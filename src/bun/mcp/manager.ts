/* ==========================================================================
   MCP 管理器 — MindTheGap-Harness

   职责：
   1. 读取持久化的 MCP 服务器配置，维护连接生命周期
   2. 连接成功后把远端工具注册进 Agent 工具表（前缀 mcp__<server>__<tool>）
   3. 对上提供状态查询、连接/断开/测试、工具调用

   调用关系：
   http-server（HTTP API） ─┐
   engine（system prompt）  ─┴→ mcpManager → mcp/client → 子进程 / HTTP
   ========================================================================== */

import type {
	McpServerConfig,
	McpServerStatus,
	McpToolInfo,
	ToolResult,
} from '../../shared/agent';
import { createMcpClient, type McpClientLike, type McpCallToolResult } from './client';
import { setDynamicTools, clearDynamicTools } from '../agent/tools';
import type { AgentTool } from '../agent/tools';
import { logMsg } from '../utils';

/** 工具名里允许的字符（多数 LLM 供应商要求 ^[a-zA-Z0-9_-]+$） */
function sanitizePrefix(raw: string): string {
	const s = raw
		.replace(/[^A-Za-z0-9_-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');
	return s || '';
}

interface Connection {
	config: McpServerConfig;
	client: McpClientLike;
	tools: McpToolInfo[];
}

class McpManager {
	/** serverId → 连接 */
	private connections = new Map<string, Connection>();
	/** serverId → 最近一次错误 */
	private lastErrors = new Map<string, string>();
	/** 同步锁，避免 UI 连续保存设置时并发连接 */
	private syncing: Promise<void> | null = null;

	/* ---------- 状态查询 ---------- */

	getStatus(): McpServerStatus[] {
		return this.connections.size === 0 && this.lastErrors.size === 0
			? []
			: Array.from(this.connections.values()).map((c) => this.toStatus(c));
	}

	private toStatus(c: Connection): McpServerStatus {
		return {
			id: c.config.id,
			name: c.config.name,
			enabled: c.config.enabled,
			connected: true,
			transport: c.config.transport,
			error: this.lastErrors.get(c.config.id),
			tools: c.tools,
		};
	}

	getTools(): McpToolInfo[] {
		const out: McpToolInfo[] = [];
		for (const c of this.connections.values()) out.push(...c.tools);
		return out;
	}

	isConnected(id: string): boolean {
		return this.connections.has(id);
	}

	/* ---------- 连接管理 ---------- */

	/**
	 * 按配置列表同步所有连接：
	 * - enabled 且未连接 / 配置变了 → 连接（或重连）
	 * - disabled 或已删除 → 断开并注销工具
	 */
	async syncAll(configs: McpServerConfig[]): Promise<void> {
		// 串行化，避免并发
		if (this.syncing) {
			await this.syncing.catch(() => { /* 忽略上一轮的错误 */ });
		}
		this.syncing = this.doSyncAll(configs);
		try {
			await this.syncing;
		} finally {
			this.syncing = null;
		}
	}

	private async doSyncAll(configs: McpServerConfig[]): Promise<void> {
		const wanted = new Map<string, McpServerConfig>();
		for (const c of configs) {
			if (c.enabled) wanted.set(c.id, c);
		}

		// 断开：不在 wanted 里，或配置发生了实质变化
		for (const [id, conn] of Array.from(this.connections)) {
			const next = wanted.get(id);
			if (!next || configChanged(conn.config, next)) {
				this.disconnect(id);
			}
		}

		// 连接：wanted 里但还没连上的
		for (const [id, cfg] of wanted) {
			if (this.connections.has(id)) continue;
			try {
				await this.connect(cfg);
			} catch (err) {
				// 单个服务器连接失败不影响其它服务器
				const msg = (err as Error).message;
				logMsg.error(`[MCP] 连接 "${cfg.name}" 失败: ${msg}`);
				this.lastErrors.set(id, msg);
			}
		}
	}

	private async connect(config: McpServerConfig): Promise<McpToolInfo[]> {
		this.lastErrors.delete(config.id);
		const client = createMcpClient(config);
		try {
			await client.initialize();
			const rawTools = await client.listTools();
			const tools = this.registerTools(config, rawTools);

			this.connections.set(config.id, { config, client, tools });
			logMsg(`[MCP] 已连接 "${config.name}"，注册 ${tools.length} 个工具: ${tools.map((t) => t.name).join(', ')}`);
			return tools;
		} catch (err) {
			client.close();
			this.lastErrors.set(config.id, (err as Error).message);
			throw err;
		}
	}

	disconnect(id: string): void {
		const conn = this.connections.get(id);
		if (!conn) return;
		conn.client.close();
		this.connections.delete(id);
		clearDynamicTools(this.sourceId(id));
		logMsg(`[MCP] 已断开 "${conn.config.name}"`);
	}

	/**
	 * 测试一个配置是否可用（不修改当前连接状态）。
	 * 用来在设置面板里「测试连接」。
	 */
	async test(config: McpServerConfig): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string; serverInfo?: { name?: string; version?: string } }> {
		const client = createMcpClient(config);
		try {
			await client.initialize();
			const rawTools = await client.listTools();
			const prefix = this.prefixOf(config);
			return {
				ok: true,
				tools: rawTools.map((t) => this.toToolInfo(config, prefix, t.name, t.description ?? '', t.inputSchema ?? {})),
				serverInfo: client.getServerInfo(),
			};
		} catch (err) {
			return { ok: false, tools: [], error: (err as Error).message };
		} finally {
			client.close();
		}
	}

	/* ---------- 工具调用 ---------- */

	async callTool(fullName: string, args: Record<string, unknown>): Promise<ToolResult> {
		const conn = this.findConnectionByToolName(fullName);
		if (!conn) {
			return { success: false, content: `MCP 工具 "${fullName}" 未找到（服务器可能已断开）`, error: 'MCP_TOOL_NOT_FOUND' };
		}
		const tool = conn.tools.find((t) => t.name === fullName);
		if (!tool) {
			return { success: false, content: `MCP 工具 "${fullName}" 未找到`, error: 'MCP_TOOL_NOT_FOUND' };
		}

		try {
			const result = await conn.client.callTool(tool.originalName, args);
			return {
				success: !result.isError,
				content: formatMcpContent(result),
				error: result.isError ? 'MCP_TOOL_ERROR' : undefined,
			};
		} catch (err) {
			return {
				success: false,
				content: `调用 MCP 工具 "${fullName}" 失败: ${(err as Error).message}`,
				error: (err as Error).message,
			};
		}
	}

	private findConnectionByToolName(fullName: string): Connection | undefined {
		for (const c of this.connections.values()) {
			if (c.tools.some((t) => t.name === fullName)) return c;
		}
		return undefined;
	}

	/* ---------- 工具注册 ---------- */

	private sourceId(serverId: string): string {
		return `mcp:${serverId}`;
	}

	private prefixOf(config: McpServerConfig): string {
		return sanitizePrefix(config.name) || `srv_${sanitizePrefix(config.id) || 'unknown'}`;
	}

	private toToolInfo(
		config: McpServerConfig,
		prefix: string,
		originalName: string,
		description: string,
		inputSchema: Record<string, unknown>,
	): McpToolInfo {
		return {
			name: `mcp__${prefix}__${originalName}`,
			originalName,
			serverId: config.id,
			serverName: config.name,
			description: `[MCP:${config.name}] ${description}`,
			inputSchema,
		};
	}

	private registerTools(
		config: McpServerConfig,
		rawTools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>,
	): McpToolInfo[] {
		const prefix = this.prefixOf(config);
		const infos = rawTools.map((t) =>
			this.toToolInfo(config, prefix, t.name, t.description ?? '', t.inputSchema ?? { type: 'object', properties: {} }),
		);

		const agentTools: AgentTool[] = infos.map((info) => ({
			name: info.name,
			description: info.description,
			parameters: normalizeSchema(info.inputSchema),
			execute: async (args) => this.callTool(info.name, args),
		}));

		setDynamicTools(this.sourceId(config.id), agentTools);
		return infos;
	}

	/* ---------- System Prompt ---------- */

	/** 生成追加到 system prompt 里的 MCP 工具说明 */
	getPromptSection(): string {
		const tools = this.getTools();
		if (tools.length === 0) return '';
		const lines = tools.map((t) => `- ${t.name}: ${t.description}`);
		return `

# MCP 外部工具
以下工具来自用户接入的 MCP 服务器，命名规则为 mcp__<服务器>__<工具名>。
它们和内置工具用法完全一致，需要时直接调用即可。
${lines.join('\n')}`;
	}
}

/** 判断两份配置是否发生了会导致需要重连的变化 */
function configChanged(a: McpServerConfig, b: McpServerConfig): boolean {
	return (
		a.transport !== b.transport ||
		(a.command ?? '') !== (b.command ?? '') ||
		JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? []) ||
		JSON.stringify(a.env ?? {}) !== JSON.stringify(b.env ?? {}) ||
		(a.cwd ?? '') !== (b.cwd ?? '') ||
		(a.url ?? '') !== (b.url ?? '') ||
		JSON.stringify(a.headers ?? {}) !== JSON.stringify(b.headers ?? {})
	);
}

/** 把 MCP 返回的 content 数组拼成一段文本 */
function formatMcpContent(result: McpCallToolResult): string {
	const parts = (result.content ?? []).map((c) => {
		if (typeof c.text === 'string') return c.text;
		if (c.type === 'image' || c.type === 'audio' || c.type === 'resource') {
			return `[${c.type} 内容，当前版本暂不支持展示]`;
		}
		return JSON.stringify(c);
	});
	const text = parts.join('\n') || '(MCP 工具无输出)';
	if (result.structuredContent !== undefined) {
		return `${text}\n${JSON.stringify(result.structuredContent, null, 2)}`;
	}
	return text;
}

/**
 * 归一化 JSON Schema：
 * 部分 MCP 服务器不返回 type 字段，而 OpenAI 系列 API 要求 parameters 必须是 object，
 * 缺失会直接 400。这里兜底补齐。
 */
function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const out = { ...schema };
	if (!out.type) out.type = 'object';
	if (!out.properties) out.properties = {};
	return out;
}

export const mcpManager = new McpManager();
