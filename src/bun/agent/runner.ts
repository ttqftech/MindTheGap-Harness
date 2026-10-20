/**
 * Agent Runner — MindTheGap-Harness（替代 v1 的 engine.ts）
 *
 * 核心不变式：**执行工具即退出 agentLoop**，由调度器按状态重入。
 * 全篇没有 Promise 等待链：一个实例在等谁，只由「status + pendingCallIds」表达，
 * 写进 ctx.json，所以「用户中途打断 → 稍后继续」和「进程重启」都能成立。
 *
 * agentLoop(agentInstanceId) 的一轮：
 *   1. 重建 system prompt、取该实例可见工具
 *   2. 调 LLM（流式）
 *   3. 把 assistant 消息（含 tool_calls）写入实例消息
 *   4. 没有 tool_call → 走结束路径（可能先反思）
 *   5. 有 tool_call → 全部落 pending → 交给调度器 → **立刻 return**
 * 调度器执行完一批工具后判断是否满足重入条件，满足则再次 agentLoop。
 *
 * **挂起的 tool call 只有一条路**：挂起时记下在等什么（`pendingWait`）→ 结果到了走 `resolvePendingCall()` → 都等到了才重入。等用户回答和等子 Agent 跑完是同一条路的两个原因，没有各自的小路径。
 *
 * 状态全部在 ctx 里；本类只在一次 run 期间做「内存中的调度缓存」（busy 集合、delegate 分组、挂起原因），进程重启后这些缓存可以安全地重新推导。
 */

import type { AgentCtx, AgentDefinition, AgentInstance, AgentInstanceMessage, AgentInstanceStatus, AgentRunRequest, AgentStreamEvent, ConversationRunStatus, LlmMessage, LlmTriggerReason, ModeDefinition, ModelConfig, StreamEventDraft, TokenUsage, ToolControl, ToolResult, ToolResultInfo, UsageEntry } from '@shared/agent';
import { callLlm } from '../llm/model';
import { mcpManager } from '../mcp/manager';
import { getMode, isLoaded, listModes, loadAllPlugins, resolveReflectionPrompt } from '../plugins/loader';
import { conversations, ensureConversationDir, settings } from '../storage';
import { logMsg } from '../utils';
import { renderSystemPrompt } from './prompt';
import { executeTool, getBuiltinToolNames, getToolsForAgentInstance, toLlmTools, type AgentTool, type ToolContext, type ToolLlmRequest, type ToolLlmResult, type TaskListWriteArgs } from './tools';

const uid = () => Math.random().toString(36).slice(2, 12);
const now = () => Date.now();

/**
 * 一个挂在 `pendingCallIds` 里的 call 在等什么。
 *
 * 「等用户点按钮」和「等子 Agent 跑完」原本是两套互不认识的写法（前者靠扫消息里的 tool result structured 反推，后者靠 structured.status === 'pending'），
 * 现在统一成一条路径：挂起时记原因 → `resolvePendingCall()` 回填 → 都等到了就重入。
 */
type PendingWait = 'client' | 'child';

// #region 提示词常量

/** ask_child 的固定提示词（属「基座」，允许用配置追加自定义内容） */
const ASK_CHILD_FIXED_PROMPT = `以下是一个子 Agent 的历史工作记录。请**仅依据这些记录**回答提问。
若记录不足以回答，请明确说明「记录中未包含该信息」，不要推测或编造。
回答应简洁、直接给出结论与必要的依据引用。`;

// #endregion

// #region 工具函数

function isTerminal(status: AgentInstanceStatus): boolean {
	return status === 'succeeded' || status === 'failed' || status === 'interrupted';
}

function message(msg: LlmMessage): AgentInstanceMessage {
	return { ...msg, updatedAt: now() };
}

/**
 * 组装真正发给模型的 messages。
 *
 * `instance.messages` 是双重身份：既是界面转写的唯一真相，又是 LLM 上下文。所以这里必须
 * ①滤掉「只给界面看」的条目（usage / 提问卡片状态，见 shared/agent.ts 的 uiOnly）
 * ②剥掉内部字段（updatedAt 等），免得被序列化进请求体。
 *
 * ⚠️ 所有 callLlm 调用点都必须经过本函数 —— 直接 map instance.messages 会把 UI 专用内容塞给模型。
 */
function toLlmMessages(entries: AgentInstanceMessage[]): LlmMessage[] {
	return entries
		.filter((m) => !m.uiOnly)
		.map(({ updatedAt: _updatedAt, uiOnly: _uiOnly, kind: _kind, data: _data, usages: _usages, ...rest }) => rest);
}

function mergeTokens(prev: TokenUsage | undefined, usage: TokenUsage): TokenUsage {
	return {
		input: (prev?.input ?? 0) + (usage?.input ?? 0),
		inputCached: (prev?.inputCached ?? 0) + (usage?.inputCached ?? 0),
		output: (prev?.output ?? 0) + (usage?.output ?? 0),
		total: (prev?.total ?? 0) + (usage?.total ?? 0),
	};
}

function buildUsageEntry(result: { usage: TokenUsage; logId: string; seq: number; durationMs: number; modelId: string }, meta: { purpose: string; agentInstanceRound?: number }): UsageEntry {
	return {
		seq: result.seq,
		round: meta.agentInstanceRound,
		purpose: meta.purpose,
		model: result.modelId,
		logId: result.logId,
		input: result.usage.input,
		output: result.usage.output,
		cached: result.usage.inputCached,
		total: result.usage.total,
		durationMs: result.durationMs,
	};
}

/** 任务清单：文本 ↔ 结构化条目 */
function parseTaskList(text: string): { done: boolean; item: string }[] {
	return (text ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^-\s*\[[ xX]\]/.test(line))
		.map((line) => ({
			done: /^-\s*\[[xX]\]/.test(line),
			item: line.replace(/^-\s*\[[ xX]\]\s*/, '').trim(),
		}));
}

function renderTaskList(items: { done: boolean; item: string }[]): string {
	if (items.length === 0) return '';
	return `# 任务清单\n${items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.item}`).join('\n')}`;
}

/**
 * 反思输出里是否含「真正要补做的事」。
 *
 * 宽松口径的反思提示词（见 plugins/MTG-builtin/daily/reflection.md）允许模型直接回「无」——那不是一个可执行的追问，若当成追问去重入，就又白烧一轮。
 * 所以除了空串，还要认几种「明确表示无需补做」的短语（限短文本，避免误伤真正的追问）。
 */
function reflectionActionable(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (t.length <= 12 && /^(无|没有|无需|无需要|无需追问|无追问|none|n\/?a|nothing)/i.test(t)) return false;
	return true;
}

// #endregion

// #region Runner

export interface RunnerOptions {
	onStream?: (event: AgentStreamEvent) => void;
}

export class AgentRunner {
	readonly conversationId: string;
	private mode: ModeDefinition;
	private model: ModelConfig;
	private runningDir: string;
	private ctx: AgentCtx;
	private options: RunnerOptions;

	private abortController = new AbortController();
	private aborted = false;

	/** 正在跑 agentLoop 的实例（防止同一实例被并发重入） */
	private busy = new Set<string>();
	/** 子实例 → 它属于哪次委托 */
	private childLink = new Map<string, { parentAgentInstanceId: string; callId: string; toolName: string }>();
	/** 挂起中的 callId → 它在等什么（见 `PendingWait`）。回填后删除 */
	private pendingWait = new Map<string, PendingWait>();

	private doneResolve: (() => void) | null = null;
	private donePromise: Promise<void>;

	constructor(params: { request: AgentRunRequest; mode: ModeDefinition; ctx: AgentCtx; options?: RunnerOptions }) {
		this.conversationId = params.request.conversationId;
		this.mode = params.mode;
		this.model = params.request.model;
		this.runningDir = params.request.runningDir || process.cwd();
		this.ctx = params.ctx;
		this.options = params.options ?? {};
		this.donePromise = new Promise((resolve) => {
			this.doneResolve = resolve;
		});
	}

	// #region 对外接口

	getCtx(): AgentCtx {
		return this.ctx;
	}

	waitDone(): Promise<void> {
		return this.donePromise;
	}

	/**
	 * 会话级运行状态（三态）—— 从根实例 status 推导。
	 *
	 * 这是 `GET /api/conversations` 里 `runStatus` 的唯一真值源。
	 * ⚠️ `pending`（等 ask_user / 等子 Agent）算 `waiting`，不算 `stopped`：
	 *   run 还活着，只是不在主动产出，UI 要显示成「等待输入」。
	 */
	runStatus(): ConversationRunStatus {
		const root = this.ctx.agentInstances[this.ctx.rootAgentInstanceId];
		if (!root) return 'stopped';
		if (root.status === 'running') return 'running';
		if (root.status === 'pending') return 'waiting';
		return 'stopped';
	}

	cancel(): void {
		this.aborted = true;
		try {
			this.abortController.abort();
		} catch {}
		for (const instance of Object.values(this.ctx.agentInstances)) {
			if (!isTerminal(instance.status)) {
				instance.status = 'interrupted';
				instance.interruptReason = '用户取消';
				instance.lastUpdatedAt = now();
				this.emitStream({ type: 'agent_end', agentInstanceId: instance.agentInstanceId, status: 'interrupted' });
			}
		}
		this.persist();
		this.finishDone();
	}

	/** 用户回答了某个 client 工具（ask_user） */
	async answerToolCall(toolCallId: string, result: string): Promise<{ ok: boolean; error?: string }> {
		const target = Object.values(this.ctx.agentInstances).find((instance) => (instance.pendingCallIds ?? []).includes(toolCallId));
		if (!target) return { ok: false, error: `未找到等待中的工具调用 ${toolCallId}` };
		if (this.pendingWait.get(toolCallId) !== 'client') {
			return { ok: false, error: `工具调用 ${toolCallId} 不是在等用户回答` };
		}

		this.resolvePendingCall(target, toolCallId, { success: true, content: result, structured: { askUserStatus: 'answered' as const, askUserAnswer: result } }, 'answer');
		this.persist();
		return { ok: true };
	}

	// #endregion

	// #region 启动

	/**
	 * 发起一轮 run。
	 * - 会话已有根实例 → **永远沿用**（一个会话一个根实例，历史因此天然完整，见 docs/设计-ctx唯一真相与动态投影.md §3.1）
	 * - 会话还没有根实例 → 新建，实例树里只有它自己
	 */
	async run(userMessage: string): Promise<void> {
		const limits = this.getModeLimits();
		this.ctx.budget = { total: limits.totalRounds, spent: 0 };
		this.ctx.modeId = this.mode.id;

		let root = this.ctx.agentInstances[this.ctx.rootAgentInstanceId];
		// 新建根实例时由 createInstance 负责发 agent_start；只有「沿用已有实例」才在这里补发
		const isNewRoot = !root;
		if (isNewRoot) {
			const instanceId = uid();
			const def = this.mode.agents[this.mode.rootAgent];
			root = this.createInstance({
				agentInstanceId: instanceId,
				agentId: this.mode.rootAgent,
				def,
				depth: 0,
				task: userMessage,
			});
			this.ctx.agentInstances[instanceId] = root;
			this.ctx.rootAgentInstanceId = instanceId;
		}

		/**
		 * 上一轮挂起的 client 工具（ask_user）在用户发新消息时算作「已跳过」
		 * 
		 * 用户直接发新消息（不是回答问题）→ 本轮所有挂起的 call 一律作废。
		 * 等用户的写成「已跳过」；等子 Agent 的不再驱动父实例（子实例跑完仍会补写结果进记录，只是没人等它了）。
		 */
		for (const instance of Object.values(this.ctx.agentInstances)) {
			for (const callId of instance.pendingCallIds ?? []) {
				if (this.pendingWait.get(callId) === 'client') {
					const result: ToolResult = { success: true, content: '用户已跳过此提问', structured: { askUserStatus: 'skipped' as const } };
					this.emitStream({ type: 'tool_end', agentInstanceId: instance.agentInstanceId, callId, toolName: 'ask_user', result });
					this.writeToolResult(instance, callId, result);
				}
				this.pendingWait.delete(callId);
			}
			instance.pendingCallIds = [];
			if (instance.status === 'pending') instance.status = 'running';
		}

		// 被中断 / 已完成的根实例：本次发言就是「唤醒它」，回到 running
		root.status = 'running';
		root.interruptReason = undefined;
		root.task = userMessage;
		const agentDef = this.getAgentDefinitionByInstance(root);
		root.lastUpdatedAt = now();
		if (!isNewRoot) root.reflectionsRemaining = agentDef.reflectionCount ?? 0;	// 反思次数是实例级字段且只减不增；根实例永续之后必须按轮重置，否则反思用尽一次就再也不反思了
		if (!isNewRoot) root.messages.push(message({ role: 'user', content: userMessage }));	// 新建实例时 createInstance 已经把这条用户消息作为首条 message 放进去了，非新建的时候才在这里再补一条
		this.emitEvent(root, 'user_message', { content: userMessage });
		if (!isNewRoot) {
			this.emitStream({
				type: 'agent_start',
				agentInstanceId: root.agentInstanceId,
				agentId: root.agentId,
				agentName: root.agentName,
				depth: root.depth,
				task: userMessage,
			});
		}
		this.enterLoop(root.agentInstanceId, 'user_message');
	}

	// #endregion

	// #region 实例管理

	/** 获取当前模式配置的的运行限制。若未配置（理论上保存时校验可以避免用户不配置此项）则给一个较高的限制值 */
	private getModeLimits() {
		const limits = this.mode.limits ?? {};
		return {
			totalRounds: limits.totalRounds ?? 1000,
			agentInstanceRounds: limits.agentInstanceRounds ?? 200,
			warnAtRemaining: limits.warnAtRemaining ?? 0,
		};
	}

	private getAgentDefinitionByInstance(agentInstance: AgentInstance): AgentDefinition {
		const def = this.mode.agents[agentInstance.agentId];
		if (!def) throw new Error(`当前实例正在使用的 Agent "${agentInstance.agentId}" 在当前模式 "${this.mode.id}" 下不存在配置。可能是插件配置发生了变化，不兼容当前会话`);
	    return def;
	}

	/** 创建一个 Agent 实例，放入 this.ctx 中，并补充父实例的 childAgentInstanceIds、发送事件 */
	private createInstance(params: { agentInstanceId: string; agentId: string; def: AgentDefinition; depth: number; task: string; parentAgentInstanceId?: string }): AgentInstance {
		const instance: AgentInstance = {
			agentInstanceId: params.agentInstanceId,
			conversationId: this.conversationId,
			modeId: this.mode.id,
			agentId: params.agentId,
			agentName: params.def.name,
			parentAgentInstanceId: params.parentAgentInstanceId,
			depth: params.depth,
			status: 'running',
			task: params.task,
			messages: [
				message({
					role: 'user',
					content: params.parentAgentInstanceId
						? `[来自父 Agent 的任务]\n${params.task}`	// TODO 提示词中同样可以嵌入 parentPrompt，考虑配置是否插入这句话
						: params.task,
				}),
			],
			pendingCallIds: [],
			summaries: [],
			reflectionsRemaining: params.def.reflectionCount ?? 0,
			rounds: 0,
			llmCalls: 0,
			childAgentInstanceIds: [],
			startedAt: now(),
			lastUpdatedAt: now(),
		};
		this.ctx.agentInstances[params.agentInstanceId] = instance;

		if (params.parentAgentInstanceId) {
			const parent = this.ctx.agentInstances[params.parentAgentInstanceId];
			if (parent && !parent.childAgentInstanceIds.includes(params.agentInstanceId)) {
				parent.childAgentInstanceIds.push(params.agentInstanceId);
			}
		}

		this.emitEvent(instance, 'agent_start', {
			agentId: instance.agentId,
			agentName: instance.agentName,
			depth: instance.depth,
			task: params.task,
		});
		this.emitStream({
			type: 'agent_start',
			agentInstanceId: instance.agentInstanceId,
			parentAgentInstanceId: params.parentAgentInstanceId,
			agentId: instance.agentId,
			agentName: instance.agentName,
			depth: instance.depth,
			task: params.task,
		});
		return instance;
	}

	// #endregion

	// #region agentLoop

	private enterLoop(agentInstanceId: string, trigger: LlmTriggerReason): void {
		void this.agentLoop(agentInstanceId, trigger).catch((e) => {
			logMsg.error(`[Runner] agentLoop 异常: ${(e as Error).message}`);
		});
	}

	/** 条件性重入：检查实例是否满足重新进入 agentLoop 的前提条件，满足则重新启动循环，不满足则静默跳过。 */
	private maybeReenter(agentInstanceId: string, trigger: LlmTriggerReason): void {
		const instance = this.ctx.agentInstances[agentInstanceId];
		if (!instance) return;                                    // ① 实例不存在 → 跳过
		if (isTerminal(instance.status)) return;                  // ② 已终态（succeeded/failed/interrupted）→ 跳过
		if ((instance.pendingCallIds ?? []).length > 0) return;   // ③ 还有未完成的 tool call → 跳过
		if (this.busy.has(agentInstanceId)) return;               // ④ 实例正在 agentLoop 中执行 → 跳过
		instance.status = 'running';                              // ⑤ 标记为运行中
		this.enterLoop(agentInstanceId, trigger);                 // ⑥ 启动新一轮循环
	}

	private async agentLoop(agentInstanceId: string, trigger: LlmTriggerReason): Promise<void> {
		const instance = this.ctx.agentInstances[agentInstanceId];
		if (!instance || isTerminal(instance.status)) return;
		if (this.busy.has(agentInstanceId)) return;
		this.busy.add(agentInstanceId);

		let nextTrigger: LlmTriggerReason | null = null;
		let exitReason: 'ask_user' | 'finish' | 'interrupted' | 'error' | 'await_child' = 'finish';
		try {
			if (this.aborted) {
				exitReason = 'interrupted';
				this.markInterrupted(instance, '用户取消');
				return;
			}

			const limits = this.getModeLimits();
			instance.rounds += 1;
			this.ctx.budget.spent += 1;

			// 预算耗尽 → 强制收尾（把「因预算耗尽中止」交还父实例判断，而不是静默丢弃）
			if (instance.rounds > limits.agentInstanceRounds || this.ctx.budget.spent > limits.totalRounds) {
				const reason = instance.rounds > limits.agentInstanceRounds ? '本实例循环上限' : '总循环预算';
				nextTrigger = await this.endPath(instance, `[预算耗尽] 因${reason}中止。已完成部分见此前消息；未完成项需父 Agent 决定是否继续。`, { forced: true });
				return;
			}

			const def = this.getAgentDefinitionByInstance(instance);
			const tools = getToolsForAgentInstance(instance, def, this.mode);
			const systemPrompt = this.buildSystemPrompt(instance, tools);

			// 最终 prompt 为空 → 不下发 system message（「空」模式的准确落地方式）
			if (systemPrompt.trim()) {
				if (instance.messages[0]?.role === 'system') {
					instance.messages[0] = message({ role: 'system', content: systemPrompt });
				} else {
					instance.messages.unshift(message({ role: 'system', content: systemPrompt }));
				}
			} else if (instance.messages[0]?.role === 'system') {
				instance.messages.shift();
			}

			const requireReason = def.ability.requireReason !== false;
			const llmTools = toLlmTools(tools, requireReason);

			const result = await callLlm(
				{
					config: this.model,
					messages: toLlmMessages(instance.messages),
					tools: llmTools,
					onChunk: (chunk) => {
						// 思考增量先发：思考模型的推理阶段通常远长于正文，
						// 只推 text 的话「模型正在思考」这段时间界面上是全黑的。
						if (chunk.reasoningDelta) {
							this.emitStream({ type: 'reasoning', agentInstanceId, chunk: chunk.reasoningDelta });
						}
						if (chunk.textDelta) {
							this.emitStream({ type: 'text', agentInstanceId, chunk: chunk.textDelta });
						}
					},
					signal: this.abortController.signal,
				},
				{
					conversationId: this.conversationId,
					// 这里永远是「带工具的正常轮次」；由反思重入的记为 trigger='reflection'，
					// 真正的反思请求在 reflect() 里发（purpose='reflection'、无工具）。
					purpose: 'agent_loop',
					agentInstanceId,
					agentId: instance.agentId,
					agentName: instance.agentName,
					depth: instance.depth,
					modeId: this.mode.id,
					trigger,
					triggeredByCallIds: this.lastResolvedCallIds,
					agentInstanceRound: instance.rounds,
				},
			);
			this.lastResolvedCallIds = undefined;

			const usageEntry = buildUsageEntry(result, { purpose: 'agent_loop', agentInstanceRound: instance.rounds });
			instance.llmCalls += 1;
			instance.tokens = mergeTokens(instance.tokens, result.usage);

			const assistantMessage: LlmMessage = { role: 'assistant', content: result.text };
			if (result.reasoningContent) assistantMessage.reasoningContent = result.reasoningContent;
			if (result.toolCalls.length > 0) {
				assistantMessage.toolCalls = result.toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
				}));
			}
			instance.messages.push({ ...message(assistantMessage), usages: [usageEntry] });
			instance.lastUpdatedAt = now();
			// 给在飞中的前端 ctx 发送 usage 事件（因不可能从 chunk 中携带 usage，所以要另发）
			this.emitStream({
				type: 'usage',
				agentInstanceId,
				logId: result.logId,
				tokens: result.usage,
				seq: result.seq,
				round: instance.rounds,
				purpose: 'agent_loop',
				agentName: instance.agentName,
				depth: instance.depth,
				durationMs: result.durationMs,
				model: result.modelId,
			});
			this.emitEvent(instance, 'assistant_message', { text: result.text, toolCallIds: result.toolCalls.map((t) => t.id) });

			// 没有工具调用 → 结束路径（根实例的隐式完成路径；可能返回反思轮）
			if (result.toolCalls.length === 0) {
				nextTrigger = await this.endPath(instance, result.text.trim() || '(无输出)');
				return;
			}

			// 有工具调用 → 落 pending，交给调度器，然后立刻退出循环
			instance.pendingCallIds = [
				...(instance.pendingCallIds ?? []),
				...result.toolCalls.map((tc) => tc.id),
			];
			instance.status = 'running';
			nextTrigger = await this.dispatchToolUse(instance, def, result.toolCalls);
			this.persist();
		} catch (e) {
			exitReason = 'error';
			const err = e as Error;
			if (this.aborted || err?.name === 'AbortError') {
				exitReason = 'interrupted';
				this.markInterrupted(instance, '用户取消');
			} else {
				logMsg.error(`[Runner] 实例 ${agentInstanceId} 出错:`, err.message);
				instance.status = 'failed';
				instance.interruptReason = err.message;
				instance.lastUpdatedAt = now();
				this.emitEvent(instance, 'system', { level: 'error', message: err.message });
				this.emitStream({ type: 'error', agentInstanceId, message: err.message });
				this.emitStream({ type: 'agent_end', agentInstanceId, status: 'failed', summary: err.message });
				this.handleChildTerminal(instance);
			}
		} finally {
			// 重入统一放这里：任何 return 路径（含结束路径的反思轮）都先释放 busy 再重入，
			// 否则 maybeReenter 会被 busy 守卫挡掉。
			this.busy.delete(agentInstanceId);
			if (nextTrigger) this.maybeReenter(agentInstanceId, nextTrigger);
		}
	}

	/** 上一次 LLM 请求是在回填哪些 tool_call 的结果之后发出的（写进 requestLog） */
	private lastResolvedCallIds: string[] | undefined;

	// #endregion

	// #region 工具调用逻辑

	/**
	 * 执行一批工具调用；返回重入原因（null = 不重入：实例在等外部事件或已走结束路径）。
	 *
	 * 每个 call 的结局只有三种，全由 `ToolResult.control` 显式给出：
	 * - 无 control（普通工具）→ 当场写终态结果、从 pending 摘掉 → 一批走完就重入
	 * - `ask_user` / `await_child` → 记下挂起原因、留在 pending 里，等 `resolvePendingCall()` 回填
	 * - `finish` → 走结束路径（可能返回反思轮）
	 */
	private async dispatchToolUse(instance: AgentInstance, def: AgentDefinition, toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]): Promise<LlmTriggerReason | null> {
		const resolved: string[] = [];
		let finishSummary: string | null = null;

		for (const call of toolCalls) {
			const reason = typeof call.arguments.reason === 'string' ? (call.arguments.reason as string) : '';
			if (!reason) {
				// 兜底只保留一行日志：模型幻觉 / 供应商未遵守 required 时照常执行，但留观测点
				logMsg(`[Runner] 工具 ${call.name} 未说明调用理由（reason 为空）`);
				this.emitEvent(instance, 'system', { level: 'warn', message: `工具 ${call.name} 未说明调用理由` });
			}

			this.emitEvent(instance, 'tool_call', { name: call.name, callId: call.id, reason, status: 'running' });
			this.emitStream({
				type: 'tool_start',
				agentInstanceId: instance.agentInstanceId,
				callId: call.id,
				toolName: call.name,
				args: call.arguments,
				reason,
			});

			// 构造某次工具调用的 ToolContext（编排原语捕获 callId）
			const toolCtx = {
				ctx: this.ctx,
				agentInstanceId: instance.agentInstanceId,
				runningDir: this.runningDir,
				conversationDir: ensureConversationDir(this.conversationId),
				reason,
				def,
				mode: this.mode,
				signal: this.abortController.signal,
				delegate: async (agentId, task) => this.primitiveDelegate(instance, call.id, agentId, task, call.name),
				finish: async (summary) => ({
					success: true,
					content: summary,
					control: { kind: 'finish', summary } satisfies ToolControl,
				}),
				resumePendingChild: async (targetId) => this.primitiveResumePending(instance, call.id, targetId, call.name),
				resumeCompletedChild: async (targetId, followUp) => this.primitiveResumeCompleted(instance, call.id, targetId, followUp, call.name),
				askChild: async (targetId, question) => this.primitiveAskChild(instance, targetId, question),
				askUser: async (args) => ({
					success: true,
					content: '已向客户端发出提问，等待用户回应',
					control: { kind: 'ask_user', args } satisfies ToolControl,
				}),
				readTaskList: () => this.ctx.taskList || '',
				writeTaskList: (op) => this.applyTaskListOp(op),
				runLlm: (req) => this.toolSubLlm(instance, req),
			} satisfies ToolContext;
			const result = await executeTool(call.name, call.arguments, toolCtx);
			const control = result.control;

			if (control?.kind === 'finish') {
				finishSummary = control.summary ?? result.content;
			}

			if (control?.kind === 'ask_user') {
				// 挂起等用户：占位结果（含 askUserStatus）→ 前端弹卡片，callId 留在 pending 里
				const placeholder: ToolResult = { success: true, content: '已向客户端发出提问，等待用户回应', structured: { askUserStatus: 'waiting' as const } };
				this.writeToolResult(instance, call.id, placeholder);
				instance.status = 'pending';
				this.pendingWait.set(call.id, 'client');
				this.emitStream({
					type: 'client_tool_call',
					agentInstanceId: instance.agentInstanceId,
					callId: call.id,
					toolName: call.name,
					args: control.args ?? call.arguments,
					needResponse: true,
				});
				this.emitStream({ type: 'tool_end', agentInstanceId: instance.agentInstanceId, callId: call.id, toolName: call.name, result: placeholder });
				continue;
			}

			this.writeToolResult(instance, call.id, result);
			this.emitStream({
				type: 'tool_end',
				agentInstanceId: instance.agentInstanceId,
				callId: call.id,
				toolName: call.name,
				result,
			});
			// ⚠️ delegate / resume_* 的即时结果只是**占位**（「未完成，完成后回填到这里」），
			// 真正的总结要等子实例进入终态时由 handleChildTerminal 写回。
			// 所以它们不算「已解析」：否则下面会把 callId 从 pendingCallIds 里摘掉，
			// 父实例会在子 Agent 还在跑的时候就重入（破坏「等子 Agent，不重入」的不变式，
			// 表现为父 Agent 把占位文案当成子任务的最终结果直接汇报）。
			if (control?.kind === 'await_child') {
				this.pendingWait.set(call.id, 'child');
				continue;
			}
			resolved.push(call.id);
		}

		// 当场拿到结果的从 pending 里摘掉；挂起的留在里面
		instance.pendingCallIds = (instance.pendingCallIds ?? []).filter((id) => !resolved.includes(id));
		if (resolved.length > 0) this.lastResolvedCallIds = resolved;

		// finish 是「提交总结」这个动作本身，放在所有工具结果写完之后处理。
		// 它不重入本实例（finish 即退出），但可能返回反思轮触发类型交给 agentLoop 重入。
		if (finishSummary !== null) {
			return await this.endPath(instance, finishSummary);
		}

		// 还有挂起的 call（等用户 / 等子 Agent）就不重入，等 resolvePendingCall() 唤醒
		if ((instance.pendingCallIds ?? []).length > 0) return null;
		return 'tool_results';
	}

	// #endregion

	// #region 编排原语实现

	private chargeSubLlm(instance: AgentInstance, result: { usage: TokenUsage; logId: string; seq: number; durationMs: number; modelId: string }, meta?: { purpose?: string; agentInstanceRound?: number }): void {
		instance.llmCalls += 1;
		instance.tokens = mergeTokens(instance.tokens, result.usage);
		const lastAssistant = instance.messages.findLast((m) => m.role === 'assistant');
		const usageEntry = buildUsageEntry(result, { purpose: meta?.purpose ?? 'web_rank', agentInstanceRound: meta?.agentInstanceRound ?? instance.rounds });
		if (lastAssistant) {
			lastAssistant.usages = [...(lastAssistant.usages ?? []), usageEntry];
		}
		this.emitStream({
			type: 'usage',
			agentInstanceId: instance.agentInstanceId,
			logId: result.logId,
			tokens: result.usage,
			seq: result.seq,
			round: instance.rounds,
			purpose: meta?.purpose ?? 'web_rank',
			agentName: instance.agentName,
			depth: instance.depth,
			durationMs: result.durationMs,
			model: result.modelId,
		});
	}

	/**
	 * 工具发起的「内部」LLM 请求（目前只有 web_search 的相关性打分用）。
	 *
	 * 为什么不复用主循环的请求：工具的输入（几十条候选）不属于 agent 的消息历史，
	 * 混进去会污染上下文、也让账本里「谁在花钱」变得看不清。
	 * 这里独立成一次 purpose=web_rank 的请求，账本里一眼可见。
	 */
	private async toolSubLlm(instance: AgentInstance, req: ToolLlmRequest): Promise<ToolLlmResult> {
		const meta = {
			conversationId: this.conversationId,
			purpose: 'web_rank' as const,
			agentInstanceId: instance.agentInstanceId,
			agentId: instance.agentId,
			agentName: instance.agentName,
			depth: instance.depth,
			modeId: this.mode.id,
			trigger: 'tool_results' as const,
			agentInstanceRound: instance.rounds,
		};
		const messages: LlmMessage[] = [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.user },
		];
		const signal = req.signal ?? this.abortController.signal;

		// 优先给「动态 schema」；没有 schema 时退到 json_object。
		// 二者都只是「约束模型输出形状」的请求，不支持它们的 provider 会 400，走下面的重试。
		const responseFormat = req.jsonSchema
			? { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } }
			: req.json
				? { type: 'json_object' }
				: undefined;

		if (!responseFormat) {
			try {
				const result = await callLlm({ config: this.model, messages, tools: [], signal }, meta);
				this.chargeSubLlm(instance, result);
				return { ok: true, text: result.text };
			} catch (err) {
				return { ok: false, text: '', error: (err as Error)?.message ?? String(err) };
			}
		}

		try {
			const result = await callLlm({ config: this.model, messages, tools: [], signal, responseFormat }, meta);
			this.chargeSubLlm(instance, result);
			return { ok: true, text: result.text };
		} catch (err) {
			const first = (err as Error)?.message ?? String(err);
			// 有些 OpenAI 兼容端点不认 response_format（json_schema 尤其），会被 400 顶回来。
			// 这类失败不该让「相关性打分」整条路作废：去掉约束字段再试一次，
			// 形状由提示词兜住（提示词里已经写死了键名规则）。
			if (!/response_format|json_schema|json_object|400|invalid[_ ]request/i.test(first)) {
				return { ok: false, text: '', error: first };
			}
			try {
				const retry = await callLlm({ config: this.model, messages, tools: [], signal }, meta);
				this.chargeSubLlm(instance, retry);
				return { ok: true, text: retry.text };
			} catch (err2) {
				return { ok: false, text: '', error: (err2 as Error)?.message ?? String(err2) };
			}
		}
	}

	private primitiveDelegate(
		parent: AgentInstance,
		callId: string,
		agentId: string,
		task: string,
		toolName: string,
	): ToolResult {
		const def = this.mode.agents[agentId];
		if (!def) return { success: false, content: `不存在的 agentId: ${agentId}` };

		const childId = uid();
		this.createInstance({
			agentInstanceId: childId,
			agentId,
			def,
			depth: parent.depth + 1,
			task,
			parentAgentInstanceId: parent.agentInstanceId,
		});
		this.childLink.set(childId, { parentAgentInstanceId: parent.agentInstanceId, callId, toolName });

		parent.pendingCallIds = Array.from(new Set([...(parent.pendingCallIds ?? []), callId]));
		parent.status = 'pending';
		parent.lastUpdatedAt = now();
		this.persist();

		this.enterLoop(childId, 'initial');

		return {
			success: true,
			content: `已委托子 Agent [${agentId}] agentInstanceId=${childId}（**未完成**，完成后会把总结回填到这里）`,
			structured: { childAgentInstanceIds: [childId], status: 'pending' },
			control: { kind: 'await_child' } satisfies ToolControl,
		};
	}

	private findInstance(instanceId: string): AgentInstance | undefined {
		return this.ctx.agentInstances[instanceId];
	}

	/** 从某实例出发，向下找最深的未完成（pending / interrupted）实例 */
	private deepestUnfinished(rootId: string): AgentInstance | undefined {
		let best: AgentInstance | undefined;
		const visit = (id: string, depth: number) => {
			const instance = this.findInstance(id);
			if (!instance) return;
			if (instance.status === 'pending' || instance.status === 'interrupted') {
				if (!best || instance.depth > best.depth || (instance.depth === best.depth && depth > 0)) best = instance;
			}
			for (const childId of instance.childAgentInstanceIds) visit(childId, depth + 1);
		};
		for (const childId of this.findInstance(rootId)?.childAgentInstanceIds ?? []) visit(childId, 0);
		return best;
	}

	private primitiveResumePending(parent: AgentInstance, callId: string, requestedId: string, toolName: string): ToolResult {
		const requested = this.findInstance(requestedId);
		const target = requested && (requested.status === 'pending' || requested.status === 'interrupted')
			? requested
			: this.deepestUnfinished(parent.agentInstanceId);

		if (!target) {
			return { success: false, content: '没有找到可恢复的子 Agent（没有 pending / interrupted 的子实例）' };
		}
		if (this.busy.has(target.agentInstanceId)) {
			return { success: false, content: `子 Agent ${target.agentInstanceId} 正在运行中，无需恢复` };
		}

		this.childLink.set(target.agentInstanceId, { parentAgentInstanceId: parent.agentInstanceId, callId, toolName });
		parent.pendingCallIds = Array.from(new Set([...(parent.pendingCallIds ?? []), callId]));
		parent.status = 'pending';

		target.status = 'running';
		target.interruptReason = undefined;
		target.lastUpdatedAt = now();
		this.persist();
		this.enterLoop(target.agentInstanceId, 'resume');

		return {
			success: true,
			content: `已恢复子 Agent [${target.agentId}] agentInstanceId=${target.agentInstanceId}（**未完成**，完成后会把总结回填到这里）`,
			structured: { agentInstanceId: target.agentInstanceId, status: 'pending' },
			control: { kind: 'await_child' } satisfies ToolControl,
		};
	}

	private primitiveResumeCompleted(
		parent: AgentInstance,
		callId: string,
		targetId: string,
		followUp: string,
		toolName: string,
	): ToolResult {
		const target = this.findInstance(targetId);
		if (!target) return { success: false, content: `找不到子实例 ${targetId}` };
		if (!isTerminal(target.status)) return { success: false, content: `子 Agent ${targetId} 还没结束，不能「重新唤醒」` };
		if (this.busy.has(targetId)) return { success: false, content: `子 Agent ${targetId} 正在运行中` };

		target.messages.push(message({
			role: 'system',
			content: `本 Agent 被父 Agent 重新唤醒。此前的工作记录仍然有效，请在此基础上继续。`,
		}));
		target.messages.push(message({ role: 'user', content: `[来自父 Agent 的任务]\n${followUp}` }));
		target.task = followUp;
		target.status = 'running';
		target.interruptReason = undefined;
		target.lastUpdatedAt = now();

		this.childLink.set(targetId, { parentAgentInstanceId: parent.agentInstanceId, callId, toolName });
		parent.pendingCallIds = Array.from(new Set([...(parent.pendingCallIds ?? []), callId]));
		parent.status = 'pending';
		this.persist();
		this.enterLoop(targetId, 'resume');

		return {
			success: true,
			content: `已重新唤醒子 Agent [${target.agentId}] agentInstanceId=${targetId}（**未完成**，完成后会把总结回填到这里）`,
			structured: { agentInstanceId: targetId, status: 'pending' },
			control: { kind: 'await_child' } satisfies ToolControl,
		};
	}

	/**
	 * ask_child：单向一次性 LLM 请求。
	 * 不写目标实例的 messages / status / ctx。
	 */
	private async primitiveAskChild(asker: AgentInstance, targetId: string, question: string): Promise<ToolResult> {
		const target = this.findInstance(targetId);
		if (!target) return { success: false, content: `找不到子实例 ${targetId}` };

		// 去掉首条 system，其余全带上（uiOnly 条目由 toLlmMessages 滤掉）
		const history = toLlmMessages(target.messages.filter((_, index) => index !== 0));

		const prompt = `${ASK_CHILD_FIXED_PROMPT}\n\n# 提问\n${question}`;
		try {
			const result = await callLlm(
				{
					config: this.model,
					messages: [{ role: 'system', content: prompt }, ...history],
					tools: [],
					signal: this.abortController.signal,
				},
				{
					conversationId: this.conversationId,
					purpose: 'ask_child',
					agentInstanceId: asker.agentInstanceId,
					agentId: asker.agentId,
					agentName: asker.agentName,
					depth: asker.depth,
					modeId: this.mode.id,
					trigger: 'tool_results',
					agentInstanceRound: asker.rounds,
				},
			);
			this.chargeSubLlm(asker, result, { purpose: 'ask_child', agentInstanceRound: asker.rounds });
			this.emitEvent(asker, 'system', { kind: 'ask_child', targetAgentInstanceId: targetId, question, answer: result.text });
			return {
				success: true,
				content: result.text || '(没有回答)',
				structured: { agentInstanceId: targetId, agentName: target.agentName },
			};
		} catch (e) {
			return { success: false, content: `ask_child 失败: ${(e as Error).message}` };
		}
	}

	// #endregion

	// #region 任务清单

	private applyTaskListOp(op: TaskListWriteArgs): string {
		const items = parseTaskList(this.ctx.taskList);
		switch (op.op) {
			case 'add':
				if (op.item?.trim()) items.push({ done: false, item: op.item.trim() });
				break;
			case 'update':
				if (op.index !== undefined && items[op.index]) {
					if (op.item !== undefined) items[op.index].item = op.item;
					if (op.done !== undefined) items[op.index].done = op.done;
				}
				break;
			case 'remove':
				if (op.index !== undefined) items.splice(op.index, 1);
				break;
			case 'replace':
				this.ctx.taskList = op.list ?? '';
				this.ctx.updatedAt = now();
				return this.ctx.taskList;
		}
		this.ctx.taskList = renderTaskList(items);
		this.ctx.updatedAt = now();
		return this.ctx.taskList;
	}

	// #endregion

	// #region 结束路径（含反思）

	/** 结束路径。如果需要反思，将往 ctx 中写入反思条目并返回 'reflection'，否则触发 agent_end 事件，并返回 null。forced 代表强制结束不反思 */
	private async endPath(instance: AgentInstance, summary: string, opts: { forced?: boolean } = {}): Promise<'reflection' | null> {
		const hadSummary = !!summary.trim();
		const hasReflectPrompt = resolveReflectionPrompt(this.mode, this.getAgentDefinitionByInstance(instance));
		const canReflect = hadSummary && hasReflectPrompt && !opts.forced && instance.reflectionsRemaining > 0 && !this.aborted;

		if (canReflect) {
			instance.reflectionsRemaining -= 1;
			instance.pendingCallIds = [];
			instance.status = 'running';
			instance.lastUpdatedAt = now();

			this.emitStream({
				type: 'reflection_start',
				agentInstanceId: instance.agentInstanceId,
				remaining: instance.reflectionsRemaining,
			});

			let reflection = '';
			let reflectionUsage: UsageEntry | undefined;
			try {
				const r = await this.reflect(instance, summary);
				reflection = r.text;
				reflectionUsage = r.usageEntry;
			} catch (e) {
				this.emitStream({
					type: 'reflection_chunk',
					agentInstanceId: instance.agentInstanceId,
					chunk: `（反思请求失败：${(e as Error).message}）`,
				});
				instance.messages.push(message({
					role: 'system',
					content: `（反思请求失败：${(e as Error).message}）`,
				}));
			}

			this.emitEvent(instance, 'reflection', { remaining: instance.reflectionsRemaining, prompt: reflection });

			if (reflectionActionable(reflection)) {
				instance.messages.push({
					...message({ role: 'system', content: reflection }),
					kind: 'reflection',
					data: { remaining: instance.reflectionsRemaining },
					...(reflectionUsage ? { usages: [reflectionUsage] } : {}),
				});
				this.persist();
				return 'reflection';
			}
			instance.messages.push({
				...message({ role: 'system', content: reflection }),
				uiOnly: true,
				kind: 'reflection',
				data: { remaining: instance.reflectionsRemaining },
				...(reflectionUsage ? { usages: [reflectionUsage] } : {}),
			});
		}

		// 正式结束
		instance.pendingCallIds = [];
		instance.summaries = [...(instance.summaries ?? []), summary];
		instance.status = opts.forced ? 'failed' : 'succeeded';
		instance.interruptReason = opts.forced ? '循环预算耗尽' : undefined;
		instance.lastUpdatedAt = now();

		const isRoot = instance.agentInstanceId === this.ctx.rootAgentInstanceId;
		this.emitEvent(instance, 'agent_end', { status: instance.status, summary });
		this.emitStream({
			type: 'agent_end',
			agentInstanceId: instance.agentInstanceId,
			status: instance.status === 'failed' ? 'failed' : 'succeeded',
			summary,
		});

		if (isRoot) {
			this.emitStream({ type: 'done', summary });
			this.persist();
			this.finishDone();
			return null;
		}

		this.handleChildTerminal(instance);
		this.persist();
		return null;
	}

	/** 反思轮：根据该实例的初始 system 提示词 + 本次总结，生成反思提示词，返回文本与用量 */
	private async reflect(instance: AgentInstance, summary: string): Promise<{ text: string; usageEntry?: UsageEntry }> {
		const def = this.getAgentDefinitionByInstance(instance);
		const prompt = resolveReflectionPrompt(this.mode, def)?.text;
		if (!prompt) return { text: '' };

		const initialSystem = instance.messages.find((m) => m.role === 'system' && !m.uiOnly)?.content ?? '';
		const result = await callLlm(
			{
				config: this.model,
				messages: [
					{ role: 'system', content: prompt },
					{
						role: 'user',
						content: `# 初始提示词\n${initialSystem}\n\n# 本次总结\n${summary}`,
					},
				],
				tools: [],
				onChunk: (chunk) => {
					if (chunk.textDelta) {
						this.emitStream({ type: 'reflection_chunk', agentInstanceId: instance.agentInstanceId, chunk: chunk.textDelta });
					}
				},
				signal: this.abortController.signal,
			},
			{
				conversationId: this.conversationId,
				purpose: 'reflection',
				agentInstanceId: instance.agentInstanceId,
				agentId: instance.agentId,
				agentName: instance.agentName,
				depth: instance.depth,
				modeId: this.mode.id,
				trigger: 'reflection',
				agentInstanceRound: instance.rounds,
			},
		);
		instance.llmCalls += 1;
		instance.tokens = mergeTokens(instance.tokens, result.usage);
		const usageEntry = buildUsageEntry(result, { purpose: 'reflection', agentInstanceRound: instance.rounds });
		this.emitStream({
			type: 'usage',
			agentInstanceId: instance.agentInstanceId,
			logId: result.logId,
			tokens: result.usage,
			seq: result.seq,
			round: instance.rounds,
			purpose: 'reflection',
			agentName: instance.agentName,
			depth: instance.depth,
			durationMs: result.durationMs,
			model: result.modelId,
		});
		return { text: result.text, usageEntry };
	}

	/**
	 * 回填一个挂起中的 tool call：写终态结果 → 从 pending 摘掉 → 清掉挂起原因。
	 *
	 * 等用户（answerToolCall）与等子 Agent（handleChildTerminal）走的是同一条路，
	 * 只有「回填完之后要不要重入」不一样，由 `nextTrigger` 决定（传 null = 不在这里重入）。
	 */
	private resolvePendingCall(instance: AgentInstance, callId: string, result: ToolResult, nextTrigger: LlmTriggerReason | null): void {
		instance.pendingCallIds = (instance.pendingCallIds ?? []).filter((id) => id !== callId);
		this.pendingWait.delete(callId);
		this.writeToolResult(instance, callId, result);
		if (nextTrigger) this.maybeReenter(instance.agentInstanceId, nextTrigger);
	}

	/** 子实例进入终态：把总结直接回填给父实例的 delegate / resume 工具调用，并唤醒父实例 */
	private handleChildTerminal(child: AgentInstance): void {
		const link = this.childLink.get(child.agentInstanceId);
		if (!link) return;

		const parent = this.findInstance(link.parentAgentInstanceId);
		if (!parent) return;

		const summary = child.summaries?.[child.summaries.length - 1] ?? child.interruptReason ?? '(无总结)';
		const finalResult: ToolResult = {
			success: true,
			content: `## [${child.agentId}] ${child.agentName}（${child.status}）\n${summary}`,
			structured: { childAgentInstanceIds: [child.agentInstanceId], status: 'done' },
		};
		this.emitStream({
			type: 'tool_end',
			agentInstanceId: parent.agentInstanceId,
			callId: link.callId,
			toolName: link.toolName,
			result: finalResult,
		});
		this.resolvePendingCall(parent, link.callId, finalResult, null);

		if (parent.status === 'pending') {
			parent.status = 'running';
			parent.lastUpdatedAt = now();
		}
		this.maybeReenter(parent.agentInstanceId, 'delegate_return');
		this.persist();
	}

	/** 标记实例为已中断，更新状态、触发事件、（如果自己是子实例）处理结束事件 */
	private markInterrupted(instance: AgentInstance, reason: string): void {
		instance.status = 'interrupted';
		instance.interruptReason = reason;
		instance.lastUpdatedAt = now();
		this.emitStream({ type: 'agent_end', agentInstanceId: instance.agentInstanceId, status: 'interrupted' });
		this.handleChildTerminal(instance);
		this.persist();
	}

	/** 触发 donePromise 的 resolve */
	private finishDone(): void {
		if (this.doneResolve) {
			this.doneResolve();
			this.doneResolve = null;
		}
	}

	// #endregion

	// #region 消息 / 事件 / 落盘

	/**
	 * 写回（或追加）某次工具调用的结果。
	 * 结果的终态信息（成功/失败 + 结构化字段）随条目一起落 ctx（`kind: 'tool_result'`）——
	 * 前端不必再对 `[失败] ` 前缀做字符串嗅探；delegate 的子实例 ID 也从这里取。
	 */
	private writeToolResult(instance: AgentInstance, callId: string, result: ToolResult): void {
		const content = result.success ? result.content : `[失败] ${result.content}`;
		const data: ToolResultInfo = { success: result.success, structured: result.structured, error: result.error };
		const existing = instance.messages.find((m) => m.role === 'tool' && m.toolCallId === callId);
		if (existing) {
			existing.content = content;
			existing.kind = 'tool_result';
			existing.data = data;
			existing.updatedAt = now();
		} else {
			instance.messages.push({ ...message({ role: 'tool', content, toolCallId: callId }), kind: 'tool_result', data });
		}
		instance.lastUpdatedAt = now();
		this.emitEvent(instance, 'tool_result', { callId, success: result.success, content: content.slice(0, 2000) });
	}

	private buildSystemPrompt(instance: AgentInstance, tools: AgentTool[]): string {
		const def = this.getAgentDefinitionByInstance(instance);
		const children = instance.childAgentInstanceIds
			.map((id) => this.findInstance(id))
			.filter((c): c is AgentInstance => !!c);
		const unfinished = children.filter((c) => c.status === 'pending' || c.status === 'interrupted' || c.status === 'running');

		const limits = this.getModeLimits();
		const totalLeft = limits.totalRounds - this.ctx.budget.spent;
		const agentInstanceLeft = limits.agentInstanceRounds - instance.rounds;
		const warn = totalLeft <= limits.warnAtRemaining || agentInstanceLeft <= limits.warnAtRemaining;
		const exhausted = totalLeft <= 0 || agentInstanceLeft <= 0;

		return renderSystemPrompt({
			agentInstance: instance,
			def,
			mode: this.mode,
			basePrompt: settings.basePrompt ?? '',
			runningDir: this.runningDir,
			conversationDir: ensureConversationDir(this.conversationId),
			tools: tools.map((t) => ({ name: t.name, description: t.description })),
			parentPrompt: instance.task,
			childAgentInstances: children,
			unfinishedAgentInstances: unfinished,
			budget: { totalLeft, agentInstanceLeft, warn, exhausted },
			depthExhausted: instance.depth >= this.mode.maxDepth,
			taskList: this.ctx.taskList,
			mcpSection: this.mcpSectionFor(tools),
		});
	}

	private mcpSectionFor(tools: AgentTool[]): string {
		const names = tools.filter((t) => t.name.startsWith('mcp__')).map((t) => t.name);
		if (names.length === 0) return '';
		// 只列本实例实际可见的那些 MCP 工具
		return mcpManager.getPromptSection(names);
	}

	private emitEvent(instance: AgentInstance, type: AgentCtx['events'][number]['type'], payload: unknown): void {
		this.ctx.events.push({
			id: uid(),
			agentInstanceId: instance.agentInstanceId,
			parentAgentInstanceId: instance.parentAgentInstanceId,
			type,
			timestamp: now(),
			payload,
		});
		// 事件流是审计用的，别让它无限膨胀
		if (this.ctx.events.length > 2000) {
			this.ctx.events.splice(0, this.ctx.events.length - 2000);
		}
		this.ctx.updatedAt = now();
	}

	/**
	 * 发一条流式事件。
	 *
	 * ⚠️ `timestamp` 在这里统一盖上，调用点一个都不许自己写 ——
	 *    前端拿它当作条目的 `updatedAt`（见 `shared/agent.ts` 的 `StreamEventBase`），
	 *    必须是从同一口钟出来的后端时间。
	 */
	private emitStream(event: StreamEventDraft): void {
		this.options.onStream?.({ ...event, timestamp: now() });
	}

	/** 更新最近更新时间，然后向 conversations Proxy 写一下，触发自动存盘 */
	private persist(): void {
		this.ctx.updatedAt = now();
		const conversation = conversations[this.conversationId];
		if (conversation) conversation.agentCtx = this.ctx;
	}
}

// #endregion

// #region 工厂

/** 会话上下文不存在时创建一个空的（第一次跑） */
function emptyCtx(conversationId: string, modeId: string): AgentCtx {
	const timestamp = now();
	return {
		conversationId,
		modeId,
		rootAgentInstanceId: '',
		agentInstances: {},
		events: [],
		taskList: '',
		budget: { total: 200, spent: 0 },
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

/** 确保插件已加载（首次调用时做一次） */
export function ensurePluginsLoaded(): void {
	if (isLoaded()) return;
	const result = loadAllPlugins({ knownToolNames: getBuiltinToolNames });
	for (const err of result.errors) {
		const where = [err.pluginId, err.modeId, err.agentId].filter(Boolean).join('/');
		if (err.level === 'error') logMsg.error(`[Plugins] ${where ? `${where}: ` : ''}${err.message}`);
		else logMsg(`[Plugins][warn] ${where ? `${where}: ` : ''}${err.message}`);
	}
	logMsg(`[Plugins] 已加载 ${result.modes.length} 个模式：${result.modes.map((m) => m.id).join(', ')}`);
}

/** 根据请求装配一个 Runner（加载插件 → 解析模式 → 取/建 ctx） */
export function createRunner(request: AgentRunRequest, options: RunnerOptions = {}): { runner?: AgentRunner; error?: string } {
	ensurePluginsLoaded();

	const mode = getMode(request.modeId);
	if (!mode) {
		const available = listModes().map((m) => m.id).join(', ') || '(无)';
		return { error: `模式不存在: ${request.modeId}。目前已加载的所有模式：${available}` };
	}

	const conversation = conversations[request.conversationId];
	if (!conversation) return { error: `会话不存在: ${request.conversationId}` };
	conversation.modeId = mode.id;

	// 先把 ctx 挂到会话上（写裸对象），再读回来 —— 读回来的一定是深层代理，
	// 这样 Runner 里的每一次改动都会自动刷新会话 updatedAt 并防抖落盘。
	if (!conversation.agentCtx) {
		conversation.agentCtx = emptyCtx(request.conversationId, mode.id);
	}
	const ctx = conversation.agentCtx as AgentCtx;
	ctx.conversationId = request.conversationId;
	ctx.modeId = mode.id;

	return {
		runner: new AgentRunner({ request, mode, ctx, options }),
	};
}

// #endregion
