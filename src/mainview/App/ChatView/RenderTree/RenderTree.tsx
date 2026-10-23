import { For, Show } from 'solid-js';
import type { RenderAgentNode, RenderBlock, RenderSubBlock, RenderToolSub } from '@mainview/projection';
import type { UsageEntry } from '@shared/agent';
import { answerAskUser } from '@mainview/runController';
import AskUserCard from '../AskUserCard/AskUserCard';
import {
	ReflectionIcon, McpIcon,
	TOOL_ARGS_LIMIT, TOOL_OUTPUT_LIMIT, PURPOSE_LABEL, STATUS_LABEL,
	truncateWithNote, fmtTokens, fmtDuration, fmtClock, fmtSize, parseMcpName,
} from './shared';
import styles from './RenderTree.module.css';

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
		parts.push(`↑${fmtTokens(usage.input)} ↓${fmtTokens(usage.output)}`);
		// parts.push(`共 ${fmtTokens(usage.total)}`);
		if (usage.cached) parts.push(`缓存 ${fmtTokens(usage.cached)}`);
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
	 * LLM 调用块里的**一个子块**：思考 / 正文 / 一次工具调用。
	 * 工具调用的结果贴在同一处（`role:'tool'` 的条目由投影合并进来），不单独成块。
	 */
	const renderSubBlock = (sub: RenderSubBlock) => {
		switch (sub.type) {
			case 'reasoning':
				// 思考过程默认折叠，但 summary 里实时滚出末尾几个字，
				// 这样即使折叠着也能看出「模型还在动」，而不是界面一片死寂。
				return (
					<details class={styles.reasoning}>
						<summary class={styles['reasoning-head']}>
							<span class={styles['reasoning-caret']}>▶</span>
							<span class={styles['reasoning-label']}>思考</span>
							<span class={styles['reasoning-peek']}>{sub.content.slice(-72)}</span>
						</summary>
						<div class={styles['reasoning-body']}>{sub.content}</div>
					</details>
				);

			case 'text':
				return <div class={styles['agent-block-text']}>{sub.content}</div>;

			case 'reflection':
				// 反思同样是「一次 LLM 调用」，所以它也走 llm 块 —— 只是内容形态固定。
				// 默认展开：设计稿就是展开态，而且它本来就只有一两句话。
				return (
					<details
						class={styles['reflection']}
						open={openOverrides.get(`reflection:${sub.key}`) ?? true}
						ontoggle={(e) => openOverrides.set(`reflection:${sub.key}`, e.currentTarget.open)}
					>
						<summary class={styles['reflection-head']}>
							<span class={styles['reflection-icon']}>
								<ReflectionIcon />
							</span>
							<span class={styles['reflection-title']}>REFLECTION</span>
							<Show when={sub.remaining !== undefined}>
								<span class={styles['reflection-chip']}>剩 {sub.remaining} 次</span>
							</Show>
							<span class={styles['reflection-caret']}>▶</span>
						</summary>
						<div class={styles['reflection-body']}>{sub.content}</div>
					</details>
				);

			case 'tool': {
				const tool = sub as RenderToolSub;

				// ask_user 的工具调用渲染成提问卡片（它的「结果」是用户回答，不是工具输出）
				if (tool.ask) {
					return (
						<AskUserCard
							block={tool.ask}
							onSubmit={(text) => void answerAskUser(convId, tool.callId, text)}
						/>
					);
				}

				// 工具调用 = 一行摘要（状态 + 工具名 + 理由 + 输出预览）+ 可展开的入参与完整输出。
				const childCount = tool.children?.length ?? 0;
				const mcp = parseMcpName(tool.name);
				// 普通工具：输出短就直接展开（一眼看到结果），长的折起来。
				// 子节点不再影响展开态 —— 它们已经不在这个 <details> 里了（见下面的注释）。
				const toolBlock = (
					<details
						class={styles['tool-card']}
						classList={{
							[styles['is-error']]: tool.status === 'error',
							[styles['is-mcp']]: !!mcp,
						}}
						open={openOverrides.get(`tool:${tool.callId}`) ?? (tool.status === 'error' || (!!tool.output && tool.output.length <= 240))}
						ontoggle={(e) => openOverrides.set(`tool:${tool.callId}`, e.currentTarget.open)}
					>
						<summary class={styles['tool-head']}>
							<span class={styles['tool-head-caret']}>▶</span>
							<span class={styles['tool-status']}>
								{tool.status === 'running' ? '⏳' : tool.status === 'success' ? '✓' : '✗'}
							</span>
							<Show
								when={mcp}
								fallback={<span class={styles['tool-name']}>{tool.name}</span>}
							>
								<span class={styles['tool-icon']}>
									<McpIcon />
								</span>
								<span class={styles['tool-name']}>mcp:{mcp!.server}</span>
								<span class={styles['tool-name-sub']}>tools/call · {mcp!.method}</span>
							</Show>
							<Show when={childCount > 0}>
								{/* 子 Agent 渲染在这个块**下面**（同级），这里只提示它委托出去了几个 */}
								<span class={styles['tool-owner']}>↳ {childCount} 个子 Agent</span>
							</Show>
							<Show when={tool.reason}>
								<span class={styles['tool-reason']}>{tool.reason}</span>
							</Show>
							<Show when={mcp}>
								<span class={styles['tool-chip']}>JSON-RPC</span>
							</Show>
							<Show
								when={tool.output}
								fallback={
									<Show when={tool.status === 'running'}>
										<span class={styles['tool-preview']}>执行中…</span>
									</Show>
								}
							>
								<span class={styles['tool-preview']}>
									{tool.output.replace(/\s+/g, ' ').trim().slice(0, 120)}
								</span>
							</Show>
						</summary>
						<div class={styles['tool-body']}>
							{/* MCP 卡用设计稿的「→ request / ← response」行；普通工具用「入参 / 输出」小标 */}
							<Show
								when={mcp}
								fallback={
									<>
										<Show when={tool.args}>
											<div class={styles['tool-section']}>入参</div>
											<pre class={styles['tool-pre']}>{truncateWithNote(tool.args, TOOL_ARGS_LIMIT)}</pre>
										</Show>
										<Show when={tool.output}>
											<div class={styles['tool-section']}>输出</div>
											<pre class={styles['tool-pre']}>{truncateWithNote(tool.output, TOOL_OUTPUT_LIMIT)}</pre>
										</Show>
									</>
								}
							>
								<Show when={tool.args}>
									<div class={styles['tool-line']}>→ request</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool.args, TOOL_ARGS_LIMIT)}</pre>
								</Show>
								<Show when={tool.output}>
									<div class={`${styles['tool-line']} ${styles['is-response']}`}>
										← response · {tool.status === 'success' ? '200 OK' : tool.status} · {fmtSize(tool.output.length)}
									</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool.output, TOOL_OUTPUT_LIMIT)}</pre>
								</Show>
							</Show>
							<Show when={!tool.args && !tool.output}>
								<div class={styles['tool-hint']}>
									{tool.status === 'running' ? '等待工具返回…' : '（该工具没有输出）'}
								</div>
							</Show>
						</div>
					</details>
				);

				// ⚠️ 委托 / 唤醒类工具：子 Agent **不嵌在上面那个 <details> 里**，而是同级渲染在它下面。
				// 理由：① 折叠工具块不该把整棵子 Agent 树一起藏起来
				//       ② 子 Agent 要有自己的左边距，使「哪一块是一个完整的子 Agent」从结构上就看得出来
				if (childCount === 0) return toolBlock;
				return (
					<div class={styles['agent-tool-group']}>
						{toolBlock}
						<div class={styles['agent-tool-children']}>
							<For each={tool.children}>{(child) => renderNode(() => child, false)}</For>
						</div>
					</div>
				);
			}
		}
	};

	/**
	 * 用户发言之后的第一个块下标 —— AGENT 头就插在它前面。
	 * （头部必须跟在用户消息**下面**，不能跑到整段对话的最上面。）
	 */
	function getFirstNonUserIndex(node: RenderAgentNode): number {
		let i = 0;
		while (i < node.blocks.length && node.blocks[i].type === 'user') i++;
		return i;
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

	/** 运行摘要：设计稿的指标胶囊（耗时 / 工具调用 / 重入我们暂时拿不到，只出这四项） */
	const renderRunSummaryFor = (node: () => RenderAgentNode) => (
		<Show when={node().tokens || node().llmCalls > 0}>
			<div class={styles['run-summary']}>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>LLM 调用</span>
					{node().llmCalls}
				</span>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>tokens</span>
					↑{fmtTokens(node().tokens?.input)} ↓{fmtTokens(node().tokens?.output)}
				</span>
				<Show when={node().tokens?.inputCached}>
					<span class={styles['summary-chip']}>
						<span class={styles['summary-chip-key']}>缓存</span>
						{fmtTokens(node().tokens!.inputCached)}
					</span>
				</Show>
				<Show when={node().rounds > 0}>
					<span class={styles['summary-chip']}>
						<span class={styles['summary-chip-key']}>轮次</span>
						{node().rounds}
					</span>
				</Show>
			</div>
		</Show>
	);

	/** 单个顶层块（`isRoot` 决定用户发言是否渲染成气泡：子 Agent 的任务已在头部显示） */
	const renderBlock = (block: RenderBlock, isRoot: boolean) => {
		switch (block.type) {
			case 'user':
				if (!isRoot) return null;
				return (
					<div class={styles['block-userMessage']}>
						<div class={styles['message-head']}>
							<span class={styles['message-head-label']}>用户</span>
							<span class={styles['message-head-spacer']} />
							<span class={styles['message-head-time']}>{fmtClock(block.updatedAt)}</span>
						</div>
						<div class={styles['user-bubble']}>{block.content}</div>
					</div>
				);

			// ⭐ 一次 LLM 调用 = 一个块：思考 / 正文 / 工具调用 / 反思都缩在它里面，账本贴在它下方
			case 'llm':
				return (
					<div class={styles['block-llm']}>
						<For each={block.subBlocks}>{(sub) => renderSubBlock(sub)}</For>
						<Show when={block.usages}>{(usages) => (
							<>
								<For each={usages()}>{(usage) => renderUsage(usage)}</For>
								<Show when={fmtClock(block.updatedAt)}>{(time) => (
									<div class={styles['agent-block-time']}>{time()}</div>
								)}</Show>
							</>
						)}</Show>
					</div>
				);

			case 'error':
				return (
					<div class={styles['block-error']}>
						<span>✗</span>
						<span>{block.message}</span>
					</div>
				);

			case 'agent':
				return renderNode(() => block.node, false);
		}
	};

	/**
	 * 一个 Agent 实例 = 一个块序列（含它的子节点）。
	 * 子 Agent 用 `<details>` 整块折叠（名字 + 状态 + 任务在头部，展开才是它自己的产出）。
	 *
	 * ⚠️ `currentNode` 参数是 accessor（访问器），不是值——这是「流式可见」和「逐块复用」能同时成立的前提：
	 * - 传值：`node.blocks` 在组件体（只执行一次）里就被求值，闭包捕获首帧快照 ⇒ 之后的流式增量全看不到。
	 * - 传 accessor：`<For each={currentNode().blocks}>` 的 `each` 是编译出的 getter，读取落在 For 自己的 memo 里，才能实现每次投影重算都会重新取数组、**逐项按引用比较**
	 *   同理，节点自身的字段（status / tokens / …）都在 JSX 表达式里读 `currentNode().x`，天生响应式。
	 */
	const renderNode = (currentNode: () => RenderAgentNode, isRoot: boolean) => {
		const blockList = () => (
			<For each={currentNode().blocks}>
				{(block, index) => (
					<>
						<Show when={index() === getFirstNonUserIndex(currentNode())}>{renderAgentHeaderFor(currentNode)}</Show>
						{renderBlock(block, true)}
					</>
				)}
			</For>
		);

		if (isRoot) {
			return (
				<div class={styles['agent-reply']}>
					{blockList()}
					{renderRunSummaryFor(currentNode)}
				</div>
			);
		}

		return (
			<details
				class={styles['agent-node']}
				/* ⚠️ 默认展开：要的是「子 Agent 的内容都看得见，想收起来时自己收」。
				   曾经按 status 自动折（跑完就收起），结果是「子 Agent 一完成就从界面上消失」。 */
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
				<div class={styles['agent-node-body']}>
					<For each={currentNode().blocks}>{(block) => renderBlock(block, false)}</For>
					{renderRunSummaryFor(currentNode)}
				</div>
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
