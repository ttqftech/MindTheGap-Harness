/* ==========================================================================
   当前 run 的全局把手

   run 的生命周期归 ChatView 管，但外壳（标题栏菜单 / 全局快捷键 / 会话头部）
   也要能显示「运行中」并触发停止。这里只做一层极薄的桥，不搬运任何业务：
     ChatView 每轮把「是否在飞」镜像进来、把停止回调登记进来；
     外壳只读 `running()` / 调 `stopRun()`。
   ========================================================================== */

import { createSignal } from 'solid-js';

/** 是否有 run 在飞（ChatView 的 isGenerating 的镜像） */
const [running, setRunningSignal] = createSignal(false);
export { running };

/** 由 ChatView 在 createEffect 里镜像 isGenerating */
export function mirrorRunning(value: boolean) {
	setRunningSignal(value);
}

let stopHandler: (() => void) | null = null;

/** 由 ChatView 挂载时登记 / 卸载时注销 */
export function registerStop(handler: (() => void) | null) {
	stopHandler = handler;
}

/** 供菜单 / 快捷键调用；没有在飞的 run 时是空操作 */
export function stopRun() {
	stopHandler?.();
}
