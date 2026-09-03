/* ==========================================================================
   Agent 层共享类型定义 — MindTheGap-Harness

   这些类型同时被主进程（Agent 引擎）和渲染进程（UI 展示）引用。
   层级性通过 parentId / workId 体现，顺序性通过扁平数组 + 时间戳体现。

   重构要点：
   - AgentMode → AgentName（统一命名，消灭 mode/AppMode/AgentMode 混用）
   - AgentRunRequest.mode → agentName
   - transfer.targetAgent → targetAgentName
   - 新增 ServiceConversation / ConversationMeta（后端数据模型）
   - 新增 ctx_patch / conversation_update SSE 事件
   ========================================================================== */

/** Agent 名称（原 AgentMode / AppMode，统一为一个类型） */
export type AgentName = '默认' | '编码' | '文件夹浏览总结';

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

/** Agent 会话上下文（后端完整数据 = ServiceCtx） */
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
	agentName: AgentName;
	parentWorkId?: string;
	runningDir?: string;
	transferableAgents: AgentName[];	/** 可转接的 Agent 列表 */
	status: 'running' | 'completed' | 'failed';
	startedAt: number;
	endedAt?: number;
	tokens?: TokenUsage;
}

/** 工具调用的标准化结果 */
export interface ToolResult {
	success: boolean;
	content: string;
	structured?: Record<string, unknown>;	/** 可选的结构化数据（用于图示模式等） */
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
	agentName: AgentName;
	model: ModelConfig;
	continueFromEventId?: string;
}

/** Agent 流式输出事件 */
export type AgentStreamEvent =
	| { type: 'text'; chunk: string }
	| { type: 'tool_start'; toolName: string; callId: string; input: unknown }
	| { type: 'tool_end'; toolName: string; callId: string; result: ToolResult }
	| { type: 'agent_start'; workId: string; agentName: AgentName }
	| { type: 'agent_end'; workId: string; agentName: AgentName; summary: string }
	| { type: 'transfer'; fromWorkId: string; toWorkId: string; targetAgentName: AgentName }
	| { type: 'usage'; tokens: TokenUsage }
	| { type: 'error'; message: string }
	| { type: 'done'; finalSummary: string }
	| { type: 'ctx_patch'; patch: Partial<AgentCtx> }
	| { type: 'conversation_update'; conversationId: string; patch: Partial<ConversationMeta> };

/* ==========================================================================
   会话 & 设置 — 后端数据模型（Agent Service 管理）
   ========================================================================== */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type MessageBlock =
	| { type: 'text'; key?: string; depth: number; content: string }
	| { type: 'tool'; key: string; depth: number; name: string; status: 'running' | 'success' | 'error'; detail?: string }
	| { type: 'agent'; key: string; depth: number; name: string; running: boolean; summary?: string }
	| { type: 'error'; key?: string; depth: number; message: string };

export interface Message {
	id: string;
	role: MessageRole;
	content: string;
	createdAt: number;
	agentName?: string;
	parentId?: string;
	tokens?: { input?: number; output?: number; cached?: number };
	duration?: number;
	blocks?: MessageBlock[];
}

/** 会话元信息（列表展示用，不含 messages） */
export interface ConversationMeta {
	id: string;
	folderId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

/** 后端完整会话数据（ServiceConversation） */
export interface ServiceConversation extends ConversationMeta {
	messages: Message[];
	agentCtx?: AgentCtx;
}

/** 文件夹 */
export interface Folder {
	id: string;
	name: string;
	path?: string;
	isLocal?: boolean;
}

/** 模型提供商（完整配置） */
export interface ModelProvider {
	id: string;
	name: string;
	apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	models: ModelProviderModel[];
	customParams: Record<string, unknown>;
}

export interface ModelProviderModel {
	id: string;
	displayName: string;
	role: 'standard' | 'economy';
	customParams?: Record<string, unknown>;
}

/** Agent 配置（原 ModeConfig） */
export interface AgentConfig {
	name: AgentName;
	transferableAgents: AgentName[];
}

/** 用量统计设置 */
export interface UsageStats {
	timeRange: '4h' | '1d' | 'today' | '7d' | '30d';
	showApiRequests: boolean;
	showToolCalls: boolean;
	showTokensInput: boolean;
	showTokensInputCached: boolean;
	showTokensOutput: boolean;
}

/** 后端完整设置 */
export interface ServiceSettings {
	providers: ModelProvider[];
	currentStandardModel: { providerId: string; modelId: string } | null;
	currentEconomyModel: { providerId: string; modelId: string } | null;
	currentAgentName: AgentName;
	agentConfigs: AgentConfig[];
	usage: UsageStats;
	folders: Folder[];
}

/** 后端完整应用状态（Agent Service 持久化） */
export interface ServiceAppState {
	settings: ServiceSettings;
	conversationMeta: ConversationMeta[];
	activeConversationId: string | null;
}
