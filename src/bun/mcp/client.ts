/* ==========================================================================
   MCP 客户端 — MindTheGap-Harness

   自己实现的极简 MCP（Model Context Protocol）客户端，零依赖。
   支持两种传输：
   - stdio：spawn 子进程，stdin/stdout 用换行分隔的 JSON-RPC 2.0 通信
   - http ：Streamable HTTP，POST JSON-RPC，响应可能是 JSON 或 SSE

   注意：主进程运行时是 Cottontail（JSC），不是 Bun。
   所以全部使用 node:* API。Cottontail 的 node:child_process 只验证过
   spawn + stdio pipe + 'data' 事件可用（流式 ReadableStream 不可用）。

   实现了 MCP 的这些能力：
   - initialize / notifications/initialized（握手）
   - tools/list
   - tools/call
   - 服务器发来的通知（如 notifications/tools/list_changed）直接忽略
   - 服务器发来的请求（如 roots/list）返回 method not found
   ========================================================================== */

import { spawn, type ChildProcess } from 'node:child_process';
import type { McpServerConfig } from '../../shared/agent';

/** 我们声称支持的协议版本。选一个兼容性最广的。 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface McpTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface McpCallToolResult {
	content: Array<{ type: string; text?: string; [k: string]: unknown }>;
	isError?: boolean;
	structuredContent?: unknown;
}

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export class McpError extends Error {
	code?: number;
	data?: unknown;
	constructor(message: string, code?: number, data?: unknown) {
		super(message);
		this.name = 'McpError';
		this.code = code;
		this.data = data;
	}
}

// #region 公共基类

abstract class BaseMcpClient {
	protected nextId = 1;
	protected serverInfo: { name?: string; version?: string } = {};
	protected pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();

	abstract send(message: Record<string, unknown>): Promise<void>;
	abstract close(): void;

	/** 发一个 JSON-RPC 请求并等待响应 */
	async requestJsonrpcWithTimeout(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new McpError(`MCP 请求超时（${method}，${timeoutMs}ms）`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timer });

			void this.send({ jsonrpc: '2.0', id, method, params: params ?? {} }).catch((err) => {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	/** 发一个通知（不需要响应） */
	async notify(method: string, params?: Record<string, unknown>): Promise<void> {
		await this.send({ jsonrpc: '2.0', method, params: params ?? {} });
	}


	/** 处理一条来自服务器的 JSON-RPC 消息 */
	protected handleMessage(msg: any): void {
		if (!msg || typeof msg !== 'object') return;

		// 响应
		if (msg.id !== undefined) {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			clearTimeout(p.timer);
			if (msg.error) {
				const e = msg.error as JsonRpcError;
				p.reject(new McpError(e.message ?? 'MCP 错误', e.code, e.data));
			} else {
				p.resolve(msg.result);
			}
			return;
		}

		// 服务器 → 客户端的请求：我们不支持，回一个 method not found
		if (msg.method) {
			void this.send({
				jsonrpc: '2.0',
				id: msg.id ?? null,
				error: { code: -32601, message: `Method not found: ${msg.method}` },
			}).catch(() => { /* 忽略 */ });
		}
		// 通知（有 method 无 id）直接忽略
	}

	/** 握手：initialize + notifications/initialized */
	async initialize(): Promise<void> {
		const result = await this.requestJsonrpcWithTimeout('initialize', {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: { tools: {} },
			clientInfo: { name: 'mindthegap-harness', version: '0.1.0' },
		}, 10000) as any;

		if (result?.serverInfo) this.serverInfo = result.serverInfo;
		await this.notify('notifications/initialized');
	}

	getServerInfo(): { name?: string; version?: string } {
		return this.serverInfo;
	}

	async listTools(): Promise<McpTool[]> {
		const result = await this.requestJsonrpcWithTimeout('tools/list', {}, 20000) as any;
		const tools = result?.tools ?? [];
		return tools.map((t: any) => ({
			name: t.name,
			description: t.description ?? '',
			inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
		}));
	}

	async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60000): Promise<McpCallToolResult> {
		const result = await this.requestJsonrpcWithTimeout('tools/call', { name, arguments: args ?? {} }, timeoutMs) as any;
		return {
			content: result?.content ?? [],
			isError: result?.isError === true,
			structuredContent: result?.structuredContent,
		};
	}
}

// #endregion

// #region stdio 传输

/**
 * Windows 上 npx/npm/yarn/pnpm 是 .cmd 批处理，直接 spawn('npx') 会失败。
 * 用户在配置里填 "npx" 时自动补成 "npx.cmd"。
 */
const WIN_CMD_SHIMS = ['npx', 'npm', 'yarn', 'pnpm', 'bun', 'deno'];

function resolveCommand(command: string): string {
	if (process.platform !== 'win32') return command;
	const lower = command.toLowerCase();
	if (WIN_CMD_SHIMS.includes(lower) && !/\.(cmd|bat|exe)$/i.test(command)) {
		return `${command}.cmd`;
	}
	return command;
}

export class StdioMcpClient extends BaseMcpClient {
	private child: ChildProcess;
	private buffer = '';
	private stderrTail = '';
	private closed = false;
	private closeError: string | null = null;

	constructor(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
		super();
		const resolved = resolveCommand(command);
		console.log(`[MCP] spawn: ${resolved} ${args.join(' ')}`);

		this.child = spawn(resolved, args, {
			cwd: options.cwd,
			env: { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});

		this.child.stdout?.on('data', (chunk: Buffer | string) => {
			this.buffer += chunk.toString();
			this.drain();
		});

		this.child.stderr?.on('data', (chunk: Buffer | string) => {
			// MCP 服务器的 stderr 通常只是日志，截断保存便于报错时展示
			this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000);
		});

		this.child.on('error', (err) => {
			this.closeError = `启动子进程失败: ${err.message}`;
			this.failAll(new McpError(this.closeError));
		});

		this.child.on('close', (code) => {
			this.closed = true;
			this.closeError = this.closeError ?? (code === 0 ? null : `子进程退出，code=${code}`);
			this.failAll(new McpError(this.closeError ?? 'MCP 子进程已关闭'));
		});
	}

	private drain(): void {
		let idx: number;
		while ((idx = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				// 非 JSON 行（比如子进程把自己的日志打到了 stdout）忽略
				continue;
			}
			this.handleMessage(msg);
		}
	}

	private failAll(err: Error): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(err);
		}
		this.pending.clear();
	}

	async send(message: Record<string, unknown>): Promise<void> {
		if (this.closed || !this.child.stdin?.writable) {
			throw new McpError(this.closeError ?? 'MCP stdio 通道已关闭');
		}
		this.child.stdin.write(JSON.stringify(message) + '\n');
	}

	close(): void {
		this.failAll(new McpError('MCP 连接已主动关闭'));
		if (!this.closed) {
			try {
				this.child.kill();
			} catch {
				/* 忽略 */
			}
		}
	}

	getStderrTail(): string {
		return this.stderrTail;
	}
}

// #endregion

// #region Streamable HTTP 传输

export class HttpMcpClient extends BaseMcpClient {
	private url: string;
	private headers: Record<string, string>;
	private sessionId?: string;

	constructor(url: string, headers: Record<string, string> = {}) {
		super();
		this.url = url;
		this.headers = headers;
	}

	async send(message: Record<string, unknown>): Promise<void> {
		// Streamable HTTP 下请求与响应走同一个 HTTP 往返，这里只负责统一发起
		const response = await this.post([message]);
		// 通知（无 id）可能返回 202 空体
		for (const item of response) this.handleMessage(item);
	}

	/** 一次 HTTP POST，返回解析出的 JSON-RPC 消息数组 */
	private async post(messages: Record<string, unknown>[]): Promise<any[]> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			// 只声明接受 JSON，避免服务器返回 Cottontail 解析不了的 SSE 流
			'Accept': 'application/json',
			...this.headers,
		};
		if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

		const single = messages.length === 1 ? messages[0] : messages;
		const resp = await fetch(this.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(single),
		});

		const sid = resp.headers.get('mcp-session-id');
		if (sid) this.sessionId = sid;

		if (resp.status === 202 || resp.status === 204) return [];
		if (!resp.ok) {
			const text = await resp.text().catch(() => resp.statusText);
			throw new McpError(`MCP HTTP ${resp.status}: ${text}`);
		}

		const text = await resp.text();
		if (!text.trim()) return [];
		try {
			const parsed = JSON.parse(text);
			return Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			// 兜底：按 SSE 文本解析（有些服务器无视 Accept 仍返回 text/event-stream）
			const out: any[] = [];
			for (const line of text.split('\n')) {
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (!data || data === '[DONE]') continue;
				try {
					out.push(JSON.parse(data));
				} catch { /* 忽略 */ }
			}
			return out;
		}
	}

	close(): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new McpError('MCP 连接已主动关闭'));
		}
		this.pending.clear();
	}
}

// #endregion

// #region 工厂

/** 对外暴露的 MCP 客户端能力（屏蔽 stdio / http 差异） */
export interface McpClientLike {
	initialize(): Promise<void>;
	listTools(): Promise<McpTool[]>;
	callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpCallToolResult>;
	getServerInfo(): { name?: string; version?: string };
	close(): void;
}

export function createMcpClient(config: McpServerConfig): McpClientLike {
	if (config.transport === 'http') {
		if (!config.url) throw new McpError('HTTP 传输必须填写 url');
		return new HttpMcpClient(config.url, config.headers ?? {});
	}
	if (!config.command) throw new McpError('stdio 传输必须填写 command');
	return new StdioMcpClient(config.command, config.args ?? [], {
		cwd: config.cwd,
		env: config.env ?? {},
	});
}

// #endregion
