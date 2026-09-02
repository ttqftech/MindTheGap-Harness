/* ==========================================================================
   模型适配器 — MindTheGap-Harness
   
   轻量级 LLM 调用封装，直接用 Bun 的 fetch API。
   支持三种 API 格式：OpenAI Chat Completions / OpenAI Responses / Anthropic
   支持 SSE 流式响应。
   
   为什么不用 langchain.js？
   - langchain.js 较重且抽象层多，我们需要精细控制流式和工具调用格式
   - Bun fetch 原生支持流式，性能好
   - 自己实现更可控，适配转接这种定制工作流
   ========================================================================== */

import type { ModelConfig, TokenUsage } from '../../shared/agent';
import { safeParseJson } from '../utils';

export interface LlmMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	/** 工具调用相关（OpenAI 格式） */
	toolCalls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	toolCallId?: string;
	/** 思考模型的推理内容，多轮工具调用时必须回传吗？ */
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

export interface LlmResponseChunk {
	/** 文本增量 */
	textDelta?: string;
	/** 工具调用增量 */
	toolCallDelta?: {
		id?: string;
		name?: string;
		argumentsDelta?: string;
		index: number;
	};
	/** 完成标志 */
	done?: boolean;
	/** 最终 Token 用量 */
	usage?: TokenUsage;
	/** 错误 */
	error?: string;
}

export interface LlmCallResult {
	text: string;
	/** 思考模型的推理内容（需在多轮回传） */
	reasoningContent: string;
	toolCalls: Array<{
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}>;
	usage: TokenUsage;
}

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
 *
 * @param baseUrl  - API 基础地址，如 `https://api.deepseek.com`
 * @param endpoint - 具体端点路径，如 `chat/completions`
 * @returns 拼接后的完整 URL，如 `https://api.deepseek.com/v1/chat/completions`
 */
function genStreamUrl(baseUrl: string, endpoint: string): string {
	let u = baseUrl.replace(/\/+$/, '');
	if (!u.includes('/v1') && !u.includes('/v1/')) {
		u = u + '/v1';
	}
	const e = endpoint.replace(/^\/+/, '');
	return `${u}/${e}`;
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
	function toOpenAiWireMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
		return messages.map((msg) => {
			if (msg.role === 'tool') {
				return {
					role: 'tool',
					content: msg.content,
					tool_call_id: msg.toolCallId,
				};
			}
			if (msg.role === 'assistant' && msg.toolCalls?.length) {
				return {
					role: 'assistant',
					content: msg.content ?? '',
					// DeepSeek 思考模型多轮工具调用时必须回传 reasoning_content
					...(msg.reasoningContent ? { reasoning_content: msg.reasoningContent } : {}),
					// TODO 下面转了一层好像是多余的，map 前后没有变化
					tool_calls: msg.toolCalls.map((toolCall) => ({
						id: toolCall.id,
						type: 'function',
						function: {
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						},
					})),
				};
			}
			return { role: msg.role, content: msg.content };
		});
	}

	const url = genStreamUrl(config.baseUrl, 'chat/completions');
	const body: Record<string, unknown> = {
		model: config.modelId,
		messages: toOpenAiWireMessages(messages),  // 必须转 wire 格式（tool_call_id 等）
		stream: false,  // Cottontail ReadableStream 不工作，先非流式
	};
	if (tools.length > 0) body.tools = tools;
	if (config.customParams) Object.assign(body, config.customParams);

	console.log(`[Model] fetching ${url}, model=${config.modelId}`);
	const resp = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(config.apiKey),
		body: JSON.stringify(body),
		signal,
	});
	console.log(`[Model] fetch response: status=${resp.status}, ok=${resp.ok}`);

	if (!resp.ok) {
		const text = await resp.text().catch(() => resp.statusText);
		throw new Error(`OpenAI Chat API error ${resp.status}: ${text}`);
	}

	const json = await resp.json();
	console.log(`[Model] got JSON response, keys=${Object.keys(json).join(',')}`);

	const result: LlmCallResult = { text: '', reasoningContent: '', toolCalls: [], usage: {} };

	const choice = json.choices?.[0];
	if (choice) {
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
				return {
					role: 'function_call_output',
					call_id: m.toolCallId,
					output: m.content,
				};
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
			chunk.toolCallDelta = {
				argumentsDelta: json.delta ?? '',
				index: 0,
			};
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

// endregion

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
					content: [
						{
							type: 'tool_result' as const,
							tool_use_id: m.toolCallId,
							content: m.content,
						},
					],
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
							input: tc.function.arguments
								? JSON.parse(tc.function.arguments)
								: {},
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
				chunk.toolCallDelta = {
					argumentsDelta: json.delta.partial_json,
					index: 0,
				};
			}
		} else if (json.type === 'message_start') {
			// message_start 里有 usage
			chunk.usage = {
				input: json.message?.usage?.input_tokens,
				output: json.message?.usage?.output_tokens,
			};
		} else if (json.type === 'message_delta' && json.usage) {
			chunk.usage = {
				input: json.usage.input_tokens,
				output: json.usage.output_tokens,
			};
		} else if (json.type === 'message_stop') {
			chunk.done = true;
		}

		return chunk;
	} catch {
		return null;
	}
}

// endregion

// #region SSE 流解析器

async function parseSseStream(
	body: ReadableStream<Uint8Array>,
	deltaParser: (line: string) => LlmResponseChunk | null,
	onChunk: (chunk: LlmResponseChunk) => void,
): Promise<LlmCallResult> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	const result: LlmCallResult = {
		text: '',
		reasoningContent: '',
		toolCalls: [],
		usage: {},
	};

	// 用于累积 tool call 的 arguments
	const toolCallAccum: Record<number, { id?: string; name?: string; args: string }> = {};

	console.log(`[SSE] parseSseStream started, bodyType=${typeof body}, reader=${!!reader}`);

	let chunkCount = 0;
	while (true) {
		console.log(`[SSE] waiting for reader.read()... (chunk #${chunkCount})`);
		const { done, value } = await reader.read();
		console.log(`[SSE] reader.read() returned: done=${done}, valueLen=${value?.length ?? 0}`);
		if (done) break;

		chunkCount++;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.trim()) continue;
			const chunk = deltaParser(line);
			if (!chunk) continue;

			onChunk(chunk);

			if (chunk.textDelta) {
				result.text += chunk.textDelta;
			}
			if (chunk.toolCallDelta) {
				const tc = chunk.toolCallDelta;
				const acc = toolCallAccum[tc.index] ?? { args: '' };
				if (tc.id) acc.id = tc.id;
				if (tc.name) acc.name = tc.name;
				if (tc.argumentsDelta) acc.args += tc.argumentsDelta;
				toolCallAccum[tc.index] = acc;
			}
			if (chunk.usage) {
				result.usage = chunk.usage;
			}
			if (chunk.done) {
				// 流结束，整理 tool calls
				result.toolCalls = Object.values(toolCallAccum)
					.filter((a) => a.name)
					.map((a) => ({
						id: a.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
						name: a.name!,
						arguments: safeParseJson(a.args),
					}));
				return result;
			}
		}
	}

	// 流意外结束
	result.toolCalls = Object.values(toolCallAccum)
		.filter((a) => a.name)
		.map((a) => ({
			id: a.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
			name: a.name!,
			arguments: safeParseJson(a.args),
		}));

	return result;
}

// #endregion

// #region 公共 API

export async function callLlm(
	config: ModelConfig,
	messages: LlmMessage[],
	tools: LlmTool[] = [],
	onChunk: (chunk: LlmResponseChunk) => void = () => {},
	signal?: AbortSignal,
): Promise<LlmCallResult> {
	switch (config.apiFormat) {
		case 'openai-chat':
			return streamOpenAiChat(config, messages, tools, onChunk, signal);
		case 'openai-responses':
			return streamOpenAiResponses(config, messages, tools, onChunk, signal);
		case 'anthropic':
			return streamAnthropic(config, messages, tools, onChunk, signal);
		default:
			throw new Error(`config.apiFormat 不支持该值: ${config.apiFormat}`);
	}
}

// #endregion