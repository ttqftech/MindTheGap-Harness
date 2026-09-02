/* ==========================================================================
   Agent 层共享类型定义 — MindTheGap-Harness
   
   这些类型同时被主进程（Agent 引擎）和渲染进程（UI 展示）引用。
   层级性通过 parentId / workId 体现，顺序性通过扁平数组 + 时间戳体现。
   ========================================================================== */

/** Agent 工作模式 */
export type AgentMode = '默认' | '编码' | '文件夹浏览总结';

/** 工具调用状态 */
export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

/** Token 用量统计 */
export interface TokenUsage {
	input?: number;
	inputCached?: number;
	output?: number;
}

/** 一条消息 / 事件在 ctx 中的统一结构 */
export interface AgentEvent {
	/** 唯一 ID */
	id: string;
	/** 所属 Agent 的 workId */
	workId: string;
	/** 父事件 ID — 体现层级性 */
	parentId?: string;
	/** 事件类型 */
	type: AgentEventType;
	/** 创建时间戳 */
	timestamp: number;
	/** 耗时 ms */
	duration?: number;
	/** 事件内容（不同 type 结构不同） */
	payload: unknown;
	/** Token 用量（如果是 LLM 调用） */
	tokens?: TokenUsage;
}

export type AgentEventType =
	| 'user_message'       // 用户发的消息
	| 'assistant_message'   // AI 的回复（含 text + tool_calls）
	| 'tool_call'           // 工具调用开始
	| 'tool_result'         // 工具调用结果
	| 'agent_start'         // Agent 开始执行
	| 'agent_end'           // Agent 结束执行
	| 'transfer'            // 转接（创建子 Agent）
	| 'system';             // 系统事件（错误、状态变更等）

/** Agent 会话上下文 */
export interface AgentCtx {
	/** 会话 ID（对应当前 conversation.id） */
	conversationId: string;
	/** 根 Agent workId */
	rootWorkId: string;
	/** 所有事件（扁平数组，按时间排序） */
	events: AgentEvent[];
	/** Agent 工作树（workId → 信息） */
	works: Record<string, AgentWorkInfo>;
	/** 创建时间 */
	createdAt: number;
	/** 最后更新时间 */
	updatedAt: number;
}

/** 一个 Agent 工作实例的信息 */
export interface AgentWorkInfo {
	workId: string;
	agentName: AgentMode;
	parentWorkId?: string;
	/** 当前运行文件夹 */
	runningDir?: string;
	/** 可转接的 Agent 列表 */
	transferableAgents: AgentMode[];
	status: 'running' | 'completed' | 'failed';
	startedAt: number;
	endedAt?: number;
	tokens?: TokenUsage;
}

/** 工具调用的标准化结果 */
export interface ToolResult {
	success: boolean;
	content: string;
	/** 可选的结构化数据（用于图示模式等） */
	structured?: Record<string, unknown>;
	/** 错误信息 */
	error?: string;
}

/** 模型提供商配置（精简版，完整版在 store 里） */
export interface ModelConfig {
	providerId: string;
	modelId: string;
	displayName: string;
	apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	customParams?: Record<string, unknown>;
}

/** 发送给 Agent 的请求 */
export interface AgentRunRequest {
	conversationId: string;
	userMessage: string;
	runningDir?: string;
	mode: AgentMode;
	/** 使用哪个模型 */
	model: ModelConfig;
	/** 从哪个事件 ID 继续（用于恢复/重试） */
	continueFromEventId?: string;
}

/** Agent 流式输出事件 */
export type AgentStreamEvent =
	| { type: 'text'; chunk: string }
	| { type: 'tool_start'; toolName: string; callId: string; input: unknown }
	| { type: 'tool_end'; toolName: string; callId: string; result: ToolResult }
	| { type: 'agent_start'; workId: string; agentName: AgentMode }
	| { type: 'agent_end'; workId: string; agentName: AgentMode; summary: string }
	| { type: 'transfer'; fromWorkId: string; toWorkId: string; targetAgent: AgentMode }
	| { type: 'usage'; tokens: TokenUsage }
	| { type: 'error'; message: string }
	| { type: 'done'; finalSummary: string };
