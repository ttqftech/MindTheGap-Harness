import { createSignal, onMount, onCleanup } from 'solid-js';
import { initTheme } from './theme/theme';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import Settings from './components/Settings';
import { PathInputModal } from './components/PathInputModal';
import { registerManualPathHandler, unregisterManualPathHandler } from './localBridge';
import { state, setState, actions, initApp } from './store';

export default function App() {
    let resizerRef: HTMLDivElement | undefined;
    let startX = 0;
    let startWidth = 0;
    let dragging = false;

    // 浏览器模式：手动输入文件夹路径的模态框
    const [manualPathOpen, setManualPathOpen] = createSignal(false);
    let manualPathResolve: ((path: string | null) => void) | null = null;

    onMount(() => {
        // 初始化应用（加载持久化状态）
        initApp();

        // 初始化主题
        const mode = initTheme();
        actions.setThemeMode(mode);

        // 注册浏览器模式手动输入路径的处理器
        registerManualPathHandler(() => {
            return new Promise<string | null>((resolve) => {
                manualPathResolve = resolve;
                setManualPathOpen(true);
            });
        });
    });

    onCleanup(() => unregisterManualPathHandler());

    const closeManualPath = (value: string | null) => {
        setManualPathOpen(false);
        if (manualPathResolve) {
            manualPathResolve(value);
            manualPathResolve = null;
        }
    };

    const onMouseDown = (e: MouseEvent) => {
        dragging = true;
        startX = e.clientX;
        startWidth = state.ui.sidebarWidth;
        resizerRef?.classList.add("dragging");

        const onMove = (ev: MouseEvent) => {
            if (!dragging) return;
            const newWidth = startWidth + (ev.clientX - startX);
            setState("ui", "sidebarWidth", Math.max(180, Math.min(400, newWidth)));
        };

        const onUp = () => {
            dragging = false;
            resizerRef?.classList.remove("dragging");
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <>
            <div class="app-root">
                <Sidebar />
                <div
                    ref={resizerRef!}
                    class="sidebar-resizer"
                    onmousedown={onMouseDown}
                />
                <ChatView />
            </div>

            <Settings />

            {/* 浏览器模式：手动输入文件夹路径 */}
            <PathInputModal
                open={manualPathOpen()}
                title="输入文件夹路径"
                onConfirm={(v) => closeManualPath(v)}
                onCancel={() => closeManualPath(null)}
            />
        </>
    );
}
