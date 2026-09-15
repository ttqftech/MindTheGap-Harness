/* ==========================================================================
   Agent HTTP Server — MindTheGap-Harness

   重构后：所有 Agent 相关操作走 HTTP（对齐 FFBox 的 serviceBridge）。
   新增：会话管理、设置管理、Ctx 同步等路由。
   Agent Service 可脱离 electrobun 独立运行。
   ========================================================================== */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentStreamEvent, AgentRunRequest, McpServerConfig } from '../shared/agent';
import { AgentEngine } from './agent/engine';
import { settings, conversations, conversationMetas, getConversationCtxById, createConversation, snapshot } from './storage';
import { mcpManager } from './mcp/manager';
import { logMsg } from './utils';

export const HTTP_PORT = 18999;

const sseClients = new Map<string, Set<ServerResponse>>();

const activeEngines = new Map<string, AgentEngine>();

function setCors(res: ServerResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

function dispatchStream(conversationId: string, event: AgentStreamEvent) {
	broadcastAgentStream(conversationId, event);
}

async function handleAgentRun(params: AgentRunRequest) {
	const { conversationId } = params;
	const existing = activeEngines.get(conversationId);
	if (existing) {
		console.warn(`[Agent] Conversation ${conversationId} already running.`);
	}

	try {
		const engine = new AgentEngine(params, {
			onStream: (event) => {
				dispatchStream(conversationId, event);
			},
		});

		activeEngines.set(conversationId, engine);

		engine.run().then(() => {
			activeEngines.delete(conversationId);
		}).catch((err) => {
			activeEngines.delete(conversationId);
			console.error(`[Agent] Engine ${conversationId} error:`, err);
			dispatchStream(conversationId, {
				type: 'error',
				message: err?.message ?? String(err),
			});
		});

		return { ok: true, conversationId };
	} catch (e: any) {
		activeEngines.delete(conversationId);
		return { ok: false, error: `Agent error: ${e?.message ?? String(e)}` };
	}
}

function handleAgentCancel(conversationId: string) {
	const engine = activeEngines.get(conversationId);
	if (!engine) {
		return { ok: false, error: `No running agent for conversation ${conversationId}` };
	}
	engine.abort();
	activeEngines.delete(conversationId);
	return { ok: true };
}

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

			// Agent 运行（立即返回。流式另走 SSE）
			if (req.method === 'POST' && path === '/api/agent/run') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				const result = await handleAgentRun(params);
				sendJson(res, 200, result);
				return;
			}

			// Agent 取消
			if (req.method === 'POST' && path === '/api/agent/cancel') {
				const body = await readBody(req);
				const { conversationId } = JSON.parse(body || '{}');
				const result = handleAgentCancel(conversationId);
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

			// Ctx
			if (req.method === 'GET' && path === '/api/agent/ctx') {
				const conversationId = url.searchParams.get('conversationId') ?? '';
				sendJson(res, 200, getConversationCtxById(conversationId));
				return;
			}

			// 会话管理
			if (req.method === 'GET' && path === '/api/conversations') {
				sendJson(res, 200, { conversations: conversationMetas() });
				return;
			}

			if (req.method === 'GET' && path.startsWith('/api/conversations/')) {
				const id = decodeURIComponent(path.slice('/api/conversations/'.length));
				sendJson(res, 200, conversations[id] ?? { ok: false, error: 'Not found' });
				return;
			}

			if (req.method === 'POST' && path === '/api/conversations') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				sendJson(res, 200, createConversation(params));
				return;
			}

			if (req.method === 'DELETE' && path.startsWith('/api/conversations/')) {
				const id = decodeURIComponent(path.slice('/api/conversations/'.length));
				delete conversations[id];
				sendJson(res, 200, { ok: true });
				return;
			}

			if (req.method === 'PUT' && path.startsWith('/api/conversations/')) {
				const id = decodeURIComponent(path.slice('/api/conversations/'.length));
				const body = await readBody(req);
				const patch = JSON.parse(body || '{}');
				const conv = conversations[id];
				// 赋值即持久化（updatedAt 由 storage 自动刷新）
				if (conv) Object.assign(conv, patch);
				sendJson(res, 200, conv ?? { ok: false, error: 'Not found' });
				return;
			}

			if (req.method === 'PUT' && path.startsWith('/api/conversation-data/')) {
				const id = decodeURIComponent(path.slice('/api/conversation-data/'.length));
				const body = await readBody(req);
				const data = JSON.parse(body || '{}');
				const conv = conversations[id];
				if (conv) {
					conv.messages = data.messages;
					if (data.agentCtx !== undefined) conv.agentCtx = data.agentCtx;
				}
				sendJson(res, 200, conv ?? { ok: false, error: 'Not found' });
				return;
			}

			// 设置 — 模型提供商
			if (req.method === 'GET' && path === '/api/settings/providers') {
				sendJson(res, 200, settings.providers);
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/providers') {
				const body = await readBody(req);
				settings.providers = JSON.parse(body || '[]');
				sendJson(res, 200, { ok: true });
				return;
			}

			if (req.method === 'GET' && path === '/api/settings/current-model') {
				sendJson(res, 200, { standard: settings.currentStandardModel, economy: settings.currentEconomyModel });
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/current-model') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				if (params.standard !== undefined) settings.currentStandardModel = params.standard;
				if (params.economy !== undefined) settings.currentEconomyModel = params.economy;
				sendJson(res, 200, { ok: true });
				return;
			}

			// 设置 — Agent 配置
			if (req.method === 'GET' && path === '/api/settings/agent-configs') {
				sendJson(res, 200, settings.agentConfigs);
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/agent-configs') {
				const body = await readBody(req);
				settings.agentConfigs = JSON.parse(body || '[]');
				sendJson(res, 200, { ok: true });
				return;
			}

			// 设置 — 用量
			if (req.method === 'GET' && path === '/api/settings/usage') {
				sendJson(res, 200, settings.usage);
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/usage') {
				const body = await readBody(req);
				settings.usage = JSON.parse(body || '{}');
				sendJson(res, 200, { ok: true });
				return;
			}

			// 设置 — MCP 服务器（配置持久化）
			if (req.method === 'GET' && path === '/api/settings/mcp-servers') {
				sendJson(res, 200, settings.mcpServers);
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/mcp-servers') {
				const body = await readBody(req);
				const servers = JSON.parse(body || '[]') as McpServerConfig[];
				settings.mcpServers = servers;
				// 配置变了立即同步连接（内部串行化，UI 连续保存也安全）
				// 传裸数据而不是 settings.mcpServers 代理：manager 会长期持有 config 做新旧比对
				void mcpManager.syncAll(servers);
				sendJson(res, 200, { ok: true });
				return;
			}

			// MCP — 运行态
			if (req.method === 'GET' && path === '/api/mcp/status') {
				sendJson(res, 200, mcpManager.getStatus());
				return;
			}

			if (req.method === 'GET' && path === '/api/mcp/tools') {
				sendJson(res, 200, mcpManager.getTools());
				return;
			}

			if (req.method === 'POST' && path === '/api/mcp/connect') {
				const body = await readBody(req);
				const { id } = JSON.parse(body || '{}');
				const servers = snapshot(settings.mcpServers);
				const cfg = servers.find((s) => s.id === id);
				if (!cfg) {
					sendJson(res, 404, { ok: false, error: `未找到 MCP 服务器 ${id}` });
					return;
				}
				await mcpManager.syncAll(servers);
				const status = mcpManager.getStatus().find((s) => s.id === id);
				sendJson(res, 200, { ok: mcpManager.isConnected(id), status });
				return;
			}

			if (req.method === 'POST' && path === '/api/mcp/disconnect') {
				const body = await readBody(req);
				const { id } = JSON.parse(body || '{}');
				mcpManager.disconnect(id);
				sendJson(res, 200, { ok: true });
				return;
			}

			// MCP — 用一份临时配置试连（不落盘、不影响现有连接）
			if (req.method === 'POST' && path === '/api/mcp/test') {
				const body = await readBody(req);
				const config = JSON.parse(body || '{}') as McpServerConfig;
				const result = await mcpManager.test(config);
				sendJson(res, 200, result);
				return;
			}

			// MCP — 直接调用某个工具（供设置面板手动验证）
			if (req.method === 'POST' && path === '/api/mcp/call') {
				const body = await readBody(req);
				const { name, arguments: args } = JSON.parse(body || '{}');
				const result = await mcpManager.callTool(name, args ?? {});
				sendJson(res, 200, result);
				return;
			}

			// 设置 — 文件夹
			if (req.method === 'GET' && path === '/api/settings/folders') {
				sendJson(res, 200, settings.folders);
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/folders') {
				const body = await readBody(req);
				settings.folders = JSON.parse(body || '[]');
				sendJson(res, 200, { ok: true });
				return;
			}

			sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
		} catch (e: any) {
			sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
		}
	});

	server.listen(HTTP_PORT, () => {
		logMsg(`[HttpServer] Agent HTTP API 开始监听 http://localhost:${HTTP_PORT}`);
	});
	return server;
}