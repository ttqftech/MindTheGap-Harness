/* ==========================================================================
   agentBridge — Agent Service HTTP + SSE（对齐 FFBox 的 serviceBridge 职责）

   重构后：纯 HTTP + SSE，不再有 RPC 回退。
   Agent Service 可脱离 electrobun 独立运行。
   所有 Agent 相关操作（会话、设置、运行、流式）全部走此 bridge。
   ========================================================================== */

import type {
	AgentRunRequest,
	AgentCtx,
	AgentStreamEvent,
	ConversationMeta,
	ServiceConversation,
	ServiceSettings,
	ModelProvider,
	AgentConfig,
	UsageStats,
	Folder,
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

export async function saveConversationData(id: string, data: { messages: ServiceConversation['messages']; agentCtx?: ServiceConversation['agentCtx'] }): Promise<boolean> {
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

export async function getCurrentModel(): Promise<ServiceSettings['currentStandardModel'] & { economy: ServiceSettings['currentEconomyModel'] } | null> {
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

/* ---------- 设置 — Agent 配置 ---------- */

export async function getAgentConfigs(): Promise<AgentConfig[]> {
	try {
		return await httpFetch<AgentConfig[]>('/api/settings/agent-configs');
	} catch {
		return [];
	}
}

export async function setAgentConfigs(configs: AgentConfig[]): Promise<boolean> {
	try {
		await httpFetch('/api/settings/agent-configs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(configs),
		});
		return true;
	} catch {
		return false;
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
