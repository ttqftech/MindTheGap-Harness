/**
 * agentBridge — Agent Service HTTP + SSE（对齐 FFBox 的 serviceBridge 职责）
 *
 * 重构后：纯 HTTP + SSE，不再有 RPC 回退。
 * Agent Service 可脱离 electrobun 独立运行。
 * 所有 Agent 相关操作（会话、设置、运行、流式）全部走此 bridge。
 */

import type { AgentRunRequest, AgentCtx, AgentInstance, AgentStreamEvent, AuthInfo, ConversationMeta, ServiceConversation, ServiceSettings, LoginResult, ModelProvider, ModeSummary, Folder, McpServerConfig, McpServerStatus, McpToolInfo, LlmRequestRecord, UserConfig } from '@shared/agent';
import type { ServiceHealth } from '@shared/buildInfo';
import { sha256Hex } from '@shared/sha256';

// #region 连接目标（可手动指定 IP / 端口）

/**
 * 本机默认端点 = 主进程 spawn / adopt 的那个 Service。
 * 「本应用托管 / 接入现有」这个区别**只对本端点成立**，连到别的机器时它就是个外部服务。
 */
export const LOCAL_ENDPOINT = { host: '127.0.0.1', port: 18999 } as const;

export interface ServiceEndpoint {
	host: string;
	port: number;
}

/**
 * 当前请求目标。默认本机 18999，可在连接面板里手动改成别的 IP / 端口（Service 监听 0.0.0.0，
 * 所以同网段的另一台机器也能连）。由 `logic/authController.ts` 在每次连接前写入。
 */
let endpoint: ServiceEndpoint = { ...LOCAL_ENDPOINT };

export function setEndpoint(host: string, port: number): void {
	endpoint = { host: host.trim(), port };
}

export function getEndpoint(): ServiceEndpoint {
	return { ...endpoint };
}

function baseUrlOf(host: string, port: number): string {
	return `http://${host}:${port}`;
}

/** 展示用的 `host:port` */
export function endpointText(e: ServiceEndpoint = endpoint): string {
	return `${e.host}:${e.port}`;
}

// #endregion

// #region 登录态（Bearer sessionId）

/**
 * 当前登录会话 id。**真相在 Service 内存里**，这里只是每次请求要带上的凭据。
 * 由 `logic/authController.ts` 在登录成功 / 断开时通过 `setSession()` 写入。
 */
let sessionId: string | null = null;

export function setSession(id: string | null): void {
	sessionId = id;
}

export function getSession(): string | null {
	return sessionId;
}

/** 带上 Authorization 的请求头（没登录时原样返回，便于「登录前也要能访问」的接口） */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
	const headers: Record<string, string> = { ...extra };
	if (sessionId) headers['Authorization'] = `Bearer ${sessionId}`;
	return headers;
}

async function httpFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const resp = await fetch(`${baseUrlOf(endpoint.host, endpoint.port)}${path}`, {
		...init,
		headers: authHeaders(init?.headers as Record<string, string> | undefined),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		throw new Error(`HTTP ${resp.status}: ${text}`);
	}
	return resp.json();
}

/** 从 httpFetch 抛出的错误里取出后端的业务 error 字段（`{ ok:false, error }`） */
function businessError(e: unknown): string {
	const raw = String((e as Error)?.message ?? e);
	const json = raw.match(/\{.*\}$/)?.[0];
	if (json) {
		try {
			return (JSON.parse(json) as { error?: string }).error ?? raw;
		} catch {
			// 解析失败就用原文
		}
	}
	return raw;
}

// #endregion

// #region 认证（照抄 FFBox serviceBridge 的模型）

/**
 * 登录。口令在这里算 SHA-256（明文不出本机），失败时后端只回 `isSuccess:false`，
 * 由调用方翻成「用户名错误 / 密码错误」。
 */
export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string; sessionId?: string; username?: string; permissions?: AuthInfo['permissions'] }> {
	try {
		const result = await httpFetch<LoginResult>('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, passkey: password ? sha256Hex(password) : '' }),
		});
		if (!result.isSuccess) {
			return { ok: false, error: result.isUserExist === false ? '登录失败：用户名错误' : '登录失败：密码错误' };
		}
		return { ok: true, sessionId: result.sessionId, username, permissions: result.permissions ?? [] };
	} catch (e) {
		return { ok: false, error: `登录失败：${businessError(e)}` };
	}
}

/** 当前登录态。session 失效（服务重启过）时返回 null */
export async function getAuthInfo(): Promise<AuthInfo | null> {
	try {
		return await httpFetch<AuthInfo>('/api/auth/session');
	} catch {
		return null;
	}
}

/** 登出：让后端丢掉这个 sessionId（服务端的会话表在内存里，不删就一直有效） */
export async function logout(): Promise<void> {
	try {
		await httpFetch('/api/auth/logout', { method: 'POST' });
	} catch {
		// 服务已经没了也算登出成功（本地凭据照样清掉）
	}
}

/** 用户列表（设置页「用户管理」） */
export async function getUsers(): Promise<UserConfig[]> {
	try {
		return await httpFetch<UserConfig[]>('/api/settings/users');
	} catch {
		return [];
	}
}

/** 保存用户列表。后端要求「用户管理」权限，无权限时返回 error */
export async function setUsers(users: UserConfig[]): Promise<{ ok: boolean; error?: string }> {
	try {
		return await httpFetch('/api/settings/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(users),
		});
	} catch (e) {
		return { ok: false, error: businessError(e) };
	}
}

// #endregion

// #region 健康检查

/**
 * 探活某个端点并取回服务自报的构建信息。
 * 服务不可达返回 null（而不是吞掉细节的 false），调用方据此区分「后端没起来」与「起来了但版本不对」。
 *
 * 不碰模块里的 `endpoint`：连接面板要在**输入框里那个地址**上做探测，和当前连接目标未必是同一个。
 */
export async function probeHealthAt(host: string, port: number, timeoutMs = 3000): Promise<ServiceHealth | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const resp = await fetch(`${baseUrlOf(host, port)}/api/health`, { signal: ctrl.signal });
		if (!resp.ok) return null;
		return (await resp.json()) as ServiceHealth;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** 探活当前连接目标 */
export function health(): Promise<ServiceHealth | null> {
	return probeHealthAt(endpoint.host, endpoint.port);
}

// #endregion

// #region Agent 运行、回答问题

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

// #endregion

// #region 流式订阅

export function subscribeStream(conversationId: string, listener: (event: AgentStreamEvent) => void, onOpen?: () => void, onError?: () => void): () => void {
	// ⚠️ EventSource 不能自定义请求头，所以 sessionId 只能走 query（后端照抄 FFBox 的 WS 做法）
	const querySearch = new URLSearchParams({ conversationId });
	if (sessionId) querySearch.set('sessionId', sessionId);
	const es = new EventSource(`${baseUrlOf(endpoint.host, endpoint.port)}/api/agent/stream?${querySearch.toString()}`);
	// ⚠️ 建连是**异步**的（几百 ms）。调用方必须在发 run **之前**等到这里 open ——
	//    后端在连接建立前发出的头几条事件（含 `agent_start`）不会重放，会永久丢失，
	//    后果是在飞期间界面一片空白（详见 ChatView.beginRun 的说明）。
	es.onopen = () => onOpen?.();
	es.onmessage = (e) => {
		try {
			const event = JSON.parse(e.data) as AgentStreamEvent;
			listener(event);
		} catch (err) {
			// ⚠️ 千万别静默：这里一沉默，回调里抛的任何异常都退化成「界面上某块永远不动」的灵异现象 ——
			//    既没有报错也没有堆栈（2026-09-15：工具结果的 SSE 事件就是这么被吞了半个月，
			//    表现为「工具一直在执行中，跑完才出结果」）。宁可日志吵一点。
			console.error('[agentBridge] 处理流式事件失败', e.data, err);
		}
	};
	es.onerror = () => {
		// ⚠️ EventSource 默认自动重连，但重连有上限（浏览器通常 ~5s 间隔无限重试）。如果后端已不再推送（run 已结束 / 服务崩溃），无限重连只会浪费资源。
		//    通知调用方连接出了问题，让它决定是否要关闭订阅并收尾（2026-09-22 加）。
		onError?.();
	};
	return () => es.close();
}

// #endregion

// #region Ctx、会话管理

export async function getCtx(conversationId: string): Promise<AgentCtx | null> {
	try {
		return await httpFetch<AgentCtx>(`/api/agent/ctx?conversationId=${encodeURIComponent(conversationId)}`);
	} catch {
		return null;
	}
}

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

export async function createConversation(params: { folderId?: string; title?: string; modeId?: string }): Promise<ServiceConversation | null> {
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

export async function getTaskList(conversationId: string): Promise<string> {
	try {
		const resp = await httpFetch<{ taskList: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/tasklist`);
		return resp.taskList ?? '';
	} catch {
		return '';
	}
}

// #endregion

// #region 设置 — 模型提供商

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

// #endregion

// #region 设置 — 模式（取代 v1 的 Agent 配置）

/** 聚合所有插件 → 模式列表（含各自的 mode.json 源码） */
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

/**
 * 保存某个模式的 mode.json（设置页源码编辑器）。
 * 成功时才写入磁盘；校验不过后端会返回 error（并且不会留下半个坏文件）。
 */
export async function saveModeJson(id: string, json: string): Promise<{ ok: boolean; error?: string }> {
	try {
		return await httpFetch(`/api/modes/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ json }),
		});
	} catch (e: any) {
		return { ok: false, error: e?.message };
	}
}

/** 基座提示词（由各 Agent 的 prompt.md 用 {{ basePrompt }} 决定是否内嵌）。没有默认值，没填就是空串 */
export async function getBasePrompt(): Promise<{ basePrompt: string }> {
	try {
		const resp = await httpFetch<{ basePrompt: string }>('/api/settings/base-prompt');
		return { basePrompt: resp.basePrompt ?? '' };
	} catch {
		return { basePrompt: '' };
	}
}

export async function setBasePrompt(basePrompt: string): Promise<boolean> {
	try {
		await httpFetch('/api/settings/base-prompt', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ basePrompt }),
		});
		return true;
	} catch {
		return false;
	}
}

// #endregion

// #region 设置 — 内置 mock（开发用：LLM 走假模型，工具仍真实执行）

export interface MockState {
	enabled: boolean;
	scenario: string;
	/** 可选剧本（由后端给，前端不重复维护一份） */
	scenarios: { id: string; label: string }[];
}

export async function getMock(): Promise<MockState> {
	try {
		return await httpFetch<MockState>('/api/settings/mock');
	} catch {
		return { enabled: false, scenario: 'web', scenarios: [] };
	}
}

/**
 * 切换 mock。⚠️ 运行期间后端会拒绝（409，服务正在跑 LLM 时不让换），所以调用方必须处理失败。
 */
export async function setMock(params: { enabled?: boolean; scenario?: string }): Promise<{ ok: boolean; error?: string }> {
	try {
		return await httpFetch('/api/settings/mock', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(params),
		});
	} catch (e: any) {
		// httpFetch 会把整个响应体塞进 message，这里把后端的业务错误（`{ error }`）取出来给用户看
		const raw = String(e?.message ?? e);
		const json = raw.match(/\{.*\}$/)?.[0];
		if (json) {
			try {
				return { ok: false, error: (JSON.parse(json) as { error?: string }).error ?? raw };
			} catch {
				// 解析失败就用原文
			}
		}
		return { ok: false, error: raw };
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

// #endregion

// #region 设置 — MCP 服务器

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

/** 重置为默认：整份写回内置示例配置，返回重置后的列表 */
export async function resetMcpServers(): Promise<McpServerConfig[]> {
	try {
		const res = await httpFetch<{ ok: boolean; servers: McpServerConfig[] }>('/api/settings/mcp-servers/reset', {
			method: 'POST',
		});
		return res.servers ?? [];
	} catch {
		return [];
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

/** 手动调用一个 MCP 工具（设置面板里用来验证效果）（TODO 前端待实现） */
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

// #endregion

// #region 设置 — 文件夹

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

// #endregion

// #region LLM 请求日志

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

export async function clearRequests(conversationId: string): Promise<boolean> {
	try {
		await httpFetch(`/api/conversations/${encodeURIComponent(conversationId)}/requests`, { method: 'DELETE' });
		return true;
	} catch {
		return false;
	}
}

// #endregion
