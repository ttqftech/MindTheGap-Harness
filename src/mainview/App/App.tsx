import { onMount, onCleanup } from 'solid-js';
import type { FFBoxThemeProvider } from 'ffbox-ui';
import { initTheme, resolvedTheme } from '../theme/theme';
import TitleBar from './TitleBar/TitleBar';
import Sidebar from './SideBar/Sidebar';
import ChatView from './ChatView/ChatView';
import Settings from './Settings/Settings';
import { setFFBoxContainer } from '../ffboxBridge';
import { state, setState, actions, initApp } from '../store';
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

        // 初始化主题
        const mode = initTheme();
        actions.setThemeMode(mode);

        // 命令式 ffbox 组件（菜单 / 对话框）挂到主题提供者上，保证能继承主题
        setFFBoxContainer(themeProviderEl);
    });

    onCleanup(() => {
        setFFBoxContainer(undefined);
    });

    const onMouseDown = (e: MouseEvent) => {
        dragging = true;
        startX = e.clientX;
        startWidth = state.ui.sidebarWidth;
        resizerRef?.classList.add(styles.dragging);

        const onMove = (ev: MouseEvent) => {
            if (!dragging) return;
            const newWidth = startWidth + (ev.clientX - startX);
            setState("ui", "sidebarWidth", Math.max(180, Math.min(400, newWidth)));
        };

        const onUp = () => {
            dragging = false;
            resizerRef?.classList.remove(styles.dragging);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <ffbox-theme-provider
            ref={themeProviderEl}
            class={styles['ffbox-theme-provider']}
            prop:theme={resolvedTheme()}
        >
            <div class={styles['app-shell']}>
                {/* 无边框窗口的自绘标题栏（浏览器模式下自行隐藏） */}
                <TitleBar />

                <div class={styles['app-root']}>
                    <Sidebar />
                    <div
                        ref={resizerRef!}
                        class={styles['sidebar-resizer']}
                        onmousedown={onMouseDown}
                    />
                    <ChatView />
                </div>
            </div>

            <Settings />
        </ffbox-theme-provider>
    );
}
