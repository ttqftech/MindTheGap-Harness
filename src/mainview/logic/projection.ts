/**
 * 投影：ctx → 渲染树（**纯函数，不落盘**）
 *
 * ① **一次 LLM 调用 = 一个块**（`role:'assistant'` 是一次调用，反思也是一次调用 —— 两者都走 `RenderLlmBlock`，不留例外）。这次调用的思考 / 正文 / 各次工具调用 / 反思，都是它的**子块**。
 * ② 遇到 delegate / resume_* 的工具调用，就按该次调用创建的子实例递归下钻。
 *
 * ⚠️ 工具结果（`role:'tool'`）不单独成块 —— 它贴在对应 toolCall 子块里（调用请求 + 返回结果同处）。
 * ⚠️ 账本（`usages`）不单独成块 —— 它是 assistant 条目自带的字段，渲染在该 LLM 块的下方。
 *
 * 设计稿：docs/设计-ctx唯一真相与动态投影.md §4
 */

import type { AgentCtx, AgentInstance, AgentInstanceMessage, AgentInstanceStatus, AskUserStructured, ReflectionInfo, TokenUsage, ToolResultInfo, UsageEntry } from '@shared/agent';

// #region 渲染树类型

/** 一个 Agent 实例 = 一个可整块折叠的节点 */
export interface RenderAgentNode {
	agentInstanceId: string;
	agentId: string;
	agentName: string;
	depth: number;
	status: AgentInstanceStatus;
	/** 该实例的任务（子 Agent 头部显示；根实例 = 用户首条发言） */
	task?: string;
	/** 最后一次 finish 的总结 */
	summary?: string;
	rounds: number;
	llmCalls: number;
	tokens?: TokenUsage;
	blocks: RenderBlock[];
}

interface BlockBase {
	/** Solid 的 For 需要稳定的 key；用「实例 id + 序号」 */
	key: string;
	/**
	 * 这一块的**最近更新时间**（毫秒时间戳）。
	 *
	 * ⚠️ 来源只能是后端：已提交的部分来自 `AgentInstanceMessage.updatedAt`（Runner `message()` 盖的），
	 * 在飞的部分来自 SSE 事件的 `timestamp`。投影**不许自己取时间** —— 每来一条事件就重算一次投影，
	 * 自己取的时间会跟着变，任何靠它算出来的计时（提问卡阻塞时长、工具耗时）都会被清零重数。
	 */
	updatedAt: number;
}

// #region 子块

export interface RenderReasoningSub extends BlockBase {
	type: 'reasoning';
	content: string;
}

export interface RenderTextSub extends BlockBase {
	type: 'text';
	content: string;
}

/** ask_user 中单个问题的渲染信息 */
export interface RenderAskQuestion {
	question: string;
	selectionMode: 'single' | 'multi';
	options: { label: string; description?: string }[];
}

/** ask_user 的提问卡片内容（它没有「工具输出」，结果是「用户回答」） */
export interface RenderAskInfo {
	callId: string;
	questions: RenderAskQuestion[];
	status: AskUserStructured['askUserStatus'];
	answer?: string;
	/** 这条提问的最新状态时间：waiting = 提问被提出的那一刻，answered = 用户回答的那一刻 */
	updatedAt: number;
}

/** 一次工具调用：调用请求 + 返回结果贴在**同一处**（结果不单独成块） */
export interface RenderToolSub extends BlockBase {
	type: 'tool';
	callId: string;
	name: string;
	reason: string;
	status: 'running' | 'success' | 'error';
	args: string;	// 入参 JSON 文本
	output: string;
	error?: string;
	/** 这次调用创建 / 唤醒的子实例，整块嵌套渲染（delegate 是挂载点） */
	children?: RenderAgentNode[];
	ask?: RenderAskInfo;	// ask_user 渲染成提问卡片而不是工具块
}

/** 反思：它也是一次 LLM 调用，只是产出形态固定（一句追问），所以照样是 llm 块里的一个子块 */
export interface RenderReflectionSub extends BlockBase {
	type: 'reflection';
	content: string;
	remaining?: number;	// 本轮反思后还剩几次
}

export type RenderSubBlock = RenderReasoningSub | RenderTextSub | RenderToolSub | RenderReflectionSub;

// #endregion

// #region 顶层块

export interface RenderUserBlock extends BlockBase {
	type: 'user';
	content: string;
}

/**
 * ⭐ **一次 LLM 调用 = 一个块**。
 *
 * 子块 = 这次调用产出的思考 / 正文 / 各次工具调用（结果贴在调用处）；
 */
export interface RenderLlmBlock extends BlockBase {
	type: 'llm';
	subBlocks: RenderSubBlock[];
	usages?: UsageEntry[];	// 本次调用花了多少（通常 1 条；工具内部发起的子请求会顺延挂到下一次调用上）
}

export interface RenderErrorBlock extends BlockBase {
	type: 'error';
	message: string;
}

/** 没有被任何工具调用认领的子实例（兜底，正常流程不会出现） */
export interface RenderAgentBlock extends BlockBase {
	type: 'agent';
	node: RenderAgentNode;
}

/**
 * ⚠️ 这里**没有** `reflection` 块：反思也是一次 LLM 调用，同样走 `RenderLlmBlock`
 * （它的 `subBlocks` 里只有一个 `reflection` 子块）。「一次 LLM 调用 = 一个块」不留例外。
 */
export type RenderBlock = RenderUserBlock | RenderLlmBlock | RenderErrorBlock | RenderAgentBlock;

// #endregion

// #region 编排类工具

/** 会创建 / 唤醒子实例的工具：它们的工具调用是子节点的挂载点 */
const ORCHESTRATING_TOOLS = ['delegate', 'resume_pending_child', 'resume_completed_child'];

/** 从工具结果的结构化字段里取出它关联的子实例 id */
function childIdsOf(info: ToolResultInfo | undefined): string[] {
	const structured = info?.structured;
	if (!structured) return [];
	if (Array.isArray(structured.childAgentInstanceIds)) return structured.childAgentInstanceIds as string[];
	if (typeof structured.agentInstanceId === 'string') return [structured.agentInstanceId];
	return [];
}

// #endregion

// #region 主函数

/**
 * 把整份 ctx 折叠成渲染树。ctx 为空 / 还没有根实例时返回 null。
 * 纯函数：同样的 ctx 一定得到同样的结果；结果**不落盘**、也不需要版本号。
 */
export function foldCtxToRenderTree(ctx: AgentCtx | null | undefined): RenderAgentNode | null {
	if (!ctx?.agentInstances) return null;
	const root = ctx.agentInstances[ctx.rootAgentInstanceId];
	if (!root) return null;
	return buildNode(ctx, root);
}

/** 单个实例 → 节点（含递归下钻） */
function buildNode(ctx: AgentCtx, instance: AgentInstance): RenderAgentNode {
	const entries = instance.messages ?? [];

	// 索引：callId → 工具结果条目
	const resultByCallId = new Map<string, AgentInstanceMessage>();
	for (const entry of entries) {
		if (entry.role === 'tool' && entry.toolCallId) resultByCallId.set(entry.toolCallId, entry);
	}

	const blocks: RenderBlock[] = [];
	const claimedChildIds = new Set<string>();
	let counter = 0;
	const nextKey = (kind: string) => `${instance.agentInstanceId}:${kind}:${counter++}`;

	for (const entry of entries) {
		// ① 反思条目：正文在 content 里，它本身就是**一次 LLM 调用**（所以照样出一个 llm 块，里面只有一个 reflection 子块）。
		//    有追问的那条同时进 LLM 上下文（没有 uiOnly 标记），没追问的那条只给界面看 —— 两者都要渲染，所以这个判断必须放在 role 之前。
		if (entry.kind === 'reflection') {
			blocks.push({
				type: 'llm',
				key: nextKey('refl'),
				updatedAt: entry.updatedAt,
				subBlocks: [{
					type: 'reflection',
					key: nextKey('refl-sub'),
					updatedAt: entry.updatedAt,
					content: entry.content,
					remaining: (entry.data as ReflectionInfo | undefined)?.remaining,
				}],
				usages: entry.usages,
			});
			continue;
		}

		// ② 工具结果：贴在对应 toolCall 的位置（见 ⑥），不单独成块
		if (entry.role === 'tool') continue;

		// ④ system：本实例的 system prompt，不进转写（反思已在 ① 处理掉）
		if (entry.role === 'system') continue;

		// ⑤ 用户发言（根实例 = 用户每轮的原话；子实例的任务在节点头部显示）
		if (entry.role === 'user') {
			blocks.push({ type: 'user', key: nextKey('user'), updatedAt: entry.updatedAt, content: entry.content });
			continue;
		}

		// ⑥ assistant = **一次 LLM 调用 → 一个块**；思考 / 正文 / 工具调用都是它的子块
		const subBlocks: RenderSubBlock[] = [];
		if (entry.reasoningContent) {
			subBlocks.push({ type: 'reasoning', key: nextKey('think'), updatedAt: entry.updatedAt, content: entry.reasoningContent });
		}
		if (entry.content?.trim()) {
			subBlocks.push({ type: 'text', key: nextKey('text'), updatedAt: entry.updatedAt, content: entry.content });
		}
		for (const toolCall of entry.toolCalls ?? []) {
			const resultEntry = resultByCallId.get(toolCall.id);
			const resultInfo = resultEntry?.data as ToolResultInfo | undefined;
			const args = parseArgs(toolCall.function.arguments);
			const reason = typeof args?.reason === 'string' ? args.reason : '';
			// 这一次工具调用的最近更新时间：有结果算结果的，没有（还在跑）算这次 LLM 调用的
			const toolUpdatedAt = resultEntry?.updatedAt ?? entry.updatedAt;

			// ask_user 的工具调用渲染成提问卡片（它的「结果」是用户回答）
			if (toolCall.function.name === 'ask_user') {
				const askStructured = resultInfo?.structured as AskUserStructured | undefined;
				const askStatus = askStructured?.askUserStatus ?? 'waiting';
				const rawQuestions = Array.isArray(args?.questions) ? args.questions as unknown[] : [];
				const questions: RenderAskQuestion[] = rawQuestions.length > 0
					? rawQuestions.map((q) => {
							const obj = q as Record<string, unknown>;
							return {
								question: typeof obj?.question === 'string' ? obj.question : '对齐颗粒度',
								selectionMode: obj?.selectionMode === 'multi' ? 'multi' as const : 'single' as const,
								options: Array.isArray(obj?.options) ? (obj.options as RenderAskQuestion['options']) : [],
							};
						})
					: [{ question: typeof args?.question === 'string' ? args.question : '对齐颗粒度', selectionMode: 'single', options: Array.isArray(args?.options) ? (args.options as RenderAskQuestion['options']) : [] }];
				subBlocks.push({
					type: 'tool',
					key: nextKey('ask'),
					updatedAt: toolUpdatedAt,
					callId: toolCall.id,
					name: toolCall.function.name,
					reason,
					status: askStatus === 'waiting' ? 'running' : 'success',
					args: toolCall.function.arguments,
					output: '',
					ask: {
						callId: toolCall.id,
						questions,
						status: askStatus,
						answer: askStructured?.askUserAnswer,
						updatedAt: resultEntry?.updatedAt ?? entry.updatedAt,
					},
				});
				continue;
			}

			// 子实例挂载：delegate / resume_* 的子块里嵌它的子节点
			let children: RenderAgentNode[] | undefined;
			if (ORCHESTRATING_TOOLS.includes(toolCall.function.name)) {
				children = [];
				for (const childId of childIdsOf(resultInfo)) {
					const child = ctx.agentInstances[childId];
					if (!child) continue;
					claimedChildIds.add(childId);
					children.push(buildNode(ctx, child));
				}
			}

			// ⚠️ delegate / resume_* 的占位结果 success 也是 true（`structured.status === 'pending'`），
			//    这时子 Agent 还在跑，显示 ✓ 会让人以为已经拿到结论 —— 一律按「执行中」渲染，
			//    等子实例全部终态后 handleChildTerminal 会用同一 callId 覆盖成终态结果。
			const awaitingChild = (resultInfo?.structured?.status as string | undefined) === 'pending';
			subBlocks.push({
				type: 'tool',
				key: nextKey('tool'),
				updatedAt: toolUpdatedAt,
				callId: toolCall.id,
				name: toolCall.function.name,
				reason,
				status: !resultEntry || awaitingChild ? 'running' : resultInfo?.success === false ? 'error' : 'success',
				args: toolCall.function.arguments,
				output: resultEntry?.content ?? '',
				error: resultInfo?.error,
				children: children && children.length > 0 ? children : undefined,
			});
		}

		// 空 assistant（没正文没思考没工具调用）就不出行了，免得界面上多一个空壳
		if (subBlocks.length === 0 && !entry.usages?.length) continue;
		blocks.push({ type: 'llm', key: nextKey('llm'), updatedAt: entry.updatedAt, subBlocks, usages: entry.usages });
	}

	// 兜底：没被任何工具调用认领的子实例（正常流程不会发生，比如结果结构化字段缺失）
	for (const childId of instance.childAgentInstanceIds ?? []) {
		if (claimedChildIds.has(childId)) continue;
		const child = ctx.agentInstances[childId];
		if (child) {
			blocks.push({ type: 'agent', key: nextKey('orphan'), updatedAt: child.lastUpdatedAt ?? child.startedAt, node: buildNode(ctx, child) });
		}
	}

	// 失败 / 被中断的实例：原因只存在 interruptReason 里（错误不会进 messages），渲染成一块错误
	if ((instance.status === 'failed' || instance.status === 'interrupted') && instance.interruptReason) {
		blocks.push({
			type: 'error',
			key: nextKey('error'),
			updatedAt: instance.lastUpdatedAt ?? instance.startedAt,
			message: instance.interruptReason,
		});
	}

	const summaries = instance.summaries ?? [];
	return {
		agentInstanceId: instance.agentInstanceId,
		agentId: instance.agentId,
		agentName: instance.agentName,
		depth: instance.depth,
		status: instance.status,
		task: instance.task,
		summary: summaries.length > 0 ? summaries[summaries.length - 1] : undefined,
		rounds: instance.rounds,
		llmCalls: instance.llmCalls ?? 0,
		tokens: instance.tokens,
		blocks,
	};
}

/** 工具入参是 JSON 文本，解析失败就当空对象（拿不到 reason / 选项时不影响渲染） */
function parseArgs(raw: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

// #endregion

// #region 渲染树 diff

/**
 * 深层 diff：让内容没变的节点保持旧引用，使 Solid <For> 能复用 DOM。
 * 规则：按 key 匹配数组项 → 递归比较内容 → 全等返回旧引用，有变返回新对象（未变子字段用旧引用）。
 */
export function diffRenderTree(oldNode: RenderAgentNode | null, newNode: RenderAgentNode | null): RenderAgentNode | null {
	if (oldNode === newNode) return oldNode;
	if (!oldNode || !newNode) return newNode;

	const blocks = diffKeyedArray(oldNode.blocks, newNode.blocks, diffBlock, (b) => b.key);
	// 如果 blocks 没有变化，renderTree 所有属性也没变化，直接返回旧数组
	if (
		blocks === oldNode.blocks
		&& oldNode.agentInstanceId === newNode.agentInstanceId
		&& oldNode.agentId === newNode.agentId
		&& oldNode.agentName === newNode.agentName
		&& oldNode.depth === newNode.depth
		&& oldNode.status === newNode.status
		&& oldNode.task === newNode.task
		&& oldNode.summary === newNode.summary
		&& oldNode.rounds === newNode.rounds
		&& oldNode.llmCalls === newNode.llmCalls
		&& oldNode.tokens === newNode.tokens
	) return oldNode;

	return { ...newNode, blocks };
}

function diffBlock(old: RenderBlock, nu: RenderBlock): RenderBlock {
	if (old.key !== nu.key || old.type !== nu.type) return nu;

	switch (nu.type) {
		case 'user': {
			const o = old as RenderUserBlock;
			if (o.content === nu.content && o.updatedAt === nu.updatedAt) return old;
			return nu;
		}
		case 'llm': {
			const o = old as RenderLlmBlock;
			const subBlocks = diffKeyedArray(o.subBlocks, nu.subBlocks, diffSubBlock, (s) => s.key);
			if (subBlocks === o.subBlocks && o.usages === nu.usages && o.updatedAt === nu.updatedAt) return old;
			return { ...nu, subBlocks };
		}
		case 'error': {
			const o = old as RenderErrorBlock;
			if (o.message === nu.message && o.updatedAt === nu.updatedAt) return old;
			return nu;
		}
		case 'agent': {
			const o = old as RenderAgentBlock;
			const node = diffRenderTree(o.node, nu.node)!;
			if (node === o.node && o.updatedAt === nu.updatedAt) return old;
			return { ...nu, node };
		}
	}
}

function diffSubBlock(oldNode: RenderSubBlock, newNode: RenderSubBlock): RenderSubBlock {
	if (oldNode.key !== newNode.key || oldNode.type !== newNode.type) return newNode;

	switch (newNode.type) {
		case 'reasoning': {
			const o = oldNode as RenderReasoningSub;
			if (o.content === newNode.content && o.updatedAt === newNode.updatedAt) return oldNode;
			return newNode;
		}
		case 'text': {
			const o = oldNode as RenderTextSub;
			if (o.content === newNode.content && o.updatedAt === newNode.updatedAt) return oldNode;
			return newNode;
		}
		case 'reflection': {
			const o = oldNode as RenderReflectionSub;
			if (o.content === newNode.content && o.remaining === newNode.remaining && o.updatedAt === newNode.updatedAt) return oldNode;
			return newNode;
		}
		case 'tool': {
			const o = oldNode as RenderToolSub;
			const children = diffKeyedArray(
				o.children ?? [], newNode.children ?? [],
				(old, nu) => diffRenderTree(old, nu)!,
				(n) => n.agentInstanceId,
			);
			const sameChildren = children === (o.children ?? []);
			if (
				sameChildren
				&& o.updatedAt === newNode.updatedAt
				&& o.callId === newNode.callId
				&& o.name === newNode.name
				&& o.reason === newNode.reason
				&& o.status === newNode.status
				&& o.args === newNode.args
				&& o.output === newNode.output
				&& o.error === newNode.error
				&& sameAsk(o.ask, newNode.ask)
			) return oldNode;
			return { ...newNode, children: children.length > 0 ? children : undefined };
		}
	}
}

/**
 * 提问卡片内容是否没变（**按值比**，不是按引用）。
 *
 * ⚠️ 为什么不能 `o.ask === nu.ask`：每次 fold 都会新建一个 `ask` 对象，引用永远不等，
 *    于是每次重算投影都被判定成「变了」→ `<For>` 当成增删项 → AskUserCard 整块重挂，
 *    组件里的局部 state（阻塞计时的秒数）跟着清零重数（2026-09-17）。
 */
function sameAsk(a: RenderAskInfo | undefined, b: RenderAskInfo | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (
		a.callId !== b.callId
		|| a.status !== b.status
		|| a.answer !== b.answer
		|| a.updatedAt !== b.updatedAt
		|| a.questions.length !== b.questions.length
	) return false;
	return a.questions.every((q, i) => {
		const bq = b.questions[i];
		return q.question === bq.question
			&& q.selectionMode === bq.selectionMode
			&& q.options.length === bq.options.length
			&& q.options.every((opt, j) => opt.label === bq.options[j].label && opt.description === bq.options[j].description);
	});
}

/**
 * 数组元素发生了变化（新增、删除、数组内元素的修改（通过 differ 返回是否原始对象判断））：返回新的数组
 * 完全没变化：返回旧数组（以保持引用稳定性）
 *
 * @param oldArr  旧数组
 * @param newArr  新数组
 * @param differ  差异函数，接收同一 key 的旧元素与新元素，返回合并后的元素（可以是新引用，可以是旧引用）
 *                如果有其中一个元素 changed（或者只在 newArr 出现，oldArr 中没有），那么整个函数的返回值就是新的结果数组
 * @param getKey  从元素中提取唯一 key 的函数（通常为 (item) => item.key）
 * @returns 若有变化则返回新的结果数组，否则返回旧数组引用
 */
function diffKeyedArray<T>(oldArr: T[], newArr: T[], differ: (o: T, n: T) => T, getKey: (item: T) => string): T[] {
	if (oldArr === newArr) return oldArr;
	if (oldArr.length === 0 && newArr.length === 0) return oldArr;

	const oldMap = new Map<string, T>();
	for (const o of oldArr) oldMap.set(getKey(o), o);

	let changed = oldArr.length !== newArr.length;
	const result: T[] = [];
	for (const newNode of newArr) {
		const oldNode = oldMap.get(getKey(newNode));
		if (oldNode) {
			const diffed = differ(oldNode, newNode);
			result.push(diffed);
			if (diffed !== oldNode) changed = true;
		} else {
			result.push(newNode);
			changed = true;
		}
	}

	return changed ? result : oldArr;
}

// #endregion

// #region 在飞 overlay（SSE 增量）

/**
 * 在飞 overlay：**与 ctx 同形状的增量**，由前端把 SSE 事件翻译着累积起来。它必须与 ctx 同形状（实例 → 条目）
 */
export interface OverlayCtx {
	conversationId?: string;
	modeId?: string;
	rootAgentInstanceId?: string;	// 本轮第一个 agent_start 带来的根实例（ctx 还没重建起来时用它兜底）
	instances: Record<string, { messages: AgentInstanceMessage[] }>;	// instanceId → 该实例在飞的条目
	meta: Record<string, Partial<AgentInstance>>;	// instanceId → 该实例在飞的展示信息
}

/** 空 overlay（一次 run 开始时用） */
export function createEmptyOverlay(conversationId?: string, modeId?: string): OverlayCtx {
	return { conversationId, modeId, instances: {}, meta: {} };
}

/**
 * 从 overlay 的增量消息中剔除已存在于 committed ctx 的重复消息。
 *
 * 场景：run 在飞期间（如 ask_user 等待用户回答），用户切走再切回来。
 * 切回来时 loadConversationCtx 会从后端拉取 ctx（后端已通过 persist() 持久化了部分消息），
 * 而 overlay 里仍保留着同一轮 run 的全部在飞消息 —— 如果简单拼接就会重复。
 *
 * 去重策略：用消息的稳定标识符做集合差。
 * - tool 结果：用 toolCallId（唯一）
 * - assistant 消息中的 toolCalls：用 toolCalls[0].id（一次 LLM 调用最多一批 toolCall，用首个 id 即可区分）
 * - 其他消息（user / system / reflection）：用 role + content 前缀组合（不用 updatedAt，因为 runner now() 和 SSE event.timestamp 之间可能有几 ms 偏差）
 */
function dedupOverlayMessages(committed: AgentInstanceMessage[], overlay: AgentInstanceMessage[]): AgentInstanceMessage[] {
	if (committed.length === 0 || overlay.length === 0) return overlay;

	const existingKeys = new Set<string>();
	for (const m of committed) {
		existingKeys.add(messageKey(m));
	}

	return overlay.filter((m) => !existingKeys.has(messageKey(m)));
}

function messageKey(m: AgentInstanceMessage): string {
	if (m.role === 'tool' && m.toolCallId) return `tool:${m.toolCallId}`;
	if (m.role === 'assistant' && m.toolCalls?.length) return `assistant_tc:${m.toolCalls[0].id}`;
	// user / system / reflection / 纯文本 assistant：
	// 用 role + content 前缀做键。不用 updatedAt，因为 runner 的 now() 和 SSE event.timestamp
	// 之间可能有几 ms 偏差，导致同一消息在 committed 和 overlay 中 updatedAt 不同而无法匹配。
	// 同一实例内不会同时出现两条 role+contentPrefix 相同的消息（content 截 80 字符足以区分）。
	const contentPrefix = (m.content ?? '').slice(0, 80);
	return `${m.role}:${contentPrefix}`;
}

/**
 * 合成「已提交的 ctx」与「在飞的 overlay」→ 一份可直接交给 `foldCtxToRenderTree()` 的 ctx。
 * 同名实例的 messages 是「已提交 + 在飞」拼接；overlay 里独有的实例用 meta 补成完整实例。
 * 纯函数，不改动入参（只做浅拷贝）。
 */
export function mergeOverlayCtx(ctx: AgentCtx | null | undefined, overlay: OverlayCtx | null | undefined): AgentCtx | null {
	if (!overlay || Object.keys(overlay.instances).length === 0) return ctx ?? null;

	const base: AgentCtx = ctx ?? {
		conversationId: overlay.conversationId ?? '',
		modeId: overlay.modeId ?? '',
		rootAgentInstanceId: overlay.rootAgentInstanceId ?? '',
		agentInstances: {},
		events: [],
		taskList: '',
		budget: { total: 0, spent: 0 },
		createdAt: 0,
		updatedAt: 0,
	};

	// 将 base 中已提交的实例浅拷贝一份，再逐个合入 overlay 中的增量数据
	const agentInstances: Record<string, AgentInstance> = { ...base.agentInstances };
	for (const [id, delta] of Object.entries(overlay.instances)) {
		const committed = agentInstances[id];
		agentInstances[id] = committed
			// 实例已存在：保留已有字段，将增量消息追加到已有消息列表末尾（跳过已持久化的重复消息）
			? { ...committed, messages: [...committed.messages, ...dedupOverlayMessages(committed.messages, delta.messages)] }
			// 实例不存在（首次出现）：用 overlay.meta 中的展示信息创建空实例，再填入增量消息
			: createEmptyAgentInstance(base, id, overlay.meta[id] ?? {}, delta.messages);
	}

	// 根实例 id 取值顺序：ctx 已提交的 → overlay 记下的 → 推断
	// 推断场景：SSE 建连超时（2s）导致 agent_start 丢失，overlay.rootAgentInstanceId 为空，
	// fold 会因 agentInstances[''] 不存在而返回 null，界面一片空白。
	// 推断规则：取 depth=0 的实例，或仅有一个实例时取那一个。
	let rootAgentInstanceId = base.rootAgentInstanceId || overlay.rootAgentInstanceId || '';
	if (!rootAgentInstanceId) {
		const ids = Object.keys(agentInstances);
		const depthZeroInstanceId = ids.find((id) => (overlay.meta[id]?.depth ?? 0) === 0);
		rootAgentInstanceId = depthZeroInstanceId ?? (ids.length === 1 ? ids[0] : '');
	}

	return {
		...base,
		rootAgentInstanceId,
		agentInstances,
	};
}

/** 用 overlay 的 meta 补出一个完整实例（本轮新建、ctx 里还没有的那个） */
function createEmptyAgentInstance(base: AgentCtx, id: string, meta: Partial<AgentInstance>, messages: AgentInstanceMessage[]): AgentInstance {
	return {
		agentInstanceId: id,
		conversationId: base.conversationId,
		modeId: base.modeId,
		agentId: meta.agentId ?? '',
		agentName: meta.agentName ?? '',
		parentAgentInstanceId: meta.parentAgentInstanceId,
		depth: meta.depth ?? 0,
		status: meta.status ?? 'running',
		task: meta.task,
		messages,
		pendingCallIds: [],
		summaries: [],
		reflectionsRemaining: 0,
		rounds: 0,
		llmCalls: 0,
		childAgentInstanceIds: [],
		startedAt: meta.startedAt ?? 0,
	};
}

// #endregion
