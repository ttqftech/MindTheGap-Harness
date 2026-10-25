import { createSignal } from 'solid-js';
import type { ExitPhase } from './types';

/**
 * 退场阶段的唯一真相（主题组件直接读它，不经过 props —— 省一条组件间的依赖）。
 * null = 没在退场，ExitOverlay 不渲染。
 */
const [exitPhase, setExitPhase] = createSignal<ExitPhase | null>(null);

export { exitPhase, setExitPhase };
