/**
 * 退场（主进程侧）— 拦关闭，然后按前端报来的阶段收尾。
 *
 * 前端全程只用一条 RPC 报进度（`exitStage`），主进程不需要知道有几个主题、几段动画：
 *   collapse → 外壳开始收了（画面已进入尾声）：先停会话 + 停 Service，窗口留着让动画放完
 *   finished → 动画放完：关窗口、退进程
 *   cancel   → 用户按了画面上的打断按钮（外壳已还原）：回到 idle，窗口留着别关
 *
 * ⚠️ 打断只在第二阶段之前有效：一旦收到过 collapse（后端已经停了、会话也取消了）就不再认 cancel。
 *    前端同步在 collapse 那一刻撤掉按钮，两边各挡一道。
 *
 * 这里对原生窗口只碰「最大化还原」「关窗」和「打断后把最大化还原回去」，动效全靠前端（windowGetFrame / windowSetFrame）。
 *
 * 拦截原理：electrobun 的 will-close 是 native 的**同步**回调（windowShouldCloseCallback 里
 * emit 完立刻读 event.response.allow 决定要不要 closeWindow），所以「不许关」必须同步写，
 * 任何 await 都来不及 —— 异步部分一律另起任务。
 */

import type { BrowserWindow } from 'electrobun/main';
import { cancelAllRuns, stopService } from './service';
import { logMsg } from '../shared/utils';

// #region 常量、状态

const EXIT_WATCHDOG_MS = 20000;	// 前端始终没上报时的兜底：宁可动画没放完，也不能让应用关不掉
const SHUTDOWN_WAIT_MS = 4000;	// 等后端停干净的上限（stopService 自带 3s 优雅停机 + 强杀）

type ExitState = 'idle' | 'exiting' | 'closing';

let state: ExitState = 'idle';
let win: BrowserWindow | null = null;

/** 看门狗句柄：退场被打断要撤掉，否则它会把下一次退场中途掐死 */
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** 关闭事件到来时窗口是不是最大化的（打断后要还回去；frame 由前端 shell.restore 还原） */
let wasMaximized = false;

/** 停后端只做一次：collapse 先停一次，finished / 兜底再进来复用同一个 Promise */
let stoppingBackend: Promise<void> | null = null;

// #endregion

// #region 对外两个入口

/**
 * 建窗口后调用一次：挂上关闭拦截。
 * 所有关闭路径（右上角 / Alt+F4 / 系统菜单 / 任务栏）都会先过这里。
 */
export function attachExit(window: BrowserWindow, notifyFrontend: () => void) {
	win = window;

	window.on('will-close', (event: any) => {
		if (state === 'closing') {
			// 收尾阶段是我们自己发起的 close —— 放行，别再走一遍序列
			event.response = { allow: true };
			return;
		}

		// 不放行：等前端把动画放完自己来收
		event.response = { allow: false };

		if (state === 'exiting') {
			// 退场中又关一次 = 用户想立刻走（动画卡死时的唯一出路）
			finish('退场中又收到关闭事件');
			return;
		}

		state = 'exiting';
		logMsg('[Exit] 截获关闭事件，交给前端放退场动画');

		// 最大化状态下改 frame 不生效（窗口由 shell 托管），先还原成普通窗口
		wasMaximized = window.isMaximized();
		if (wasMaximized) window.unmaximize();

		notifyFrontend();
		watchdog = setTimeout(() => {
			if (state === 'exiting') finish('前端未上报动画结束');
		}, EXIT_WATCHDOG_MS);
	});
}

/** 前端报进度：外壳开始收 / 动画放完 / 被打断按钮取消 */
export function reportExitStage(stage: 'collapse' | 'finished' | 'cancel') {
	if (state === 'closing') return;

	if (stage === 'cancel') {
		// 只在真退场途中认：没在退场就收到 cancel（旧前端 / 预览误报）什么也不该发生
		// stoppingBackend 非空 = 已进第二阶段（后端停过，会话找不回了），此时打断无效
		if (state !== 'exiting' || stoppingBackend !== null) return;
		state = 'idle';
		if (watchdog) {
			clearTimeout(watchdog);
			watchdog = null;
		}
		logMsg('[Exit] 收到打断，取消本次关闭');

		// 前端这条是在 shell.restore() 之后才发的，外框已经落回原位，此刻最大化回去不会打架
		if (wasMaximized) {
			wasMaximized = false;
			win?.maximize();
		}
		return;
	}

	if (stage === 'collapse') {
		// 只在真退场途中接受：没在退场就收到 collapse（旧前端 / 异常路径）不能把后端停了
		if (state !== 'exiting') return;
		// 画面已进入尾声，后端可以先走；窗口还在，动画继续放完
		logMsg('[Exit] 外壳开始收，先停会话与后端');
		void stopBackend();
		return;
	}

	finish('前端上报动画放完');
}

// #endregion

// #region 内部

/** 停会话 + 停 Service（幂等；管理员设了密码时第一步会 401，见 service.cancelAllRuns 注释） */
function stopBackend(): Promise<void> {
	stoppingBackend ??= (async () => {
		// 并发：某个会话取消失败/卡住也不能耽误 shutdown（shutdown 自己还会在服务端 cancelAllRunners）
		await Promise.all([cancelAllRuns(), stopService()]);
	})();
	return stoppingBackend;
}

/** 收尾：先关窗（立刻），等后端停干净再退进程 */
function finish(reason: string) {
	if (state === 'closing') return;
	state = 'closing';
	logMsg(`[Exit] 收尾关窗（${reason}）`);

	win?.close();

	// 窗口先消失，别让用户等后端；进程等 Service 停干净再退（最多 SHUTDOWN_WAIT_MS）
	void Promise.race([stopBackend(), new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS))]).then(() => {
		logMsg('[Exit] 后端已停，进程退出');
		process.exit(0);
	});
}

// #endregion
