/**
 * 聊天区的「贴底跟随」：用户停在底部时，内容长高就跟到底；滚上去了就不打扰。
 *
 * ⚠️ **别指望浏览器自动做这件事**。Chrome 只有 scroll anchoring（保证「你正在看的那一行别乱跳」），
 *    内容**追加在下方**时它不会把你带到新的底部，所以「贴底」必须自己实现。
 * ⚠️ **也别只在 SSE 增量时滚一次**（旧实现就是在 tick 里量一次 `scrollHeight` 再赋 `scrollTop`）：
 *    内容变高的来源远不止流式文本 —— 折叠块开合动画、```html 预览 iframe 提交 srcdoc、图片加载完、run 结束把在飞 overlay 换成已提交 ctx、切会话……**这些都没有 tick**，于是「有时候灵有时候不灵」。
 *    真正的触发点只能是**高度变化本身**，所以这里用 ResizeObserver。
 *
 * 为什么用 RO 而不是「每次更新后再量一遍」：
 * - RO 在 layout 之后、paint 之前回调，赋值 scrollTop 不会闪；
 * - 它天然覆盖「一帧里长高了多次」（动画每帧触发一次，跟随是连续的，不是跳跃）；
 * - 不用跟 CSS 过渡 / transitionend 抢时序。
 */

/** 「算贴底」的容差：太大会把「刚往上翻两行」的人也拽回底部，太小会被小数高度差骗到 */
export const FOLLOW_BOTTOM_THRESHOLD = 24;

export interface BottomFollow {
	jump(): void;	// 强制落到底部并恢复跟随（发送消息、切会话这类「必须让用户看到最新内容」的场合）
	dispose(): void;	// 拆掉监听 / 观察（元素要没了，或换了个新的滚动容器）
}

/**
 * 给一个滚动容器挂上贴底跟随。容器自己必须是 `overflow-y: auto` 的那一层，
 * 内容装在它的**直接子节点**里（子节点会整体换：空态 ↔ 消息列表 ↔ 错误块，所以要重新挂观察）。
 */
export function attachBottomFollow(el: HTMLElement): BottomFollow {
	/** 是否跟随：由用户当前停在哪儿决定，只有用户自己滚上去才会关掉 */
	let stick = true;

	/**
	 * 我们最后一次把 scrollTop 放到的位置。
	 *
	 * ⚠️ scroll 事件是**异步**派发的（下一帧的 scroll steps），等它到达时内容可能又长了一截 ——
	 *    那时 `distanceFromBottom()` 已经不是 0，若照它下结论就会把「我自己滚的」误判成「用户滚上去了」，
	 *    `stick` 一假，后面再也不跟随（实测：连着来 10 次增量，只跟住了第 1 次）。
	 *    所以用「位置没动过 ⇒ 这条 scroll 是我自己的回声」把它挡掉。
	 */
	let appliedScrollTop = -1;

	const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;

	const scrollToBottom = () => {
		el.scrollTop = el.scrollHeight;
		appliedScrollTop = el.scrollTop;	// 读回真实值（超出最大滚动量时会被 clamp）
	};

	/** 用户滚上去了就停止跟随；回到底部（包括我们自己滚的）再恢复 */
	const onScroll = () => {
		if (Math.abs(el.scrollTop - appliedScrollTop) < 1) return;
		stick = distanceFromBottom() <= FOLLOW_BOTTOM_THRESHOLD;
	};
	el.addEventListener('scroll', onScroll, { passive: true });

	const ro = new ResizeObserver(() => {
		if (stick) scrollToBottom();
	});

	/** 直接子节点换过 → 观察目标也要跟着换（`observe()` 会立刻投递一次当前尺寸，正好当作一次对齐） */
	const syncTargets = () => {
		ro.disconnect();
		for (const child of Array.from(el.children)) ro.observe(child);
	};
	const mo = new MutationObserver(syncTargets);
	mo.observe(el, { childList: true });
	syncTargets();

	return {
		jump() {
			stick = true;
			scrollToBottom();
		},
		dispose() {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
			mo.disconnect();
		},
	};
}
