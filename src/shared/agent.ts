/* ==========================================================================
   Agent 层共享类型定义 — MindTheGap-Harness（v2 架构）

   三层：插件 Plugin → 模式 Mode → Agent 定义 AgentDefinition；
   运行时产出一棵 AgentInstance 树。

   与 v1 的差异（详见 docs/Agent架构-v2设计.md）：
   - `AgentName` 字面量联合类型删除，一切 id 都是 string（能力全部外置到数据文件）
   - `AgentWorkInfo` → `AgentInstance`（携完整消息历史）
   - `workId` → `agentInstanceId`，`ctx.works` → `ctx.agentInstances`
   - 新增 `finish` 完成工具、`reflectionCount` 反思、`ask_user` 客户端工具、循环预算
   - 新增 §8 LLM 层请求日志类型（LlmRequestRecord / LlmPurpose / LlmTrigger）

   注意：UI 侧的 `Message` / `MessageBlock`（前端渲染用的投影）保留不变，
   它由 Runner 在跑的过程中同步产出，和 ctx.agentInstances 一起落在同一个 ctx.json 里。
   ========================================================================== */

/* ==========================================================================
   1. 插件 / 模式 / Agent 定义（磁盘数据模型）
   ========================================================================== */

/** plugins/<pluginId>/plugin.json */
export interface PluginManifest {
	id: string;				// 'MTG-builtin'
	name: string;				// 'MTG 内置插件'
	version: string;
	description?: string;
	modes: string[];			// 该插件提供的 mode id 列表
	/** ↓ 由加载器填充 */
	source?: 'builtin' | 'user';
	dir?: string;				// 插件根目录绝对路径
}

/** Agent 能力策略：agent.json 里的 ability 字段 */
export interface AbilityPolicy {
	/** 工具白名单：不写 allow = 全部内置工具（再减去 deny）；写了 = 只保留 allow 内且不在 deny 内的 */
	tools?: { allow?: string[]; deny?: string[] };
	/** MCP 工具可见性：none / all / 服务器 id 白名单 */
	mcp?: 'none' | 'all' | string[];
	/** 该 Agent 的工具调用是否必填 reason（默认跟随全局 true） */
	requireReason?: boolean;
}

/** <modeId>/<agentId>/agent.json */
export interface AgentDefinition {
	id: string;				// 'explore'
	name: string;				// '探索'（展示名）
	promptFile: string;			// 相对 agent 目录，默认 'prompt.md'
	prompt: string;				// 由加载器读入
	ability: AbilityPolicy;
	/** 允许委托的 agent id 白名单。不传 = 本模式全部 Agent 可用 */
	delegatable?: string[];
	/** 模型槽位 */
	model?: 'standard' | 'economy';
	/** 任务清单在提示词层面是否注入（不影响工具层面是否可用） */
	taskListInject: boolean;
	/** 反思轮数初始值，默认 0 = 不反思（见设计 §7.9） */
	reflectionCount?: number;
	/** 追加到「反思问题构造器」提示词的自定义内容 */
	reflectionPromptAppend?: string;
}

/** <modeId>/mode.json 里声明、可被 settings.modeConfigs 覆盖的默认配置 */
export interface ModeConfigDefaults {
	limits?: {
		totalRounds?: number;		// 一次 run 的总循环上限，默认 200
		agentInstanceRounds?: number;	// 单实例循环上限，默认 50
		warnAtRemaining?: number;	// 剩余多少次时开始注入告警提示词，默认 3
	};
	/** 空模式：是否把 MCP 放入（默认 false） */
	includeMcp?: boolean;
	/** 追加到反思问题构造器的提示词（覆盖 agent 级 reflectionPromptAppend） */
	reflectionPromptAppend?: string;
	[key: string]: unknown;
}

/** <modeId>/mode.json */
export interface ModeDefinition {
	id: string;				// 'code' | 'empty'
	name: string;				// '编码' | '空'
	description?: string;
	rootAgent: string;			// agent id，根实例由它创建
	agents: Record<string, AgentDefinition>;
	/** 最大嵌套深度（根实例 depth = 0）。达到后 delegate 工具不再展示给模型 */
	maxDepth: number;
	/** 是否注入 prompts/_base.md 基座（'空'模式设 false，得到真正的空提示词） */
	injectBasePrompt: boolean;
	/** 任务清单：功能开关 + 是否可写。提示词注入由 agent 级 taskListInject 决定 */
	taskList?: { enabled: boolean; writable: boolean };
	/** 该模式默认的 MCP 策略（可被 agent 级 ability.mcp 覆盖） */
	mcp?: 'none' | 'all' | string[];
	/** 循环预算默认值（可被 settings.modeConfigs[modeId].limits 覆盖） */
	defaultSettings: ModeConfigDefaults;
	/** 该模式对外暴露的可配置项（设置页 JSON 编辑器据此渲染说明） */
	settingsSchema?: Record<string, unknown>;
	ui?: { icon?: string; accent?: string };
	/** ↓ 由加载器填充 */
	pluginId: string;
	pluginName: string;
	pluginDir: string;
}

/** 对外聚合（GET /api/modes 返回，含当前生效配置） */
export interface ModeSummary {
	id: string;
	name: string;
	description?: string;
	pluginId: string;
	pluginName: string;
	rootAgent: string;
	agents: { id: string; name: string; delegatable: string[] }[];
	maxDepth: number;
	ui?: ModeDefinition['ui'];
	/** 当前生效配置（defaultSettings ⊕ settings.modeConfigs[id] 深合并） */
	config: ModeConfigDefaults;
	settingsSchema?: Record<string, unknown>;
	/** 是否被用户插件覆盖了同名内置模式 */
	overridden?: boolean;
}

/* ==========================================================================
   2. LLM 消息（前后端 / llm 层共用，AgentInstanceMessage 基于它扩展）
   ========================================================================== */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

/** OpenAI 线格式的 tool_call（内部一律用这套驼峰字段，发请求时转 wire 格式） */
export interface LlmToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface LlmMessage {
	role: LlmRole;
	content: string;
	toolCalls?: LlmToolCall[];
	toolCallId?: string;
	/** 思考模型的推理内容，多轮工具调用时必须回传 */
	reasoningContent?: string;
}

export interface LlmTool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

/* ==========================================================================
   3. 运行时实例树
   ========================================================================== */

export type AgentInstanceStatus =
	| 'running'			// 正在模型输出 / 正在跑工具 / 即将重入 agentLoop
	| 'pending'			// 出循环等待外部事件：等子 Agent、等用户回答、等客户端工具
	| 'succeeded'			// 已调用 finish 并接受总结（根实例 = 结束本轮）
	| 'failed'			// 出错终止 / 触达循环上限
	| 'interrupted';		// 用户取消 / 进程退出
	// 注：'running' 若被中途打断，仍保持 running；下次启动 agentLoop 前统一改 interrupted

/** LlmMessage 之上只加一个时间戳 */
export type AgentInstanceMessage = LlmMessage & { updatedAt: number };

export interface AgentInstance {
	agentInstanceId: string;
	conversationId: string;
	modeId: string;
	agentId: string;
	agentName: string;			// 展示名冗余，避免每次都查定义
	parentAgentInstanceId?: string;
	depth: number;				// 根 = 0
	status: AgentInstanceStatus;
	/** 父 Agent 下发的任务说明（同时是首条 user 消息内容） */
	task?: string;
	/** 该实例自己的完整消息历史（含 system），每条带 updatedAt */
	messages: AgentInstanceMessage[];
	/** 尚未拿到结果的 tool callId（便于调度器判断是否可重入，可从 messages 推导，这里缓存） */
	pendingCallIds?: string[];
	/** 历次 finish 提交的总结（完成后仍可被重新唤醒接续，所以是数组） */
	summaries?: string[];
	/** 剩余反思次数（创建时 = AgentDefinition.reflectionCount ?? 0） */
	reflectionsRemaining: number;
	/** 本实例消耗的 agentLoop 轮数 */
	rounds: number;
	childAgentInstanceIds: string[];
	/** 本实例累计 token。只是从 requestLog 聚合来的运行时缓存，权威数据在 requestLog.jsonl */
	tokens?: TokenUsage;
	startedAt: number;
	lastUpdatedAt?: number;
	/** 中断 / 失败原因（供父实例的「尚未完成的子 Agent」段落展示） */
	interruptReason?: string;
}

export interface RunBudget {
	/** 本轮 run 的总轮数上限 */
	total: number;
	/** 已消耗（含全部子实例） */
	spent: number;
}

/** 后台任务占位（本版不实现，仅保留字段与提示词段落） */
export interface BackgroundTask {
	id: string;
	description: string;
	createdAt: number;
}

export interface AgentCtx {
	ctxVersion: 2;
	conversationId: string;
	modeId: string;
	rootAgentInstanceId: string;
	agentInstances: Record<string, AgentInstance>;
	/** 扁平事件流（UI 渲染 / 审计用，体量小，不含完整消息体） */
	events: AgentEvent[];
	/** 任务清单（纯文本） */
	taskList: string;
	/** 本轮 run 的循环预算。每次 POST /api/agent/run 重置 */
	budget: RunBudget;
	/** 后台任务占位（本版不实现，仅保留字段与提示词段落） */
	backgroundTasks?: BackgroundTask[];
	createdAt: number;
	updatedAt: number;
}

/* ==========================================================================
   4. 事件与流式
   ========================================================================== */

export type AgentEventType =
	| 'user_message' | 'assistant_message'
	| 'tool_call'			// 带 status: 'pending'|'running'|'success'|'error'、reason、origin
	| 'tool_result'
	| 'agent_start' | 'agent_end'
	| 'reflection'			// 反思轮（§7.9）
	| 'system';

/** 扁平事件流里的一条（不含完整消息体） */
export interface AgentEvent {
	id: string;
	agentInstanceId: string;
	parentAgentInstanceId?: string;
	type: AgentEventType;
	timestamp: number;
	duration?: number;
	payload: unknown;
	tokens?: TokenUsage;
}

/** 工具调用的标准化结果 */
export interface ToolResult {
	success: boolean;
	content: string;
	structured?: Record<string, unknown>;
	error?: string;
}

/** Agent 流式输出事件（SSE 推送，前端按 agentInstanceId 归层） */
export type AgentStreamEvent =
	| { type: 'text'; agentInstanceId: string; chunk: string }
	| { type: 'tool_start'; agentInstanceId: string; callId: string; toolName: string; args: unknown; reason: string }
	| { type: 'tool_end'; agentInstanceId: string; callId: string; toolName: string; result: ToolResult }
	| { type: 'agent_start'; agentInstanceId: string; parentAgentInstanceId?: string; agentId: string; agentName: string; depth: number; task?: string }
	| { type: 'agent_end'; agentInstanceId: string; status: 'succeeded' | 'failed' | 'interrupted'; summary?: string }
	/** 需要客户端响应的工具（ask_user）。参考 langchain-aliyun 的 client_tool_call */
	| { type: 'client_tool_call'; agentInstanceId: string; callId: string; toolName: string; args: unknown; needResponse: boolean }
	| { type: 'reflection'; agentInstanceId: string; remaining: number; prompt: string }
	| { type: 'usage'; agentInstanceId?: string; logId?: string; tokens: TokenUsage }
	| { type: 'error'; agentInstanceId?: string; message: string }
	| { type: 'done'; summary: string };

/* ==========================================================================
   5. Token 用量 / 模型
   ========================================================================== */

export interface TokenUsage {
	input?: number;
	inputCached?: number;
	output?: number;
	total?: number;
}

/** 模型提供商配置（精简版，完整版是 ModelProvider） */
export interface ModelConfig {
	providerId: string;
	modelId: string;
	displayName: string;
	apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	customParams?: Record<string, unknown>;
}

/* ==========================================================================
   6. 请求 / 响应
   ========================================================================== */

/** 发送给 Agent 的请求 */
export interface AgentRunRequest {
	conversationId: string;
	userMessage: string;
	modeId: string;
	runningDir?: string;
	model: ModelConfig;
}

/** ask_user 的参数 */
export interface AskUserArgs {
	question: string;
	/** 单选项（每个可带描述）；为空时前端只给自由输入 */
	options?: { label: string; description?: string }[];
	/** 追加到提问卡片的补充说明 */
	extraPrompt?: string;
}

/** POST /api/agent/answer —— 续接 client 工具（ask_user） */
export interface AgentAnswerRequest {
	conversationId: string;
	toolCallId: string;
	result: string;
}

/* ==========================================================================
   7. LLM 层请求日志（§8）
   ========================================================================== */

export type LlmPurpose = 'agent_loop' | 'reflection' | 'ask_child' | 'other';

/** 什么导致了这次请求 */
export type LlmTrigger =
	| 'initial'			// 实例刚创建，第一次请求
	| 'user_message'			// 根实例收到用户新发言
	| 'tool_results'			// 回填了一批普通工具结果之后
	| 'delegate_return'		// 一批子实例进入终态之后
	| 'answer'			// 用户回答了 client 工具（ask_user）
	| 'resume'			// 被 resume_* 唤醒
	| 'reflection';			// 反思轮

/** conversations/<id>/requestLog.jsonl —— 每行一条，append-only */
export interface LlmRequestRecord {
	seq: number;				// 会话内递增序号
	logId: string;				// `${seq}-${startedAt.toString(36)}`，SSE / dump 文件用它定位
	conversationId: string;

	// ---- 归属：这是「谁」发的请求（agent 层的线索）----
	agentInstanceId?: string;		// 发起方实例。ask_child 记「提问方」，被问方不因此变更
	agentId?: string;
	agentName?: string;
	depth?: number;
	modeId?: string;
	purpose: LlmPurpose;
	trigger?: LlmTrigger;
	triggeredByCallIds?: string[];		// 这次请求是在回填哪些 tool_call 的结果之后发出的
	producedToolCallIds?: string[];		// 这次请求产出了哪些 tool_call（与 ctx 里的 messages 对齐）
	agentInstanceRound?: number;		// 该实例的第几轮

	// ---- 模型 ----
	providerId: string;
	model: string;
	format: 'openai-chat' | 'openai-responses' | 'anthropic';

	// ---- 请求形状（只记「形」，正文不进来：正文在 ctx.json 里）----
	request?: {
		messageCount: number;
		toolCount: number;
		toolNames?: string[];
		systemPromptChars: number;
		systemPromptHash?: string;
		totalChars: number;
		stream: boolean;
	};

	// ---- 结果 ----
	status: 'success' | 'error' | 'aborted';
	usage?: TokenUsage;
	finishReason?: string;
	firstChunkMs?: number;			// TTFT
	durationMs: number;
	error?: { name?: string; message: string; status?: number };

	startedAt: number;
	endedAt: number;
}

/** requestLog 配置（settings.debug.requestLog） */
export interface RequestLogConfig {
	enabled: boolean;
	includeToolNames: boolean;
	maxBytes: number;
	dumpPayload: boolean;
}

/* ==========================================================================
   8. UI 侧数据模型（会话 & 消息）

   messages 是「给前端看的投影」，由 Runner 边跑边写；
   agentCtx 是 agent 层的唯一真相。两者同存于 conversations/<id>/ctx.json。
   ========================================================================== */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type MessageBlock =
	| { type: 'text'; key?: string; depth: number; agentInstanceId?: string; content: string }
	| { type: 'tool'; key: string; depth: number; agentInstanceId?: string; name: string; status: 'running' | 'success' | 'error'; reason?: string; detail?: string }
	| { type: 'agent'; key: string; depth: number; agentInstanceId?: string; name: string; running: boolean; summary?: string }
	| { type: 'reflection'; key: string; depth: number; agentInstanceId?: string; remaining: number; text: string }
	| { type: 'ask_user'; key: string; depth: number; agentInstanceId?: string; question: string; options: { label: string; description?: string }[]; status: 'waiting' | 'answered' | 'skipped'; answer?: string }
	| { type: 'error'; key?: string; depth: number; agentInstanceId?: string; message: string };

export interface Message {
	id: string;
	role: MessageRole;
	content: string;
	createdAt: number;
	agentName?: string;
	modeId?: string;
	tokens?: { input?: number; output?: number; cached?: number };
	duration?: number;
	blocks?: MessageBlock[];
}

/** 会话元信息（列表展示用，不含 messages） */
export interface ConversationMeta {
	id: string;
	folderId: string;
	title: string;
	modeId: string;
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

/* ==========================================================================
   9. MCP（Model Context Protocol）
   ========================================================================== */

/** MCP 传输方式 */
export type McpTransport = 'stdio' | 'http';

/** MCP 服务器配置（持久化） */
export interface McpServerConfig {
	id: string;
	name: string;
	enabled: boolean;
	transport: McpTransport;
	command?: string;	// stdio: 可执行命令（如 node / npx / python），在 Windows 上会自动补 .cmd 后缀
	args?: string[];	// stdio: 命令参数
	env?: Record<string, string>;	// stdio: 附加环境变量（与 process.env 合并，优先级更高）
	cwd?: string;	// stdio: 子进程工作目录
	url?: string;	// http: MCP 端点地址（Streamable HTTP）
	headers?: Record<string, string>;	// http: 附加请求头
}

/** 一个 MCP 工具 */
export interface McpToolInfo {
	name: string;	// 暴露给 LLM 的名称，格式 mcp__<serverName>__<toolName>
	originalName: string;	// MCP 服务器上的原始工具名
	serverId: string;
	serverName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** MCP 服务器实时状态（不持久化） */
export interface McpServerStatus {
	id: string;
	name: string;
	enabled: boolean;
	connected: boolean;
	transport: McpTransport;
	error?: string;
	tools: McpToolInfo[];
}

/* ==========================================================================
   10. 设置
   ========================================================================== */

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

/** 用量统计设置（纯 UI 偏好；真实统计从 requestLog 聚合） */
export interface UsageStats {
	timeRange: '4h' | '1d' | 'today' | '7d' | '30d';
	showApiRequests: boolean;
	showToolCalls: boolean;
	showTokensInput: boolean;
	showTokensInputCached: boolean;
	showTokensOutput: boolean;
}

/** 调试配置 */
export interface DebugSettings {
	requestLog: RequestLogConfig;
}

/** 后端完整设置 */
export interface ServiceSettings {
	providers: ModelProvider[];
	currentStandardModel: { providerId: string; modelId: string } | null;
	currentEconomyModel: { providerId: string; modelId: string } | null;
	/** 当前模式 id（取代 v1 的 currentAgentName） */
	currentModeId: string;
	/** 各模式的配置覆盖（defaultSettings ⊕ 它 = 生效配置） */
	modeConfigs: Record<string, ModeConfigDefaults>;
	usage: UsageStats;
	folders: Folder[];
	mcpServers: McpServerConfig[];
	debug: DebugSettings;
}

/** 后端完整应用状态（Agent Service 持久化） */
export interface ServiceAppState {
	settings: ServiceSettings;
	conversationMeta: ConversationMeta[];
	activeConversationId: string | null;
}
