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
 * `src/mainview/logic/projection.ts` 的 `foldCtxToRenderTree()` 从根实例出发，遇到 delegate 工具调用
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
	/** 显式关闭 MCP 工具（默认 false = 跟随 mode 级策略） */
	mcpDisabled?: boolean;
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
	/** 动态状态提示词文件名（相对 agent 目录，默认 `prompt.state.md`）。渲染后仅拼入 LLM 请求尾部，不写入 instance.messages，以保持首条 system 消息不变从而利用 KV Cache */
	statePromptFile?: string;
	/** 由加载器读入的动态状态模板内容（没有文件时为空串） */
	statePrompt?: string;
	/**
	 * 强度指令文件名（可选，相对 agent 目录）。文件存在时**整份替换**模式级 `effort.md`。
	 *
	 * 存在的理由：不同角色的能力范围不同（核对员没有写盘、勘查员不委托），
	 * 一份通用的强度文案只能写到「大家都成立」的粒度；要按角色说事就在自己的目录里放一份。
	 * 没有这个文件时仍然用模式级那份 —— 不需要按角色区分时一个字节都不用写。
	 */
	effortFile?: string;
	/** 由加载器读入的 Agent 级强度指令模板（没有文件时为空串） */
	effortPrompt?: string;
}

/**
 * 模式参数的值：只允许 JSON 里的东西（标量 / 数组 / 对象）。
 *
 * 允许数组与对象是因为参数要能**整段替换**配置：例如「关掉写入类工具」= 用一整份
 * 新的白名单数组覆盖 `ability.tools.allow`（`"allow": "[writeTools]"`）。
 */
export type ParamValue = string | number | boolean | null | ParamValue[] | { [key: string]: ParamValue };

/** 动态表单里一个下拉选项 */
export interface ModeParamOption {
	label: string;
	/** 选中该项时写进变量表 `params[<control.key>]` 的值 */
	value: ParamValue;
	description?: string;
	/**
	 * 选中该项时**额外**覆盖的变量 —— 「一个参数影响多处」就靠它：
	 * 例如「强度 = ultracode」顺带把 `r`（反思次数）、`totalRounds` 一起顶掉。
	 *
	 * ⚠️ 用户手选过的变量不受它覆盖（见 `shared/modeParams.ts` 的两遍规则）。
	 */
	vars?: Record<string, ParamValue>;
}

/**
 * Composer 输入框下方的动态表单项（目前只有下拉，`type` 留作扩展）。
 *
 * 值会写进变量表：`vars[control.key] = 选中项的 value`，然后被
 * `mode.json` / `agent.json` 的 `"[key]"` 与提示词的 `{{ key }}` 消费。
 */
export interface ModeParamControl {
	key: string;
	label: string;
	description?: string;
	/** 目前只支持 'select'；不写等同于 select */
	type?: 'select';
	/** 不在 Composer 下方渲染（只作为变量参与插值），用于纯内部开关 */
	hidden?: boolean;
	/** 默认选中项的值；不写时依次取 `params[key]`、第一个选项 */
	default?: ParamValue;
	options: ModeParamOption[];
}

/**
 * 循环预算 —— mode.json 顶层 `limits`。
 * 三个字段都可不写，兜底值（1000 / 200 / 0）在 runner.getModeLimits() 里。
 *
 * ⚠️ 曾经有过 `subAgentInstanceRounds`（子 Agent 单独一道更紧的上限），2026-10-31 删掉：
 * 它当初是为了兜住弱模型（dots3）子 Agent 独自烧 30 轮的失控，代价是「同一个工序两套预算」，
 * 根实例与子 Agent 的价格观完全对不上。换到收敛正常的模型之后这个补丁是负资产 —— 弱模型应该
 * 整体降一档强度（少轮数 + 强反思），而不是给子 Agent 单开一个数。
 */
export interface ModeLimits {
	totalRounds?: number;			// 一次 run 的总循环上限
	agentInstanceRounds?: number;	// 单个实例（根 / 子一视同仁）的循环上限
	warnAtRemaining?: number;		// 剩余多少次时开始注入告警提示词
}

/**
 * 工具安全性档位 —— **会话级配置**（`chatConfig.safety`），全局只留一份默认模板 `settings.chatDefaults.safety`。
 *
 * 它是横切所有插件 / 模式的一道闸门：换模式不换档位，改某个会话的档位只影响这个会话之后开始的 run。
 * 落点是工具执行层（`service/safety.ts`），与各 Agent 的 `ability.tools` 名单**正交**：
 * 名单决定「这个角色该有哪些工具」（工作流），档位决定「这批工具里有副作用的那部分能不能真跑」。
 *
 * | 档位 | 可见工具 | shell | 删除 |
 * |---|---|---|---|
 * | readonly-strict | 只读 + 编排 | 不提供 | 不提供 |
 * | readonly-smart  | 只读 + shell | 每次 LLM 审核，只放行无副作用命令 | 不提供 |
 * | normal          | 全部 | 直通 | → 系统回收站，无则会话 backups/ |
 * | smart           | 全部 | LLM 审核（拦不可逆 / 越界 / 危险脚本） | → 回收站 |
 * | off             | 全部 | 直通 | 真删 |
 *
 * 提示词里通过 `buildPromptScope` 的内置变量读它：`{{ safety }}` / `{{#if safetyReadOnly}}`。
 */
export type ToolSafety = 'readonly-strict' | 'readonly-smart' | 'normal' | 'smart' | 'off';

/** <modeId>/mode.json —— 模式配置的唯一来源（没有 settings 覆盖层，设置页直接编辑这个文件） */
export interface ModeDefinition {
	id: string;				// 'code' | 'empty'
	name: string;				// '编码' | '空'
	description?: string;
	rootAgent: string;			// agent id，根实例由它创建
	agents: Record<string, AgentDefinition>;
	/** 最大嵌套深度（根实例 depth = 0）。达到后 delegate 工具不再展示给模型 */
	maxDepth: number;
	/** 待办清单：功能开关 + 是否可写（工具层面）。提示词里要不要内嵌，由该 Agent 的 prompt.md 自己决定 */
	todoList?: { enabled: boolean; writable: boolean };
	/** 该模式是否关闭 MCP 工具（默认 false = 开放） */
	mcpDisabled?: boolean;
	/**
	 * 变量默认值表 —— `{ "r": 0, "writeTools": ["file_read"] }`。
	 * 会被 Composer 下方的 `form` 选择覆盖，得到本次 run 生效的变量表（`ModeDefinition.vars`）。
	 * 消费方式见 `shared/modeParams.ts` 顶部说明。
	 */
	params?: Record<string, ParamValue>;
	/** Composer 输入框下方的动态表单（覆盖 `params` 默认值用），由 mode.json 声明 */
	form?: ModeParamControl[];
	/** 循环预算（缺省时用 runner 里的默认值） */
	limits?: ModeLimits;
	ui?: { icon?: string; accent?: string };
	/** ↓ 由运行时填充：本次 run 生效的变量（默认值 + 表单选择 + 选项 vars），见 runner.createRunner */
	vars?: Record<string, ParamValue>;
	/**
	 * 模式级反思提示词（`<modeId>/reflection.md` → 内置默认 逐级回退，
	 * agent 级 reflection.md 存在时整份替换它）。下面两个字段由加载器填充。
	 */
	reflectionPrompt?: string;
	reflectionPromptPath?: string;
	/**
	 * 模式级「强度指令」模板（`<modeId>/effort.md`）。
	 *
	 * ⭐ 它渲染出来的内容**不进 system prompt**，而是每次 LLM 请求**尾部**追加的一条 `role:'system'` 消息
	 * （与 `prompt.state.md` 同位置，排在它前面）。理由见 `docs/架构-插件与模式.md`：
	 * 提示词缓存是「tools → system → messages」三层前缀，改 system 一个字 = 后面整段历史全部 miss；
	 * 而改尾部消息只影响尾部自己。强度因此可以在会话中途切换而**不炸掉缓存**。
	 *
	 * 某个 Agent 目录下放了 `effortFile` 指定的文件时，**整份替换**这份（不做拼接）。
	 */
	effortPrompt?: string;
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
	/** 模式参数：默认变量表 + Composer 下方的动态表单（定义，不是当前选择） */
	params?: Record<string, ParamValue>;
	form?: ModeParamControl[];
	/** mode.json 源码文本 / 路径 —— 设置页的编辑器直接编辑它 */
	modeJson?: string;
	modeJsonPath?: string;
	/** 是否被用户插件覆盖了同名内置模式 */
	overridden?: boolean;
}

// #endregion

// #region 媒体输入（图片 / 视频）

/**
 * - OpenAI Chat：`image_url.url` 可以是 `data:image/png;base64,...`
 * - OpenAI Responses：`input_image.image_url` 同上
 * - Anthropic：`{ type:'image', source:{ type:'base64', media_type, data } }`
 */
export interface LlmImageRef {
	name: string;	// 原始文件名（聊天框里用它指代这张图）
	mime: string;	// image/png、image/jpeg、image/webp、image/gif
	file: string;	// conversations/<id>/attachments/ 内的文件名，真正发给模型时由 runner 读成 `base64` 再交给 llm 层
	size?: number;	// 产物字节数
	base64?: string;
	quality?: ImageQuality;	// 压缩档位（老附件没有这个字段 = 未经过重编码）
	width?: number;
	height?: number;
}

export type ImageQuality = 'low' | 'normal' | 'original';	// 图片压缩档位：低清 = 1/4 宽高 + 长边 512（≈300 token）；普通 = 1/2 宽高 + 长边 1536（≈2000 token）；原图 = 不重编码
export type VideoQuality = 'low' | 'normal' | 'high';	// 视频压缩档位：低清 = 1/4 + 长边 480；普通 = 1/2 + 长边 1280；高清 = 长边 1920；统一按 1fps 重编码
export type VideoCodec = 'h264' | 'h265' | 'av1' | 'h266';	// 视频编码：h266 只是设置页的彩蛋选项，后端一律拒收（见 service/media.ts）

export const IMAGE_QUALITY_VALUES: ImageQuality[] = ['low', 'normal', 'original'];
export const VIDEO_QUALITY_VALUES: VideoQuality[] = ['low', 'normal', 'high'];
export const VIDEO_CODEC_VALUES: VideoCodec[] = ['h264', 'h265', 'av1', 'h266'];

/**
 * 空白会话（还没发第一句、后端没有这个会话）预览媒体时用的占位 conversationId。
 * 它映射到全局 `media-cache/` 目录，**不创建会话记录**；首句发出转成真会话后，
 * 后端把缓存里的 raw / 产物复制进会话附件目录，前端一次都不用重传。
 */
export const DRAFT_MEDIA_CONVERSATION_ID = '__media-draft__';

/** 后端设置里的媒体默认值（全局；每个文件还能在输入框的 Msgbox 里单独改档） */
export interface MediaSettings {
	imageQuality: ImageQuality;
	videoQuality: VideoQuality;
}

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
	imageQuality: 'normal',
	videoQuality: 'normal',
};

/** 设置页 / Msgbox 共用的档位文案（数值与 service/media.ts 的档位表一一对应） */
export const IMAGE_QUALITY_OPTIONS: { value: ImageQuality; label: string; desc: string }[] = [
	{ value: 'low', label: '低清', desc: '四分之一宽高 · 长边 ≤ 512 · 预估 300 token' },
	{ value: 'normal', label: '普通', desc: '二分之一宽高 · 长边 ≤ 1536 · 预估 2000 token' },
	{ value: 'original', label: '原图', desc: '不进行重编码，按原始字节发送' },
];

export const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string; desc: string }[] = [
	{ value: 'low', label: '低清', desc: '四分之一宽高 · 长边 ≤ 480 · 1fps' },
	{ value: 'normal', label: '普通', desc: '二分之一宽高 · 长边 ≤ 1280 · 1fps' },
	{ value: 'high', label: '高清', desc: '长边 ≤ 1920 · 1fps' },
];

export const VIDEO_CODEC_OPTIONS: { value: VideoCodec; label: string; desc: string }[] = [
	{ value: 'h264', label: 'H.264 / AVC', desc: 'preset medium · crf 24' },
	{ value: 'h265', label: 'H.265 / HEVC', desc: 'preset faster · crf 24' },
	{ value: 'av1', label: 'AV1', desc: 'libsvtav1 preset 10 · crf 36' },
	{ value: 'h266', label: 'H.266 / VVC', desc: '（选了会弹窗，不会真的启用）' },
];

/**
 * 一段视频在会话附件目录里的引用。
 * `file` 是按当前档位 + 编码转码后的 mp4 产物：前端 `<video>` 直接读它，
 * 模型也直接收它本体（`video_url` + base64），**不抽帧、不降级成图片**。
 */
export interface LlmVideoRef {
	name: string;
	mime: string;	// video/mp4（转码产物统一 mp4）
	file: string;
	size?: number;
	quality: VideoQuality;
	codec: VideoCodec;
	width?: number;
	height?: number;
	duration?: number;	// 秒
	base64?: string;	// 请求时由 runner 现读，不进 ctx.json
}

/** 前端 prepare 时告诉后端「我要哪个产物」——后端据此拼文件名判重 */
export interface MediaPrepareRequest {
	kind: 'image' | 'video';
	hash: string;	// 前端算的内容 hash，后端用它当文件名
	name: string;
	mime: string;	// 原始文件 mime
	quality: ImageQuality | VideoQuality;
	codec?: VideoCodec;	// 视频才有
}

/** prepare 的结果：命中缓存 / 后端拿已有 raw 直接转码 / 需要前端上传原始字节 */
export interface MediaPrepareResult {
	ok: boolean;
	error?: string;
	needUpload?: boolean;
	cached?: boolean;
	image?: LlmImageRef;
	video?: LlmVideoRef;
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
	reasoningContent?: string;	// 思考模型的推理内容，多轮工具调用时必须回传
	images?: LlmImageRef[];	// 用户消息附带的图片（仅 `supportsVision` 的模型会真正发出去）
	videos?: LlmVideoRef[];	// 用户消息附带的视频（已经转码完成）；只有 supportsVideo 的模型才会带 base64 发给上游
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
 * - `tool_result` / `reflection` 是普通条目的附加信息，仍会进 LLM 上下文
 *   （`tool_result` 解掉「成功/失败靠 `[失败] ` 前缀嗅探」；`reflection` 解掉「反思文本和 system prompt 分不开」）
 */
/**
 * 条目的语义分类：
 * - `tool_result`：工具结果（贴在对应 toolCall 处）
 * - `reflection`：反思轮
 * - `notice`：**系统事件**（预算耗尽 / 用户取消 / 出错…）。它是时间线的一部分，按发生顺序落在
 *   `messages` 里、`uiOnly`（只给界面看，不进 LLM 上下文）。别再往实例上另加「错误时间戳」之类的字段 ——
 *   那样只能把错误补在末尾，时序就乱了（2026-10-27）。
 */
export type MessageKind = 'tool_result' | 'reflection' | 'notice';

/**
 * 实例条目 = LLM 消息 + id + 时间戳 + 可选的结构化载荷。
 *
 * ⚠️ 这份数组是**双重身份**：既是界面转写的唯一真相，又是发给模型的上下文。
 * 所以要区分「界面看、模型不看」的条目（如提问卡片状态），这就是 `uiOnly` 的用途。
 *
 * ⭐ `id` 是条目的**唯一身份**，由**写这条的人**（Runner）分配，全局唯一、永不复用：
 * - SSE 事件用 `messageId` 指着自己属于哪一条 ⇒ 前端不必「猜」这份增量该拼进哪条消息；
 * - 「已提交 ctx」与「在飞 overlay」按 id 抵扣 ⇒ 不需要内容前缀 / 时间窗这类启发式；
 * - 渲染树的 key 由它派生 ⇒ 条目插入 / 删除不会让后面的块 key 错位。
 *
 * ⚠️ 它**不发给模型**：`toLlmMessages()` 会把它剥掉。
 */
export type AgentInstanceMessage = LlmMessage & {
	id: string;
	updatedAt: number;
	/** 只给界面看，组 payload 时过滤掉（见 runner 的 `toLlmMessages()`） */
	uiOnly?: true;
	kind?: MessageKind;
	/** `kind` 对应的结构化载荷 */
	data?: ToolResultInfo | ReflectionInfo;
	/**
	 * 这次 LLM 调用的账本，挂在**这次调用的产出物**上（assistant 条目 / 反思条目）。
	 *
	 * 为什么不做成一条独立的 `role:'system'` 条目：usage 本来就是「某一次 LLM 调用附带的一条数据」，
	 * 拆成独立条目后投影只能把它平铺进转写，界面上就出现一堆与调用脱节的流水，与「一次调用一个块」冲突。
	 *
	 * 由 runner 在 push 产出物时直接从 callLlm 返回值构造，不再经过全局 emitter 中转。
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

/** ask_user 工具结果的结构化字段：提问卡片的状态（不再靠字符串比对） */
export interface AskUserStructured {
	askUserStatus: 'waiting' | 'answered' | 'skipped';
	askUserAnswer?: string;
}

/** `kind: 'tool_result'` 的载荷：工具结果的终态信息 */
export interface ToolResultInfo {
	success: boolean;
	/** 工具返回的结构化字段（如 delegate 的 `childAgentInstanceIds` / `status`，ask_user 的 `askUserStatus` / `askUserAnswer`，渲染要用） */
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
	/** 历次 finish 提交的总结（完成后仍可被重新唤醒接续，所以是数组） */
	summaries?: string[];
	/** 剩余反思次数（创建时 = AgentDefinition.reflectionCount ?? 0） */
	reflectionsRemaining: number;
	/** 本实例消耗的 agentLoop 轮数 */
	rounds: number;
	/**
	 * 本实例**终身**累计发起过多少次 LLM 请求（由 runner 在每次 callLlm 后累加）。
	 *
	 * ⚠️ 界面**不读**它：根实例永续（一个会话一个根），终身数字显示在发言末尾会被误读成
	 * 「这一句话就花了这么多」。界面用投影按「本次发言区间」现算的 `RunUsage`（见 projection.ts）。
	 */
	llmCalls: number;
	childAgentInstanceIds: string[];
	/**
	 * 本实例**终身**累计 token（由 runner 在每次 callLlm 后累加）。
	 *
	 * ⚠️ 只存不读（2026-10-27 起）：保留它是为了将来做「会话总消耗」之类的统计；
	 * 界面的运行摘要已改为按本次发言区间求和（`RunUsage`），不要再拿它渲染。
	 */
	tokens?: TokenUsage;
	startedAt: number;
	lastUpdatedAt?: number;
	/** 中断 / 失败原因（供父实例的「尚未完成的子 Agent」段落展示；界面上的那条由 `kind:'notice'` 的消息承载） */
	interruptReason?: string;
	/** 动态状态快照：key → 上次序列化值，用于 buildPromptScope 计算 stateChanged */
	stateSnapshot?: Record<string, string>;
}

export interface RunBudget {
	/** 本轮 run 的总轮数上限 */
	total: number;
	/** 已消耗（含全部子实例） */
	spent: number;
}

/**
 * 后台任务状态。
 * - `running`：进程还活着
 * - `completed`：正常退出（exit 0）
 * - `failed`：异常退出（非 0 / 被信号杀死 / 起不来）
 * - `stopped`：用户手动停止（工具 stop 或侧栏按钮）
 */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

/**
 * 后台任务（`background_start` 拉起的常驻 shell）。
 *
 * ⚠️ 进程本体活在 Service 内存里（`service/background.ts`），这里只存**元信息**，
 * 随 ctx 落盘 —— 服务重启后进程已经没了，靠这份记录把「曾经有过什么任务」讲清楚。
 */
export interface BackgroundTask {
	id: string;
	command: string;	// 实际执行的命令
	description: string;	// 启动时说明的用途（模型给的 reason / description）
	status: BackgroundTaskStatus;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	exitCode?: number | null;
	pendingNotify?: boolean;	// 进程已结束、但还没在「下一轮 system message」里告知模型（告知后清掉）
	agentInstanceId?: string;	// 发起它的 Agent 实例
}

export interface AgentCtx {
	conversationId: string;
	modeId: string;
	rootAgentInstanceId: string;
	agentInstances: Record<string, AgentInstance>;
	/** 扁平事件流（UI 渲染 / 审计用，体量小，不含完整消息体） */
	events: AgentEvent[];
	/** 待办清单（纯文本，checkbox 行） */
	todoList: string;
	/** 本轮 run 的循环预算。每次 POST /api/agent/run 重置 */
	budget: RunBudget;
	/** 后台任务（本会话的所有常驻进程，含已结束的；进程本体在 Service 内存里） */
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

/**
 * 工具对**调度器**的处置要求。普通工具不设（= 结果当场可用，照常重入）。
 *
 * 这是调度器判断「这个 call 之后该干什么」的唯一信号 —— 以前它是 `structured['__orchestrator']` 这种魔法键 + `structured.status === 'pending'` 两套路子，全靠字符串约定串联。
 * ⚠️ `structured` 是给**界面**看的（渲染嵌套树 / 成功失败），两者不是一回事，别互相嗅探。
 */
export type ToolControl =
	| { kind: 'finish'; summary: string }
	| { kind: 'ask_user'; args: AskUserArgs }
	| { kind: 'await_child' };

/** 工具调用的标准化结果 */
export interface ToolResult {
	success: boolean;
	content: string;
	/** 给界面看的结构化字段（如 delegate 的 `childAgentInstanceIds` / `status`） */
	structured?: Record<string, unknown>;
	error?: string;
	/** 给调度器看的处置要求（见 `ToolControl`）。不进 LLM 上下文，也不下发给界面 */
	control?: ToolControl;
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

/**
 * Agent 流式输出事件（SSE 推送）。
 */
export type AgentStreamEvent = StreamEventBase & (
	| { type: 'text'; agentInstanceId: string; messageId: string; chunk: string }
	| { type: 'reasoning'; agentInstanceId: string; messageId: string; chunk: string }
	| { type: 'tool_start'; agentInstanceId: string; messageId: string; callId: string; toolName: string; args: unknown; reason: string }
	| { type: 'tool_end'; agentInstanceId: string; messageId: string; callId: string; toolName: string; result: ToolResult }
	| { type: 'agent_start'; agentInstanceId: string; messageId: string; parentAgentInstanceId?: string; agentId: string; agentName: string; depth: number; task?: string; images?: LlmImageRef[]; videos?: LlmVideoRef[] }
	| { type: 'agent_end'; agentInstanceId: string; status: 'succeeded' | 'failed' | 'interrupted'; summary?: string }
	| { type: 'client_tool_call'; agentInstanceId: string; callId: string; toolName: string; args: unknown; needResponse: boolean }	// 需要客户端响应的工具（ask_user）。参考 langchain-aliyun 的 client_tool_call
	| { type: 'reflection_start'; agentInstanceId: string; messageId: string; remaining: number }
	| { type: 'reflection_chunk'; agentInstanceId: string; messageId: string; chunk: string }
	| {
		type: 'usage';
		agentInstanceId?: string;
		messageId: string;	// 这笔账挂在哪个条目上（主调用 = 那条 assistant；反思 = 那条 reflection）
		logId?: string;
		tokens: TokenUsage;
		seq?: number;
		round?: number;
		purpose?: string;
		agentName?: string;
		depth?: number;
		durationMs?: number;
		model?: string;
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
	supportsVision?: boolean;
	supportsVideo?: boolean;
	fullUrl?: boolean;	// 勾选「完整 URL」：baseUrl 即完整端点，请求时不再补 /v1 与接口路径
	/**
	 * 本次请求要写的思考强度：`param` 是模型设置里的参数名（支持 `a.b` 嵌套路径），
	 * `value` 是用户在下拉框三级菜单里选的档位。不选 = undefined（不传，走模型默认）。
	 */
	thinking?: { param: string; value: string };
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
	/**
	 * 用户本轮附带的图片（**已经是上传到服务器的附件引用**，不是本地路径）。
	 * 前端先 `POST /api/conversations/:id/attachments` 把字节传进会话附件目录，
	 * 这里只带 `{ name, mime, file, size }`；ctx 里只存引用，请求时才读成 base64。
	 */
	images?: LlmImageRef[];
	videos?: LlmVideoRef[];
	/**
	 * Composer 下方动态表单的选择（`{ [controlKey]: 选项 value }`）。
	 * 后端用它覆盖 `mode.json` 的 `params` 默认值；不传 = 全用默认。
	 */
	params?: Record<string, ParamValue>;
	/**
	 * 本轮生效的聊天配置（会话级）。后端在开跑时固化进 `conversations/<id>/ctx.json` 的 `chatConfig`，
	 * 并从中取 `safety` 作为本次 run 的工具闸门；不传时退回全局 `settings.chatDefaults`。
	 */
	chatConfig?: ChatConfig;
}

/** ask_user 中单个问题的定义 */
export interface AskUserQuestion {
	question: string;
	/** 选择模式：single = 单选（默认），multi = 多选 */
	selectionMode?: 'single' | 'multi';
	/** 选项（每个可带描述）；为空时该问题只接受自由输入 */
	options?: { label: string; description?: string }[];
}

/** ask_user 的参数 */
export interface AskUserArgs {
	/** 0~多个问题；为空时前端只给自由输入 */
	questions: AskUserQuestion[];
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
	| 'safety_review'	// 工具安全闸门里的 shell 命令审核（工具发起的独立请求）
	| 'other';

/** 什么导致了这次请求 */
export type LlmTriggerReason =
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
	trigger?: LlmTriggerReason;
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
		/**
		 * 尾部 system 消息（effort.md 的强度指令 / prompt.state.md 的动态状态）的字数与哈希。
		 * 它们拼在 messages 尾部，**不属于缓存前缀**，所以和 systemPromptHash 分开记 ——
		 * 混在一起会把「尾部每轮正常变化」误判成「前缀失效」。
		 */
		tailSystemChars?: number;
		tailSystemHash?: string;
		totalChars: number;
		stream: boolean;
		/**
		 * 发给 LLM 的 messages **全文**（含拼接后的 system / 状态提示词）。
		 * 只在 `settings.debug.requestLog.level === 'full'` 时记录 —— ctx 里的记录是节选，
		 * 想复现「模型到底看到了什么」只能靠它。
		 */
		messages?: LlmMessage[];
	};

	// ---- 结果 ----
	/**
	 * 模型这次**回了什么**（正文 / 思考全文）。
	 * 只在 `settings.debug.requestLog.level === 'full'` 时记录 —— 等级「仅输入」只留 messages 不留它。
	 */
	response?: {
		text?: string;
		reasoning?: string;
	};

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
	level?: RequestLogLevel;
}

/**
 * 请求日志的详细程度：
 * - `default`：只留形状（条数 / 字符数 / 用量），正文一概不落盘
 * - `input`：额外落 `request.messages` 全文 —— 能看「模型看到了什么」，但看不到它回了什么
 * - `full`：再额外落 `response.text` / `response.reasoning` —— 入参与输出都完整
 */
export type RequestLogLevel = 'default' | 'input' | 'full';

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

/** 模型引用。不存完整 ModelConfig —— 那是每轮 run 按当前 providers 现算出来的 */
export interface ModelRef {
	providerId: string;
	modelId: string;
}

/**
 * 聊天配置 —— Composer 那几颗 chip（模式 / 模型 / 强度 / 安全性）的完整状态。
 *
 * ⚠️ 真相在后端，前端只是内存镜像：
 *   · `settings.chatDefaults` = 新会话的默认模板（全局）
 *   · `conversations/<id>/ctx.json` 顶层的 `chatConfig` = 这一会话自己的快照
 * 切会话从列表下发的 meta 里读回，改 chip 时 PUT 回该会话；新建会话拿默认模板克隆一份。
 * ⛔ 不写 localStorage —— 这些是会话数据，不是本机界面偏好。
 */
export interface ChatConfig {
	modeId: string;
	standardModel: ModelRef | null;
	economyModel: ModelRef | null;
	/** key = `providerId/modelId`，value = 思考强度档位；缺省 = 「默认（不传参数）」 */
	thinkingLevels: Record<string, string>;
	/** Composer 下方 form 控件的选择，按 modeId 分组 */
	modeParams: Record<string, Record<string, ParamValue>>;
	safety: ToolSafety;
}

/** 聊天配置的兜底值（老会话缺 chatConfig、或 Service 还没连上时用） */
export const DEFAULT_CHAT_CONFIG: ChatConfig = {
	modeId: 'code',
	standardModel: null,
	economyModel: null,
	thinkingLevels: {},
	modeParams: {},
	safety: 'normal',
};

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
	/**
	 * 这一会话当前用的聊天配置（模式 / 模型 / 强度 / 安全性）。
	 * 存在 ctx.json 顶层，列表接口顺手带回：切会话时前端从 meta 里同步读回，不必再发一次请求。
	 * 老会话没有这个字段 = 用 `settings.chatDefaults` 兜底。
	 */
	chatConfig?: ChatConfig;
}

/**
 * 后端完整会话数据。
 *
 * ⚠️ **没有 `messages` 字段**（2026-09-14 删除）：界面上的内容一律由 ctx 现算 ——
 * 见 `src/mainview/logic/projection.ts` 的 `foldCtxToRenderTree()`。历史遗留的 `Message` /
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

/** HTTP 传输时由本应用代拉的进程（保活用，见 mcp/manager.ts 的 ensureAlive） */
export interface McpLaunchConfig {
	command: string;	// 可执行文件（node / python 等），Windows 上会自动补 .cmd 后缀
	args?: string[];
	env?: Record<string, string>;	// 与 process.env 合并，优先级更高
	cwd?: string;
}

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
	launch?: McpLaunchConfig;	// http: 探测不到时由本应用拉起该进程
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

/** 思考强度参数名的默认值（OpenAI 兼容接口普遍用 reasoning_effort） */
export const DEFAULT_THINKING_PARAM = 'reasoning_effort';

/** 模型提供商（完整配置） */
export interface ModelProvider {
	id: string;
	name: string;
	apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	fullUrl?: boolean;	// 勾选「完整 URL」：baseUrl 即完整端点，请求时不再补 /v1 与接口路径
	models: ModelProviderModel[];
	customParams: Record<string, unknown>;
}

export interface ModelProviderModel {
	id: string;
	displayName: string;
	role: 'standard' | 'economy';
	customParams?: Record<string, unknown>;
	contextWindow?: { input?: number; output?: number };
	supportsVision?: boolean;
	supportsVideo?: boolean;
	videoCodec?: VideoCodec;	// supportsVideo 时生效，缺省按 h264
	thinking?: { param: string; values: string[] };
}

/** 测试连通性的结果（`POST /api/settings/test-model`） */
export interface ModelTestResult {
	ok: boolean;
	latencyMs: number;	// 往返耗时（ms）
	status?: number;	// 上游 HTTP 状态码（连不上时没有）
	message: string;	// 成功时是简短说明，失败时是错误摘要
}

/** 开发用 mock：把 LLM 请求转给后端内置的 mock 服务（**工具仍真实执行**） */
export interface MockSettings {
	/** 打开后，**下一次** LLM 请求就发往内置 mock；运行期间禁止切换（见 http-server 的守卫） */
	enabled: boolean;
	/** 剧本名，见 `src/service/llm/mock.ts` 的 MOCK_SCENARIOS */
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

// #region 11. 用户与登录（照抄 FFBox 的 serviceBridge 鉴权模型）

/**
 * 权限项。本项目只开放一项「用户管理」。
 * 值用驼峰字符串（与 FFBox 一致），存进 settings.json 的 users[].permissions。
 */
export type Permission = 'userManagement';

/** 全部权限（新用户默认无权限；空用户名的管理员默认全有） */
export const ALL_PERMISSIONS: Permission[] = ['userManagement'];

/** 权限的中文标签（设置页 / 提示文案共用） */
export const PERMISSION_LABELS: Record<Permission, string> = {
	userManagement: '用户管理',
};

/** 一个用户（持久化在 settings.json 的 users 里） */
export interface UserConfig {
	username: string;	// 空字符串 = 管理员账号（仅在无密码时可空账号登录）
	passkey: string;	// SHA-256 十六进制摘要；空串 = 该账号无密码
	permissions: Permission[];	// 权限列表。空数组 = 已配置但无权限
}

/**
 * 未配置任何用户时的默认账号：空用户名（管理员）、无密码、全部权限。
 * 放在 shared 里是因为 storage（出厂默认值）与 auth（读侧回落）都要用它，
 * 而这两个模块互相 import 会成环。
 */
export function defaultUsers(): UserConfig[] {
	return [{ username: '', passkey: '', permissions: [...ALL_PERMISSIONS] }];
}

/** 登录结果（POST /api/auth/login 的响应体） */
export interface LoginResult {
	isUserExist: boolean;
	isSuccess: boolean;
	sessionId?: string;
	permissions?: Permission[];
}

/** 当前登录态（GET /api/auth/session 的响应体） */
export interface AuthInfo {
	username: string;
	permissions: Permission[];
	anonymous?: boolean;	// true = 无密码放行的匿名访问（尚未配置密码的管理员）
}

// #endregion

/** 后端完整设置 */
export interface ServiceSettings {
	providers: ModelProvider[];
	/**
	 * 新会话的默认聊天配置（模式 / 模型 / 强度 / 安全性）。
	 * ⚠️ 它只是**模板**：每个会话在 ctx.json 的 `chatConfig` 里存自己的一份，互不影响。
	 * 老的 settings.json 里 `currentStandardModel` / `currentEconomyModel` / `safety` 三个顶层字段
	 * 由 `loadSettings()` 迁移到这里。
	 */
	chatDefaults: ChatConfig;
	/**
	 * 基座提示词。所有模式共享，由设置页的「提示词」面板编辑。
	 * **不自动拼进 system prompt**：要不要内嵌由各 Agent 的 prompt.md 里有没有 `{{ basePrompt }}` 决定；
	 * 内嵌时会按当前作用域再渲染一遍（所以这里可以写 `{{platform}}` 之类的变量）。
	 * **没有默认值**：没填就是空串，空串是合法状态（等于不提供基座），代码不会拿任何硬编码文案去补。
	 */
	basePrompt: string;
	/** 图片 / 视频输入的默认压缩档位（设置页「媒体」Tab） */
	media: MediaSettings;
	folders: Folder[];
	mcpServers: McpServerConfig[];
	/** 用户列表（见 §11）。缺字段时按「空用户名的管理员、无密码、全权限」处理 */
	users: UserConfig[];
	debug: DebugSettings;
}

/**
 * `GET /api/settings/snapshot` 的响应：一次拿齐所有「纯数据」设置。
 * 不含 users（要权限）、mode.json（在插件目录）、MCP 运行态（内存），也不含任何有写副作用的字段。
 * `loadBackendState()` 只发这一个设置类请求，其余是 /api/modes、/api/conversations、/api/health。
 */
export interface SettingsSnapshot {
	providers: ModelProvider[];
	chatDefaults: ChatConfig;
	basePrompt: string;
	media: MediaSettings;
	folders: Folder[];
	mcpServers: McpServerConfig[];
	/** 内置 mock 开关 + 后端给的剧本清单（debug.mock） */
	mock: { enabled: boolean; scenario: string; scenarios: { id: string; label: string }[] };
}

/**
 * `PATCH /api/settings` 的请求体：**只写请求里出现的 key**。
 * 前端按「与上次保存的快照逐字段比对」收集脏字段，避免把别的窗口刚改过的字段用旧值盖回去。
 * mcp-servers 不在这里（PUT 必须 await syncAll），users / safety / mock / request-log 各有独立接口。
 */
export interface SettingsPatch {
	providers?: ModelProvider[];
	chatDefaults?: ChatConfig;
	basePrompt?: string;
	media?: MediaSettings;
	folders?: Folder[];
}

// #endregion
