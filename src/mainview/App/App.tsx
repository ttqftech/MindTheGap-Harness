import { onMount, onCleanup, createEffect, Show } from 'solid-js';
import type { FFBoxThemeProvider } from 'ffbox-ui';
import { initTheme, resolvedTheme, applyDensity, applyAccent } from '../theme/theme';
import TitleBar from './TitleBar/TitleBar';
import Sidebar from './SideBar/Sidebar';
import ChatView from './ChatView/ChatView';
import RightSidebar from './RightSidebar/RightSidebar';
import Settings from './Settings/Settings';
import { setFFBoxContainer } from '../ffboxBridge';
import { state, setState, actions, initApp, getActiveConversation, isConversationAlive } from '../store';
import { newTask } from '../appCommands';
import { stopRun, initRunController } from '../runController';
import styles from './App.module.css';

export default function App() {
	let resizerRef: HTMLDivElement | undefined;
	/** 右侧栏（任务清单）拖拽条 */
	let rightResizerRef: HTMLDivElement | undefined;
	/** FFBox-UI 主题提供者：所有 ffbox 组件都必须在它的子树内才能继承主题 */
	let themeProviderEl: FFBoxThemeProvider | undefined;
	let startX = 0;
	let startWidth = 0;
	let dragging = false;

	/**
	 * 侧边栏拖拽工厂：左右两根拖拽条逻辑基本一致（钳位 180–400、拖时给条加 dragging 类、
	 * 全局 mousemove/mouseup），只是控制的宽度字段、DOM 引用、以及方向不同。
	 * 左侧栏：鼠标右移 → 宽度增大（delta 正）；
	 * 右侧栏：鼠标右移 → 宽度减小（delta 取反）。
	 */
	const createResizeHandler = (resizer: HTMLDivElement | undefined, widthKey: 'leftSidebarWidth' | 'rightSidebarWidth', invertDirection = false) =>
		(e: MouseEvent) => {
			e.preventDefault();	// 避免触发选中
			dragging = true;
			startX = e.clientX;
			startWidth = state.ui[widthKey];
			resizer?.classList.add(styles.dragging);

			const onMouseMove = (ev: MouseEvent) => {
				if (!dragging) return;
				const delta = invertDirection ? -(ev.clientX - startX) : (ev.clientX - startX);
				const newWidth = startWidth + delta;
				setState('ui', widthKey, Math.max(180, Math.min(400, newWidth)));
			};

			const onMouseUp = () => {
				dragging = false;
				resizer?.classList.remove(styles.dragging);
				window.removeEventListener('mousemove', onMouseMove);
				window.removeEventListener('mouseup', onMouseUp);
			};

			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		};

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
			actions.toggleLeftSidebar();
			return;
		}
		// Ctrl+Shift+B：折叠 / 展开右侧栏（任务清单）。不占用 Ctrl+B，与左侧边栏快捷键区分。
		if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
			e.preventDefault();
			actions.toggleRightSidebar();
			return;
		}
		if (mod && e.key === ',') {
			e.preventDefault();
			actions.openSettings();
			return;
		}
		// esc：设置面板开着时先关面板（优先于中断运行），避免抢掉弹窗 / 下拉的关闭手势
		if (e.key === 'Escape' && state.ui.settingsProgress > 0) {
			e.preventDefault();
			actions.closeSettings();
			return;
		}
		// esc 中断运行：只在**当前会话**真的有 run 在飞时接管（running 或 waiting）
		if (e.key === 'Escape' && isConversationAlive(getActiveConversation())) {
			e.stopPropagation();
			stopRun();
		}
	};

	onMount(() => {
		window.addEventListener('keydown', onKeyDown);
	});
	onCleanup(() => window.removeEventListener('keydown', onKeyDown));

	const onLeftBarMouseDown = createResizeHandler(resizerRef, 'leftSidebarWidth');
	const onRightBarMouseDown = createResizeHandler(rightResizerRef, 'rightSidebarWidth', true);

	return (
		<ffbox-theme-provider ref={themeProviderEl} class={styles['ffbox-theme-provider']} prop:theme={resolvedTheme()}>
			<div class={styles['app-shell']}>
				<TitleBar />
				<div class={styles.clientArea}>
					<Sidebar />
					{/* 侧边栏收起时不给拖拽条，否则会留下一条 4px 的死区 */}
					<Show when={!state.ui.leftSidebarCollapsed}>
						<div ref={resizerRef!} class={styles.sidebarResizer} onmousedown={onLeftBarMouseDown} />
					</Show>
					<ChatView />
					{/* 右侧栏（任务清单）：收起时同样不给拖拽条，避免 4px 死区 */}
					<Show when={!state.ui.rightSidebarCollapsed}>
						<div ref={rightResizerRef!} class={styles.rightSidebarResizer} onmousedown={onRightBarMouseDown} />
					</Show>
					<RightSidebar />
					<Settings />
				</div>
			</div>
		</ffbox-theme-provider>
	);
}