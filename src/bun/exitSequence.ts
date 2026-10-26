/**
 * 退场序列（主进程侧）— 只做基础的事：拦截关闭 → 停会话 → 通知前端 → 等前端说「放完了」→ 停后端退出。
 *
 * 主进程只给它两个原语：windowGetFrame / windowSetFrame（见 rpc-handlers.ts）。
 *
 * 拦截原理：electrobun 的 will-close 是 native 的**同步**回调（windowShouldCloseCallback 里 emit 完立刻读 event.response.allow 决定要不要 closeWindow），
 * 所以「不许关」必须在 handler 里同步写，任何 await 都来不及 —— 异步部分一律另起任务。
 */

import type { BrowserWindow } from 'electrobun/main';
import { logMsg } from './utils';

// #region 常量、类型

const EXIT_WATCHDOG_MS = 20000;	// 前端始终没上报 finish 时的兜底：宁可动画没放完，也不能让应用关不掉

export interface ExitOptions {
	getWindow: () => BrowserWindow | null;
	/** 通知前端开始退场（铺动画 + 放声音 + 收窗口） */
	notifyFrontend: () => void;
	/** 停止所有进行中的会话 */
	stopAllRuns: () => void;
	/** 停掉后端 HTTP 服务 */
	stopServer: () => void;
}

type ExitState = 'idle' | 'exiting' | 'closing';

// #endregion

// #region 状态

let state: ExitState = 'idle';
let options: ExitOptions | null = null;

// #endregion

/** 装到主窗口上：所有 WM_CLOSE 路径（右上角 / Alt+F4 / 系统菜单 / 任务栏）都会先过这里 */
export function installExitSequence(opts: ExitOptions) {
	options = opts;
	const win = opts.getWindow();
	if (!win) return;
	win.on('will-close', (event: any) => {
		// 收尾阶段是我们自己发起的 close —— 放行，别再走一遍序列
		if (state === 'closing') {
			event.response = { allow: true };
			return;
		}
		if (state === 'idle') {
			// 同步拦截：不放行，等前端把动画放完自己来收
			event.response = { allow: false };
			void runExit();
			return;
		}
		// 已经在退场还要再关一次 = 用户想立刻走（动画卡死时的唯一出路），直接收尾
		logMsg('[Exit] 退场中又收到关闭事件，立即退出');
		event.response = { allow: false };
		finish();
	});
}

/** 前端上报：动画与外壳动效都已结束 */
export function notifyExitFinished() {
	logMsg(`[Exit] 前端退场结束（当前状态 ${state}），收尾`);
	finish();
}

/** 退场是否已经开始（供其它模块判断是否还该响应交互） */
export function isExiting(): boolean {
	return state !== 'idle';
}

// #region 序列

async function runExit() {
	if (state !== 'idle' || !options) return;
	state = 'exiting';
	logMsg('[Exit] 截获关闭事件，交给前端主题走退场');

	const win = options.getWindow();
	// 最大化状态下改 frame 不生效（窗口由 shell 托管），先还原成普通窗口
	if (win?.isMaximized()) win.unmaximize();

	options.stopAllRuns();
	options.notifyFrontend();

	// 前端崩了 / 旧构建没接上新消息时，兜底放行：应用必须能退出
	setTimeout(() => {
		if (state === 'exiting') {
			logMsg('[Exit] 退场超时（前端未上报），强制退出');
			finish();
		}
	}, EXIT_WATCHDOG_MS);
}

/** 收尾：停后端 → 关窗口 → 退出进程 */
function finish() {
	if (state === 'closing' || !options) return;
	state = 'closing';
	logMsg('[Exit] 退场结束，停止后端并退出');
	options.stopAllRuns();
	options.stopServer();
	options.getWindow()?.close();
	// electrobun 关完窗口不一定会结束主进程事件循环，自己退
	setTimeout(() => process.exit(0), 400);
}

// #endregion
