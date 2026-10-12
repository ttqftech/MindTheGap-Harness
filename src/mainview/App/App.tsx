import { onMount, onCleanup, createEffect, Show } from 'solid-js';
import type { FFBoxThemeProvider } from 'ffbox-ui';
import { initTheme, resolvedTheme, applyDensity, applyAccent } from '../theme/theme';
import TitleBar from './TitleBar/TitleBar';
import Sidebar from './SideBar/Sidebar';
import ChatView from './ChatView/ChatView';
import Settings from './Settings/Settings';
import { setFFBoxContainer } from '../ffboxBridge';
import { state, setState, actions, initApp, getActiveConversation, isConversationAlive } from '../store';
import { newTask } from '../appCommands';
import { stopRun, initRunController } from '../runController';
import styles from './App.module.css';

export default function App() {
	let resizerRef: HTMLDivElement | undefined;
	/** FFBox-UI 主题提供者：所有 ffbox 组件都必须在它的子树内才能继承主题 */
	let themeProviderEl: FFBoxThemeProvider | undefined;
	let startX = 0;
	let startWidth = 0;
	let dragging = false;

	onMount(() => {
		// 初始化应用（加载持久化状态）
		initApp();

		// 把「刷新页面时后端仍在跑」的会话接回 SSE（订阅是应用级的，见 runController 的说明）
		initRunController();

		// 初始化主题
		const mode = initTheme();
		actions.setThemeMode(mode);

		// 命令式 ffbox 组件（菜单 / 对话框）挂到主题提供者上，保证能继承主题
		setFFBoxContainer(themeProviderEl);
	});

	onCleanup(() => {
		setFFBoxContainer(undefined);
	});

	// 界面密度 / 强调色：store 是真相源，这里落到 <html> 的类名上（令牌见 theme/theme.css）
	createEffect(() => applyDensity(state.ui.density));
	createEffect(() => applyAccent(state.ui.accent));

	// 全局快捷键：外壳级命令，和标题栏菜单走同一批 appCommands
	const onKeyDown = (e: KeyboardEvent) => {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
			e.preventDefault();
			void newTask();
			return;
		}
		if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
			e.preventDefault();
			actions.toggleSidebar();
			return;
		}
		if (mod && e.key === ',') {
			e.preventDefault();
			actions.openSettings();
			return;
		}
		// esc 中断运行：只在**当前会话**真的有 run 在飞时接管（running 或 waiting），避免抢掉弹窗 / 下拉的关闭手势
		if (e.key === 'Escape' && isConversationAlive(getActiveConversation())) {
			e.stopPropagation();
			stopRun();
		}
	};

	onMount(() => {
		window.addEventListener('keydown', onKeyDown);
	});
	onCleanup(() => window.removeEventListener('keydown', onKeyDown));

	const onMouseDown = (e: MouseEvent) => {
		e.preventDefault();	// 避免触发选中
		dragging = true;
		startX = e.clientX;
		startWidth = state.ui.sidebarWidth;
		resizerRef?.classList.add(styles.dragging);

		const onMouseMove = (ev: MouseEvent) => {
			if (!dragging) return;
			const newWidth = startWidth + (ev.clientX - startX);
			setState("ui", "sidebarWidth", Math.max(180, Math.min(400, newWidth)));
		};

		const onMouseUp = () => {
			dragging = false;
			resizerRef?.classList.remove(styles.dragging);
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	return (
		<ffbox-theme-provider ref={themeProviderEl} class={styles['ffbox-theme-provider']} prop:theme={resolvedTheme()}>
			<div class={styles['app-shell']}>
				<TitleBar />
				<div class={styles.clientArea}>
					<Sidebar />
					{/* 侧边栏收起时不给拖拽条，否则会留下一条 4px 的死区 */}
					<Show when={!state.ui.sidebarCollapsed}>
						<div ref={resizerRef!} class={styles.sidebarResizer} onmousedown={onMouseDown} />
					</Show>
					<ChatView />
				</div>
			</div>
			<Settings />
		</ffbox-theme-provider>
	);
}
