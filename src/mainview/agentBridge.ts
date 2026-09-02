/* ==========================================================================
   agentBridge — Agent 业务能力（对齐 FFBox 的 serviceBridge 职责）

   参照 FFBox：Agent 相关调用全部改用 HTTP 接口（主进程 http-server.ts）。
   这样浏览器环境（Vite dev / 浏览器 Agent）也能连上真实的 Agent 引擎。

   - 启动时探测主进程 HTTP Server，可用则全程走 HTTP（fetch + SSE）
   - 否则回退到 electrobun RPC
   - 传输通道只选一个（避免 SSE / RPC 双通道重复事件）
   ========================================================================== */

import { rpc, subscribeAgentStream as _subscribeRpc } from './rpc';
import type {
	AgentRunRequest,
	AgentCtx,
	AgentStreamEvent,
} from '../shared/agent';

/** Agent HTTP Server 地址（与主进程 http-server.ts 的 HTTP_PORT 一致） */
const HTTP_PORT = 18999;
const HTTP_BASE = `http://localhost:${HTTP_PORT}`;

/** Agent 运行结果 */
export interface AgentRunResult {
	ok: boolean;
	finalSummary?: string;
	ctx?: AgentCtx;
	error?: string;
}

/* ---------- 传输通道探测 ---------- */

type Transport = 'http' | 'rpc' | 'unknown';
let transport: Transport = 'unknown';
let _httpOk: boolean | null = null;

async function probeHttp(): Promise<boolean> {
	if (_httpOk !== null) return _httpOk;
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 1500);
		const resp = await fetch(`${HTTP_BASE}/api/health`, { signal: ctrl.signal });
		clearTimeout(timer);
		_httpOk = resp.ok;
	} catch {
		_httpOk = false;
	}
	return _httpOk;
}

/** 解析传输通道（模块加载即开始探测） */
async function resolveTransport(): Promise<Transport> {
	if (transport !== 'unknown') return transport;
	transport = (await probeHttp()) ? 'http' : 'rpc';
	console.log(`[agentBridge] transport = ${transport}`);
	return transport;
}

// 模块加载时立即开始探测，让用户操作前通道已确定
void resolveTransport();

/* ---------- Agent 运行 ---------- */

/** 发起 Agent 运行 — 立即返回，真正结果从 agentStream（SSE/RPC）汇总 */
export async function runAgent(params: AgentRunRequest): Promise<AgentRunResult> {
	const t = await resolveTransport();

	if (t === 'http') {
		try {
			const resp = await fetch(`${HTTP_BASE}/api/agent/run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(params),
			});
			const result = await resp.json();
			if (!result.ok) {
				return { ok: false, error: result.error };
			}
			return { ok: true, finalSummary: '', ctx: result.data?.ctx };
		} catch (e: any) {
			console.warn('[agentBridge] HTTP agentRun failed, fallback to RPC:', e?.message);
			transport = 'rpc';
		}
	}

	// 回退 RPC
	const result = await rpc.request.agentRun(params);
	if (!result.ok) {
		return { ok: false, error: result.error };
	}
	return { ok: true, finalSummary: '', ctx: result.data.ctx };
}

/** 取消 Agent 运行 */
export async function cancelAgent(conversationId: string): Promise<boolean> {
	const t = await resolveTransport();

	if (t === 'http') {
		try {
			const resp = await fetch(`${HTTP_BASE}/api/agent/cancel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ conversationId }),
			});
			const result = await resp.json();
			if (result.ok) return true;
		} catch (e: any) {
			console.warn('[agentBridge] HTTP agentCancel failed, fallback to RPC:', e?.message);
			transport = 'rpc';
		}
	}

	const result = await rpc.request.agentCancel({ conversationId });
	return result.ok;
}

/* ---------- 流式订阅 ---------- */

/** 打开 SSE 连接，返回取消订阅函数 */
function openSse(
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
			// 忽略坏消息
		}
	};
	es.onerror = (e) => {
		// 不主动 close：让 EventSource 按服务端 retry 间隔自动重连，
		// 只有调用方显式取消（unsubscribe）才真正断开
		console.warn(`[agentBridge] SSE ${conversationId} 连接异常，等待自动重连:`, e);
	};
	return () => es.close();
}

/**
 * 订阅某个 conversation 的 Agent 流式事件。
 * 传输通道与 runAgent 一致（HTTP SSE 或 RPC），保证不重复。
 */
export function subscribeStream(
	conversationId: string,
	listener: (event: AgentStreamEvent) => void,
): () => void {
	if (transport === 'http') {
		return openSse(conversationId, listener);
	}

	// rpc / unknown（unknown 时等 resolveTransport 完成后再注册对应通道）
	if (transport === 'unknown') {
		let unsub: (() => void) | null = null;
		void resolveTransport().then((t) => {
			unsub = t === 'http'
				? openSse(conversationId, listener)
				: _subscribeRpc(conversationId, listener);
		});
		return () => unsub?.();
	}

	return _subscribeRpc(conversationId, listener);
}
