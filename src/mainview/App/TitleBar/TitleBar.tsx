/** 
 * 自绘标题栏 — 品牌锁型 + 折叠侧边栏 + 菜单栏 + LOCAL 徽标 + 三大金刚键
 * 
 * 主窗口用 titleBarStyle: 'hiddenInset' 去掉了原生标题栏，所以：
 * - 拖动窗口：靠 CSS 的 app-region: drag（electrobun preload 会把它转成原生拖拽区）
 * - 最小化 / 最大化 / 关闭：走 RPC（localBridge.windowControls）
 * - 浏览器（vite dev / playwright）里没有原生窗口，整条栏照常渲染（方便调前端），但三个窗口按钮置灰——点了也没用
 */

import { createSignal, onCleanup, onMount, For, createMemo } from 'solid-js';
import { isElectrobunEnv } from '@mainview/rpc';
import { windowControls, getEnvInfo } from '@mainview/localBridge';
import { showMenu } from '@mainview/ffboxBridge';
import { state, actions } from '@mainview/store';
import { APP_MENUS, type AppMenuGroup } from './appMenu';
import { startSettingsDrag } from '../Settings/useSettingsDrag';
import { useTooltip } from 'ffbox-ui';
import { getTimeString } from '@shared/utils';
import styles from './TitleBar.module.css';
import MTGxlong from './MTG-xlong.svg';

/** 折叠侧边栏：方框 + 中间竖线，分栏线上带一点强调色 */
function CollapseSidebarIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
			<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" />
			<line x1="6.4" y1="2.6" x2="6.4" y2="13.4" stroke="var(--accent)" stroke-width="1.5" />
		</svg>
	);
}

/** 折叠右侧栏：与 CollapseSidebarIcon 对称，分栏线贴右边 */
function CollapseRightSidebarIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
			<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" />
			<line x1="9.6" y1="2.6" x2="9.6" y2="13.4" stroke="var(--accent)" stroke-width="1.5" />
		</svg>
	);
}

function MinimizeIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1">
			<line x1="2.4" y1="7" x2="11.6" y2="7" />
		</svg>
	);
}

function MaximizeIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1">
			<rect x="2.7" y="2.7" width="8.6" height="8.6" />
		</svg>
	);
}

function RestoreIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1">
			<rect x="2.7" y="4.6" width="6.7" height="6.7" />
			<path d="M4.6 4.6V2.7h6.7v6.7H9.4" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1">
			<line x1="3.1" y1="3.1" x2="10.9" y2="10.9" />
			<line x1="10.9" y1="3.1" x2="3.1" y2="10.9" />
		</svg>
	);
}

export default function TitleBar() {
	const [maximized, setMaximized] = createSignal(false);
	const [frontendEnvInfo, setFrontendEnvInfo] = createSignal<{ platform: string; arch: string; osVersion: string; appVersion: string, build: typeof buildInfo } | null>(null);
	/** 浏览器模式：整条栏照常画，但窗口按钮不可用 */
	const inNativeWindow = isElectrobunEnv();

	const serviceTooltipContent = createMemo(() => {
		const env = frontendEnvInfo();
		if (!env) return ``;
		const buildType = env.build.isDev ? '开发' : '生产';
		const buildTime = getTimeString(new Date(env.build.buildTime), false);
		return [
			`前端版本：${env.appVersion}`,
			`平台：${env.platform}`,
			`架构：${env.arch}`,
			`操作系统：${env.osVersion}`,
			`构建：${env.build.gitCommit} (${buildType})`,
			`构建时间: ${buildTime}`,
		].join('\n');
	});

	/** 回读最大化状态（窗口被系统贴边、双击标题栏等都会改变它） */
	const syncMaximized = () => {
		if (!inNativeWindow) return;
		void windowControls.isMaximized().then(setMaximized);
	};

	onMount(() => {
		syncMaximized();
		// 最大化 / 还原必然触发 resize，用它做同步信号，省得再加一条 bun → webview 的消息通道
		window.addEventListener('resize', syncMaximized);
		void getEnvInfo().then((env) => setFrontendEnvInfo(env));
	});

	onCleanup(() => window.removeEventListener('resize', syncMaximized));

	const handleMaximizeClick = async () => {
		if (!inNativeWindow) return;
		setMaximized(await windowControls.toggleMaximize());
	};

	/** 菜单挂在按钮下方弹出，triggerRect 用按钮的实际矩形 */
	const openMenu = (group: AppMenuGroup, el: HTMLElement) => {
		const rect = el.getBoundingClientRect();
		showMenu({
			menu: group.build(),
			type: 'action',
			triggerRect: { xMin: rect.left, yMin: rect.bottom, xMax: rect.right, yMax: rect.bottom },
		});
	};

	// #region 设置面板拖拽拉出（标题栏品牌区域：点击切换 + 下滑拖拽）
	// 逻辑全在 useSettingsDrag：它只把鼠标位移换算成 0~1 的进度写进 store，
	// 面板的位移 / 可见性由 Settings 自己从进度派生。
	// #endregion

	return (
		<div class={styles.titleBar}>
			{/* 品牌锁型 — 点击切换设置面板，下滑拖拽拉出。MTG-long.svg 是完整品牌词标（MINDTHEGAP + HARNESS） */}
			<div class={styles['title-bar-brand']} onmousedown={startSettingsDrag} {...useTooltip('设置面板')}>
				<MTGxlong class={styles['app-mark']} />
			</div>

			{/* 折叠 / 展开侧边栏 */}
			<button
				class={styles['title-bar-icon-btn']}
				{...useTooltip(state.ui.leftSidebarCollapsed ? '展开主侧边栏 (Ctrl+B)' : '折叠主侧边栏 (Ctrl+B)')}
				aria-label={state.ui.leftSidebarCollapsed ? '展开主侧边栏' : '折叠主侧边栏'}
				onclick={() => actions.toggleLeftSidebar()}
			>
				<CollapseSidebarIcon />
			</button>
			<button
				class={styles['title-bar-icon-btn']}
				{...useTooltip(state.ui.rightSidebarCollapsed ? '展开右侧边栏 (Ctrl+Shift+B)' : '折叠右侧边栏 (Ctrl+Shift+B)')}
				aria-label={state.ui.rightSidebarCollapsed ? '展开右侧边栏' : '折叠右侧边栏'}
				onclick={() => actions.toggleRightSidebar()}
			>
				<CollapseRightSidebarIcon />
			</button>

			{/* 菜单栏 */}
			<nav class={styles['menu-bar']}>
				<For each={APP_MENUS}>
					{(group) => (
						<button class={styles['menu-bar-item']} onclick={(e) => openMenu(group, e.currentTarget)}>
							{group.label}
						</button>
					)}
				</For>
			</nav>

			{/* 拖拽区：占了剩下的宽度，双击切换最大化 */}
			<div class={styles['title-bar-drag']} ondblclick={() => void handleMaximizeClick()} />

			{/* 运行时徽标 */}
			<div class={styles['local-badge']} {...useTooltip(serviceTooltipContent())}>
				<span class={styles['status-dot']} />
				{frontendEnvInfo() ? <span class={styles['local-badge-text']}>版本 {frontendEnvInfo()?.appVersion}</span> : null}
			</div>

			{/* 窗口控制组 */}
			<div class={styles['title-bar-buttons']}>
				<button
					aria-label="最小化窗口"
					title="最小化"
					disabled={!inNativeWindow}
					onclick={() => void windowControls.minimize()}
				>
					<MinimizeIcon />
				</button>
				<button
					aria-label={maximized() ? '向下还原窗口' : '最大化窗口'}
					title={maximized() ? '向下还原' : '最大化'}
					disabled={!inNativeWindow}
					onclick={() => void handleMaximizeClick()}
				>
					{maximized() ? <RestoreIcon /> : <MaximizeIcon />}
				</button>
				<button
					class={styles.clostBtn}
					aria-label="关闭窗口"
					title="关闭"
					disabled={!inNativeWindow}
					onclick={() => void windowControls.close()}
				>
					<CloseIcon />
				</button>
			</div>
		</div>
	);
}
