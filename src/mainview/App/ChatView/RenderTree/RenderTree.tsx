import { Index, For, Show, Switch, Match } from 'solid-js';
import { useTooltip } from 'ffbox-ui';
import type { RenderAgentNode, RenderBlock, RenderLlmBlock, RenderSubBlock, RenderToolSub, RunUsage } from '@mainview/logic/projection';
import { runOfTurn } from '@mainview/logic/projection';
import type { UsageEntry } from '@shared/agent';
import { answerAskUser } from '@mainview/logic/runController';
import { showMenu } from '@mainview/bridges/ffboxBridge';
import AskUserCard from '@mainview/App/ChatView/AskUserCard/AskUserCard';
import { showRequestDetailMsgbox } from './requestDetail';
import {
	ReflectionIcon, McpIcon,
	TOOL_ARGS_LIMIT, TOOL_OUTPUT_LIMIT, PURPOSE_LABEL, STATUS_LABEL,
	truncateWithNote, fmtUsageTriple, USAGE_GLYPH, fmtDuration, fmtClock, fmtSize, parseMcpName,
} from './shared';
import styles from './RenderTree.module.css';

/**
 * 摘要胶囊的悬浮明细：表面只显示合计，这里摊开「合计是怎么加起来的」。
 */
function runSummaryTooltip(run: RunUsage): string {
	const lines = ['本次发言（含子 Agent 与反思）'];
	// 图例只在真有缓存命中时给：没有 ⟳ 的账本不需要解释 ⟳
	if (run.total.cached > 0) {
		lines.push(`${USAGE_GLYPH.cached} 命中缓存　${USAGE_GLYPH.input} 新增输入　${USAGE_GLYPH.output} 输出`);
	}
	lines.push(`本 Agent · ${run.own.calls} 次  ${fmtUsageTriple(run.own.input, run.own.cached, run.own.output)}`);
	if (run.reflection.calls > 0) {
		lines.push(`反思 · ${run.reflection.calls} 次  ${fmtUsageTriple(run.reflection.input, run.reflection.cached, run.reflection.output)}`);
	}
	if (run.toolSub.calls > 0) {
		lines.push(`工具内请求 · ${run.toolSub.calls} 次  ${fmtUsageTriple(run.toolSub.input, run.toolSub.cached, run.toolSub.output)}`);
	}
	if (run.children.calls > 0) {
		lines.push(`子 Agent · ${run.childAgents} 个 / ${run.children.calls} 次  ${fmtUsageTriple(run.children.input, run.children.cached, run.children.output)}`);
	}
	return lines.join('\n');
}

/**
 * 渲染树组件：把 RenderAgentNode 树投影成 JSX。
 *
 * 聊天视图和图示视图共享同一份渲染树数据，只是投影方式不同——
 * 本组件负责「聊天消息列表」这种投影。
 */
export default function RenderTreeView(props: { tree: RenderAgentNode; openOverrides: Map<string, boolean>; convId: string }) {
	const { openOverrides, convId } = props;

	/** 一次 LLM 调用的账本：贴在所属块的**下方**（它是那次调用自带的一条数据，不是独立条目） */
	const renderUsage = (usage: UsageEntry) => {
		const parts: string[] = []
		parts.push(`#${usage.seq ?? '?'}`);
		if (usage.round) parts.push(`第 ${usage.round} 轮`);
		parts.push(fmtUsageTriple(usage.input, usage.cached, usage.output));
		const duration = fmtDuration(usage.durationMs);
		if (duration) parts.push(duration);
		if (usage.purpose && usage.purpose !== 'agent_loop') {
			parts.push(PURPOSE_LABEL[usage.purpose] ?? usage.purpose);
		}
		parts.push(usage.model);
		return (
			<div class={styles['agent-block-usage']}>
				<span class={styles['agent-usage-text']}>{parts.join(' · ')}</span>
			</div>
		);
	};

	/**
	 * 一个 LLM 块的右键菜单：导出这次请求**真正发给模型**的 messages 全文。
	 *
	 * logId 来自该块自己的账本（`usage.logId`）；块还在飞、账本还没落地时置灰。
	 * 菜单挂在鼠标处而不是块上 —— 一次调用的块可能很长，用块矩形会飘到很远。
	 *
	 * ⚠️ 必须 `stopPropagation`：子 Agent 的块是**嵌在**父块的 `.block-llm` 里的
	 *    （委托工具 → `.agent-tool-children` → 子节点 → 子块），不拦的话右键子块
	 *    会一路冒到外层，最后弹出来的是外层那次调用的菜单。
	 */
	const openLlmBlockMenu = (e: MouseEvent, block: RenderLlmBlock) => {
		e.preventDefault();
		e.stopPropagation();
		/**
		 * 右键那一刻给这条消息来一道扫光，**菜单关闭时**再把类摘掉。
		 *
		 * 只加/删一个 class，不参与投影与 diff —— 纯视觉反馈，不能让它进入渲染树（否则每次扫光都触发重算）。
		 * 同一元素连点要能重放：先摘类、强制回流、再挂类。
		 * 动画本身是 `forwards` 的，挂到菜单关闭为止不会残留光带，只保证菜单开着时这一块一直是「被选中」的那一条。
		 */
		const sweepTarget = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
		if (sweepTarget) {
			sweepTarget.classList.remove(styles.sweep);
			void sweepTarget.offsetWidth;	// 强制回流，否则第二次点同一个块动画不会重播
			sweepTarget.classList.add(styles.sweep);
		}
		const usage = block.usages?.find((u) => u.logId) ?? block.usages?.[0];
		const logId = usage?.logId;
		showMenu({
			type: 'action',
			triggerRect: { xMin: e.clientX, yMin: e.clientY, xMax: e.clientX, yMax: e.clientY },
			menu: [
				{
					type: 'normal',
					value: 'export-detail',
					label: '查看这条 LLM 请求的详细信息…',
					disabled: !logId,
					onClick: () => {
						if (logId) showRequestDetailMsgbox(convId, logId, usage?.seq);
					},
				},
			],
			onClose: () => {
				sweepTarget?.classList.remove(styles.sweep);
			}
		});
	};

	/** 某个位置当前的子块是什么类型（类型不符给 undefined，让 `<Match>` 判假落到下一个分支） */
	function subTypeEquals<T extends RenderSubBlock['type']>(sub: () => RenderSubBlock, type: T): Extract<RenderSubBlock, { type: T }> | undefined {
		const s = sub();
		return s.type === type ? (s as Extract<RenderSubBlock, { type: T }>) : undefined;
	}

	/**
	 * 一次工具调用的卡片：一行摘要（状态 + 工具名 + 理由 + 输出预览）+ 可展开的入参与完整输出。
	 *
	 * ⚠️ 参数是 accessor，不是值：同一个位置上流式更新（状态翻转、输出变长）时只有这几处表达式在动，
	 *    卡片元素本身不重建 —— 否则每次 fold 都换掉整张卡，连它下面的子 Agent 子树一起重挂。
	 */
	/**
	 * 工具卡的右键菜单：目前只有一个入口 —— 回放这条命令的**安全审核**请求。
	 *
	 * 安全审核也是一次独立的 LLM 调用，但它不是对话里的 LLM 块（它的产物是「放行 / 拦下」，不是消息），logId 藏在工具结果的 `structured.safety` 里，投影时取到 `safetyLogId`。
	 * 所以挂载点和 LLM 块不同，**弹窗与 logId 用法完全一致**（同一个 `showRequestDetailMsgbox`）。
	 */
	const openToolCardMenu = (e: MouseEvent, tool: RenderToolSub) => {
		const safetyLogId = tool.safetyLogId;
		e.preventDefault();
		e.stopPropagation();	// 工具卡在 `.block-llm` 内部，不拦就冒泡成「看这次 LLM 调用」的菜单
		// 与 LLM 块同一套扫光反馈：让用户看清右键的是哪一张卡
		const sweepTarget = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
		if (sweepTarget) {
			sweepTarget.classList.remove(styles.sweep);
			void sweepTarget.offsetWidth;
			sweepTarget.classList.add(styles.sweep);
		}
		showMenu({
			type: 'action',
			triggerRect: { xMin: e.clientX, yMin: e.clientY, xMax: e.clientX, yMax: e.clientY },
			menu: [
				{
					type: 'normal',
					value: 'safety-review-detail',
					label: safetyLogId ? '查看这次命令的安全审核…' : '（这次调用没有安全审查记录）',
					disabled: !safetyLogId,
					onClick: () => {
						if (safetyLogId) showRequestDetailMsgbox(convId, safetyLogId);
					},
				},
			],
			onClose: () => {
				sweepTarget?.classList.remove(styles.sweep);
			}
		});
	};

	const renderToolCard = (tool: () => RenderToolSub) => {
		const mcpName = () => parseMcpName(tool().name);
		return (
			<details
				class={styles['tool-card']}
				classList={{
					[styles['is-error']]: tool().status === 'error',
					[styles['is-mcp']]: !!mcpName(),
				}}
				open={openOverrides.get(`tool:${tool().callId}`) ?? (tool().status === 'error' || (!!tool().output && tool().output.length <= 240))}
				ontoggle={(e) => openOverrides.set(`tool:${tool().callId}`, e.currentTarget.open)}
				oncontextmenu={(e) => openToolCardMenu(e, tool())}
			>
				<summary class={styles['tool-head']}>
					<span class={styles['tool-head-caret']}>▶</span>
					<span class={styles['tool-status']}>
						{tool().status === 'running' ? '⏳' : tool().status === 'success' ? '✓' : '✗'}
					</span>
					<Show
						when={mcpName()}
						fallback={<span class={styles['tool-name']}>{tool().name}</span>}
					>
						{(m) => (
							<>
								<span class={styles['tool-icon']}>
									<McpIcon />
								</span>
								<span class={styles['tool-name']}>mcp:{m().server}</span>
								<span class={styles['tool-name-sub']}>tools/call · {m().method}</span>
							</>
						)}
					</Show>
					<Show when={(tool().children?.length ?? 0) > 0}>
						{/* 子 Agent 渲染在这个块**下面**（同级），这里只提示它委托出去了几个 */}
						<span class={styles['tool-owner']}>↳ {tool().children!.length} 个子 Agent</span>
					</Show>
					<Show when={tool().reason}>
						<span class={styles['tool-reason']}>{tool().reason}</span>
					</Show>
					<Show when={mcpName()}>
						<span class={styles['tool-chip']}>JSON-RPC</span>
					</Show>
					{/* <Show
						when={tool().output}
						fallback={
							<Show when={tool().status === 'running'}>
								<span class={styles['tool-preview']}>执行中…</span>
							</Show>
						}
					>
						<span class={styles['tool-preview']}>
							{tool().output.replace(/\s+/g, ' ').trim().slice(0, 120)}
						</span>
					</Show> */}
				</summary>
				<div class={styles['tool-body']}>
					{/* MCP 卡用设计稿的「→ request / ← response」行；普通工具用「入参 / 输出」小标 */}
					<Show
						when={mcpName()}
						fallback={
							<>
								<Show when={tool().args}>
									<div class={styles['tool-section']}>入参</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool().args, TOOL_ARGS_LIMIT)}</pre>
								</Show>
								<Show when={tool().output}>
									<div class={styles['tool-section']}>输出</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool().output, TOOL_OUTPUT_LIMIT)}</pre>
								</Show>
							</>
						}
					>
						<>
							<Show when={tool().args}>
								<div class={styles['tool-line']}>→ request</div>
								<pre class={styles['tool-pre']}>{truncateWithNote(tool().args, TOOL_ARGS_LIMIT)}</pre>
							</Show>
							<Show when={tool().output}>
								<div class={`${styles['tool-line']} ${styles['is-response']}`}>
									← response · {tool().status === 'success' ? '200 OK' : tool().status} · {fmtSize(tool().output.length)}
								</div>
								<pre class={styles['tool-pre']}>{truncateWithNote(tool().output, TOOL_OUTPUT_LIMIT)}</pre>
							</Show>
						</>
					</Show>
					<Show when={!tool().args && !tool().output}>
						<div class={styles['tool-hint']}>
							{tool().status === 'running' ? '等待工具返回…' : '（该工具没有输出）'}
						</div>
					</Show>
				</div>
			</details>
		);
	};

	/**
	 * 委托 / 唤醒类工具：卡片 + 它下面的子 Agent。
	 *
	 * ⚠️ 子 Agent **不嵌在卡片的 `<details>` 里**，而是同级渲染在它下面：
	 *    ① 折叠卡片不该把整棵子 Agent 树一起藏起来
	 *    ② 子 Agent 有自己的左边距，使「哪一块是一个完整的子 Agent」从结构上就看得出来
	 * ⚠️ 子节点列表用 `<Index>`：子 Agent 流式时它的节点对象每帧都是新的，`<For>` 会按引用判定成「换了个人」→ 整棵子树重挂（`.block-llm` 是全新 DOM，:hover 的边条过渡会反复重播）。
	 */
	const renderToolGroup = (tool: () => RenderToolSub) => (
		<div class={styles['agent-tool-group']}>
			{renderToolCard(tool)}
			<Show when={(tool().children?.length ?? 0) > 0}>
				<div class={styles['agent-tool-children']}>
					<Index each={tool().children ?? []}>{(child) => renderNode(child, false)}</Index>
				</div>
			</Show>
		</div>
	);

	/**
	 * LLM 调用块里的**一个子块**：思考 / 正文 / 一次工具调用。
	 * 工具调用的结果贴在同一处（`role:'tool'` 的条目由投影合并进来），不单独成块。
	 *
	 * ⚠️ 与顶层块同理：参数是 accessor、分派用 `<Switch>`，让「同一位置上的内容变了」只更新表达式，
	 *    不重建元素。用值 + switch 的话流式时每个 chunk 都会换一个新的子块 DOM。
	 */
	const renderSubBlock = (sub: () => RenderSubBlock) => (
		<Switch fallback={null}>
			{/* 思考过程默认折叠，但 summary 里实时滚出末尾几个字，这样即使折叠着也能看出「模型还在动」 */}
			<Match when={subTypeEquals(sub, 'reasoning')}>
				{(r) => (
					<details
						class={styles.reasoning}
						/* ⚠️ 展开态必须自己记（与工具卡 / 反思 / 子 Agent 同一套 openOverrides）：
						   靠浏览器原生 `open` 的话，这一块一旦被重建（换 key / 短暂消失再出现 / 树整体重挂）就弹回折叠。 */
						open={openOverrides.get(`reasoning:${r().key}`) ?? false}
						ontoggle={(e) => openOverrides.set(`reasoning:${r().key}`, e.currentTarget.open)}
					>
						<summary class={styles['reasoning-head']}>
							<span class={styles['reasoning-caret']}>▶</span>
							<span class={styles['reasoning-label']}>思考</span>
							<span class={styles['reasoning-peek']}>{r().content.slice(-72)}</span>
						</summary>
						<div class={styles['reasoning-body']}>{r().content}</div>
					</details>
				)}
			</Match>

			<Match when={subTypeEquals(sub, 'text')}>
				{(t) => <div class={styles['agent-block-text']}>{t().content}</div>}
			</Match>

			{/* 反思同样是「一次 LLM 调用」，所以它也走 llm 块 —— 只是内容形态固定。
			    默认展开：设计稿就是展开态，而且它本来就只有一两句话。 */}
			<Match when={subTypeEquals(sub, 'reflection')}>
				{(r) => (
					<details
						class={styles['reflection']}
						open={openOverrides.get(`reflection:${r().key}`) ?? true}
						ontoggle={(e) => openOverrides.set(`reflection:${r().key}`, e.currentTarget.open)}
					>
						<summary class={styles['reflection-head']}>
							<span class={styles['reflection-icon']}>
								<ReflectionIcon />
							</span>
							<span class={styles['reflection-title']}>REFLECTION</span>
							<Show when={r().remaining !== undefined}>
								<span class={styles['reflection-chip']}>剩 {r().remaining} 次</span>
							</Show>
							<span class={styles['reflection-caret']}>▶</span>
						</summary>
						<div class={styles['reflection-body']}>{r().content}</div>
					</details>
				)}
			</Match>

			<Match when={subTypeEquals(sub, 'tool')}>
				{(tool) => (
					<Show
						when={tool().ask}
						fallback={renderToolGroup(tool)}
					>
						{/* ask_user 的工具调用渲染成提问卡片（它的「结果」是用户回答，不是工具输出） */}
						{(ask) => (
							<AskUserCard
								block={ask()}
								onSubmit={(text) => void answerAskUser(convId, tool().callId, text)}
							/>
						)}
					</Show>
				)}
			</Match>
		</Switch>
	);

	/**
	 * 「用户 → assistant」回合边界 —— AGENT 头就插在这些块前面。
	 * 消息列表可能是 [user][agent][tool][agent][user][agent]…：agent 自主连续执行的块不重复加头，
	 * 只在每个用户消息**之后的第一个块**加一次。开头没有用户块时也算边界（避免头缺席）。
	 * （头部必须跟在用户消息**下面**，不能跑到整段对话的最上面。）
	 */
	function isTurnStart(node: RenderAgentNode, i: number): boolean {
		const block = node.blocks[i];
		if (!block || block.type === 'user') return false;
		return i === 0 || node.blocks[i - 1].type === 'user';
	}

	/** 消息头 / AGENT：指示灯 + AGENT + Agent 名 + 状态标记 */
	const renderAgentHeaderFor = (node: () => RenderAgentNode) => (
		<div class={styles['message-head']}>
			<span class={styles['message-head-dot']} />
			<span class={`${styles['message-head-label']} ${styles['is-agent']}`}>AGENT</span>
			<span class={styles['message-head-meta']}>{node().agentName || node().agentId}</span>
			<span class={styles['message-head-chip']}>{STATUS_LABEL[node().status] ?? node().status}</span>
			<span class={styles['message-head-spacer']} />
		</div>
	);

	/**
	 * 运行摘要：**某一轮发言**的消耗（该轮用户消息之后、下一轮用户消息之前）。
	 *
	 * ⚠️ 别退回成读 `instance.tokens` / `instance.llmCalls`：那两个是**实例终身累加**，根实例又是永续的（一个会话一个根），显示出来会让人误以为「这一句话就花了这么多」。
	 * 表面是含子 Agent 与反思的合计；悬浮看分项（FFBox-UI 的 tooltip，见 `runSummaryTooltip`）。
	 * 每轮末尾各一个 —— 历史每一轮的成本都留在原地，不只最后一轮。
	 */
	const renderRunSummaryFor = (run: () => RunUsage) => (
		<Show when={run().total.calls > 0}>
			<div class={styles['run-summary']} {...useTooltip(runSummaryTooltip(run()), 'tl')}>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>LLM 调用</span>
					{run().total.calls}
				</span>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>tokens</span>
					{fmtUsageTriple(run().total.input, run().total.cached, run().total.output)}
				</span>
				<Show when={run().rounds > 0}>
					<span class={styles['summary-chip']}>
						<span class={styles['summary-chip-key']}>轮次</span>
						{run().rounds}
					</span>
				</Show>
			</div>
		</Show>
	);

	/** 某个位置当前的块（类型不符给 undefined，让 `<Match>` 判假落到下一个分支） */
	function blockTypeEquals<T extends RenderBlock['type']>(block: () => RenderBlock, type: T): Extract<RenderBlock, { type: T }> | undefined {
		const b = block();
		return b.type === type ? (b as Extract<RenderBlock, { type: T }>) : undefined;
	}

	/** 单个顶层块（`isRoot` 决定用户发言是否渲染成气泡：子 Agent 的任务已在头部显示） */
	const renderBlock = (block: () => RenderBlock, isRoot: boolean) => (
		<Switch fallback={null}>
			{/* 用户发言：子 Agent 的那条已经在它自己的节点头部显示，不再重复成气泡 */}
			<Match when={isRoot && blockTypeEquals(block, 'user')}>
				{(user) => (
					<div class={styles['block-userMessage']}>
						<div class={styles['message-head']}>
							<span class={styles['message-head-label']}>用户</span>
							<span class={styles['message-head-spacer']} />
							<span class={styles['message-head-time']}>{fmtClock(user().updatedAt)}</span>
						</div>
						<div class={styles['user-bubble']}>{user().content}</div>
					</div>
				)}
			</Match>

			{/* ⭐ 一次 LLM 调用 = 一个块：思考 / 正文 / 工具调用 / 反思都缩在它里面，账本贴在它下方 */}
			<Match when={blockTypeEquals(block, 'llm')}>
				{(llm) => (
					<div class={styles['block-llm']} oncontextmenu={(e) => openLlmBlockMenu(e, llm())}>
						<Index each={llm().subBlocks}>{(sub) => renderSubBlock(sub)}</Index>
						<Show when={llm().usages}>{(usages) => (
							<>
								<For each={usages()}>{(usage) => renderUsage(usage)}</For>
								<Show when={fmtClock(llm().updatedAt)}>{(time) => (
									<div class={styles['agent-block-time']}>{time()}</div>
								)}</Show>
							</>
						)}</Show>
					</div>
				)}
			</Match>

			<Match when={blockTypeEquals(block, 'error')}>
				{(err) => (
					<div class={styles['block-error']}>
						<span>✗</span>
						<span>{err().message}</span>
					</div>
				)}
			</Match>

			<Match when={blockTypeEquals(block, 'agent')}>
				{(agent) => renderNode(() => agent().node, false)}
			</Match>
		</Switch>
	);

	/**
	 * 一个 Agent 实例 = 一个块序列（含它的子节点）。
	 * 子 Agent 用 `<details>` 整块折叠（名字 + 状态 + 任务在头部，展开才是它自己的产出）。
	 *
	 * ⚠️ `currentNode` 参数是 accessor（访问器），不是值——这是「流式可见」和「逐块复用」能同时成立的前提：
	 * - 传值：`node.blocks` 在组件体（只执行一次）里就被求值，闭包捕获首帧快照 ⇒ 之后的流式增量全看不到。
	 * - 传 accessor：`<Index each={currentNode().blocks}>` 的 `each` 是编译出的 getter，读取落在组件自己的 memo 里，才能实现每次投影重算都会重新取数组、逐个位置更新
	 *   同理，节点自身的字段（status / tokens / …）都在 JSX 表达式里读 `currentNode().x`，天生响应式。
	 */
	/**
	 * 每轮的**最后一块**：摘要胶囊插在它后面。
	 * 下一块是新的 `user`（= 新一轮开始），或者它已经是最后一块（正在进行 / 已结束的一轮）—— 两种都是轮末。
	 */
	function isTurnEnd(node: RenderAgentNode, i: number): boolean {
		const next = node.blocks[i + 1];
		return !next || next.type === 'user';
	}

	/**
	 * 块序列（根节点与子节点共用）：AGENT 头（仅根）→ 块 → **本轮末尾的摘要胶囊**。
	 * 胶囊按 `block.turn` 取账，所以历史每一轮都有自己的胶囊，不是只在最后出现一个。
	 *
	 * ⭐ 用 `<Index>` 而不是 `<For>`：
	 *    `<For>` 按**引用**比对项，流式时「当前这个 llm 块的正文长了两个字」就会产生一个新对象 ⇒ 整块（连同它里面的所有工具卡）被拆掉重建；
	 *    `<Index>` 按**位置**给该项一个 signal，值变了只更新读到它的那些表达式 —— 只剩那一段正文节点在动。
	 *    （代价是「位置」变了 DOM 会被复用：所以分支选择也必须是响应式的，用 `<Switch>` 而不是 switch，否则某个位置上的块换了类型，旧的 DOM 会留在原位。块类型本身通过 messageId 派生的 key 保持稳定。）
	 */
	const renderBlocks = (node: () => RenderAgentNode, isRoot: boolean) => (
		<Index each={node().blocks}>
			{(block, index) => (
				<>
					<Show when={isRoot && isTurnStart(node(), index)}>{renderAgentHeaderFor(node)}</Show>
					{renderBlock(block, isRoot)}
					<Show when={isTurnEnd(node(), index)}>
						{renderRunSummaryFor(() => runOfTurn(node(), block().turn))}
					</Show>
				</>
			)}
		</Index>
	);

	const renderNode = (currentNode: () => RenderAgentNode, isRoot: boolean) => {
		if (isRoot) {
			return <div class={styles['agent-reply']}>{renderBlocks(currentNode, true)}</div>;
		}
		return (
			<details
				class={styles['agent-node']}
				/* ⚠️ 默认展开：要的是「子 Agent 的内容都看得见，想收起来时自己收」。 */
				open={openOverrides.get(`node:${currentNode().agentInstanceId}`) ?? true}
				ontoggle={(e) => openOverrides.set(`node:${currentNode().agentInstanceId}`, e.currentTarget.open)}
			>
				<summary class={styles['agent-node-header']}>
					<span class={styles['agent-node-caret']}>▶</span>
					<span class={styles['agent-node-name']}>{currentNode().agentName || currentNode().agentId}</span>
					<span class={styles['agent-node-status']}>{STATUS_LABEL[currentNode().status] ?? currentNode().status}</span>
					<Show when={currentNode().task}>
						<span class={styles['agent-node-task']}>{currentNode().task}</span>
					</Show>
				</summary>
				<div class={styles['agent-node-body']}>{renderBlocks(currentNode, false)}</div>
			</details>
		);
	};

	/**
	 * 渲染入口。
	 * 
	 * 注意：`props.tree` 必须在**会被重新执行的跟踪作用域里**读——
	 *    组件体顶层不是跟踪作用域，`return renderNode(props.tree, true)` 会把第一帧的树捕获进闭包，会导致后续更新没有被追踪，导致「流式输出要等整块跑完才出现」。
	 */
	return renderNode(() => props.tree!, true);
}