/* ==========================================================================
   模型适配器 — MindTheGap-Harness（LLM 层）

   轻量级 LLM 调用封装：直接 fetch + SSE，支持三种 API 格式
   （OpenAI Chat Completions / OpenAI Responses / Anthropic）。

   本文件是 **requestLog 的唯一埋点**（§8）：
   callLlm() 内部 begin / end，用 finally 保证异常或 abort 也落一条终态记录。
   调用方（runner / 工具）拿到返回值时，日志已经写完了。

   从 agent 目录迁入本目录（本次重构唯一的目录结构变化）。
   ========================================================================== */

import type { LlmMessage, LlmTool, LlmToolCall, ModelConfig, ModelTestResult, TokenUsage, LlmPurpose, LlmTriggerReason, LlmRequestRecord } from '@shared/agent';
import { logMsg, safeParseJson } from '../../shared/utils';
import { allocateLogId, appendRequestRecord, dumpPayload, getRequestLogOptions } from './requestLog';

// #region 类型

export interface LlmToolCallDelta {
	id?: string;
	name?: string;
	argumentsDelta?: string;
	index: number;
}

export interface LlmResponseChunk {
	/** 文本增量 */
	textDelta?: string;
	/** 思考模型的推理增量（DeepSeek thinking 模式） */
	reasoningDelta?: string;
	/** 工具调用增量（流式时逐段追加） */
	toolCallDelta?: LlmToolCallDelta;
	/** 同一次 delta 里含多条工具调用（DeepSeek 会这样发）——与 toolCallDelta 二选一 */
	toolCallDeltas?: LlmToolCallDelta[];
	/** 一次工具调用参数已完整（非流式路径用） */
	toolCallComplete?: { id: string; name: string; arguments: Record<string, unknown> };
	/** 本轮的结束原因（流式末块携带） */
	finishReason?: string;
	/** 完成标志 */
	done?: boolean;
	/** 最终 Token 用量 */
	usage?: TokenUsage;
	error?: string;
}

export interface LlmCallResult {
	text: string;
	reasoningContent: string;
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
	usage: TokenUsage;
	finishReason?: string;
	logId: string;
	seq: number;
	durationMs: number;
	modelId: string;
}

/**
 * 解析层的产出：`logId` / `seq` / `durationMs` / `modelId` 由 `callLlm` 在返回处统一补齐
 * （只有它才知道这些元信息），三个 `stream*` 与两个 `parse*` 都不碰。
 */
export type ParsedLlmResult = Omit<LlmCallResult, 'logId' | 'seq' | 'durationMs' | 'modelId'>;

export interface LlmRequest {
	config: ModelConfig;
	messages: LlmMessage[];
	tools?: LlmTool[];
	onChunk?: (chunk: LlmResponseChunk) => void;
	signal?: AbortSignal;
	/**
	 * 要求模型输出结构化内容（目前只有 openai-chat 会落地成 response_format）。
	 * 其他协议没有等价字段，靠提示词约束——调用方要自己做「解析失败就降级」。
	 */
	responseFormat?: Record<string, unknown>;
}

// #region 超时保护

/**
 * LLM 请求超时。
 *
 * 它不是用户取消（`AbortError`）：runner 的 `callLlmWithRetry` 靠 `name` 认出它是**瞬时**错误并重试，
 * 所以一次网络抖动不会直接判掉这一轮 —— 重试也超时才算本轮失败。
 *
 * 只有两种：`idle`（上游迟迟不吐字节，或吐着吐着断了）与 `total`（一字节一字节地慢慢滴，总时长失控）。
 * 首字节与「流式中途静默」合成一档：两者的判据都是「一段时间内没有任何数据」，分开只会多一个枚举
 * 和一次重复的计时器重置 —— 真正的区别（吐没吐过东西）由 `received` 一个布尔值说清就够了。
 */
export class LlmTimeoutError extends Error {
	kind: 'idle' | 'total';
	timeoutMs: number;
	received: boolean;
	constructor(kind: 'idle' | 'total', timeoutMs: number, received: boolean) {
		super(
			kind === 'idle'
				? `LLM request timeout：${timeoutMs}ms 内没有收到任何数据（${received ? '流式中断' : '尚未开始输出'}）`
				: `LLM request timeout：整次请求超过上限 ${timeoutMs}ms 仍未结束`,
		);
		this.name = 'LlmTimeoutError';
		this.kind = kind;
		this.timeoutMs = timeoutMs;
		this.received = received;
	}
}

/**
 * 上游 HTTP 成功、流里却一个字节都没有（实测 packy 中转约 4 次里 1 次：`text/event-stream` + 空 body）。
 *
 * 解析层看不出这是故障，它拿到的是「空文本 + 零工具调用 + 零用量」；而 runner 的轮次结束条件正是
 * 「这一轮没有工具调用」——于是整次 run 什么都没做，却被标成 succeeded，交付正文是 `(无输出)`。
 * 这比直接报错更贵：用户和判分都以为它干完了。所以在这里把它当**瞬时错误**抛出去，交给重试。
 *
 * 只在 `purpose='agent_loop'` 上判：反思的「空输出」是合法哨兵（表示没有要补的缺口），不是故障。
 */
export class LlmEmptyResponseError extends Error {
	logId: string;
	constructor(logId: string) {
		super('LLM 空响应：请求成功但没有返回任何文本、工具调用或 token 用量');
		this.name = 'LlmEmptyResponseError';
		this.logId = logId;
	}
}

export interface LlmTimeouts {
	idleMs: number;	// 两次数据之间允许的最长静默（起点是发出请求那一刻）
	totalMs: number;	// 整次请求的总上限（兜底「每段都不超 idle，但总时长失控」）
}

/**
 * 超时取值。默认值留得很宽（3 分钟没有新字节已经远超正常水平），
 * 宁可慢一点也不要把正常的大上下文请求误判成超时 —— 误判的代价是这一轮白跑加一次重试。
 * 环境变量覆盖只用于压测与本地调试（`artifacts/e2e/probe-llm-timeout.mjs`）。
 */
export function resolveLlmTimeouts(): LlmTimeouts {
	const num = (name: string, fallback: number) => {
		const n = Number(process.env[name]);
		return Number.isFinite(n) && n > 0 ? n : fallback;
	};
	return {
		idleMs: num('MTG_LLM_TIMEOUT_MS', 180_000),
		totalMs: num('MTG_LLM_TIMEOUT_TOTAL_MS', 900_000),
	};
}

// #endregion

/** 调用方只需提供元信息；形状 / 用量由 callLlm 自己补齐 */
export interface LlmCallMeta {
	conversationId: string;
	purpose: LlmPurpose;
	agentInstanceId?: string;
	/** 冗余的归属信息（runner 直接传入，避免 llm 层反向依赖 ctx） */
	agentId?: string;
	agentName?: string;
	depth?: number;
	modeId?: string;
	trigger?: LlmTriggerReason;
	triggeredByCallIds?: string[];
	agentInstanceRound?: number;
}

// #endregion

// #region 公共工具

function buildHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`,
		...extra,
	};
}

/**
 * 拼接流式请求的完整 URL。
 *
 * 1. 去掉 baseUrl 尾部多余斜杠，避免出现 `https://host//v1/...`
 * 2. 若 baseUrl 中尚未包含 `/v1` 路径段，则自动补上
 *    （DeepSeek 等兼容 OpenAI 的端点要求 `/v1` 前缀）
 * 3. 去掉 endpoint 开头多余斜杠，保证最终拼接结果唯一
 */
function genStreamUrl(baseUrl: string, endpoint: string): string {
	let u = baseUrl.replace(/\/+$/, '');
	if (!u.includes('/v1') && !u.includes('/v1/')) {
		u = u + '/v1';
	}
	const e = endpoint.replace(/^\/+/, '');
	return `${u}/${e}`;
}

/** 简易字符串指纹（djb2），用来比对「拼接结果变了没有」 */
function hashString(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

/**
 * 从 OpenAI Chat Completions 的 usage 里取「命中缓存的输入 token 数」。
 *
 * 各家用的字段名不一样，实测（2026-10-31）：
 * - 标准字段 `prompt_tokens_details.cached_tokens`：OpenAI / DeepSeek / 小米 / 小红书 / 各类中转站都认
 * - DeepSeek 官方额外给一份 `prompt_cache_hit_tokens`，做兜底
 * - 小米**首次未命中时该对象是 `null`**（不是缺字段），所以必须可选链
 * - 小红书同时给 `cached_read_tokens` 别名，标准字段也在，不用单独处理
 *
 * 注意语义：cached 是 prompt_tokens 的**子集**（不额外相加），与界面「↑input + 缓存 N」一致。
 */
function openAiChatCachedTokens(usage: any): number | undefined {
	const std = usage?.prompt_tokens_details?.cached_tokens;
	if (typeof std === 'number') return std;
	const ds = usage?.prompt_cache_hit_tokens;
	return typeof ds === 'number' ? ds : undefined;
}

/**
 * Anthropic 的 usage → 内部 TokenUsage。
 *
 * ⚠️ 语义与 OpenAI 相反：`input_tokens` **只算最后一个 cache breakpoint 之后的未缓存部分**，
 * 总输入 = input_tokens + cache_read_input_tokens + cache_creation_input_tokens。
 * 不把它们加起来，界面上「↑input」在两种协议之间就没法比。
 */
function anthropicUsageToTokenUsage(usage: any): TokenUsage | undefined {
	if (!usage || typeof usage.input_tokens !== 'number') return undefined;
	const read = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
	const created = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
	return {
		input: usage.input_tokens + read + created,
		inputCached: read,
		output: usage.output_tokens,
	};
}

// #endregion

// #region OpenAI Chat Completions

async function streamOpenAiChat(
	config: ModelConfig,
	messages: LlmMessage[],
	tools: LlmTool[],
	onChunk: (chunk: LlmResponseChunk) => void,
	signal?: AbortSignal,
	responseFormat?: Record<string, unknown>,
): Promise<ParsedLlmResult> {
	/**
	 * 内部 LlmMessage → OpenAI Chat Completions wire 格式。
	 * 关键：内部用 toolCalls/toolCallId，协议要求 tool_calls/tool_call_id，
	 * 字段名不转换会直接 400（"missing field tool_call_id"）。
	 */
	function toOpenAiWireMessages(list: LlmMessage[]): Array<Record<string, unknown>> {
		return list.map((msg) => {
			if (msg.role === 'tool') {
				return {
					role: 'tool',
					content: msg.content,
					tool_call_id: msg.toolCallId,
				};
			}
			if (msg.role === 'assistant') {
				// ⚠️ 请求里只要带 tools，DeepSeek 思考模式就要求**每一条 assistant 消息都带
				// reasoning_content 字段**——字段缺失（不是值为空）即 400：
				//   "The `reasoning_content` in the thinking mode must be passed back to the API."
				// 实测空串 `''` 也能通过，所以这里无条件写出该字段。
				// 早先写成「仅当有 tool_calls 时才带上」，一旦历史里留下纯文本的 assistant 消息
				// （v2 反思轮重入必然产生）后续请求就全 400。
				const out: Record<string, unknown> = {
					role: 'assistant',
					content: msg.content ?? '',
					reasoning_content: msg.reasoningContent ?? '',
				};
				if (msg.toolCalls?.length) {
					out.tool_calls = msg.toolCalls.map((toolCall) => ({
						id: toolCall.id,
						type: 'function',
						function: {
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						},
					}));
				}
				return out;
			}
			return { role: msg.role, content: msg.content };
		});
	}

	const url = genStreamUrl(config.baseUrl, 'chat/completions');
	const body: Record<string, unknown> = {
		model: config.modelId,
		messages: toOpenAiWireMessages(messages),	// 必须转 wire 格式（tool_call_id 等）
		// ⚠️ 必须开流式 + 带 usage。早先这里写的是 `stream: false`，注释声称
		// 「Cottontail ReadableStream 不工作，先非流式」——那是早期误判，实测不成立：
		// 在 cottontail 0.5.0 里 `fetch()` 返回标准 ReadableStream，`getReader()` 能逐块读，
		// 本地慢速 SSE 探针（artifacts/e2e/probe-stream.mjs）确认分块到达。
		// 代价是关掉流式后整段文字一次性到达，界面上完全看不到进度。
		stream: true,
		stream_options: { include_usage: true },	// 否则流式响应里拿不到 usage
	};
	if (tools.length > 0) body.tools = tools;
	if (responseFormat) body.response_format = responseFormat;
	if (config.customParams) Object.assign(body, config.customParams);

	const resp = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config.apiKey),
		body: JSON.stringify(body),
		signal,
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => resp.statusText);
		throw new Error(`OpenAI Chat API error ${resp.status}: ${text}`);
	}

	// 正常路径：逐块读 SSE，文本增量即时交给 onChunk → runner 转 SSE → 前端逐字渲染
	if (resp.body && typeof (resp.body as ReadableStream<Uint8Array>).getReader === 'function') {
		return await parseSseStream(resp.body as ReadableStream<Uint8Array>, parseOpenAiChatDelta, onChunk);
	}

	// 兜底：运行时没提供 body（实测 cottontail 会提供，留此以防换运行时）
	const json = await resp.json();
	return parseOpenAiChatFullResponse(json, onChunk);
}

/**
 * 一次性 JSON 响应的解析（非流式兜底路径）。
 * 与流式路径产出同样的 LlmCallResult，调用方无感。
 */
function parseOpenAiChatFullResponse(json: any, onChunk: (chunk: LlmResponseChunk) => void): ParsedLlmResult {
	const result: ParsedLlmResult = { text: '', reasoningContent: '', toolCalls: [], usage: {} };

	const choice = json.choices?.[0];
	if (choice) {
		if (typeof choice.finish_reason === 'string') result.finishReason = choice.finish_reason;
		const msg = choice.message ?? {};
		// 思考模型的推理内容（多轮工具调用时必须保存并回传）
		if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
			result.reasoningContent = msg.reasoning_content;
		}
		if (msg.content) {
			result.text = msg.content;
			onChunk({ textDelta: msg.content });
		}
		if (msg.tool_calls?.length) {
			for (const tc of msg.tool_calls) {
				const argsStr = typeof tc.function?.arguments === 'string'
					? tc.function.arguments
					: JSON.stringify(tc.function?.arguments ?? '');
				const args = safeParseJson(argsStr) ?? {};
				result.toolCalls.push({
					id: tc.id,
					name: tc.function?.name ?? '',
					arguments: args,
				});
				onChunk({
					toolCallComplete: {
						id: tc.id,
						name: tc.function?.name ?? '',
						arguments: args,
					},
				});
			}
		}
	}

	if (json.usage) {
		result.usage = {
			input: json.usage.prompt_tokens,
			inputCached: openAiChatCachedTokens(json.usage),
			output: json.usage.completion_tokens,
			total: json.usage.total_tokens,
		};
		onChunk({ usage: result.usage });
	}

	onChunk({ done: true });
	return result;
}

function parseOpenAiChatDelta(line: string): LlmResponseChunk | null {
	if (!line.startsWith('data:')) return null;
	const data = line.slice(5).trim();
	if (data === '[DONE]') return { done: true };

	try {
		const json = JSON.parse(data);
		const chunk: LlmResponseChunk = {};

		// ⚠️ 开了 stream_options.include_usage 之后，**最后一个数据块是 `choices: []` + `usage`**。
		// 早先这里先判断 `if (!choice) return null`，会把带 usage 的末块整个丢掉，
		// 结果是流式下 token 用量永远是 0（请求日志和界面统计一起失真）。
		if (json.usage) {
			chunk.usage = {
				input: json.usage.prompt_tokens,
				inputCached: openAiChatCachedTokens(json.usage),
				output: json.usage.completion_tokens,
				total: json.usage.total_tokens,
			};
		}

		const choice = json.choices?.[0];
		if (!choice) return chunk.usage ? chunk : null;

		const delta = choice.delta ?? {};
		if (delta.content) chunk.textDelta = delta.content;
		// 思考模型的推理增量（不接住的话 reasoningContent 落盘永远是空串）
		if (delta.reasoning_content) chunk.reasoningDelta = delta.reasoning_content;
		if (choice.finish_reason) chunk.finishReason = choice.finish_reason;

		if (delta.tool_calls?.length) {
			// 一次 delta 可能带多条 tool_call（并行调用），全部转出去，
			// 只取 [0] 会导致后续参数被静默丢弃、工具参数解析残缺。
			chunk.toolCallDeltas = delta.tool_calls.map((tc: any) => ({
				id: tc.id,
				name: tc.function?.name,
				argumentsDelta: tc.function?.arguments,
				index: tc.index ?? 0,
			}));
		}

		return chunk;
	} catch {
		return null;
	}
}

// #endregion

// #region OpenAI Responses API

async function streamOpenAiResponses(
	config: ModelConfig,
	messages: LlmMessage[],
	tools: LlmTool[],
	onChunk: (chunk: LlmResponseChunk) => void,
	signal?: AbortSignal,
): Promise<ParsedLlmResult> {
	const url = genStreamUrl(config.baseUrl, 'responses');
	// Responses API 需要把 system message 抽出来。
	let leadSystem: LlmMessage | undefined;
	const inputMsgs: Record<string, unknown>[] = [];
	for (const m of messages) {
		if (m.role === 'system') {
			if (!leadSystem) leadSystem = m;
			else inputMsgs.push({ role: 'system', content: m.content });
			continue;
		}
		if (m.role === 'tool') {
			inputMsgs.push({ role: 'function_call_output', call_id: m.toolCallId, output: m.content });
			continue;
		}
		inputMsgs.push({ role: m.role, content: m.content });
	}

	const body: Record<string, unknown> = {
		model: config.modelId,
		input: inputMsgs,
		stream: true,
	};
	if (leadSystem) body.instructions = leadSystem.content;
	if (tools.length > 0) body.tools = tools.map((t) => ({ type: t.type, ...t.function }));
	if (config.customParams) Object.assign(body, config.customParams);

	const resp = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config.apiKey),
		body: JSON.stringify(body),
		signal,
	});

	if (!resp.ok || !resp.body) {
		const text = await resp.text().catch(() => resp.statusText);
		throw new Error(`OpenAI Responses API error ${resp.status}: ${text}`);
	}

	return parseSseStream(resp.body, parseOpenAiResponsesDelta, onChunk);
}

function parseOpenAiResponsesDelta(line: string): LlmResponseChunk | null {
	// Responses API 使用不同的事件类型格式
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) return null;
	const data = trimmed.slice(5).trim();
	if (data === '[DONE]') return { done: true };

	try {
		const json = JSON.parse(data);
		const eventType = json.type;
		const chunk: LlmResponseChunk = {};

		if (eventType === 'response.output_text.delta') {
			chunk.textDelta = json.delta ?? '';
		} else if (eventType === 'response.function_call_arguments.delta') {
			chunk.toolCallDelta = { argumentsDelta: json.delta ?? '', index: 0 };
		} else if (eventType === 'response.completed') {
			const usage = json.response?.usage;
			if (usage) {
				chunk.usage = {
					input: usage.input_tokens,
					inputCached: usage.input_tokens_details?.cached_tokens,
					output: usage.output_tokens,
				};
			}
			chunk.done = true;
		}

		return chunk;
	} catch {
		return null;
	}
}

// #endregion

// #region Anthropic

async function streamAnthropic(
	config: ModelConfig,
	messages: LlmMessage[],
	tools: LlmTool[],
	onChunk: (chunk: LlmResponseChunk) => void,
	signal?: AbortSignal,
): Promise<ParsedLlmResult> {
	// ⚠️ endpoint 只能是 `messages`：genStreamUrl 已经负责补 `/v1`，写成 `v1/messages` 会拼出
	// `.../v1/v1/messages`（原来的写法就是这样，anthropic 分支其实一直没跑通过）
	const url = genStreamUrl(config.baseUrl, 'messages');
	// ⭐ 只有**第一条** system 走顶层 `system` 参数：它是缓存前缀的第二层，必须逐字节稳定。
	//   其余 system（尾部强度指令 / 动态状态，以及历史中途的 `<self_check>` / 预算收尾通知）保持 `role:'system'` 原样就地发出
	let leadSystem: LlmMessage | undefined;
	const convMsgs: Record<string, unknown>[] = [];
	for (const m of messages) {
		if (m.role === 'system') {
			if (!leadSystem) leadSystem = m;
			else convMsgs.push({ role: 'system', content: m.content });
			continue;
		}
		if (m.role === 'tool') {
			// ⚠️ 并行工具调用的**多个 tool_result 必须装在同一个 user 消息里**，否则 400：
			//   `tool_use ids were found without tool_result blocks immediately after: call_01_…`
			//   （一次回复里两个 file_write 就会踩到；Anthropic 只认「紧跟 assistant 的那一条 user」）
			const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
			const prev = convMsgs[convMsgs.length - 1];
			const prevBlocks = prev?.content as Array<{ type?: string }> | undefined;
			if (prev?.role === 'user' && Array.isArray(prevBlocks) && prevBlocks[0]?.type === 'tool_result') {
				prevBlocks.push(block);
			} else {
				convMsgs.push({ role: 'user', content: [block] });
			}
			continue;
		}
		// Anthropic 使用 assistant 格式传递之前的 tool_use
		if (m.toolCalls?.length) {
			convMsgs.push({
				role: 'assistant',
				content: [
					...(m.content ? [{ type: 'text', text: m.content }] : []),
					...m.toolCalls.map((tc) => ({
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
					})),
				],
			});
			continue;
		}
		convMsgs.push({ role: m.role, content: m.content });
	}

	const body: Record<string, unknown> = {
		model: config.modelId,
		messages: convMsgs,
		max_tokens: 4096,
		stream: true,
	};
	if (leadSystem) body.system = leadSystem.content;
	if (tools.length > 0) {
		body.tools = tools.map((t) => ({
			name: t.function.name,
			description: t.function.description,
			input_schema: t.function.parameters,
		}));
		body.tool_choice = { type: 'auto' };
	}
	if (config.customParams) Object.assign(body, config.customParams);

	const resp = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config.apiKey, { 'anthropic-version': '2023-06-01' }),
		body: JSON.stringify(body),
		signal,
	});

	if (!resp.ok || !resp.body) {
		const text = await resp.text().catch(() => resp.statusText);
		throw new Error(`Anthropic API error ${resp.status}: ${text}`);
	}

	return parseSseStream(resp.body, parseAnthropicDelta, onChunk);
}

function parseAnthropicDelta(line: string): LlmResponseChunk | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) return null;
	const data = trimmed.slice(5).trim();

	try {
		const json = JSON.parse(data);
		const chunk: LlmResponseChunk = {};

		if (json.type === 'content_block_start') {
			// ⭐ 工具调用的**名字与 id 只在这条事件里出现**（delta 阶段只有 partial_json 参数）。
			//    漏了它 = `toolCallAccum` 永远没有 name ⇒ finalizeToolCalls 把它们全过滤掉，表现为「模型看得见工具、也调用了，但 MTG 一个都没执行，直接当文本结束」。
			//    （这条分支 2026-10-30 才修好 URL，工具路径此前从没跑通过。）
			const block = json.content_block as { type?: string; id?: string; name?: string } | undefined;
			if (block?.type === 'tool_use') {
				chunk.toolCallDelta = { id: block.id, name: block.name, index: json.index ?? 0 };
			}
		} else if (json.type === 'content_block_delta') {
			if (json.delta.type === 'text_delta') {
				chunk.textDelta = json.delta.text;
			} else if (json.delta.type === 'input_json_delta') {
				chunk.toolCallDelta = { argumentsDelta: json.delta.partial_json, index: json.index ?? 0 };
			} else if (json.delta.type === 'thinking_delta') {
				// 思考模型（deepseek / 小米的 anthropic 兼容端点）把推理放在 thinking_delta 里
				chunk.reasoningDelta = json.delta.thinking;
			}
		} else if (json.type === 'message_start') {
			// message_start 就带全了输入侧账本（含缓存命中），输出侧此时是 0
			const usage = anthropicUsageToTokenUsage(json.message?.usage);
			if (usage) chunk.usage = usage;
		} else if (json.type === 'message_delta') {
			// stop_reason 也带在这里：`tool_use` / `end_turn` / `max_tokens`
			if (json.delta?.stop_reason) {
				chunk.done = true;
				chunk.finishReason = json.delta.stop_reason;
			}
			const u = json.usage;
			if (u) {
				// message_delta 只用来收尾输出 token，但各家把输入侧发的形状对不上，实测（2026-10-31）：
				// - deepseek / 中转：带真实 input + cache_read，可以覆盖
				// - 小米：只带未缓存的 input、**不带** cache_read —— 覆盖会把命中数抹成 0
				// - 小红书：input 与 cache_read 全是 0 的占位 —— 覆盖会把整条账本清零
				// 所以只在「带 cache_read 且不全是 0」时才用 delta 覆盖输入侧，否则只取 output。
				const read = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : -1;
				const merged = read >= 0 && (read > 0 || u.input_tokens > 0) ? anthropicUsageToTokenUsage(u) : undefined;
				if (merged) {
					chunk.usage = merged;
				} else if (typeof u.output_tokens === 'number') {
					chunk.usage = { output: u.output_tokens };
				}
			}
		} else if (json.type === 'message_stop') {
			chunk.done = true;
		}

		return chunk;
	} catch {
		return null;
	}
}

// #endregion

// #region SSE 流解析器

async function parseSseStream(
	body: ReadableStream<Uint8Array>,
	deltaParser: (line: string) => LlmResponseChunk | null,
	onChunk: (chunk: LlmResponseChunk) => void,
): Promise<ParsedLlmResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	const result: ParsedLlmResult = { text: '', reasoningContent: '', toolCalls: [], usage: {} };

	// 用于累积 tool call 的 arguments
	const toolCallAccum: Record<number, { id?: string; name?: string; args: string }> = {};

	const finalizeToolCalls = () => {
		result.toolCalls = Object.values(toolCallAccum)
			.filter((a) => a.name)
			.map((a) => ({
				id: a.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
				name: a.name!,
				arguments: safeParseJson(a.args),
			}));
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.trim()) continue;
			const chunk = deltaParser(line);
			if (!chunk) continue;

			onChunk(chunk);

			if (chunk.textDelta) result.text += chunk.textDelta;
			if (chunk.reasoningDelta) result.reasoningContent += chunk.reasoningDelta;
			if (chunk.finishReason) result.finishReason = chunk.finishReason;
			// 兼容两种形状：单条 toolCallDelta 与一次多条 toolCallDeltas
			const deltas = chunk.toolCallDeltas ?? (chunk.toolCallDelta ? [chunk.toolCallDelta] : []);
			for (const tc of deltas) {
				const acc = toolCallAccum[tc.index] ?? { args: '' };
				if (tc.id) acc.id = tc.id;
				if (tc.name) acc.name = tc.name;
				if (tc.argumentsDelta) acc.args += tc.argumentsDelta;
				toolCallAccum[tc.index] = acc;
			}
			// ⚠️ 必须**合并**而不是覆盖：Anthropic 的输入账本在 message_start、输出收尾在
			// message_delta，后到的 `{ output }` 直接覆盖会把 input 和缓存命中一起抹掉
			// （小红书就是这么丢的：start 给了 357+3584，delta 又发了一串 0）。
			// openai-chat 每次发的是完整 usage，合并与覆盖等价。
			if (chunk.usage) result.usage = { ...result.usage, ...chunk.usage };
			if (chunk.done) {
				finalizeToolCalls();
				return result;
			}
		}
	}

	// 流意外结束
	finalizeToolCalls();
	return result;
}

// #endregion

// #region 公共 API

/**
 * 开发用 mock 的解析器：由 http-server 注入（它负责读 settings）。
 * 返回 null = 走真实请求。
 *
 * 放在这一处的原因：`callLlm` 是唯一 LLM 出口 —— 只换 baseUrl / apiFormat，runner、工具、SSE 全都无感。
 * 注意开关是**每次请求现读**的（不是启动时缓存），但运行期间禁止切换（http-server 有守卫）。
 */
let mockResolver: (() => { baseUrl: string; scenario: string } | null) | null = null;

export function setMockResolver(fn: typeof mockResolver): void {
	mockResolver = fn;
}

/**
 * 调用 LLM 并写一条请求日志。
 * 日志写在 finally 里：成功 / 报错 / 被 abort 都会留下终态记录。
 */
export async function callLlm(req: LlmRequest, meta: LlmCallMeta): Promise<LlmCallResult> {
	const { config: rawConfig, messages, tools = [], onChunk = () => {}, signal, responseFormat } = req;

	// 开着 mock 时把这次请求转给内置 mock：强制 openai-chat 格式 + 换 baseUrl，
	// 并把 modelId 标成 `mock:<scenario>`，这样 requestLog 与 ctx 里的账本条目一眼能看出不是真模型。
	const mock = mockResolver?.() ?? null;
	const isMock = mock !== null;
	const config: ModelConfig = isMock
		? {
			...rawConfig,
			apiFormat: 'openai-chat',
			baseUrl: mock!.baseUrl,
			apiKey: rawConfig.apiKey || 'mock',
			modelId: `mock:${mock!.scenario}`,
		}
		: rawConfig;

	const { logId, seq } = allocateLogId(meta.conversationId);
	const startedAt = Date.now();
	let firstChunkMs: number | undefined;
	let status: LlmRequestRecord['status'] = 'success';
	let error: LlmRequestRecord['error'];
	let finishReason: string | undefined;
	let usage: TokenUsage = {};
	let producedToolCallIds: string[] = [];
	let firstChunkSeen = false;
	// 等级=完整时把响应正文也落进 record（「仅输入」只落 messages，这里累加但不写出）
	let outputText = '';
	let outputReasoning = '';

	const wrappedOnChunk = (chunk: LlmResponseChunk) => {
		if (!firstChunkSeen) {
			firstChunkMs = Date.now() - startedAt;
			firstChunkSeen = true;
		}
		// 有数据进来就说明上游还活着：把静默计时器重置
		armIdle();
		logMsg(`[model] chunk`, chunk);
		if (chunk.usage) usage = { ...usage, ...chunk.usage };
		if (chunk.textDelta) outputText += chunk.textDelta;
		if (chunk.reasoningDelta) outputReasoning += chunk.reasoningDelta;
		onChunk(chunk);
	};

	// ⭐ 拆成「前缀层」与「尾部层」分别记录：
	//   提示词缓存是 tools → system → messages 的前缀结构，**只有第一条** system 属于前缀的第二层。
	//   effort.md / prompt.state.md 渲染出来的也是 system 消息，但它们拼在 **messages 尾部** ——
	//   它们变化只影响尾部自己，不会打掉前缀。把两者混在一个 hash 里（旧行为）会误报「前缀变了」。
	const systemMsgs = messages.filter((m) => m.role === 'system');
	const leadSystemText = systemMsgs[0]?.content ?? '';
	const tailSystemText = systemMsgs.slice(1).map((m) => m.content).join('\n\n');
	const toolNames = tools.map((t) => t.function.name);

	// #region 超时看门狗
	//
	// 没有它，一次「连上了但永远不吐字节」的请求会永久挂住：ctx 停在 running、父实例停在 pending，
	// 而 requestLog 连一条记录都写不出来（记录在 finally 里，卡住时永远到不了）—— 连哪里卡了都查不到。
	const armIdle = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => fail(new LlmTimeoutError('idle', timeouts.idleMs, firstChunkSeen)), timeouts.idleMs);
	};
	// 两个计时器：idle（每来一个 chunk 重置）与 total（全程只走一次）。
	// 超时一律往外抛 `LlmTimeoutError`，runner 认它是瞬时错误 → 自动重试。
	const timeouts = resolveLlmTimeouts();
	const controller = new AbortController();
	let timedOut: LlmTimeoutError | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let totalTimer: ReturnType<typeof setTimeout> | undefined;
	const stopTimers = () => {
		clearTimeout(idleTimer);
		clearTimeout(totalTimer);
	};
	let rejectWatchdog: ((e: LlmTimeoutError) => void) | undefined;
	const watchdog = new Promise<never>((_resolve, reject) => {
		rejectWatchdog = reject;
	});
	watchdog.catch(() => {});
	/** 超时唯一出口：打掉等待 + 中断 fetch。Cottontail 的 fetch 是自研实现，不能假设它认 signal，所以两条都做。 */
	const fail = (e: LlmTimeoutError) => {
		if (timedOut) return;
		timedOut = e;
		stopTimers();
		rejectWatchdog?.(e);
		try {
			controller.abort(e);
		} catch {
			controller.abort();
		}
	};
	armIdle();
	totalTimer = setTimeout(() => fail(new LlmTimeoutError('total', timeouts.totalMs, firstChunkSeen)), timeouts.totalMs);
	// 外部取消照旧生效（用户中断 / run 被 abort），但不要被当成超时
	const onExternalAbort = () => {
		stopTimers();
		try {
			controller.abort((signal as { reason?: unknown } | undefined)?.reason);
		} catch {
			controller.abort();
		}
	};
	if (signal) {
		if (signal.aborted) onExternalAbort();
		else signal.addEventListener('abort', onExternalAbort, { once: true });
	}
	// #endregion

	logMsg(`[model] 将调用 LLM 接口`, config, messages, tools);
	try {
		const inner = (async () => {
			switch (config.apiFormat) {
				case 'openai-chat':
					return streamOpenAiChat(config, messages, tools, wrappedOnChunk, controller.signal, responseFormat);
				case 'openai-responses':
					return streamOpenAiResponses(config, messages, tools, wrappedOnChunk, controller.signal);
				case 'anthropic':
					return streamAnthropic(config, messages, tools, wrappedOnChunk, controller.signal);
				default:
					throw new Error(`config.apiFormat 不支持该值: ${config.apiFormat}`);
			}
		})();
		// 超时后 inner 可能还在自己跑完（abort 未必被上游认），别让它变成 unhandled rejection
		inner.catch(() => {});
		const result = await Promise.race([inner, watchdog]);

		stopTimers();
		finishReason = result.finishReason;
		usage = result.usage ?? usage;
		producedToolCallIds = result.toolCalls.map((tc) => tc.id);
		return {
			...result,
			usage,
			logId,
			seq,
			durationMs: Date.now() - startedAt,
			modelId: config.modelId,
		};
	} catch (e) {
		const err = e as Error & { status?: number; name?: string; logId?: string };
		// 失败也要能定位日志：把 logId 挂到错误上（安全审核失败时界面仍能点开那一份）
		if (e && typeof e === 'object') err.logId = logId;
		// 看门狗打出来的：把真正的超时错误抛出去（否则它只是一个无名 AbortError，会被当成用户取消、不重试）
		if (timedOut) {
			status = 'error';
			error = { name: timedOut.name, message: timedOut.message, status: undefined };
			throw timedOut;
		}
		if (err?.name === 'AbortError' || signal?.aborted) {
			status = 'aborted';
		} else {
			status = 'error';
			error = { name: err?.name, message: err?.message ?? String(e), status: err?.status };
		}
		throw e;
	} finally {
		stopTimers();
		if (signal) signal.removeEventListener('abort', onExternalAbort);
		const endedAt = Date.now();
		const logOptions = getRequestLogOptions();
		const record: LlmRequestRecord = {
			seq,
			logId,
			conversationId: meta.conversationId,
			agentInstanceId: meta.agentInstanceId,
			agentId: meta.agentId,
			agentName: meta.agentName,
			depth: meta.depth,
			modeId: meta.modeId,
			purpose: meta.purpose,
			trigger: meta.trigger,
			triggeredByCallIds: meta.triggeredByCallIds,
			producedToolCallIds,
			agentInstanceRound: meta.agentInstanceRound,
			providerId: config.providerId,
			model: config.modelId,
			format: config.apiFormat,
			mock: isMock,
			request: {
				messageCount: messages.length,
				toolCount: tools.length,
				toolNames: logOptions.includeToolNames ? toolNames : undefined,
				systemPromptChars: leadSystemText.length,
				systemPromptHash: leadSystemText ? hashString(leadSystemText) : undefined,
				// 尾部 system 消息（effort / state）：每轮可能不同，是**预期**的，不计入前缀稳定性
				tailSystemChars: tailSystemText.length,
				tailSystemHash: tailSystemText ? hashString(tailSystemText) : undefined,
				totalChars: JSON.stringify(messages).length + JSON.stringify(tools).length,
				stream: true,
				// 等级 ≥「仅输入」时把 messages 原文一起存下（界面上「导出详细信息」靠它）；
				// 默认等级只留形状，日志体积与本项目历史上的 requestLog 一致。
				messages: logOptions.level === 'default' ? undefined : messages,
			},
			// 只有「完整」才落输出：等级「仅输入」的语义就是「只看模型看到了什么」
			response: logOptions.level === 'full'
				? { text: outputText || undefined, reasoning: outputReasoning || undefined }
				: undefined,
			status,
			usage: Object.keys(usage).length > 0 ? usage : undefined,
			finishReason,
			firstChunkMs,
			durationMs: endedAt - startedAt,
			error,
			startedAt,
			endedAt,
		};
		appendRequestRecord(record);
		dumpPayload(meta.conversationId, logId, { request: { config, messages, tools }, record });
	}
}

/** 供 runner 复用的派生类型 */
export type { LlmToolCall };

// #endregion

// #region 连通性测试（设置页每个模型行上的「测试连通性」）

/** 从上游错误体里抠一句人话：优先 `error.message`，否则截断原文 */
function explainUpstreamError(text: string): string {
	const raw = (text ?? '').trim();
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
		const msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
		if (msg) return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
	} catch {
		// 不是 JSON：原样截断
	}
	return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

/**
 * 用**一个最小请求**打一次真实上游：不带历史、不带工具，只要一个非流式响应。
 *
 * ⚠️ 为什么不复用 `callLlm`：那条路会开流式、写 requestLog、把记录挂在某个会话上；
 * 而测试发生在「可能还没有会话、参数还没填完」的时候。这里只回答一件事：「地址 + Key + 模型名」这三样凑在一起，能不能换来一个 2xx。
 *
 * 代价是一次真实请求（max_tokens 极小），所以只在用户点按钮时调用。
 */
export async function testModelConnectivity(config: ModelConfig): Promise<ModelTestResult> {
	const startedAt = Date.now();
	const endpoint = config.apiFormat === 'openai-chat'
		? 'chat/completions'
		: config.apiFormat === 'openai-responses' ? 'responses' : 'messages';
	const url = genStreamUrl(config.baseUrl, endpoint);

	const ping = [{ role: 'user', content: 'ping' }];
	const body: Record<string, unknown> = config.apiFormat === 'openai-responses'
		? { model: config.modelId, input: 'ping', max_output_tokens: 16 }
		: { model: config.modelId, messages: ping, max_tokens: 1 };
	// 自定义参数照常合并（有些中转要求必填的额外字段），但 stream 由测试强制关掉
	if (config.customParams) Object.assign(body, config.customParams);
	body.model = config.modelId;
	body.stream = false;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	try {
		const resp = await fetch(url, {
			method: 'POST',
			headers: buildHeaders(config.apiKey, config.apiFormat === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const latencyMs = Date.now() - startedAt;
		const text = await resp.text().catch(() => '');
		if (!resp.ok) {
			return { ok: false, latencyMs, status: resp.status, message: `${resp.status} ${explainUpstreamError(text) || resp.statusText}`.trim() };
		}
		return { ok: true, latencyMs, status: resp.status, message: `连通正常 · ${latencyMs} ms` };
	} catch (e) {
		const latencyMs = Date.now() - startedAt;
		const err = e as Error & { cause?: { code?: string; message?: string } };
		const aborted = err?.name === 'AbortError';
		// `fetch failed` 本身没信息量，真正的原因（ECONNREFUSED / ENOTFOUND / 证书）在 cause 里
		const cause = err?.cause ? (err.cause.code ?? err.cause.message) : '';
		return {
			ok: false,
			latencyMs,
			message: aborted ? '超时 20s：上游没有响应' : `请求失败：${err?.message ?? String(e)}${cause ? `（${cause}）` : ''}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

// #endregion
