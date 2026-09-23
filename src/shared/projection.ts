/* ==========================================================================
   投影：ctx → 渲染树（**纯函数，不落盘**）

   这是本次改造的技术核心：界面上的所有内容都由 ctx 现算，不再持久化一份「UI 消息」。
   规则只有两条：

   ① **一次 LLM 调用 = 一个块**（`role:'assistant'` 是一次调用，反思也是一次调用 —— 两者都走
      `RenderLlmBlock`，不留例外）。这次调用的思考 / 正文 / 各次工具调用 / 反思，都是它的**子块**，
      不允许平铺到外层。
   ② 遇到 delegate / resume_* 的工具调用，就按该次调用创建的子实例递归下钻。
      所以「嵌套」是结构本身，不需要 depth 缩进来假装。

   ⚠️ 工具结果（`role:'tool'`）不单独成块 —— 它贴在对应 toolCall 子块里（调用请求 + 返回结果同处）。
   ⚠️ 账本（`usages`）不单独成块 —— 它是 assistant 条目自带的字段，渲染在该 LLM 块的下方。

   为什么放在 shared/：前后端共用同一个实现。前端流式期间自己在内存里拼的是「在飞 overlay」，
   而「已提交」部分一律走这里 —— 两套实现就是旧设计病根的复现。

   设计稿：docs/设计-ctx唯一真相与动态投影.md §4
   ========================================================================== */

import type {
	AgentCtx,
	AgentInstance,
	AgentInstanceMessage,
	AgentInstanceStatus,
	AskUserState,
	ReflectionInfo,
	TokenUsage,
	ToolResultInfo,
	UsageEntry,
} from './agent';

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
}

// ---------- LLM 调用块里的子块 ----------

export interface RenderReasoningSub extends BlockBase {
	type: 'reasoning';
	content: string;
}

export interface RenderTextSub extends BlockBase {
	type: 'text';
	content: string;
}

/** ask_user 的提问卡片内容（它没有「工具输出」，结果是「用户回答」） */
export interface RenderAskInfo {
	callId: string;
	question: string;
	options: { label: string; description?: string }[];
	status: AskUserState['status'];
	answer?: string;
}

/** 一次工具调用：调用请求 + 返回结果贴在**同一处**（结果不单独成块） */
export interface RenderToolSub extends BlockBase {
	type: 'tool';
	callId: string;
	name: string;
	/** 模型给出的调用理由（reason 参数） */
	reason: string;
	/** 还没有结果条目 = 正在执行 */
	status: 'running' | 'success' | 'error';
	/** 入参（JSON 文本；截断是渲染层的事，这里给全文） */
	args: string;
	output: string;
	error?: string;
	/** 这次调用创建 / 唤醒的子实例，整块嵌套渲染（delegate 是挂载点） */
	children?: RenderAgentNode[];
	/** ask_user：渲染成提问卡片而不是工具块 */
	ask?: RenderAskInfo;
}

/** 反思：它也是一次 LLM 调用，只是产出形态固定（一句追问），所以照样是 llm 块里的一个子块 */
export interface RenderReflectionSub extends BlockBase {
	type: 'reflection';
	content: string;
	/** 本轮反思后还剩几次 */
	remaining?: number;
}

export type RenderSubBlock = RenderReasoningSub | RenderTextSub | RenderToolSub | RenderReflectionSub;

// ---------- 顶层块 ----------

export interface RenderUserBlock extends BlockBase {
	type: 'user';
	content: string;
}

/**
 * ⭐ **一次 LLM 调用 = 一个块**。
 *
 * 子块 = 这次调用产出的思考 / 正文 / 各次工具调用（结果贴在调用处）；
 * 账本（`usages`）挂在本块**下方** —— 它是这次调用自带的一条数据，不是独立条目。
 */
export interface RenderLlmBlock extends BlockBase {
	type: 'llm';
	subBlocks: RenderSubBlock[];
	/** 本次调用花了多少（通常 1 条；工具内部发起的子请求会顺延挂到下一次调用上） */
	usages?: UsageEntry[];
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

	// 索引：callId → 工具结果条目 / 提问卡片状态条目
	const resultByCallId = new Map<string, AgentInstanceMessage>();
	const askStateByCallId = new Map<string, AskUserState>();
	for (const entry of entries) {
		if (entry.role === 'tool' && entry.toolCallId) resultByCallId.set(entry.toolCallId, entry);
		if (entry.kind === 'ask_user_state') {
			const state = entry.data as AskUserState;
			askStateByCallId.set(state.callId, state);
		}
	}

	const blocks: RenderBlock[] = [];
	const claimedChildIds = new Set<string>();
	let counter = 0;
	const nextKey = (kind: string) => `${instance.agentInstanceId}:${kind}:${counter++}`;

	for (const entry of entries) {
		// ① 反思条目：正文在 content 里，它本身就是**一次 LLM 调用**（所以照样出一个 llm 块，
		//    里面只有一个 reflection 子块）。有追问的那条同时进 LLM 上下文（没有 uiOnly 标记），
		//    没追问的那条只给界面看 —— 两者都要渲染，所以这个判断必须放在 role 之前。
		if (entry.kind === 'reflection') {
			blocks.push({
				type: 'llm',
				key: nextKey('refl'),
				subBlocks: [{
					type: 'reflection',
					key: nextKey('refl-sub'),
					content: entry.content,
					remaining: (entry.data as ReflectionInfo | undefined)?.remaining,
				}],
				usages: entry.usages,
			});
			continue;
		}

		// ② 提问卡片状态：跟随它的那次工具调用渲染（见 ⑥），不单独出行
		if (entry.kind === 'ask_user_state') continue;

		// ③ 工具结果：贴在对应 toolCall 的位置（见 ⑥），不单独成块
		if (entry.role === 'tool') continue;

		// ④ system：本实例的 system prompt，不进转写（反思已在 ① 处理掉）
		if (entry.role === 'system') continue;

		// ⑤ 用户发言（根实例 = 用户每轮的原话；子实例的任务在节点头部显示）
		if (entry.role === 'user') {
			blocks.push({ type: 'user', key: nextKey('user'), content: entry.content });
			continue;
		}

		// ⑥ assistant = **一次 LLM 调用 → 一个块**；思考 / 正文 / 工具调用都是它的子块
		const subBlocks: RenderSubBlock[] = [];
		if (entry.reasoningContent) {
			subBlocks.push({ type: 'reasoning', key: nextKey('think'), content: entry.reasoningContent });
		}
		if (entry.content?.trim()) {
			subBlocks.push({ type: 'text', key: nextKey('text'), content: entry.content });
		}
		for (const toolCall of entry.toolCalls ?? []) {
			const resultEntry = resultByCallId.get(toolCall.id);
			const resultInfo = resultEntry?.data as ToolResultInfo | undefined;
			const args = parseArgs(toolCall.function.arguments);
			const reason = typeof args?.reason === 'string' ? args.reason : '';

			// ask_user 的工具调用渲染成提问卡片（它的「结果」是用户回答）
			if (toolCall.function.name === 'ask_user') {
				const state = askStateByCallId.get(toolCall.id);
				subBlocks.push({
					type: 'tool',
					key: nextKey('ask'),
					callId: toolCall.id,
					name: toolCall.function.name,
					reason,
					status: state?.status === 'waiting' ? 'running' : 'success',
					args: toolCall.function.arguments,
					output: '',
					ask: {
						callId: toolCall.id,
						question: typeof args?.question === 'string' ? args.question : '需要你的确认',
						options: Array.isArray(args?.options) ? (args.options as RenderAskInfo['options']) : [],
						status: state?.status ?? 'waiting',
						answer: state?.answer,
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

			subBlocks.push({
				type: 'tool',
				key: nextKey('tool'),
				callId: toolCall.id,
				name: toolCall.function.name,
				reason,
				status: !resultEntry ? 'running' : resultInfo?.success === false ? 'error' : 'success',
				args: toolCall.function.arguments,
				output: resultEntry?.content ?? '',
				error: resultInfo?.error,
				children: children && children.length > 0 ? children : undefined,
			});
		}

		// 空 assistant（没正文没思考没工具调用）就不出行了，免得界面上多一个空壳
		if (subBlocks.length === 0 && !entry.usages?.length) continue;
		blocks.push({ type: 'llm', key: nextKey('llm'), subBlocks, usages: entry.usages });
	}

	// 兜底：没被任何工具调用认领的子实例（正常流程不会发生，比如结果结构化字段缺失）
	for (const childId of instance.childAgentInstanceIds ?? []) {
		if (claimedChildIds.has(childId)) continue;
		const child = ctx.agentInstances[childId];
		if (child) blocks.push({ type: 'agent', key: nextKey('orphan'), node: buildNode(ctx, child) });
	}

	// 失败 / 被中断的实例：原因只存在 interruptReason 里（错误不会进 messages），渲染成一块错误
	if ((instance.status === 'failed' || instance.status === 'interrupted') && instance.interruptReason) {
		blocks.push({ type: 'error', key: nextKey('error'), message: instance.interruptReason });
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

// #region 在飞 overlay（SSE 增量）

/**
 * 在飞 overlay：**与 ctx 同形状的增量**，由前端把 SSE 事件翻译着累积起来。
 *
 * ⚠️ 它必须与 ctx 同形状（实例 → 条目），**不能**在渲染层用「扁平块列表」——
 * 否则子 Agent 的在飞内容没法嵌进上级的 delegate 块里，就只能再写一套拼树逻辑，
 * 而那正是旧设计病根的复现。这样「在飞」与「已提交」共用同一个 fold。
 */
export interface OverlayCtx {
	conversationId?: string;
	modeId?: string;
	/** 本轮第一个 agent_start 带来的根实例（ctx 还没重建起来时用它兜底） */
	rootAgentInstanceId?: string;
	/** instanceId → 该实例在飞的条目 */
	instances: Record<string, { messages: AgentInstanceMessage[] }>;
	/** 在飞实例的展示信息（来自 agent_start） */
	meta: Record<string, Partial<AgentInstance>>;
}

/** 空 overlay（一次 run 开始时用） */
export function emptyOverlay(conversationId?: string, modeId?: string): OverlayCtx {
	return { conversationId, modeId, instances: {}, meta: {} };
}

/**
 * 合成「已提交的 ctx」与「在飞的 overlay」→ 一份可直接交给 `foldCtxToRenderTree()` 的 ctx。
 * 同名实例的 messages 是「已提交 + 在飞」拼接；overlay 里独有的实例用 meta 补成完整实例。
 * 纯函数，不改动入参（只做浅拷贝）。
 */
export function mergeOverlayCtx(
	ctx: AgentCtx | null | undefined,
	overlay: OverlayCtx | null | undefined,
): AgentCtx | null {
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

	const agentInstances: Record<string, AgentInstance> = { ...base.agentInstances };
	for (const [id, delta] of Object.entries(overlay.instances)) {
		const committed = agentInstances[id];
		agentInstances[id] = committed
			? { ...committed, messages: [...committed.messages, ...delta.messages] }
			: overlayInstance(base, id, overlay.meta[id] ?? {}, delta.messages);
	}

	return {
		...base,
		rootAgentInstanceId: base.rootAgentInstanceId || overlay.rootAgentInstanceId || '',
		agentInstances,
	};
}

/** 用 overlay 的 meta 补出一个完整实例（本轮新建、ctx 里还没有的那个） */
function overlayInstance(
	base: AgentCtx,
	id: string,
	meta: Partial<AgentInstance>,
	messages: AgentInstanceMessage[],
): AgentInstance {
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
