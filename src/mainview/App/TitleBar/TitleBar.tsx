/* ==========================================================================
   自绘标题栏 — 无边框窗口的三大金刚键

   主窗口用 titleBarStyle: 'hidden' 去掉了原生标题栏，所以：
   - 拖动窗口：靠 CSS 的 app-region: drag（electrobun preload 会把它转成原生拖拽区）
   - 最小化 / 最大化 / 关闭：走 RPC（localBridge.windowControls）
   - 浏览器（vite dev / playwright）里没有原生窗口，整条标题栏不渲染
   ========================================================================== */

import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { isElectrobunEnv } from '../../rpc';
import { windowControls } from '../../localBridge';
import styles from './TitleBar.module.css';

/** 最小化：一条横线 */
function MinimizeIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10">
			<line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
		</svg>
	);
}

/** 最大化：空心方框 */
function MaximizeIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10">
			<rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
		</svg>
	);
}

/** 还原：两个叠放的方框 */
function RestoreIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10">
			<rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
			<rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
		</svg>
	);
}

/** 关闭：叉 */
function CloseIcon() {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10">
			<line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1" />
			<line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1" />
		</svg>
	);
}

export default function TitleBar() {
	const [maximized, setMaximized] = createSignal(false);

	/** 回读最大化状态（窗口被系统贴边、双击标题栏等都会改变它） */
	const syncMaximized = () => {
		void windowControls.isMaximized().then(setMaximized);
	};

	onMount(() => {
		syncMaximized();
		// 最大化 / 还原必然触发 resize，用它做同步信号，省得再加一条 bun → webview 的消息通道
		window.addEventListener('resize', syncMaximized);
	});

	onCleanup(() => window.removeEventListener('resize', syncMaximized));

	const handleMaximizeClick = async () => {
		setMaximized(await windowControls.toggleMaximize());
	};

	return (
		<Show when={isElectrobunEnv()}>
			<div class={styles['title-bar']}>
				{/* 拖拽区：同时充当标题显示区，双击切换最大化 */}
				<div
					class={styles['title-bar-drag']}
					ondblclick={() => void handleMaximizeClick()}
				>
					<span class={styles['title-bar-text']}>MindTheGap-Harness</span>
				</div>

				<div class={styles['title-bar-buttons']}>
					<button
						class={styles['title-bar-btn']}
						aria-label="最小化窗口"
						title="最小化"
						onclick={() => void windowControls.minimize()}
					>
						<MinimizeIcon />
					</button>
					<button
						class={styles['title-bar-btn']}
						aria-label={maximized() ? '向下还原窗口' : '最大化窗口'}
						title={maximized() ? '向下还原' : '最大化'}
						onclick={() => void handleMaximizeClick()}
					>
						<Show when={maximized()} fallback={<MaximizeIcon />}>
							<RestoreIcon />
						</Show>
					</button>
					<button
						class={`${styles['title-bar-btn']} ${styles['title-bar-close']}`}
						aria-label="关闭窗口"
						title="关闭"
						onclick={() => void windowControls.close()}
					>
						<CloseIcon />
					</button>
				</div>
			</div>
		</Show>
	);
}
