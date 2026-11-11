import type { JSX } from 'solid-js';
import styles from './RenderTree.module.css';

/**
 * 可开合的块：头部（点它 / 按 Enter、空格） + 带高度动画的内容区。
 * 思考、工具卡、反思、子 Agent 节点四处共用，只是类名不同。
 *
 * ⭐ 高度动画**不测量**：内容区是一个 `grid-template-rows: 0fr ↔ 1fr` 的过渡（见 CSS 的 .collapsible）。
 *    - 展开态的高度由内容自己撑开，流式变高时 `1fr` 即时跟上，不会每来一个字就重新计时；
 *    - 只有 0 与 1 之间的切换才有过渡，所以「新块插入 / 老组自动收起」也自带动画。
 *    （用 `height: auto` 做不到过渡；量高度写 px 的话，流式期间每帧都得重量，还得跟 transitionend 抢时序。）
 *
 * ⚠️ `data-open` 挂两处：外层给头部 caret 的旋转用，过渡层给自己的 0fr↔1fr 用（两者不在同一层）。
 *    用空串 / undefined 表达有无，而不是 true/false —— `data-open="false"` 也是**存在**的属性，
 *    `[data-open]` 照样命中的坑。
 */
export default function Collapsible(props: {
	/** 当下该不该展开：调用方用 `openState.isOpen(key, auto)` 现算（读的是 store，本身响应式） */
	open: boolean;
	/** 用户点了头部 */
	onToggle: () => void;
	class?: string;
	classList?: Record<string, boolean | undefined>;
	headClass: string;
	bodyClass: string;
	head: JSX.Element;
	onContextMenu?: (e: MouseEvent) => void;
	children: JSX.Element;
}) {
	const flag = () => (props.open ? '' : undefined);
	return (
		<div class={props.class} classList={props.classList ?? {}} data-open={flag()} oncontextmenu={props.onContextMenu}>
			<div
				class={props.headClass}
				role="button"
				tabindex="0"
				aria-expanded={props.open}
				onclick={() => props.onToggle()}
				onkeydown={(e) => {
					// 只接 Enter / 空格（`role="button"` 的约定）；别拦 Tab 之类的键盘导航
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						props.onToggle();
					}
				}}
			>
				{props.head}
			</div>
			<div class={styles.collapsible} data-open={flag()}>
				<div class={styles.clip}>
					<div class={props.bodyClass}>{props.children}</div>
				</div>
			</div>
		</div>
	);
}
