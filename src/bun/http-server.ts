/* ==========================================================================
   Agent HTTP Server — MindTheGap-Harness

   参照 FFBox 的 serviceBridge 思路：把 Agent 相关调用从 electrobun RPC
   改为 HTTP 接口，这样：
   - 浏览器环境（Vite dev / Playwright / 浏览器 Agent）也能连上主进程
   - WebView2 渲染进程同样走 HTTP，前后端解耦

   接口:
   - GET  /api/health                       健康检查
   - POST /api/agent/run                    body: AgentRunRequest
   - POST /api/agent/cancel                 body: { conversationId }
   - GET  /api/agent/stream?conversationId= SSE 流式推送 AgentStreamEvent
   ========================================================================== */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentStreamEvent } from '../shared/agent';
import { agentRun, agentCancel } from './rpc-handlers';

export const HTTP_PORT = 18999;

// SSE 订阅者：conversationId -> Set<Response>
const sseClients = new Map<string, Set<ServerResponse>>();

// #region 工具函数

function setCors(res: ServerResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, code: number, obj: unknown) {
	res.writeHead(code, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => (data += chunk));
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

// #endregion

// #region 流式广播

/** 向某个 conversation 的所有 SSE 客户端推送事件 */
export function broadcastAgentStream(conversationId: string, event: AgentStreamEvent) {
	const clients = sseClients.get(conversationId);
	if (!clients || clients.size === 0) return;
	const payload = `data: ${JSON.stringify(event)}\n\n`;
	for (const res of clients) {
		try {
			res.write(payload);
		} catch {
			// 客户端已断开
		}
	}
}

// #endregion

// #region HTTP 路由

export function startHttpServer() {
	const server = createServer(async (req, res) => {
		setCors(res);

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? '/', `http://localhost:${HTTP_PORT}`);
		const path = url.pathname;

		try {
			// 健康检查
			if (req.method === 'GET' && path === '/api/health') {
				sendJson(res, 200, { ok: true, service: 'mindthegap-agent', port: HTTP_PORT });
				return;
			}

			// Agent 运行（立即返回，流式走 SSE）
			if (req.method === 'POST' && path === '/api/agent/run') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				const result = await agentRun(params);
				sendJson(res, 200, result);
				return;
			}

			// Agent 取消
			if (req.method === 'POST' && path === '/api/agent/cancel') {
				const body = await readBody(req);
				const { conversationId } = JSON.parse(body || '{}');
				const result = await agentCancel({ conversationId });
				sendJson(res, 200, result);
				return;
			}

			// SSE 流式订阅
			if (req.method === 'GET' && path === '/api/agent/stream') {
				const conversationId = url.searchParams.get('conversationId') ?? '';
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
					'Access-Control-Allow-Origin': '*',
				});
				res.write('retry: 1000\n\n');

				if (!sseClients.has(conversationId)) sseClients.set(conversationId, new Set());
				sseClients.get(conversationId)!.add(res);

				// 客户端断开时清理
				req.on('close', () => {
					const set = sseClients.get(conversationId);
					if (set) {
						set.delete(res);
						if (set.size === 0) sseClients.delete(conversationId);
					}
				});
				return;
			}

			sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
		} catch (e: any) {
			sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
		}
	});

	server.listen(HTTP_PORT, () => {
		console.log(`[HttpServer] Agent HTTP API listening on http://localhost:${HTTP_PORT}`);
	});
	return server;
}

// #endregion
