/* ==========================================================================
   Agent Runner — MindTheGap-Harness（替代 v1 的 engine.ts）

   核心不变式：**执行工具即退出 agentLoop**，由调度器按状态重入。
   全篇没有 Promise 等待链：一个实例在等谁，只由「status + pendingCallIds」表达，
   写进 ctx.json，所以「用户中途打断 → 稍后继续」和「进程重启」都能成立。

   agentLoop(agentInstanceId) 的一轮：
     1. 重建 system prompt、取该实例可见工具
     2. 调 LLM（流式）
     3. 把 assistant 消息（含 tool_calls）写入实例消息
     4. 没有 tool_call → 走结束路径（可能先反思）
     5. 有 tool_call → 全部落 pending → 交给调度器 → **立刻 return**
   调度器执行完一批工具后判断是否满足重入条件，满足则再次 agentLoop。

   状态全部在 ctx 里；本类只在一次 run 期间做「内存中的调度缓存」
   （busy 集合、delegate 分组），进程重启后这些缓存可以安全地重新推导。
   ========================================================================== */

import type {
	AgentCtx,
	AgentDefinition,
	AgentInstance,
	AgentInstanceMessage,
	AgentInstanceStatus,
	AgentRunRequest,
	AgentStreamEvent,
	LlmMessage,
	LlmTrigger,
	ModeConfigDefaults,
	ModeDefinition,
	ModelConfig,
	TokenUsage,
	ToolResult,
} from '../../shared/agent';
import { callLlm } from '../llm/model';
import { mcpManager } from '../mcp/manager';
import { getMode, isLoaded, listModes, loadAllPlugins, resolveModeConfig } from '../plugins/loader';
import { conversations, ensureConversationDir, settings, snapshot } from '../storage';
import { logMsg } from '../utils';
import { assembleSystemPrompt, loadReflectionPrompt } from './prompt';
import {
	executeTool, getBuiltinToolNames, getToolsForAgentInstance, toLlmTools,
	type AgentTool, type TaskListOp, type ToolContext,
} from './tools';

const uid = () => Math.random().toString(36).slice(2, 12);
const now = () => Date.now();

/** 工具结果里用来标记「这是编排类工具」的键 */
const ORCH = '__orchestrator';

interface OrchestratorMarker {
	kind: 'finish' | 'ask_user';
	summary?: string;
	args?: unknown;
}

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

// #endregion

// #region Runner

export interface RunnerOptions {
	onStream?: (event: AgentStreamEvent) => void;
}

export class AgentRunner {
	readonly conversationId: string;
	private mode: ModeDefinition;
	private modeConfig: ModeConfigDefaults;
	private model: ModelConfig;
	private runningDir: string;
	private ctx: AgentCtx;
	private options: RunnerOptions;

	private abortController = new AbortController();
	private aborted = false;

	/** 正在跑 agentLoop 的实例（防止同一实例被并发重入） */
	private busy = new Set<string>();
	/** delegate / resume 的分组：callId → 组 */
	private groups = new Map<string, { parentAgentInstanceId: string; childAgentInstanceIds: string[]; results: Map<string, string> }>();
	/** 子实例 → 它属于哪次委托 */
	private childLink = new Map<string, { parentAgentInstanceId: string; callId: string }>();

	private doneResolve: (() => void) | null = null;
	private donePromise: Promise<void>;

	constructor(params: {
		request: AgentRunRequest;
		mode: ModeDefinition;
		modeConfig: ModeConfigDefaults;
		ctx: AgentCtx;
		options?: RunnerOptions;
	}) {
		this.conversationId = params.request.conversationId;
		this.mode = params.mode;
		this.modeConfig = params.modeConfig;
		this.model = params.request.model;
		this.runningDir = params.request.runningDir || process.cwd();
		this.ctx = params.ctx;
		this.options = params.options ?? {};
		this.donePromise = new Promise((resolve) => {
			this.doneResolve = resolve;
		});
	}

	// ---------- 对外接口 ----------

	getCtx(): AgentCtx {
		return this.ctx;
	}

	waitDone(): Promise<void> {
		return this.donePromise;
	}

	isRunning(): boolean {
		const root = this.ctx.agentInstances[this.ctx.rootAgentInstanceId];
		return !!root && !isTerminal(root.status);
	}

	cancel(): void {
		this.aborted = true;
		try {
			this.abortController.abort();
		} catch {
			// 忽略
		}
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
		let target: AgentInstance | undefined;
		for (const instance of Object.values(this.ctx.agentInstances)) {
			if ((instance.pendingCallIds ?? []).includes(toolCallId)) {
				target = instance;
				break;
			}
		}
		if (!target) return { ok: false, error: `未找到等待中的工具调用 ${toolCallId}` };

		this.writeToolResult(target, toolCallId, { success: true, content: result, structured: { answer: result } });
		target.pendingCallIds = (target.pendingCallIds ?? []).filter((id) => id !== toolCallId);
		this.persist();
		this.maybeReenter(target.agentInstanceId, 'answer');
		return { ok: true };
	}

	/** 用户直接发新消息（不是回答问题）→ 把所有仍 pending 的 client 工具标记为已跳过 */
	skipPendingClientTools(): void {
		for (const instance of Object.values(this.ctx.agentInstances)) {
			for (const callId of instance.pendingCallIds ?? []) {
				if (this.isClientToolResult(instance, callId)) {
					this.writeToolResult(instance, callId, { success: true, content: '用户已跳过此提问' });
					this.emitStream({ type: 'tool_end', agentInstanceId: instance.agentInstanceId, callId, toolName: 'ask_user', result: { success: true, content: '用户已跳过此提问' } });
				}
			}
			instance.pendingCallIds = [];
			if (instance.status === 'pending') instance.status = 'running';
		}
	}

	// ---------- 启动 ----------

	/**
	 * 发起一轮 run。
	 * - 已有一个「未结束」的根实例（用户打断后又被唤醒）→ 沿用，不新建
	 * - 否则新建根实例，并把上一轮 run 的实例树 / 事件流清空（每轮 run 一棵新树，避免 ctx.json 无限增长）
	 */
	async run(userMessage: string): Promise<void> {
		const limits = this.limits();
		this.ctx.budget = { total: limits.totalRounds, spent: 0 };
		this.ctx.modeId = this.mode.id;

		let root = this.ctx.agentInstances[this.ctx.rootAgentInstanceId];
		// 新建根实例时由 createInstance 负责发 agent_start；只有「唤醒已有实例」才在这里补发
		const isNewRoot = !root || isTerminal(root.status);
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
			this.ctx.agentInstances = { [instanceId]: root };
			this.ctx.events = [];
			this.ctx.rootAgentInstanceId = instanceId;
		}

		// 上一轮挂起的 client 工具（ask_user）在用户发新消息时算作「已跳过」
		this.skipPendingClientTools();

		// 被中断的根实例：本次发言就是「唤醒它」，回到 running
		root.status = 'running';
		root.interruptReason = undefined;
		root.task = userMessage;
		// 新建实例时 createInstance 已经把这条用户消息作为首条 message 放进去了，
		// 这里只补「唤醒已有实例」的情况，否则会出现两条一模一样的 user 消息。
		if (!isNewRoot) root.messages.push(message({ role: 'user', content: userMessage }));
		root.lastUpdatedAt = now();
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

	// ---------- 实例管理 ----------

	private limits() {
		const defaults = this.mode.defaultSettings.limits ?? {};
		const overrides = this.modeConfig.limits ?? {};
		return {
			totalRounds: overrides.totalRounds ?? defaults.totalRounds ?? 200,
			agentInstanceRounds: overrides.agentInstanceRounds ?? defaults.agentInstanceRounds ?? 50,
			warnAtRemaining: overrides.warnAtRemaining ?? defaults.warnAtRemaining ?? 3,
		};
	}

	private defOf(agentInstance: AgentInstance): AgentDefinition {
		return this.mode.agents[agentInstance.agentId] ?? Object.values(this.mode.agents)[0];
	}

	private createInstance(params: {
		agentInstanceId: string;
		agentId: string;
		def: AgentDefinition;
		depth: number;
		task: string;
		parentAgentInstanceId?: string;
	}): AgentInstance {
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
						? `[来自父 Agent 的任务]\n${params.task}`
						: params.task,
				}),
			],
			pendingCallIds: [],
			summaries: [],
			reflectionsRemaining: params.def.reflectionCount ?? 0,
			rounds: 0,
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

	// ---------- agentLoop ----------

	private enterLoop(agentInstanceId: string, trigger: LlmTrigger): void {
		void this.agentLoop(agentInstanceId, trigger).catch((e) => {
			logMsg.error(`[Runner] agentLoop 异常: ${(e as Error).message}`);
		});
	}

	private maybeReenter(agentInstanceId: string, trigger: LlmTrigger): void {
		const instance = this.ctx.agentInstances[agentInstanceId];
		if (!instance) return;
		if (isTerminal(instance.status)) return;
		if ((instance.pendingCallIds ?? []).length > 0) return;
		if (this.busy.has(agentInstanceId)) return;
		instance.status = 'running';
		this.enterLoop(agentInstanceId, trigger);
	}

	private async agentLoop(agentInstanceId: string, trigger: LlmTrigger): Promise<void> {
		const instance = this.ctx.agentInstances[agentInstanceId];
		if (!instance || isTerminal(instance.status)) return;
		if (this.busy.has(agentInstanceId)) return;
		this.busy.add(agentInstanceId);

		let nextTrigger: LlmTrigger | null = null;
		try {
			if (this.aborted) {
				this.markInterrupted(instance, '用户取消');
				return;
			}

			const limits = this.limits();
			instance.rounds += 1;
			this.ctx.budget.spent += 1;

			// 预算耗尽 → 强制收尾（把「因预算耗尽中止」交还父实例判断，而不是静默丢弃）
			if (instance.rounds > limits.agentInstanceRounds || this.ctx.budget.spent > limits.totalRounds) {
				const reason = instance.rounds > limits.agentInstanceRounds ? '本实例循环上限' : '总循环预算';
				nextTrigger = await this.endPath(instance, `[预算耗尽] 因${reason}中止。已完成部分见此前消息；未完成项需父 Agent 决定是否继续。`, { forced: true });
				return;
			}

			const def = this.defOf(instance);
			const tools = getToolsForAgentInstance(instance, def, this.mode, this.modeConfig);
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
					messages: instance.messages.map(({ updatedAt: _u, ...rest }) => rest),
					tools: llmTools,
					onChunk: (chunk) => {
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

			// 写入 assistant 消息（含 tool_calls）
			const assistantMessage: LlmMessage = { role: 'assistant', content: result.text };
			if (result.reasoningContent) assistantMessage.reasoningContent = result.reasoningContent;
			if (result.toolCalls.length > 0) {
				assistantMessage.toolCalls = result.toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
				}));
			}
			instance.messages.push(message(assistantMessage));
			instance.tokens = this.mergeTokens(instance.tokens, result.usage);
			instance.lastUpdatedAt = now();
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
			nextTrigger = await this.dispatch(instance, def, result.toolCalls);
			this.persist();
		} catch (e) {
			const err = e as Error;
			if (this.aborted || err?.name === 'AbortError') {
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
			this.busy.delete(agentInstanceId);
			// 重入统一放这里：任何 return 路径（含结束路径的反思轮）都先释放 busy 再重入，
			// 否则 maybeReenter 会被 busy 守卫挡掉。
			if (nextTrigger) this.maybeReenter(agentInstanceId, nextTrigger);
		}
	}

	/** 上一次 LLM 请求是在回填哪些 tool_call 的结果之后发出的（写进 requestLog） */
	private lastResolvedCallIds: string[] | undefined;

	// ---------- 调度器 ----------

	/** 执行一批工具调用；返回「若为 null 表示不需要重入」 */
	private async dispatch(
		instance: AgentInstance,
		def: AgentDefinition,
		toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[],
	): Promise<LlmTrigger | null> {
		const resolved: string[] = [];
		let needReenter: LlmTrigger | null = null;
		let finishSummary: string | null = null;
		let suspended = false;

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

			const toolCtx = this.buildToolContext(instance, def, call.id, reason);
			const result = await executeTool(call.name, call.arguments, toolCtx);
			const marker = result.structured?.[ORCH] as OrchestratorMarker | undefined;

			if (marker?.kind === 'finish') {
				finishSummary = marker.summary ?? result.content;
			}

			if (marker?.kind === 'ask_user') {
				// client 工具：写占位结果 → 出循环 → 前端弹卡片
				const placeholder: ToolResult = { success: true, content: '已向客户端发出提问，等待用户回应' };
				this.writeToolResult(instance, call.id, placeholder);
				instance.status = 'pending';
				suspended = true;
				this.emitStream({
					type: 'client_tool_call',
					agentInstanceId: instance.agentInstanceId,
					callId: call.id,
					toolName: call.name,
					args: marker.args ?? call.arguments,
					needResponse: true,
				});
				this.emitStream({ type: 'tool_end', agentInstanceId: instance.agentInstanceId, callId: call.id, toolName: call.name, result: placeholder });
				continue;	// 保留在 pendingCallIds 里，等用户回答
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
			// （deferred 的调用**故意不**进 resolved，让它留在 pendingCallIds 里等子实例终态）
			if (result.structured?.status !== 'pending') resolved.push(call.id);
			if (!suspended) needReenter = 'tool_results';
		}

		// 已完成的结果从 pending 里摘掉
		instance.pendingCallIds = (instance.pendingCallIds ?? []).filter((id) => !resolved.includes(id));
		if (resolved.length > 0) this.lastResolvedCallIds = resolved;

		// finish 是「提交总结」这个动作本身，放在所有工具结果写完之后处理。
		// 它不重入本实例（finish 即退出），但可能返回反思轮触发类型交给 agentLoop 重入。
		if (finishSummary !== null) {
			return await this.endPath(instance, finishSummary);
		}

		if (suspended) return null;			// 等用户，不重入
		if ((instance.pendingCallIds ?? []).length > 0) return null;	// 等子 Agent，不重入
		return needReenter;
	}

	/** 构造某次工具调用的 ToolContext（编排原语捕获 callId） */
	private buildToolContext(instance: AgentInstance, def: AgentDefinition, callId: string, reason: string): ToolContext {
		return {
			ctx: this.ctx,
			agentInstanceId: instance.agentInstanceId,
			runningDir: this.runningDir,
			conversationDir: ensureConversationDir(this.conversationId),
			reason,
			def,
			mode: this.mode,
			delegate: async (tasks) => this.primitiveDelegate(instance, callId, tasks),
			finish: async (summary) => ({
				success: true,
				content: summary,
				structured: { [ORCH]: { kind: 'finish', summary } satisfies OrchestratorMarker },
			}),
			resumePendingChild: async (targetId) => this.primitiveResumePending(instance, callId, targetId),
			resumeCompletedChild: async (targetId, followUp) => this.primitiveResumeCompleted(instance, callId, targetId, followUp),
			askChild: async (targetId, question) => this.primitiveAskChild(instance, targetId, question),
			askUser: async (args) => ({
				success: true,
				content: '已向客户端发出提问，等待用户回应',
				structured: { [ORCH]: { kind: 'ask_user', args } satisfies OrchestratorMarker },
			}),
			readTaskList: () => this.ctx.taskList || '',
			writeTaskList: (op) => this.applyTaskListOp(op),
		};
	}

	// ---------- 编排原语实现 ----------

	private primitiveDelegate(
		parent: AgentInstance,
		callId: string,
		tasks: { agentId: string; task: string }[],
	): ToolResult {
		const childIds: string[] = [];
		for (const task of tasks) {
			const def = this.mode.agents[task.agentId];
			if (!def) continue;
			const childId = uid();
			const child = this.createInstance({
				agentInstanceId: childId,
				agentId: task.agentId,
				def,
				depth: parent.depth + 1,
				task: task.task,
				parentAgentInstanceId: parent.agentInstanceId,
			});
			childIds.push(childId);
			this.childLink.set(childId, { parentAgentInstanceId: parent.agentInstanceId, callId });
		}

		this.groups.set(callId, {
			parentAgentInstanceId: parent.agentInstanceId,
			childAgentInstanceIds: childIds,
			results: new Map(),
		});
		parent.pendingCallIds = Array.from(new Set([...(parent.pendingCallIds ?? []), callId]));
		parent.status = 'pending';
		parent.lastUpdatedAt = now();
		this.persist();

		// 启动子实例（不 await：等价于「一批普通工具调用并行执行」）
		for (const childId of childIds) this.enterLoop(childId, 'initial');

		const lines = childIds.map((id, i) => `- [${tasks[i].agentId}] agentInstanceId=${id} — ${tasks[i].task.slice(0, 60)}`);
		return {
			success: true,
			content: `已委托 ${childIds.length} 个子 Agent（**未完成**，完成后会把总结回填到这里）：\n${lines.join('\n')}`,
			structured: { childAgentInstanceIds: childIds, status: 'pending' },
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

	private primitiveResumePending(parent: AgentInstance, callId: string, requestedId: string): ToolResult {
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

		this.childLink.set(target.agentInstanceId, { parentAgentInstanceId: parent.agentInstanceId, callId });
		this.groups.set(callId, {
			parentAgentInstanceId: parent.agentInstanceId,
			childAgentInstanceIds: [target.agentInstanceId],
			results: new Map(),
		});
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
		};
	}

	private primitiveResumeCompleted(parent: AgentInstance, callId: string, targetId: string, followUp: string): ToolResult {
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

		this.childLink.set(targetId, { parentAgentInstanceId: parent.agentInstanceId, callId });
		this.groups.set(callId, {
			parentAgentInstanceId: parent.agentInstanceId,
			childAgentInstanceIds: [targetId],
			results: new Map(),
		});
		parent.pendingCallIds = Array.from(new Set([...(parent.pendingCallIds ?? []), callId]));
		parent.status = 'pending';
		this.persist();
		this.enterLoop(targetId, 'resume');

		return {
			success: true,
			content: `已重新唤醒子 Agent [${target.agentId}] agentInstanceId=${targetId}（**未完成**，完成后会把总结回填到这里）`,
			structured: { agentInstanceId: targetId, status: 'pending' },
		};
	}

	/**
	 * ask_child：单向一次性 LLM 请求。
	 * 不写目标实例的 messages / status / ctx。
	 */
	private async primitiveAskChild(asker: AgentInstance, targetId: string, question: string): Promise<ToolResult> {
		const target = this.findInstance(targetId);
		if (!target) return { success: false, content: `找不到子实例 ${targetId}` };

		// 去掉首条 system，其余全带上
		const history = target.messages
			.filter((_, index) => index !== 0)
			.map(({ updatedAt: _u, ...rest }) => rest);

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
				},
			);
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

	// ---------- 任务清单 ----------

	private applyTaskListOp(op: TaskListOp): string {
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

	// ---------- 结束路径（含反思） ----------

	/** 结束路径。返回值 = 结束后要重入的触发类型（反思轮），null = 真结束 */
	private async endPath(instance: AgentInstance, summary: string, opts: { forced?: boolean } = {}): Promise<LlmTrigger | null> {
		const hadSummary = !!summary.trim();
		const canReflect = hadSummary && !opts.forced && instance.reflectionsRemaining > 0 && !this.aborted;

		if (canReflect) {
			instance.reflectionsRemaining -= 1;
			instance.pendingCallIds = [];
			instance.status = 'running';
			instance.lastUpdatedAt = now();
			try {
				const reflection = await this.reflect(instance, summary);
				instance.messages.push(message({
					role: 'system',
					content: reflection || '（反思未产生有效追问，请自行检查是否确实完成）',
				}));
				this.emitEvent(instance, 'reflection', { remaining: instance.reflectionsRemaining, prompt: reflection });
				this.emitStream({
					type: 'reflection',
					agentInstanceId: instance.agentInstanceId,
					remaining: instance.reflectionsRemaining,
					prompt: reflection,
				});
			} catch (e) {
				instance.messages.push(message({
					role: 'system',
					content: `（反思请求失败：${(e as Error).message}）`,
				}));
			}
			this.persist();
			// ⚠️ 不能在这里直接 maybeReenter：本函数是被 agentLoop await 的，此刻 busy 还握着，
			// 重入会被 busy 守卫挡掉（表现为「反思完就没动静了」）。把触发类型交回 agentLoop，
			// 等 finally 释放 busy 后再由调度器重入。
			return 'reflection';
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

	/** 反思轮：额外一次 LLM 请求，输入 = 该实例的初始 system 提示词 + 本次总结 */
	private async reflect(instance: AgentInstance, summary: string): Promise<string> {
		const def = this.defOf(instance);
		const append = this.modeConfig.reflectionPromptAppend || def.reflectionPromptAppend || '';
		const fixed = loadReflectionPrompt();
		const prompt = `${fixed}\n\n${append}`.trim();

		const initialSystem = instance.messages.find((m) => m.role === 'system')?.content ?? '';
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
			},
		);
		return result.text;
	}

	/** 子实例进入终态：把总结汇回父实例的 delegate / resume 工具结果，并在全员结束时唤醒父实例 */
	private handleChildTerminal(child: AgentInstance): void {
		const link = this.childLink.get(child.agentInstanceId);
		if (!link) return;

		const parent = this.findInstance(link.parentAgentInstanceId);
		if (!parent) return;

		const group = this.groups.get(link.callId);
		if (group) {
			group.results.set(child.agentInstanceId, child.summaries?.[child.summaries.length - 1] ?? child.interruptReason ?? '(无总结)');
			const allTerminal = group.childAgentInstanceIds.every((id) => {
				const instance = this.findInstance(id);
				return instance ? isTerminal(instance.status) : true;
			});
			if (allTerminal) {
				const parts = group.childAgentInstanceIds.map((id) => {
					const instance = this.findInstance(id);
					if (!instance) return '';
					const summary = group.results.get(id) ?? '(无总结)';
					return `## [${instance.agentId}] ${instance.agentName}（${instance.status}）\n${summary}`;
				}).filter(Boolean);
				this.writeToolResult(parent, link.callId, {
					success: true,
					content: parts.join('\n\n') || '(子 Agent 无输出)',
					structured: { childAgentInstanceIds: group.childAgentInstanceIds, status: 'done' },
				});
				parent.pendingCallIds = (parent.pendingCallIds ?? []).filter((id) => id !== link.callId);
				this.groups.delete(link.callId);
			}
		}

		if (parent.status === 'pending') {
			parent.status = 'running';
			parent.lastUpdatedAt = now();
		}
		if ((parent.pendingCallIds ?? []).length === 0 && !this.busy.has(parent.agentInstanceId) && !isTerminal(parent.status)) {
			this.maybeReenter(parent.agentInstanceId, 'delegate_return');
		}
		this.persist();
	}

	private markInterrupted(instance: AgentInstance, reason: string): void {
		instance.status = 'interrupted';
		instance.interruptReason = reason;
		instance.lastUpdatedAt = now();
		this.emitStream({ type: 'agent_end', agentInstanceId: instance.agentInstanceId, status: 'interrupted' });
		this.handleChildTerminal(instance);
		this.persist();
	}

	private finishDone(): void {
		if (this.doneResolve) {
			this.doneResolve();
			this.doneResolve = null;
		}
	}

	// ---------- 消息 / 事件 / 落盘 ----------

	/** 写回（或追加）某次工具调用的结果 */
	private writeToolResult(instance: AgentInstance, callId: string, result: ToolResult): void {
		const content = result.success ? result.content : `[失败] ${result.content}`;
		const existing = instance.messages.find((m) => m.role === 'tool' && m.toolCallId === callId);
		if (existing) {
			existing.content = content;
			existing.updatedAt = now();
		} else {
			instance.messages.push(message({ role: 'tool', content, toolCallId: callId }));
		}
		instance.lastUpdatedAt = now();
		this.emitEvent(instance, 'tool_result', { callId, success: result.success, content: content.slice(0, 2000) });
	}

	/** 判断某个 pending 的 callId 是不是 client 工具（ask_user）的 */
	private isClientToolResult(instance: AgentInstance, callId: string): boolean {
		for (const msg of instance.messages) {
			if (msg.role === 'assistant' && msg.toolCalls) {
				for (const tc of msg.toolCalls) {
					if (tc.id !== callId) continue;
					const name = tc.function.name;
					if (name === 'ask_user') return true;
					// 已写入的占位结果也能认出来
				}
			}
		}
		const toolMsg = instance.messages.find((m) => m.role === 'tool' && m.toolCallId === callId);
		return toolMsg?.content === '已向客户端发出提问，等待用户回应';
	}

	private mergeTokens(prev: TokenUsage | undefined, usage: TokenUsage): TokenUsage {
		return {
			input: (prev?.input ?? 0) + (usage?.input ?? 0),
			inputCached: (prev?.inputCached ?? 0) + (usage?.inputCached ?? 0),
			output: (prev?.output ?? 0) + (usage?.output ?? 0),
			total: (prev?.total ?? 0) + (usage?.total ?? 0),
		};
	}

	private buildSystemPrompt(instance: AgentInstance, tools: AgentTool[]): string {
		const def = this.defOf(instance);
		const children = instance.childAgentInstanceIds
			.map((id) => this.findInstance(id))
			.filter((c): c is AgentInstance => !!c);
		const unfinished = children.filter((c) => c.status === 'pending' || c.status === 'interrupted' || c.status === 'running');

		const limits = this.limits();
		const totalLeft = limits.totalRounds - this.ctx.budget.spent;
		const agentInstanceLeft = limits.agentInstanceRounds - instance.rounds;
		const warn = totalLeft <= limits.warnAtRemaining || agentInstanceLeft <= limits.warnAtRemaining;
		const exhausted = totalLeft <= 0 || agentInstanceLeft <= 0;

		return assembleSystemPrompt({
			agentInstance: instance,
			def,
			mode: this.mode,
			modeConfig: this.modeConfig,
			runningDir: this.runningDir,
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

	private emitStream(event: AgentStreamEvent): void {
		this.options.onStream?.(event);
	}

	private persist(): void {
		this.ctx.updatedAt = now();
		const conv = conversations[this.conversationId];
		if (conv) conv.agentCtx = this.ctx;
	}
}

// #endregion

// #region 工厂

/** 会话上下文不存在时创建一个空的（第一次跑） */
function emptyCtx(conversationId: string, modeId: string): AgentCtx {
	const timestamp = now();
	return {
		ctxVersion: 2,
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

export interface CreateRunnerResult {
	runner?: AgentRunner;
	error?: string;
}

/** 根据请求装配一个 Runner（加载插件 → 解析模式 → 取/建 ctx） */
export function createRunner(request: AgentRunRequest, options: RunnerOptions = {}): CreateRunnerResult {
	ensurePluginsLoaded();

	const mode = getMode(request.modeId);
	if (!mode) {
		const available = listModes().map((m) => m.id).join(', ') || '(无)';
		return { error: `模式不存在: ${request.modeId}。可用模式：${available}` };
	}

	const overrides = (settings.modeConfigs ?? {})[request.modeId] as Partial<ModeConfigDefaults> | undefined;
	const modeConfig = resolveModeConfig(mode, snapshot(overrides));

	const conv = conversations[request.conversationId];
	if (!conv) return { error: `会话不存在: ${request.conversationId}` };
	conv.modeId = mode.id;

	// 先把 ctx 挂到会话上（写裸对象），再读回来 —— 读回来的一定是深层代理，
	// 这样 Runner 里的每一次改动都会自动刷新会话 updatedAt 并防抖落盘。
	const existing = conv.agentCtx as AgentCtx | undefined;
	if (!existing || existing.ctxVersion !== 2) {
		conv.agentCtx = emptyCtx(request.conversationId, mode.id);
	}
	const ctx = conv.agentCtx as AgentCtx;
	ctx.conversationId = request.conversationId;
	ctx.modeId = mode.id;

	return {
		runner: new AgentRunner({ request, mode, modeConfig, ctx, options }),
	};
}

// #endregion
