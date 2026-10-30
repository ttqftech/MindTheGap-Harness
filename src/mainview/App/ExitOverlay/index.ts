/**
 * 退场编排（前端侧）— 主题注册表 + 编排
 *
 * 主进程（bun/exitSequence.ts）只会说一句「要退了」，其余全在这里：
 * 铺哪套画面、放什么声音、什么时候开始收外壳、收成什么样，都是主题自己的事。
 * 加一个新主题 = 在 themes/ 下加一个目录 + 在这里登记一行，主进程一个字都不用改。
 */

import { createSignal } from 'solid-js';
import { rpc } from '@mainview/bridges/rpc';
import { createShellAnimator, sleep } from './shell';
import type { ExitTheme, ExitThemeId } from './types';
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
 * 整段退场的总时长兜底：主题的时间轴卡住时也能收尾（真实退场还有主进程 20s 看门狗；
 * 预览没有，这里是唯一能把窗口还原回来的路）。
 */
const EXIT_TIMEOUT_MS = 15000;

async function runExit(theme: ExitTheme, preview: boolean) {
	if (activeTheme()) return;	// 关闭事件可能连着来好几次（Alt+F4 长按等），只接第一次
	setActiveTheme(theme);

	// 预览时窗口可能是最大化的（真实退场由主进程先 unmaximize），先还原，否则 setFrame 不生效
	if (preview) {
		const max = await rpc.request.windowIsMaximized();
		if (max.ok && max.data) {
			await rpc.request.windowToggleMaximize();
			await sleep(350);
		}
	}

	const shell = await createShellAnimator(preview);

	try {
		// 声音、画面阶段、什么时候收窗口，全是主题 run() 内部的事，这里只等它放完
		await Promise.race([theme.run({ preview, shell }), sleep(EXIT_TIMEOUT_MS)]);
	} catch (e) {
		console.warn('[Exit] 退场异常，直接收尾:', e);
	}

	if (preview) {
		await shell.restore();
		setActiveTheme(null);
		return;
	}
	console.log('[Exit] 退场完成');
	void rpc.request.exitFinished();
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
