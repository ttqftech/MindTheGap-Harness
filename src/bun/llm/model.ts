/* ==========================================================================
   模型适配器 — MindTheGap-Harness（LLM 层）

   轻量级 LLM 调用封装：直接 fetch + SSE，支持三种 API 格式
   （OpenAI Chat Completions / OpenAI Responses / Anthropic）。

   本文件是 **requestLog 的唯一埋点**（§8）：
   callLlm() 内部 begin / end，用 finally 保证异常或 abort 也落一条终态记录。
   调用方（runner / 工具）拿到返回值时，日志已经写完了。

   从 src/bun/agent/model.ts 迁入本目录（本次重构唯一的目录结构变化）。
   ========================================================================== */

import type {
	LlmMessage,
	LlmTool,
	LlmToolCall,
	ModelConfig,
	TokenUsage,
	LlmPurpose,
	LlmTrigger,
	LlmRequestRecord,
} from '../../shared/agent';
import { safeParseJson } from '../utils';
import { allocateLogId, appendRequestRecord, dumpPayload, getRequestLogOptions } from './requestLog';

// #region 类型

export interface LlmResponseChunk {
	/** 文本增量 */
	textDelta?: string;
	/** 工具调用增量（流式时逐段追加） */
	toolCallDelta?: {
		id?: string;
		name?: string;
		argumentsDelta?: string;
		index: number;
	};
	/** 一次工具调用参数已完整（非流式路径用） */
	toolCallComplete?: { id: string; name: string; arguments: Record<string, unknown> };
	/** 完成标志 */
	done?: boolean;
	/** 最终 Token 用量 */
	usage?: TokenUsage;
	error?: string;
}

export interface LlmCallResult {
	text: string;
	/** 思考模型的推理内容（需在多轮回传） */
	reasoningContent: string;
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
	usage: TokenUsage;
	finishReason?: string;
}

export interface LlmRequest {
	config: ModelConfig;
	messages: LlmMessage[];
	tools?: LlmTool[];
	onChunk?: (chunk: LlmResponseChunk) => void;
	signal?: AbortSignal;
}

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
	trigger?: LlmTrigger;
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

// #endregion

// #region OpenAI Chat Completions

async function streamOpenAiChat(
	config: ModelConfig,
	messages: LlmMessage[],
	tools: LlmTool[],
	onChunk: (chunk: LlmResponseChunk) => void,
	signal?: AbortSignal,
): Promise<LlmCallResult> {
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
		stream: false,	// Cottontail ReadableStream 不工作，先非流式（见 docs/日志.md）
	};
	if (tools.length > 0) body.tools = tools;
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

	const json = await resp.json();

	const result: LlmCallResult = { text: '', reasoningContent: '', toolCalls: [], usage: {} };

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
		const choice = json.choices?.[0];
		if (!choice) return null;

		const delta = choice.delta ?? {};
		const chunk: LlmResponseChunk = {};

		if (delta.content) chunk.textDelta = delta.content;
		if (delta.tool_calls?.length) {
			const tc = delta.tool_calls[0];
			chunk.toolCallDelta = {
				id: tc.id,
				name: tc.function?.name,
				argumentsDelta: tc.function?.arguments,
				index: tc.index ?? 0,
			};
		}

		if (json.usage) {
			chunk.usage = {
				input: json.usage.prompt_tokens,
				output: json.usage.completion_tokens,
			};
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
): Promise<LlmCallResult> {
	const url = genStreamUrl(config.baseUrl, 'responses');
	// Responses API 需要把 system message 抽出来
	const systemMsg = messages.find((m) => m.role === 'system');
	const inputMsgs = messages.filter((m) => m.role !== 'system');

	const body: Record<string, unknown> = {
		model: config.modelId,
		input: inputMsgs.map((m) => {
			if (m.role === 'tool') {
				return { role: 'function_call_output', call_id: m.toolCallId, output: m.content };
			}
			return { role: m.role, content: m.content };
		}),
		stream: true,
	};
	if (systemMsg) body.instructions = systemMsg.content;
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
): Promise<LlmCallResult> {
	const url = genStreamUrl(config.baseUrl, 'v1/messages');
	const systemMsg = messages.find((m) => m.role === 'system');
	const convMsgs = messages
		.filter((m) => m.role !== 'system')
		.map((m) => {
			if (m.role === 'tool') {
				return {
					role: 'user' as const,
					content: [{ type: 'tool_result' as const, tool_use_id: m.toolCallId, content: m.content }],
				};
			}
			// Anthropic 使用 assistant 格式传递之前的 tool_use
			if (m.toolCalls?.length) {
				return {
					role: 'assistant' as const,
					content: [
						...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
						...m.toolCalls.map((tc) => ({
							type: 'tool_use' as const,
							id: tc.id,
							name: tc.function.name,
							input: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
						})),
					],
				};
			}
			return { role: m.role as 'user' | 'assistant', content: m.content };
		});

	const body: Record<string, unknown> = {
		model: config.modelId,
		messages: convMsgs,
		max_tokens: 4096,
		stream: true,
	};
	if (systemMsg) body.system = systemMsg.content;
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

		if (json.type === 'content_block_delta') {
			if (json.delta.type === 'text_delta') {
				chunk.textDelta = json.delta.text;
			} else if (json.delta.type === 'input_json_delta') {
				chunk.toolCallDelta = { argumentsDelta: json.delta.partial_json, index: 0 };
			}
		} else if (json.type === 'message_start') {
			chunk.usage = {
				input: json.message?.usage?.input_tokens,
				output: json.message?.usage?.output_tokens,
			};
		} else if (json.type === 'message_delta') {
			if (json.delta?.stop_reason) chunk.done = true;
			if (json.usage) {
				chunk.usage = {
					input: json.usage.input_tokens,
					output: json.usage.output_tokens,
				};
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
): Promise<LlmCallResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	const result: LlmCallResult = { text: '', reasoningContent: '', toolCalls: [], usage: {} };

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
			if (chunk.toolCallDelta) {
				const tc = chunk.toolCallDelta;
				const acc = toolCallAccum[tc.index] ?? { args: '' };
				if (tc.id) acc.id = tc.id;
				if (tc.name) acc.name = tc.name;
				if (tc.argumentsDelta) acc.args += tc.argumentsDelta;
				toolCallAccum[tc.index] = acc;
			}
			if (chunk.usage) result.usage = chunk.usage;
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
 * 调用 LLM 并写一条请求日志。
 * 日志写在 finally 里：成功 / 报错 / 被 abort 都会留下终态记录。
 */
export async function callLlm(req: LlmRequest, meta: LlmCallMeta): Promise<LlmCallResult> {
	const { config, messages, tools = [], onChunk = () => {}, signal } = req;

	const { logId, seq } = allocateLogId(meta.conversationId);
	const startedAt = Date.now();
	let firstChunkMs: number | undefined;
	let status: LlmRequestRecord['status'] = 'success';
	let error: LlmRequestRecord['error'];
	let finishReason: string | undefined;
	let usage: TokenUsage = {};
	let producedToolCallIds: string[] = [];
	let firstChunkSeen = false;

	const wrappedOnChunk = (chunk: LlmResponseChunk) => {
		if (!firstChunkSeen) {
			firstChunkMs = Date.now() - startedAt;
			firstChunkSeen = true;
		}
		if (chunk.usage) usage = { ...usage, ...chunk.usage };
		onChunk(chunk);
	};

	const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
	const toolNames = tools.map((t) => t.function.name);

	try {
		const result = await (async () => {
			switch (config.apiFormat) {
				case 'openai-chat':
					return streamOpenAiChat(config, messages, tools, wrappedOnChunk, signal);
				case 'openai-responses':
					return streamOpenAiResponses(config, messages, tools, wrappedOnChunk, signal);
				case 'anthropic':
					return streamAnthropic(config, messages, tools, wrappedOnChunk, signal);
				default:
					throw new Error(`config.apiFormat 不支持该值: ${config.apiFormat}`);
			}
		})();

		finishReason = result.finishReason;
		usage = result.usage ?? usage;
		producedToolCallIds = result.toolCalls.map((tc) => tc.id);
		emitUsage(meta, logId, usage);
		return result;
	} catch (e) {
		const err = e as Error & { status?: number; name?: string };
		if (err?.name === 'AbortError' || signal?.aborted) {
			status = 'aborted';
		} else {
			status = 'error';
			error = { name: err?.name, message: err?.message ?? String(e), status: err?.status };
		}
		throw e;
	} finally {
		const endedAt = Date.now();
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
			request: {
				messageCount: messages.length,
				toolCount: tools.length,
				toolNames: getRequestLogOptions().includeToolNames ? toolNames : undefined,
				systemPromptChars: systemText.length,
				systemPromptHash: systemText ? hashString(systemText) : undefined,
				totalChars: JSON.stringify(messages).length + JSON.stringify(tools).length,
				stream: config.apiFormat !== 'openai-chat',
			},
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

/** usage 流事件带上 logId，前端可把「这一次请求花了多少」贴到对应实例的气泡上 */
let usageEmitter: ((conversationId: string, agentInstanceId: string | undefined, logId: string, usage: TokenUsage) => void) | null = null;

export function setUsageEmitter(fn: typeof usageEmitter): void {
	usageEmitter = fn;
}

function emitUsage(meta: LlmCallMeta, logId: string, usage: TokenUsage) {
	if (!usageEmitter) return;
	if (Object.keys(usage).length === 0) return;
	usageEmitter(meta.conversationId, meta.agentInstanceId, logId, usage);
}

/** 供 runner 复用的派生类型 */
export type { LlmToolCall };

// #endregion
