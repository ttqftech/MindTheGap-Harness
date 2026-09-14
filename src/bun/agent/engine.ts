/* ==========================================================================
   Agent 核心引擎 — MindTheGap-Harness
   
   核心工作流:
   
   用户消息
     ↓
   Orchestrator.run()
     ↓
   创建 root AgentWork
     ↓
   [循环] Agent 执行:
     ├── 构建 system prompt + 历史消息
     ├── 调用 LLM（带工具列表）
     ├── 流式输出 text → onStream
     ├── 有 tool_calls? → executeTool → 结果回填 messages → 继续循环
     ├── 有 transfer tool? → spawnAgent（子 Agent 并行跑）
     └── 没有 tool_calls → Agent 结束
     ↓
   所有 Agent 完成 → 返回最终结果
   
   转接机制:
   - transfer 工具被调用时，engine.spawnAgent() 创建子 AgentWork
   - 子 Agent 独立执行自己的循环
   - 父 Agent 在当前 loop 中会收到子 Agent 完成后的系统消息
   - 子 Agent 的详细 ctx.events 通过 parentId 关联到父事件
   
   流式输出:
   - 通过 onStream 回调实时推送 AgentStreamEvent
   - 渲染进程边收边渲染
   ========================================================================== */

import type { AgentCtx, AgentEvent, AgentName, AgentRunRequest, AgentStreamEvent, AgentWorkInfo, TokenUsage, ToolResult } from '../../shared/agent';
import { logMsg } from '../utils';
import { callLlm, type LlmMessage, type LlmTool } from './model';
import { executeTool, getLlmTools, type ToolContext, type AgentTool } from './tools';
import { mcpManager } from '../mcp/manager';

const uid = () => Math.random().toString(36).slice(2, 10);

// #region System Prompt 模板

function buildSystemPrompt(agentName: AgentName, transferableAgents: AgentName[], runningDir?: string): string {
	const baseInstructions = `你是 MindTheGap-Harness，一个 AI 编程助手。

# 运行环境
- 操作系统: Windows（shell 为 cmd.exe）。bash 工具里只能用 Windows 兼容命令（dir/type/echo...），不要用 Unix 命令（ls/date +%Y/grep -r）
- 当前时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
- 运行目录: ${runningDir ?? '(未指定)'}

# 工作原则
1. 先用 think 工具分析问题，然后再行动
2. 文件操作前先看目录结构（file_list）和现有文件内容（file_read）
3. 修改代码前先理解项目结构（read AGENTS.md / README.md / package.json 等）
4. 每一步操作后总结做了什么、效果如何
5. 如果遇到无法解决的问题，诚实告知用户

# 可用能力
- 文件操作: 读写编辑文件、创建/删除/重命名/列出
- Bash 命令: 在运行目录中执行 shell 命令
- think: 内部推理
- transfer: 转接任务给其他 Agent 模式
- MCP 工具: 用户接入的外部能力，名称以 mcp__ 开头（见下方「MCP 外部工具」）`;

	const transferSection = transferableAgents.length > 0
		? `
# 可转接的 Agent 模式
你可以用 transfer 工具把任务分给其他专业 Agent:
${transferableAgents.map((m) => `- ${m}`).join('\n')}

转接建议:
- 当任务涉及写代码改代码时 → 转接给 "编码"
- 当任务涉及浏览/分析文件夹结构时 → 转接给 "文件夹浏览总结"
- 可同时发起多个 transfer 并行执行
- 子 Agent 完成后会自动把详细结果返回到当前对话`
		: `
# 当前模式不可转接其他 Agent`;

	return `${baseInstructions}

# 当前 Agent 模式: ${agentName}
${transferSection}

请用中文回复（代码和技术术语除外）。`;
}

// #endregion

// #region Agent 引擎

export interface EngineOptions {
	onStream?: (event: AgentStreamEvent) => void;
	/** 最大工具调用轮次（防止死循环） */
	maxToolRounds?: number;
}

export class AgentEngine {
	private ctx: AgentCtx;
	private request: AgentRunRequest;
	private options: EngineOptions;
	/** 每个 workId 的消息历史（用于 LLM 调用） */
	private workMessages = new Map<string, LlmMessage[]>();
	/** 等待子 Agent 完成的父 workId → pending 信息 */
	private pendingChildren = new Map<string, Array<{
		childWorkId: string;
		resolve: (summary: string) => void;
	}>>();
	/** 运行中的 workId 集合 */
	private runningWorks = new Set<string>();
	/** 取消控制 */
	private abortController = new AbortController();
	private aborted = false;

	constructor(request: AgentRunRequest, options: EngineOptions = {}) {
		this.request = request;
		this.options = options;
		this.ctx = this.createInitialCtx();
	}

	private createInitialCtx(): AgentCtx {
		const rootWorkId = uid();
		const now = Date.now();

		const rootWork: AgentWorkInfo = {
			workId: rootWorkId,
			agentName: this.request.agentName,
			runningDir: this.request.runningDir,
			transferableAgents: [], // 运行时从 agentConfigs 注入
			status: 'running',
			startedAt: now,
		};

		return {
			conversationId: this.request.conversationId,
			rootWorkId,
			events: [],
			works: { [rootWorkId]: rootWork },
			createdAt: now,
			updatedAt: now,
		};
	}

	/** 获取当前 ctx（用于持久化） */
	getCtx(): AgentCtx {
		return this.ctx;
	}

	/** 取消整个 Agent 运行 */
	abort(): void {
		this.aborted = true;
		this.abortController.abort();
		this.options.onStream?.({ type: 'error', message: 'Agent 已被用户取消' });
	}

	/** 检查是否已取消（在循环中调用） */
	private checkAborted(): void {
		if (this.aborted) {
			throw new Error('Agent aborted by user');
		}
	}

	/** 设置可转接 Agent 列表（从 store 注入） */
	setTransferableAgents(workId: string, agents: AgentName[]): void {
		const work = this.ctx.works[workId];
		if (work) work.transferableAgents = agents;
	}

	/** 启动整个 Agent 工作流 */
	async run(): Promise<string> {
		const { onStream } = this.options;
		const rootWorkId = this.ctx.rootWorkId;
		console.log(`[Agent] Engine.run() started, conversationId=${this.request.conversationId}, modelId=${this.request.model?.modelId ?? 'MISSING'}`);

		// 初始化根 Agent 的可转接列表
		this.setTransferableAgents(rootWorkId, this.getDefaultTransferable(this.request.agentName));

		// 创建根 Agent start 事件
		this.emitEvent({
			id: uid(),
			workId: rootWorkId,
			type: 'agent_start',
			timestamp: Date.now(),
			payload: { agentName: this.request.agentName },
		});
		onStream?.({ type: 'agent_start', workId: rootWorkId, agentName: this.request.agentName });

		// 添加用户消息到根 Agent
		this.emitEvent({
			id: uid(),
			workId: rootWorkId,
			type: 'user_message',
			timestamp: Date.now(),
			payload: { content: this.request.userMessage },
		});
		this.addWorkMessage(rootWorkId, {
			role: 'user',
			content: this.request.userMessage,
		});

		this.runningWorks.add(rootWorkId);

		// 运行根 Agent（async，会递归运行子 Agent）
		const rootResult = await this.runAgent(rootWorkId);

		// 根 Agent 结束
		this.ctx.works[rootWorkId].status = 'completed';
		this.ctx.works[rootWorkId].endedAt = Date.now();
		this.runningWorks.delete(rootWorkId);

		this.emitEvent({
			id: uid(),
			workId: rootWorkId,
			type: 'agent_end',
			timestamp: Date.now(),
			payload: { summary: rootResult },
		});
		onStream?.({
			type: 'agent_end',
			workId: rootWorkId,
			agentName: this.request.agentName,
			summary: rootResult,
		});

		this.ctx.updatedAt = Date.now();
		onStream?.({ type: 'done', finalSummary: rootResult });

		return rootResult;
	}

	/** 获取默认可转接列表（硬编码 fallback，实际应从 store 注入） */
	private getDefaultTransferable(agentName: AgentName): AgentName[] {
		const map: Record<AgentName, AgentName[]> = {
			'默认': ['编码', '文件夹浏览总结'],
			'编码': ['默认'],
			'文件夹浏览总结': ['默认', '编码'],
		};
		return map[agentName] ?? [];
	}

	/** 运行单个 Agent 的循环 */
	private async runAgent(workId: string): Promise<string> {
		const { onStream, maxToolRounds = 20 } = this.options;
		const work = this.ctx.works[workId];
		if (!work) throw new Error(`Work ${workId} not found`);

		// 构建 system prompt（MCP 工具说明由 mcpManager 动态提供）
		const systemPrompt = buildSystemPrompt(work.agentName, work.transferableAgents, work.runningDir) + mcpManager.getPromptSection();
		this.setSystemMessage(workId, systemPrompt);

		let assistantContent = '';
		let totalTokens: TokenUsage = {};

		for (let round = 0; round < maxToolRounds; round++) {
			// 检查是否已取消
			this.checkAborted();

			// 调用 LLM
			const messages = this.workMessages.get(workId) ?? [];
			const tools = getLlmTools();

			try {
				logMsg(`[Agent] 调用模型。round ${round + 1}, modelId=${this.request.model?.modelId}, messages.length=${messages.length}`);
				const result = await callLlm(
					this.request.model,
					messages,
					tools as LlmTool[],
					(chunk) => {
						if (chunk.textDelta) {
							assistantContent += chunk.textDelta;
							onStream?.({ type: 'text', chunk: chunk.textDelta });
						}
						if (chunk.usage) {
							totalTokens = {
								input: (totalTokens.input ?? 0) + (chunk.usage.input ?? 0),
								inputCached: (totalTokens.inputCached ?? 0) + (chunk.usage.inputCached ?? 0),
								output: (totalTokens.output ?? 0) + (chunk.usage.output ?? 0),
							};
							onStream?.({ type: 'usage', tokens: totalTokens });
						}
					},
					this.abortController.signal,
				);

				// 把 assistant 回复加入消息历史
				const assistantMsg: LlmMessage = {
					role: 'assistant',
					content: result.text,
				};
				// 思考模型的 reasoning_content 必须保存，多轮工具调用时要回传给 API
				if (result.reasoningContent) {
					assistantMsg.reasoningContent = result.reasoningContent;
				}
				if (result.toolCalls.length > 0) {
					assistantMsg.toolCalls = result.toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.arguments),
						},
					}));
				}
				this.addWorkMessage(workId, assistantMsg);

				// 如果没有工具调用 → Agent 完成
				if (result.toolCalls.length === 0) break;

				// 处理工具调用
				for (const tc of result.toolCalls) {
					// emit tool_call start event
					this.emitEvent({
						id: uid(),
						workId,
						type: 'tool_call',
						timestamp: Date.now(),
						payload: { name: tc.name, input: tc.arguments },
					});
					onStream?.({
						type: 'tool_start',
						toolName: tc.name,
						callId: tc.id,
						input: tc.arguments,
					});

					// 执行工具
					const toolCtx: ToolContext = {
						ctx: this.ctx,
						workId,
						runningDir: work.runningDir ?? process.cwd(),
						spawnAgent: (agentName, task) => this.spawnAgentFromTool(agentName, task, workId),
					};

					const toolResult = await executeTool(tc.name, tc.arguments, toolCtx);

					// emit tool_result event
					this.emitEvent({
						id: uid(),
						workId,
						type: 'tool_result',
						timestamp: Date.now(),
						payload: { callId: tc.id, result: toolResult },
					});
					onStream?.({
						type: 'tool_end',
						toolName: tc.name,
						callId: tc.id,
						result: toolResult,
					});

					// 把 tool 结果加入消息历史
					this.addWorkMessage(workId, {
						role: 'tool',
						content: toolResult.content,
						toolCallId: tc.id,
					});

					// 如果是 transfer 工具，等待子 Agent 完成后把总结加进来
					if (tc.name === 'transfer' && toolResult.success) {
						const childWorkId = (toolResult.structured?.childWorkId as string) ?? '';
						if (childWorkId) {
							// 等待子 Agent 完成
							const childSummary = await this.waitForChild(childWorkId);
							// 把子 Agent 的总结作为系统消息加入
							this.addWorkMessage(workId, {
								role: 'user',
								content: `[子 Agent "${this.ctx.works[childWorkId]?.agentName}" 工作完成。以下是总结信息]\n${childSummary}`,
							});
						}
					}
				}
			} catch (err) {
				// 如果是用户取消，静默退出
				if (this.aborted) break;

				const msg = (err as Error).message;
				logMsg.error(`[Agent] runAgent error:`, msg);
				onStream?.({ type: 'error', message: msg });
				this.emitEvent({
					id: uid(),
					workId,
					type: 'system',
					timestamp: Date.now(),
					payload: { level: 'error', message: msg },
				});
				assistantContent += `\n\n[错误] ${msg}`;
				break;
			}
		}

		// 记录最终 token 用量
		work.tokens = totalTokens;
		this.ctx.updatedAt = Date.now();

		return assistantContent || '(Agent 未产生输出)';
	}

	/** spawnAgent 的工具调用入口（由 transfer 工具触发） */
	private async spawnAgentFromTool(
		agentName: AgentName,
		task: string,
		parentWorkId: string,
	): Promise<string> {
		const childWorkId = uid();
		const parentWork = this.ctx.works[parentWorkId];
		const now = Date.now();

		// 创建子 WorkInfo
		this.ctx.works[childWorkId] = {
			workId: childWorkId,
			agentName: agentName,
			parentWorkId,
			runningDir: parentWork?.runningDir,
			transferableAgents: this.getDefaultTransferable(agentName),
			status: 'running',
			startedAt: now,
		};

		this.runningWorks.add(childWorkId);

		// 注册等待（TODO 为什么没有用上？）
		const waitPromise = new Promise<string>((resolve) => {
			const parentList = this.pendingChildren.get(parentWorkId) ?? [];
			parentList.push({ childWorkId, resolve });
			this.pendingChildren.set(parentWorkId, parentList);
		});

		// 记录 transfer 事件
		this.emitEvent({
			id: uid(),
			workId: parentWorkId,
			type: 'transfer',
			timestamp: now,
			payload: { childWorkId, targetAgentName: agentName, task },
		});

		// 子 agent start
		this.options.onStream?.({
			type: 'transfer',
			fromWorkId: parentWorkId,
			toWorkId: childWorkId,
			targetAgentName: agentName,
		});
		this.options.onStream?.({
			type: 'agent_start',
			workId: childWorkId,
			agentName: agentName,
		});
		this.emitEvent({
			id: uid(),
			workId: childWorkId,
			parentId: this.ctx.events[this.ctx.events.length - 1]?.id,
			type: 'agent_start',
			timestamp: now,
			payload: { agentName: agentName, task },
		});

		// 添加子 agent 的第一条消息：系统告诉它 "你被转接了"
		const systemMsg = `[来自父 Agent 的任务]\n${task}\n\n请独立完成此任务。完成后输出详细的总结。`;
		this.workMessages.set(childWorkId, [
			{ role: 'system', content: buildSystemPrompt(agentName, this.getDefaultTransferable(agentName), parentWork?.runningDir) },
			{ role: 'system', content: systemMsg },
		]);

		// 异步运行子 Agent（不 await，让多个 transfer 可以并行）
		void this.runAgent(childWorkId).then((summary) => {
			const work = this.ctx.works[childWorkId];
			work.status = 'completed';
			work.endedAt = Date.now();
			this.runningWorks.delete(childWorkId);

			this.options.onStream?.({
				type: 'agent_end',
				workId: childWorkId,
				agentName: agentName,
				summary,
			});

			// 通知等待者子 Agent 完成，调用其 resolve 函数，并从 pendingChildren 中移除
			const list = this.pendingChildren.get(parentWorkId);
			if (list) {
				const idx = list.findIndex((p) => p.childWorkId === childWorkId);
				if (idx >= 0) {
					list[idx].resolve(summary);
					list.splice(idx, 1);
				}
				if (list.length === 0) this.pendingChildren.delete(parentWorkId);
			}
		});

		return childWorkId;
	}

	/** 等待子 Agent 完成 */
	private async waitForChild(childWorkId: string): Promise<string> {
		// 在子 workId 自己的 pendingChildren 里找不对
		// 应该等子 Agent 的 runAgent 完成后 resolve
		// 这里用轮询 + Promise
		return new Promise((resolve) => {
			const check = () => {
				const work = this.ctx.works[childWorkId];
				if (work && work.status === 'completed') {
					// 找到最后一条 assistant 消息
					const msgs = this.workMessages.get(childWorkId) ?? [];
					const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
					resolve(lastAssistant?.content ?? '(子 Agent 完成，无输出)');
					return;
				}
				setTimeout(check, 200);
			};
			check();
		});
	}

	/* ---------- 内部工具 ---------- */

	private emitEvent(event: Omit<AgentEvent, 'timestamp'> & { timestamp?: number }): void {
		const full: AgentEvent = {
			...event,
			timestamp: event.timestamp ?? Date.now(),
		};
		this.ctx.events.push(full);
		this.ctx.updatedAt = full.timestamp;
	}

	private addWorkMessage(workId: string, msg: LlmMessage): void {
		const list = this.workMessages.get(workId) ?? [];
		list.push(msg);
		this.workMessages.set(workId, list);
	}

	private setSystemMessage(workId: string, content: string): void {
		const list = this.workMessages.get(workId) ?? [];
		const existingIdx = list.findIndex((m) => m.role === 'system');
		if (existingIdx >= 0) {
			list[existingIdx] = { role: 'system', content };
		} else {
			list.unshift({ role: 'system', content });
		}
		this.workMessages.set(workId, list);
	}
}

// #endregion
