/**
 * Agent 层共享类型定义 — MindTheGap-Harness（v2 架构）
 *
 * 三层：插件 Plugin → 模式 Mode → Agent 定义 AgentDefinition；
 * 运行时产出一棵 AgentInstance 树。
 *
 * 与 v1 的差异（详见 docs/Agent架构-v2设计.md）：
 * - `AgentName` 字面量联合类型删除，一切 id 都是 string（能力全部外置到数据文件）
 * - `AgentWorkInfo` → `AgentInstance`（携完整消息历史）
 * - `workId` → `agentInstanceId`，`ctx.works` → `ctx.agentInstances`
 * - 新增 `finish` 完成工具、`reflectionCount` 反思、`ask_user` 客户端工具、循环预算
 * - 新增 §8 LLM 层请求日志类型（LlmRequestRecord / LlmPurpose / LlmTrigger）
 *
 * 注意：界面**没有独立的 UI 消息模型**（2026-09-14 起）。渲染完全由 ctx 现算：
 * `src/mainview/projection.ts` 的 `foldCtxToRenderTree()` 从根实例出发，遇到 delegate 工具调用
 * 就下钻到子实例递归渲染。所以这里的 `AgentInstance.messages` 就是唯一的转写真相，
 * 其中带 `uiOnly` 标记的条目只给界面看、不下发给模型。设计稿见
 * `docs/设计-ctx唯一真相与动态投影.md`。
 */

// #region 1. 插件 / 模式 / Agent 定义（磁盘数据模型）

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
	/** 反思轮数初始值，默认 0 = 不反思（见设计 §7.9） */
	reflectionCount?: number;
	/**
	 * Agent 级反思提示词文件名（相对本 agent 目录，默认 `reflection.md`）。
	 * 该文件存在时，本 Agent 的反思轮**整份替换**模式级的反思提示词，不做拼接。
	 */
	reflectionPromptFile?: string;
	/** 由加载器读入的 Agent 级反思提示词内容（没有文件时为空串） */
	reflectionPrompt?: string;
}

/**
 * 循环预算 —— mode.json 顶层 `limits`。
 * 三个字段都可不写，兜底值（200 / 50 / 3）在 runner.limits() 里。
 */
export interface ModeLimits {
	totalRounds?: number;			// 一次 run 的总循环上限
	agentInstanceRounds?: number;	// 单实例循环上限
	warnAtRemaining?: number;		// 剩余多少次时开始注入告警提示词
}

/** <modeId>/mode.json —— 模式配置的唯一来源（没有 settings 覆盖层，设置页直接编辑这个文件） */
export interface ModeDefinition {
	id: string;				// 'code' | 'empty'
	name: string;				// '编码' | '空'
	description?: string;
	rootAgent: string;			// agent id，根实例由它创建
	agents: Record<string, AgentDefinition>;
	/** 最大嵌套深度（根实例 depth = 0）。达到后 delegate 工具不再展示给模型 */
	maxDepth: number;
	/** 任务清单：功能开关 + 是否可写（工具层面）。提示词里要不要内嵌，由该 Agent 的 prompt.md 自己决定 */
	taskList?: { enabled: boolean; writable: boolean };
	/** 该模式默认的 MCP 策略（可被 agent 级 ability.mcp 覆盖） */
	mcp?: 'none' | 'all' | string[];
	/** 循环预算（缺省时用 runner 里的默认值） */
	limits?: ModeLimits;
	ui?: { icon?: string; accent?: string };
	/**
	 * 模式级反思提示词（`<modeId>/reflection.md` → 内置默认 逐级回退，
	 * agent 级 reflection.md 存在时整份替换它）。下面两个字段由加载器填充。
	 */
	reflectionPrompt?: string;
	reflectionPromptPath?: string;
	/** mode.json 的源码文本与绝对路径（设置页直接编辑这份 JSON） */
	modeJsonText?: string;
	modeJsonPath?: string;
	/** ↓ 由加载器填充 */
	pluginId: string;
	pluginName: string;
	pluginDir: string;
}

/** 对外聚合（GET /api/modes 返回） */
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
	/** mode.json 顶层字段（就是生效配置，没有覆盖层） */
	limits?: ModeLimits;
	/** mode.json 源码文本 / 路径 —— 设置页的编辑器直接编辑它 */
	modeJson?: string;
	modeJsonPath?: string;
	/** 是否被用户插件覆盖了同名内置模式 */
	overridden?: boolean;
}

// #endregion

// #region 2. LLM 消息（前后端 / llm 层共用，AgentInstanceMessage 基于它扩展）

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

// #endregion

// #region 3. 运行时实例树

export type AgentInstanceStatus =
	| 'running'			// 正在模型输出 / 正在跑工具 / 即将重入 agentLoop
	| 'pending'			// 出循环等待外部事件：等子 Agent、等用户回答、等客户端工具
	| 'succeeded'			// 已调用 finish 并接受总结（根实例 = 结束本轮）
	| 'failed'			// 出错终止 / 触达循环上限
	| 'interrupted';		// 用户取消 / 进程退出
	// 注：'running' 若被中途打断，仍保持 running；下次启动 agentLoop 前统一改 interrupted

/**
 * 条目的结构化载荷种类（`kind`）：
 * - `ask_user_state` 属 **uiOnly**（界面要看、不下发模型）
 * - `tool_result` / `reflection` 是普通条目的附加信息，仍会进 LLM 上下文
 *   （`tool_result` 解掉「成功/失败靠 `[失败] ` 前缀嗅探」；`reflection` 解掉「反思文本和 system prompt 分不开」）
 */
export type MessageKind = 'ask_user_state' | 'tool_result' | 'reflection';

/**
 * 实例条目 = LLM 消息 + 时间戳 + 可选的结构化载荷。
 *
 * ⚠️ 这份数组是**双重身份**：既是界面转写的唯一真相，又是发给模型的上下文。
 * 所以要区分「界面看、模型不看」的条目（如提问卡片状态），这就是 `uiOnly` 的用途。
 */
export type AgentInstanceMessage = LlmMessage & {
	updatedAt: number;
	/** 只给界面看，组 payload 时过滤掉（见 runner 的 `toLlmMessages()`） */
	uiOnly?: true;
	kind?: MessageKind;
	/** `kind` 对应的结构化载荷 */
	data?: AskUserState | ToolResultInfo | ReflectionInfo;
	/**
	 * 这次 LLM 调用的账本，挂在**这次调用的产出物**上（assistant 条目 / 反思条目）。
	 *
	 * 为什么不做成一条独立的 `role:'system'` 条目：usage 本来就是「某一次 LLM 调用附带的一条数据」，
	 * 拆成独立条目后投影只能把它平铺进转写，界面上就出现一堆与调用脱节的流水，与「一次调用一个块」冲突。
	 *
	 * 交接方式：usage emitter 在 `callLlm` 内部就触发（比 runner push 产出物更早），
	 * 所以先暂存在 `AgentInstance.pendingUsage`，由 runner 在 push 产出物时取走（`runner.ts` 的 `adoptUsage`）。
	 */
	usages?: UsageEntry[];
};

/** 一次 LLM 请求的账本（真相在 ctx；requestLog.jsonl 只是诊断日志） */
export interface UsageEntry {
	seq: number;					// 会话内第几次 LLM 请求
	round?: number;					// 该实例第几轮 agentLoop
	purpose: string;				// agent_loop / reflection / ask_child / web_rank
	model: string;
	logId?: string;
	input?: number;
	output?: number;
	cached?: number;
	total?: number;
	durationMs: number;
	/** agentLoop 本段的小计不落盘：由前端按区间对 usage 条目求和 */
}

/** `kind: 'ask_user_state'` 的载荷：提问卡片的状态（不再靠字符串比对） */
export interface AskUserState {
	callId: string;
	status: 'waiting' | 'answered' | 'skipped';
	answer?: string;
}

/** `kind: 'tool_result'` 的载荷：工具结果的终态信息 */
export interface ToolResultInfo {
	success: boolean;
	/** 工具返回的结构化字段（如 delegate 的 `childAgentInstanceIds` / `status`，渲染嵌套树要用） */
	structured?: Record<string, unknown>;
	error?: string;
}

/** `kind: 'reflection'` 的载荷：反思条目的元信息（反思正文本身在 content 里） */
export interface ReflectionInfo {
	/** 本轮反思后还剩几次 */
	remaining: number;
}

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
	/** 该实例自己的完整消息历史（含 system 与 uiOnly 条目），每条带 updatedAt */
	messages: AgentInstanceMessage[];
	/** 尚未拿到结果的 tool callId（便于调度器判断是否可重入，可从 messages 推导，这里缓存） */
	pendingCallIds?: string[];
	/**
	 * 运行期暂存：usage emitter 记下、还没被某次 LLM 产出物领走的账本。
	 * 正常流程里它在 push 产出物时立刻被清空（见 `runner.ts` 的 `adoptUsage`），落盘时通常不存在。
	 * **不是给界面看的东西** —— 界面上的账本一律读 `AgentInstanceMessage.usages`。
	 */
	pendingUsage?: UsageEntry[];
	/** 历次 finish 提交的总结（完成后仍可被重新唤醒接续，所以是数组） */
	summaries?: string[];
	/** 剩余反思次数（创建时 = AgentDefinition.reflectionCount ?? 0） */
	reflectionsRemaining: number;
	/** 本实例消耗的 agentLoop 轮数 */
	rounds: number;
	/** 本实例累计发起过多少次 LLM 请求（唯一写入点在 llm usage emitter） */
	llmCalls: number;
	childAgentInstanceIds: string[];
	/** 本实例累计 token（唯一写入点在 llm usage emitter；唯一真相） */
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

// #endregion

// #region 4. 事件与流式

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

/**
 * 每个 SSE 事件都必须带一个**后端时间**：`timestamp` = 事件发生那一刻服务端的 `Date.now()`。
 *
 * ⚠️ 前端拼装在飞 overlay 时**一律用它**，不许自己 `Date.now()` ——
 *    否则「在飞期间前端算出来的时间」与「ctx 里那份后端时间」不是同一个来源，
 *    每收到一条 SSE 就要重新 fold 一次，`Date.now()` 也随之重取，任何计时器都会从头开始数
 *    （提问卡的「阻塞中 mm:ss」就是这么坏的，2026-09-17）。
 */
export interface StreamEventBase {
	timestamp: number;
}

/** 分布式 Omit：后端**构造**事件时不写 timestamp（由 `emitStream` 统一盖一个） */
export type StreamEventDraft = DistributiveOmit<AgentStreamEvent, 'timestamp'>;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/** Agent 流式输出事件（SSE 推送，前端按 agentInstanceId 归层） */
export type AgentStreamEvent = StreamEventBase & (
	| { type: 'text'; agentInstanceId: string; chunk: string }
	| { type: 'reasoning'; agentInstanceId: string; chunk: string }
	| { type: 'tool_start'; agentInstanceId: string; callId: string; toolName: string; args: unknown; reason: string }
	| { type: 'tool_end'; agentInstanceId: string; callId: string; toolName: string; result: ToolResult }
	| { type: 'agent_start'; agentInstanceId: string; parentAgentInstanceId?: string; agentId: string; agentName: string; depth: number; task?: string }
	| { type: 'agent_end'; agentInstanceId: string; status: 'succeeded' | 'failed' | 'interrupted'; summary?: string }
	| { type: 'client_tool_call'; agentInstanceId: string; callId: string; toolName: string; args: unknown; needResponse: boolean }	// 需要客户端响应的工具（ask_user）。参考 langchain-aliyun 的 client_tool_call
	| { type: 'reflection_start'; agentInstanceId: string; remaining: number }
	| { type: 'reflection_chunk'; agentInstanceId: string; chunk: string }
	| {
		type: 'usage';
		agentInstanceId?: string;
		logId?: string;
		tokens: TokenUsage;
		scope?: 'call' | 'loop';	// call: 每次 LLM 请求结束就发一条　loop: agentLoop 中断时发（询问用户 / 完成任务 / 出错），带本段增量与实例累计
		seq?: number;	// 该会话内第几次 LLM 请求（requestLog 的自增序号）
		round?: number;	// 该实例的第几轮 agentLoop
		purpose?: string;	// agent_loop / reflection / ask_child / web_rank
		agentName?: string;
		depth?: number;
		durationMs?: number;
		model?: string;
		loopDelta?: TokenUsage;	// 仅 scope='loop'：本段（本次 agentLoop）的增量
		loopCalls?: number;	// 仅 scope='loop'：本段发生了几次 LLM 调用
		reason?: 'ask_user' | 'finish' | 'interrupted' | 'error' | 'await_child';	// 仅 scope='loop'：中断原因（ask_user' | 'finish' | 'interrupted' | 'error' | 'await_child'）
	}
	| { type: 'error'; agentInstanceId?: string; message: string }
	| { type: 'done'; summary: string }
);

// #endregion

// #region 5. Token 用量 / 模型

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
	apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	customParams?: Record<string, unknown>;
}

// #endregion

// #region 6. 请求 / 响应

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
}

/** POST /api/agent/answer —— 续接 client 工具（ask_user） */
export interface AgentAnswerRequest {
	conversationId: string;
	toolCallId: string;
	result: string;
}

// #endregion

// #region 7. LLM 层请求日志（§8）

export type LlmPurpose =
	| 'agent_loop'		// 实例主循环（含重入）
	| 'reflection'		// 反思轮
	| 'ask_child'		// ask_child 的一次性问答
	| 'web_rank'		// web_search 内部的相关性打分（工具发起的独立请求）
	| 'other';

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
	/** 这条记录来自内置 mock（`model` 会是 `mock:<scenario>`）。统计真实用量时应剔除 */
	mock?: boolean;

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

// #endregion

// #region 8. 会话（UI 侧数据模型）

/**
 * 会话的运行状态 —— **三态**，由后端从 `activeRunners` + 根实例 status 现算，不落盘。
 *
 * ⚠️ 为什么不是布尔（`isRunning()`）：「正在跑」其实要分两种活着的状态 ——
 *   - `running`  正在主动产出（LLM 输出 / 工具执行 / 即将重入 agentLoop）
 *   - `waiting` 等待客户端（ask_user / 客户端工具调用）—— 后端根实例 status = `pending`，
 *              仍是「活着」的 run，但不在主动产出，UI 要显示成「等待输入」而不是「运行中」
 *   - `stopped` 已结束（succeeded / failed / interrupted）或 runner 还在 activeRunners
 *              里但根实例已终态（只在 done 到删 runner 之间的极短窗口出现）
 * 没有 run 时是 `undefined`（从未跑过 / runner 已从 activeRunners 删除）。
 *
 * 前端按会话自己读：侧边栏把 running + waiting 都点亮（但视觉可区分），
 * 会话头部据此显示「运行中 / 等待输入」。计算在 http-server.ts 的 GET /api/conversations 里，
 * 真值源是 `AgentRunner.runStatus()`（从根实例 status 推导）。
 */
export type ConversationRunStatus = 'running' | 'waiting' | 'stopped';

/** 会话元信息（列表展示用，不含 ctx） */
export interface ConversationMeta {
	id: string;
	folderId: string;
	title: string;
	modeId: string;
	createdAt: number;
	updatedAt: number;
	/**
	 * 会话头部面包屑的「额外信息」—— 一段**字符串**，由后端按需计算。
	 *
	 * 当前实现：工作目录的 `branch @ shortCommit`
	 * （不是 git 仓库 / 没装 git / 「本地」分组没有 path 时为 undefined）。
	 * 计算逻辑在 storage.ts 的 `getFolderExtraInfo()`，有 TTL 缓存，不落盘。
	 */
	extraInfo?: string;
	/**
	 * 这个会话**当前的运行状态**（后端 `activeRunners` 里有没有它 + 根实例 status）。
	 *
	 * ⚠️ 为什么放在 ConversationMeta 而不是单独一个接口：侧边栏要按「每个任务自己的状态」点亮，需要 per-conversation 的状态量，而列表接口本来就是 per-conversation 的 ——
	 * 顺手带上就行，不必再开一个轮询接口。后端在 `GET /api/conversations` 里现算，不落盘（这是运行态，不是会话数据）。
	 *
	 * ⚠️ 实时性：后端这份只在列表刷新时才回来，在飞期间前端靠 **SSE 事件**（不是本地镜像）实时刷新当前会话的 runStatus —— 见 `runSubscription.ts`。
	 * 切走再回来时，因为订阅跟着会话走、不跟着视图走，回来时 runStatus 已经是新鲜的，不会再出现「切走再回来显示不在运行」。
	 */
	runStatus?: ConversationRunStatus;
}

/**
 * 后端完整会话数据。
 *
 * ⚠️ **没有 `messages` 字段**（2026-09-14 删除）：界面上的内容一律由 ctx 现算 ——
 * 见 `src/mainview/projection.ts` 的 `foldCtxToRenderTree()`。历史遗留的 `Message` /
 * `MessageBlock` / `MessageRole`（前端自己拼一份 UI 转写再回写后端）已一并删除。
 */
export interface ServiceConversation extends ConversationMeta {
	agentCtx?: AgentCtx;
}

/**
 * 文件夹 —— 就是一个工作目录。
 * 作用只有两个：把会话归类，以及把工作目录路径传给 Agent（`AgentRunRequest.runningDir` → 提示词 `{{ runningDir }}`）。
 *
 * - 没有「名字」这个概念：`id` 就是绝对路径本身，显示名由 `folderLabel()` 从路径现算（只看最后一段）。
 * - 「本地」是默认分组：`id === 'local'`、没有 `path`，等于「不给 Agent 传工作目录」。
 */
export interface Folder {
	/** 真实文件夹 = 绝对路径；默认分组固定为 'local' */
	id: string;
	/** 工作目录绝对路径；「本地」没有 */
	path?: string;
	isLocal?: boolean;
}

// #endregion

// #region 9. MCP（Model Context Protocol）

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

// #endregion

// #region 10. 设置

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

/** 开发用 mock：把 LLM 请求转给后端内置的 mock 服务（**工具仍真实执行**） */
export interface MockSettings {
	/** 打开后，**下一次** LLM 请求就发往内置 mock；运行期间禁止切换（见 http-server 的守卫） */
	enabled: boolean;
	/** 剧本名，见 `src/bun/llm/mock.ts` 的 MOCK_SCENARIOS */
	scenario: string;
}

/** 调试配置 */
export interface DebugSettings {
	requestLog: RequestLogConfig;
	/**
	 * 内置 mock 开关。
	 * ⚠️ 声明为可选：老的 settings.json 里 `debug` 只有 requestLog，而 `loadSettings()` 是
	 * **整对象覆盖**（不做深合并），所以运行时它可能就是 undefined —— 读侧一律用 `?.` 防御。
	 */
	mock?: MockSettings;
}

/** 后端完整设置 */
export interface ServiceSettings {
	providers: ModelProvider[];
	currentStandardModel: { providerId: string; modelId: string } | null;
	currentEconomyModel: { providerId: string; modelId: string } | null;
	/**
	 * 基座提示词。所有模式共享，由设置页的「提示词」面板编辑。
	 * **不自动拼进 system prompt**：要不要内嵌由各 Agent 的 prompt.md 里有没有 `{{ basePrompt }}` 决定；
	 * 内嵌时会按当前作用域再渲染一遍（所以这里可以写 `{{platform}}` 之类的变量）。
	 * **没有默认值**：没填就是空串，空串是合法状态（等于不提供基座），代码不会拿任何硬编码文案去补。
	 */
	basePrompt: string;
	folders: Folder[];
	mcpServers: McpServerConfig[];
	debug: DebugSettings;
}

// #endregion