/**
 * 退场编排（前端侧）— 主题注册表 + 编排
 *
 * 主进程（bun/exitSequence.ts）只会说一句「要退了」，其余全在这里：
 * 铺哪套画面、放什么声音、什么时候开始收外壳、收成什么样，都是主题自己的事。
 * 加一个新主题 = 在 themes/ 下加一个目录 + 在这里登记一行，主进程一个字都不用改。
 *
 * 每个主题画面上都有一枚「打断按钮」（文案与长相是主题自己的）：
 * 按下去 = 中止这条时间轴 + 声音掐掉 + 外壳还原 + 告诉主进程这次别关了。
 * 按钮的状态与入口作为 props 交给主题的 Component（见 types.ts 的 ExitThemeProps），
 * 按钮只在外壳开始收（第二阶段）之前存在 —— 那一刻会话与 Service 已经停了，反悔也回不来；
 * 预览走同一条时间轴，不做特殊区分。
 */

import { createSignal } from 'solid-js';
import { rpc } from '@mainview/bridges/rpc';
import { stopExitAudio } from './audio';
import { createShellAnimator, sleep } from './shell';
import type { ExitTheme, ExitThemeId, ShellAnimator } from './types';
import tunnel from './themes/tunnel';
import flipboard from './themes/flipboard';
import gate from './themes/gate';
import schematic from './themes/schematic';
import turnstile from './themes/turnstile';
import blackout from './themes/blackout';
import loop from './themes/loop';
import cabin from './themes/cabin';
import escalator from './themes/escalator';
import taillight from './themes/taillight';

// #region 主题表

export const EXIT_THEMES: readonly ExitTheme[] = [
	tunnel,
	flipboard,
	gate,
	schematic,
	turnstile,
	blackout,
	loop,
	cabin,
	escalator,
	taillight,
];

/** 设置页分段控件用的选项 */
export const EXIT_THEME_OPTIONS: readonly { value: ExitThemeId; label: string }[] = EXIT_THEMES.map((t) => ({
	value: t.id,
	label: t.label,
}));

/** 当前选中的主题。持久化在 store 的 ui.exitTheme（localStorage），启动时由那边回灌 */
const [exitThemeId, setExitThemeId] = createSignal<ExitThemeId>('tunnel');

export { exitThemeId, setExitThemeId };

export function themeById(id: ExitThemeId): ExitTheme {
	return EXIT_THEMES.find((t) => t.id === id) ?? EXIT_THEMES[0];
}

// #endregion

// #region 编排

/** 正在退场的主题（null = 没在退场，ExitOverlay 不渲染） */
const [activeTheme, setActiveTheme] = createSignal<ExitTheme | null>(null);

export { activeTheme };

/**
 * 本轮的打断入口（null = 画面上没有按钮：还没开始，或已经不可打断）。
 * 存 AbortController 而不是一个回调：打断这件事本身就是 abort，没有别的事要做。
 */
const [interruptController, setInterruptController] = createSignal<AbortController | null>(null);

/** 按钮是否还有效：外壳第一次动起来（会话与 Service 已停）之后就不再可打断 */
export function interruptible(): boolean {
	const controller = interruptController();
	return controller !== null && !controller.signal.aborted;
}

/** 主题打断按钮的 onclick */
export function interruptExit(): void {
	interruptController()?.abort();
}

/**
 * 整段退场的总时长兜底：主题的时间轴卡住时也能收尾（真实退场还有主进程 20s 看门狗；
 * 预览没有，这里是唯一能把窗口还原回来的路）。
 */
const EXIT_TIMEOUT_MS = 15000;

async function runExit(theme: ExitTheme, preview: boolean) {
	if (activeTheme()) return;	// 关闭事件可能连着来好几次（Alt+F4 长按等），只接第一次
	setActiveTheme(theme);

	// 取消只有一条通道：打断按钮 → abort。外壳的逐帧循环、主题链上的每个 await 都吃它。
	const controller = new AbortController();
	const { signal } = controller;

	let shell: ShellAnimator | null = null;
	try {
		// 预览时窗口可能是最大化的（真实退场由主进程先 unmaximize），先还原，否则 setFrame 不生效。
		// 这段还没挂打断按钮，不可能被 abort，所以用普通 sleep。
		if (preview) {
			const max = await rpc.request.windowIsMaximized();
			if (max.ok && max.data) {
				await rpc.request.windowToggleMaximize();
				await sleep(350);
			}
		}

		// 到这里时间轴才真正开始，按钮随之出现：按下去 = abort，外壳与主题链同时停手
		setInterruptController(controller);
		// 外壳第一次动 = 第二阶段，按钮随之撤掉（回调由 shell 在那一刻打过来）
		shell = await createShellAnimator(preview, signal, () => setInterruptController(null));

		// 声音、画面阶段、什么时候收窗口，全是主题 run() 内部的事，这里只等它放完（或被打断 / 超时）
		await Promise.race([theme.run({ preview, shell, signal }), sleep(EXIT_TIMEOUT_MS, signal)]);
	} catch (e) {
		if (!signal.aborted) console.warn('[Exit] 退场异常，直接收尾:', e);
	} finally {
		setInterruptController(null);
	}

	// 打断与预览都是「不退出、把窗口还原回来」；差别只在打断要静音、还要告诉主进程别关
	if (signal.aborted || preview) {
		if (signal.aborted) {
			stopExitAudio();	// 主题那条链已经退栈，不会再排新的声音
			console.log('[Exit] 退场被打断，取消本次关闭');
		}
		await shell?.restore();
		setActiveTheme(null);
		if (signal.aborted && !preview) void rpc.request.exitStage({ stage: 'cancel' });
		return;
	}
	console.log('[Exit] 退场完成');
	void rpc.request.exitStage({ stage: 'finished' });
}

/** 真实退场：主进程截获关闭事件后推过来 */
export function beginExitSequence() {
	void runExit(themeById(exitThemeId()), false);
}

/** 设置页预览：完整走一遍（含收外壳），但不退出进程，结束后把窗口还原 */
export function previewExitTheme(id: ExitThemeId = exitThemeId()) {
	void runExit(themeById(id), true);
}

// 兜底通道：主进程除了推 RPC message，还会用 webview.executeJavascript 直接打这个全局钩子
// （dev 下 HMR 换掉的模块不会重建 Electroview，message handler 可能还是旧的）。两边都调，这里幂等。
(window as unknown as Record<string, unknown>).__mtgExitSequence = () => beginExitSequence();

// #endregion
