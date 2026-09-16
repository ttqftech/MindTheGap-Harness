/* ==========================================================================
   agentBridge — Agent Service HTTP + SSE（对齐 FFBox 的 serviceBridge 职责）

   重构后：纯 HTTP + SSE，不再有 RPC 回退。
   Agent Service 可脱离 electrobun 独立运行。
   所有 Agent 相关操作（会话、设置、运行、流式）全部走此 bridge。
   ========================================================================== */

import type {
	AgentRunRequest,
	AgentCtx,
	AgentInstance,
	AgentStreamEvent,
	ConversationMeta,
	ServiceConversation,
	ServiceSettings,
	ModelProvider,
	ModeSummary,
	ModeConfigDefaults,
	UsageStats,
	Folder,
	McpServerConfig,
	McpServerStatus,
	McpToolInfo,
	LlmRequestRecord,
} from '../shared/agent';

const HTTP_PORT = 18999;
const HTTP_BASE = `http://localhost:${HTTP_PORT}`;

async function httpFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const resp = await fetch(`${HTTP_BASE}${path}`, init);
	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		throw new Error(`HTTP ${resp.status}: ${text}`);
	}
	return resp.json();
}

/* ---------- 健康检查 ---------- */

export async function health(): Promise<boolean> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 1500);
		const resp = await fetch(`${HTTP_BASE}/api/health`, { signal: ctrl.signal });
		clearTimeout(timer);
		return resp.ok;
	} catch {
		return false;
	}
}

/* ---------- Agent 运行 ---------- */

export async function runAgent(params: AgentRunRequest): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
	try {
		return await httpFetch('/api/agent/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
	} catch (e: any) {
		return { ok: false, error: e?.message };
	}
}

export async function cancelAgent(conversationId: string): Promise<{ ok: boolean }> {
	try {
		return await httpFetch('/api/agent/cancel', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ conversationId }),
		});
	} catch {
		return { ok: false };
	}
}

/* ---------- 流式订阅 ---------- */

export function subscribeStream(
	conversationId: string,
	listener: (event: AgentStreamEvent) => void,
): () => void {
	const es = new EventSource(
		`${HTTP_BASE}/api/agent/stream?conversationId=${encodeURIComponent(conversationId)}`,
	);
	es.onmessage = (e) => {
		try {
			const event = JSON.parse(e.data) as AgentStreamEvent;
			listener(event);
		} catch {
			// ignore
		}
	};
	es.onerror = () => {
		// EventSource 自动重连
	};
	return () => es.close();
}

/* ---------- Ctx ---------- */

export async function getCtx(conversationId: string): Promise<AgentCtx | null> {
	try {
		return await httpFetch<AgentCtx>(`/api/agent/ctx?conversationId=${encodeURIComponent(conversationId)}`);
	} catch {
		return null;
	}
}

/* ---------- 会话管理 ---------- */

export async function getConversations(): Promise<ConversationMeta[]> {
	try {
		const result = await httpFetch<{ conversations: ConversationMeta[] }>('/api/conversations');
		return result.conversations;
	} catch {
		return [];
	}
}

export async function getConversation(id: string): Promise<ServiceConversation | null> {
	try {
		return await httpFetch<ServiceConversation>(`/api/conversations/${encodeURIComponent(id)}`);
	} catch {
		return null;
	}
}

export async function createConversation(params: { folderId?: string; title?: string }): Promise<ServiceConversation | null> {
	try {
		return await httpFetch<ServiceConversation>('/api/conversations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
	} catch {
		return null;
	}
}

export async function deleteConversation(id: string): Promise<boolean> {
	try {
		await httpFetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
		return true;
	} catch {
		return false;
	}
}

export async function updateConversation(id: string, patch: Partial<ConversationMeta>): Promise<boolean> {
	try {
		await httpFetch(`/api/conversations/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		});
		return true;
	} catch {
		return false;
	}
}

/** 保存 UI 消息。**不要**顺手回写 agentCtx：ctx 由后端 Runner 自己持久化（ctx.json 是唯一真相），
 *  前端手上那份只是快照，回写会把实例树/轮次回滚。 */
export async function saveConversationData(id: string, data: { messages: ServiceConversation['messages'] }): Promise<boolean> {
	try {
		await httpFetch(`/api/conversation-data/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		return true;
	} catch {
		return false;
	}
}

/* ---------- 设置 — 模型提供商 ---------- */

export async function getProviders(): Promise<ModelProvider[]> {
	try {
		return await httpFetch<ModelProvider[]>('/api/settings/providers');
	} catch {
		return [];
	}
}

export async function setProviders(providers: ModelProvider[]): Promise<boolean> {
	try {
		await httpFetch('/api/settings/providers', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(providers),
		});
		return true;
	} catch {
		return false;
	}
}

export async function getCurrentModel(): Promise<{
	standard: ServiceSettings['currentStandardModel'];
	economy: ServiceSettings['currentEconomyModel'];
} | null> {
	try {
		return await httpFetch('/api/settings/current-model');
	} catch {
		return null;
	}
}

export async function setCurrentModel(params: { standard?: ServiceSettings['currentStandardModel']; economy?: ServiceSettings['currentEconomyModel'] }): Promise<boolean> {
	try {
		await httpFetch('/api/settings/current-model', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
		return true;
	} catch {
		return false;
	}
}

/* ---------- 设置 — 模式（取代 v1 的 Agent 配置） ---------- */

/** 聚合所有插件 → 模式列表（含当前生效配置） */
export async function getModes(): Promise<ModeSummary[]> {
	try {
		return await httpFetch<ModeSummary[]>('/api/modes');
	} catch {
		return [];
	}
}

export async function getMode(id: string): Promise<Record<string, unknown> | null> {
	try {
		return await httpFetch(`/api/modes/${encodeURIComponent(id)}`);
	} catch {
		return null;
	}
}

export async function getModeConfigs(): Promise<Record<string, ModeConfigDefaults>> {
	try {
		return await httpFetch<Record<string, ModeConfigDefaults>>('/api/settings/mode-configs');
	} catch {
		return {};
	}
}

export async function setModeConfigs(configs: Record<string, ModeConfigDefaults>): Promise<boolean> {
	try {
		await httpFetch('/api/settings/mode-configs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(configs),
		});
		return true;
	} catch {
		return false;
	}
}

export async function getCurrentMode(): Promise<string | null> {
	try {
		const resp = await httpFetch<{ currentModeId: string }>('/api/settings/current-mode');
		return resp.currentModeId ?? null;
	} catch {
		return null;
	}
}

export async function setCurrentMode(currentModeId: string): Promise<boolean> {
	try {
		await httpFetch('/api/settings/current-mode', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ currentModeId }),
		});
		return true;
	} catch {
		return false;
	}
}

export interface PluginLoadErrorInfo {
	level: 'error' | 'warn';
	pluginId?: string;
	modeId?: string;
	agentId?: string;
	message: string;
}

/** 插件（含加载错误 / 被覆盖标记） */
export async function getPlugins(): Promise<{ plugins: unknown[]; errors: PluginLoadErrorInfo[]; overridden: string[] }> {
	try {
		return await httpFetch('/api/plugins');
	} catch {
		return { plugins: [], errors: [], overridden: [] };
	}
}

/** 重新扫描并加载插件 */
export async function reloadPlugins(): Promise<{ ok: boolean; modes?: string[]; errors?: PluginLoadErrorInfo[] }> {
	try {
		return await httpFetch('/api/plugins/reload', { method: 'POST' });
	} catch (e: any) {
		return { ok: false, errors: [{ level: 'error', message: e?.message ?? String(e) }] };
	}
}

/* ---------- 设置 — 用量 ---------- */

export async function getUsage(): Promise<UsageStats | null> {
	try {
		return await httpFetch<UsageStats>('/api/settings/usage');
	} catch {
		return null;
	}
}

export async function setUsage(usage: UsageStats): Promise<boolean> {
	try {
		await httpFetch('/api/settings/usage', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(usage),
		});
		return true;
	} catch {
		return false;
	}
}

/* ---------- 设置 — MCP 服务器 ---------- */

export async function getMcpServers(): Promise<McpServerConfig[]> {
	try {
		return await httpFetch<McpServerConfig[]>('/api/settings/mcp-servers');
	} catch {
		return [];
	}
}

export async function setMcpServers(servers: McpServerConfig[]): Promise<boolean> {
	try {
		await httpFetch('/api/settings/mcp-servers', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(servers),
		});
		return true;
	} catch {
		return false;
	}
}

/** 运行态：哪些服务器已连上、各自有哪些工具 */
export async function getMcpStatus(): Promise<McpServerStatus[]> {
	try {
		return await httpFetch<McpServerStatus[]>('/api/mcp/status');
	} catch {
		return [];
	}
}

export async function getMcpTools(): Promise<McpToolInfo[]> {
	try {
		return await httpFetch<McpToolInfo[]>('/api/mcp/tools');
	} catch {
		return [];
	}
}

export async function connectMcpServer(id: string): Promise<{ ok: boolean; error?: string; status?: McpServerStatus }> {
	try {
		return await httpFetch('/api/mcp/connect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		});
	} catch (e: any) {
		return { ok: false, error: e?.message };
	}
}

export async function disconnectMcpServer(id: string): Promise<{ ok: boolean }> {
	try {
		return await httpFetch('/api/mcp/disconnect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		});
	} catch {
		return { ok: false };
	}
}

/** 用一份还没保存的配置试连，返回服务器信息和工具清单 */
export async function testMcpServer(config: McpServerConfig): Promise<{
	ok: boolean;
	tools: McpToolInfo[];
	error?: string;
	serverInfo?: { name?: string; version?: string };
}> {
	try {
		return await httpFetch('/api/mcp/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		});
	} catch (e: any) {
		return { ok: false, tools: [], error: e?.message };
	}
}

/** 手动调用一个 MCP 工具（设置面板里用来验证效果） */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<{ success: boolean; content: string; error?: string }> {
	try {
		return await httpFetch('/api/mcp/call', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, arguments: args }),
		});
	} catch (e: any) {
		return { success: false, content: '', error: e?.message };
	}
}

/* ---------- 设置 — 文件夹 ---------- */

export async function getFolders(): Promise<Folder[]> {
	try {
		return await httpFetch<Folder[]>('/api/settings/folders');
	} catch {
		return [];
	}
}

export async function setFolders(folders: Folder[]): Promise<boolean> {
	try {
		await httpFetch('/api/settings/folders', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(folders),
		});
		return true;
	} catch {
		return false;
	}
}

/* ---------- client 工具（ask_user）的回答 ---------- */

/** 回答一个 client 工具调用（ask_user），续接该实例的 agentLoop */
export async function answerToolCall(params: { conversationId: string; toolCallId: string; result: string }): Promise<{ ok: boolean; error?: string }> {
	try {
		return await httpFetch('/api/agent/answer', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
	} catch (e: any) {
		return { ok: false, error: e?.message };
	}
}

/* ---------- 任务清单 ---------- */

export async function getTaskList(conversationId: string): Promise<string> {
	try {
		const resp = await httpFetch<{ taskList: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/tasklist`);
		return resp.taskList ?? '';
	} catch {
		return '';
	}
}

export async function setTaskList(conversationId: string, taskList: string): Promise<boolean> {
	try {
		await httpFetch(`/api/conversations/${encodeURIComponent(conversationId)}/tasklist`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ taskList }),
		});
		return true;
	} catch {
		return false;
	}
}

/* ---------- 单个 AgentInstance（调试 / 详情） ---------- */

export async function getAgentInstance(conversationId: string, agentInstanceId: string): Promise<AgentInstance | null> {
	try {
		return await httpFetch<AgentInstance>(`/api/conversations/${encodeURIComponent(conversationId)}/agent-instances/${encodeURIComponent(agentInstanceId)}`);
	} catch {
		return null;
	}
}

/* ---------- LLM 请求日志 ---------- */

export async function getRequests(
	conversationId: string,
	opts: { limit?: number; agentInstanceId?: string; purpose?: string; since?: number } = {},
): Promise<LlmRequestRecord[]> {
	try {
		const qs = new URLSearchParams();
		if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
		if (opts.agentInstanceId) qs.set('agentInstanceId', opts.agentInstanceId);
		if (opts.purpose) qs.set('purpose', opts.purpose);
		if (opts.since !== undefined) qs.set('since', String(opts.since));
		const resp = await httpFetch<{ requests: LlmRequestRecord[] }>(
			`/api/conversations/${encodeURIComponent(conversationId)}/requests?${qs.toString()}`,
		);
		return resp.requests ?? [];
	} catch {
		return [];
	}
}

export interface RequestStatsResponse {
	total: number;
	byStatus: Record<string, number>;
	byPurpose: Record<string, { count: number; input: number; output: number }>;
	byModel: Record<string, { count: number; input: number; output: number }>;
	byAgentInstance: Record<string, { count: number; input: number; output: number; agentName?: string }>;
}

export async function getRequestStats(conversationId: string): Promise<RequestStatsResponse | null> {
	try {
		return await httpFetch<RequestStatsResponse>(`/api/conversations/${encodeURIComponent(conversationId)}/requests/stats`);
	} catch {
		return null;
	}
}

export async function clearRequests(conversationId: string): Promise<boolean> {
	try {
		await httpFetch(`/api/conversations/${encodeURIComponent(conversationId)}/requests`, { method: 'DELETE' });
		return true;
	} catch {
		return false;
	}
}
