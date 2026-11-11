/**
 * 折叠块的展开状态（思考 / 工具卡 / 反思 / 子 Agent 节点共用）。
 *
 * 每块有两个正交的问题：
 * ① 现在该不该展开 —— 由**默认策略**决定：只有「最后一组」（整棵树里最后那一次 LLM 调用里的所有子块）展开，
 *    其余一律折叠；每次投影重算都会重判，所以新来一个块，上一组就自动收了。
 * ② 用户手动点过没有 —— 点过就**固定**，① 再怎么变都不动它。
 *
 * 两件事用一个三值状态表达就够：
 * - `auto`：没人动过，跟着 ① 走
 * - `open` / `closed`：用户亲手点过，固定住
 *
 * ⚠️ 记录里**只存手动的那两种**，没有这个 key 就是 `auto` —— 千万别把「当前该不该展开」写进记录，否则每块都会变成手动固定，新块一来也收不回去。
 *
 * ⚠️ 用 store 而不是裸 Map：`data-open` 是一次带判重的 effect，只有它**读到的 signal 变了**才会重跑。
 *    裸 Map 写进去没有任何通知，点了没反应（旧版靠 `<details>` 原生 open 撑着，现在自己驱动，就必须可响应）。
 *    按 key 细粒度跟踪，点一个块只重跑它自己那条 effect。
 */
import { createStore } from 'solid-js/store';

/** 用户手动固定下来的状态（记录里只会出现这两个值） */
export type FixedOpenState = 'open' | 'closed';

export interface OpenState {
	/** 这一块此刻该不该展开：手动过就用固定的那个值，否则跟 `autoOpen`（= 它是不是最后一组）走 */
	isOpen(key: string, autoOpen: boolean): boolean;
	/** 用户点了头部：翻转后固定下来 */
	toggle(key: string, nextOpen: boolean): void;
}

/** key 见各块的构造处：`tool:<callId>` / `reasoning:<key>` / `reflection:<key>` / `node:<agentInstanceId>` */
export function createOpenState(): OpenState {
	const [fixed, setFixed] = createStore<Record<string, FixedOpenState>>({});	// 用 createStore 而不是 createSignal，因为 store 有 key 级别的响应式，而 signal 需要整块替换，需要所有用到 isOpen 的地方都重新计算
	return {
		isOpen(key, autoOpen) {
			const f = fixed[key];
			return f ? f === 'open' : autoOpen;
		},
		toggle(key, nextOpen) {
			setFixed(key, nextOpen ? 'open' : 'closed');
		},
	};
}
