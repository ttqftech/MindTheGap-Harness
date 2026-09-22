/* ==========================================================================
   Agent HTTP Server — MindTheGap-Harness

   所有 Agent 相关操作走 HTTP（对齐 FFBox 的 serviceBridge）。
   Agent Service 可脱离 electrobun 独立运行。

   v2 的接口见 docs/Agent架构-v2设计.md §12：
   modes / agent/answer / plugins/reload / agent-instances / requests / tasklist
   ========================================================================== */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
	AgentAnswerRequest,
	AgentCtx,
	AgentInstance,
	AgentRunRequest,
	AgentStreamEvent,
	McpServerConfig,
	ModeDefinition,
	ModeSummary,
} from '../shared/agent';
import { createRunner, ensurePluginsLoaded, type AgentRunner } from './agent/runner';
import { getBuiltinToolNames } from './agent/tools';
import { setUsageEmitter } from './llm/model';
import {
	clearRequests, readRequestStats, readRequests, setRequestLogOptions,
} from './llm/requestLog';
import { getLoadErrors, listModes, listPlugins, loadAllPlugins, saveModeJson } from './plugins/loader';
import { mcpManager } from './mcp/manager';
import { settings, conversations, conversationMetas, getConversationCtxById, createConversation, snapshot } from './storage';
import type { ServiceHealth } from '../shared/buildInfo';
import { logMsg } from './utils';

export const HTTP_PORT = 18999;

/** 本服务启动时间（ISO UTC）：health 里用来区分「刚起的进程」和「跑了两天的旧进程」 */
const SERVICE_STARTED_AT = new Date().toISOString();

const sseClients = new Map<string, Set<ServerResponse>>();

/** 正在跑的 Runner：conversationId → Runner */
const activeRunners = new Map<string, AgentRunner>();

/** 上次插件加载结果里「被用户插件覆盖」的 mode id */
let overriddenModeIds: string[] = [];

/** electrobun 发布通道，由 startHttpServer 的调用方注入（本文件不引 electrobun，便于独立运行） */
let serviceChannel = 'unknown';

/** 组装 /api/health 的返回体：构建信息 + 运行时信息 */
function healthInfo(): ServiceHealth {
	return {
		ok: true,
		service: 'mindthegap-agent',
		port: HTTP_PORT,
		pid: process.pid,
		channel: serviceChannel,
		startedAt: SERVICE_STARTED_AT,
		build: buildInfo,
	};
}

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

// #region 插件 / 模式

/** 重新加载插件并把 requestLog 配置同步给 llm 层 */
function reloadPlugins(): { plugins: number; modes: string[]; errors: unknown[]; overridden: string[] } {
	ensurePluginsLoaded();
	const result = loadAllPlugins({ knownToolNames: getBuiltinToolNames });
	overriddenModeIds = result.overridden;
	return {
		plugins: result.plugins.length,
		modes: result.modes.map((m) => m.id),
		errors: [...getLoadErrors()],
		overridden: overriddenModeIds,
	};
}

/** 模式定义 → 对外摘要（含 mode.json 源码，设置页的编辑器直接改它） */
function toModeSummary(mode: ModeDefinition): ModeSummary {
	return {
		id: mode.id,
		name: mode.name,
		description: mode.description,
		pluginId: mode.pluginId,
		pluginName: mode.pluginName,
		rootAgent: mode.rootAgent,
		agents: Object.values(mode.agents).map((a) => ({
			id: a.id,
			name: a.name,
			delegatable: a.delegatable ?? [],
		})),
		maxDepth: mode.maxDepth,
		ui: mode.ui,
		// 模式配置就是 mode.json 顶层的这几个字段，不再有 settings 覆盖层
		limits: mode.limits,
		modeJson: mode.modeJsonText,
		modeJsonPath: mode.modeJsonPath,
		overridden: overriddenModeIds.includes(mode.id),
	};
}

/** 聚合所有插件 → ModeSummary[] */
function buildModeSummaries(): ModeSummary[] {
	return listModes().map((mode) => toModeSummary(mode));
}

// #endregion

// #region Agent 运行

async function handleAgentRun(params: AgentRunRequest) {
	const { conversationId } = params;

	const existing = activeRunners.get(conversationId);
	if (existing?.isRunning()) {
		// 同一个会话不允许并行两轮 run；旧的那轮先停掉
		existing.cancel();
		activeRunners.delete(conversationId);
	}

	const { runner, error } = createRunner(params, {
		onStream: (event) => dispatchStream(conversationId, event),
	});
	if (!runner) {
		dispatchStream(conversationId, { type: 'error', message: error ?? 'Agent 启动失败' });
		dispatchStream(conversationId, { type: 'done', summary: '' });
		return { ok: false, error };
	}

	activeRunners.set(conversationId, runner);

	runner
		.run(params.userMessage)
		.then(() => runner.waitDone())
		.then(() => {
			if (activeRunners.get(conversationId) === runner) activeRunners.delete(conversationId);
		})
		.catch((err) => {
			activeRunners.delete(conversationId);
			console.error(`[Agent] Runner ${conversationId} error:`, err);
			dispatchStream(conversationId, { type: 'error', message: err?.message ?? String(err) });
		});

	return { ok: true, conversationId };
}

function handleAgentCancel(conversationId: string) {
	const runner = activeRunners.get(conversationId);
	if (!runner) {
		return { ok: false, error: `No running agent for conversation ${conversationId}` };
	}
	runner.cancel();
	activeRunners.delete(conversationId);
	return { ok: true };
}

async function handleAgentAnswer(params: AgentAnswerRequest) {
	const runner = activeRunners.get(params.conversationId);
	if (!runner) {
		return { ok: false, error: `会话 ${params.conversationId} 当前没有正在运行的 Agent` };
	}
	return runner.answerToolCall(params.toolCallId, params.result);
}

// #endregion

// #region 任务清单

function getTaskList(conversationId: string): string {
	return getConversationCtxById(conversationId)?.taskList ?? '';
}

function setTaskList(conversationId: string, taskList: string): { ok: boolean; error?: string } {
	const conv = conversations[conversationId];
	if (!conv) return { ok: false, error: 'Not found' };
	const ctx = conv.agentCtx as AgentCtx | undefined;
	if (!ctx) return { ok: false, error: '该会话还没有 agentCtx' };
	ctx.taskList = taskList;
	return { ok: true };
}

// #endregion

/**
 * 启动 Agent HTTP 服务。
 * @param options.channel electrobun 发布通道（dev / canary / stable），仅用于 health 自报，默认 'unknown'
 */
export function startHttpServer(options: { channel?: string } = {}) {
	serviceChannel = options.channel ?? 'unknown';

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
			// 健康检查 —— 返回构建信息 + 运行时信息，而不是干巴巴一个 ok：
			// 端口被旧进程占着时，旧进程同样会回 ok，只有 gitCommit / buildTime / pid 能拆穿它
			if (req.method === 'GET' && path === '/api/health') {
				sendJson(res, 200, healthInfo());
				return;
			}

			// ---------- 插件 / 模式 ----------

			if (req.method === 'GET' && path === '/api/modes') {
				sendJson(res, 200, buildModeSummaries());
				return;
			}

			if (req.method === 'GET' && path === '/api/plugins') {
				sendJson(res, 200, { plugins: listPlugins(), errors: getLoadErrors(), overridden: overriddenModeIds });
				return;
			}

			if (req.method === 'POST' && path === '/api/plugins/reload') {
				const result = reloadPlugins();
				logMsg(`[HttpServer] 插件已重新加载：${result.modes.join(', ')}`);
				sendJson(res, 200, { ok: true, ...result });
				return;
			}

			if (req.method === 'GET' && path.startsWith('/api/modes/')) {
				const id = decodeURIComponent(path.slice('/api/modes/'.length));
				const mode = listModes().find((m) => m.id === id);
				if (!mode) {
					sendJson(res, 404, { ok: false, error: `模式不存在: ${id}` });
					return;
				}
				// 整份返回（含 mode.json 源码），设置页据此渲染源码编辑器
				sendJson(res, 200, {
					...mode,
					...toModeSummary(mode),
				});
				return;
			}

			// 保存 mode.json（设置页源码编辑器）—— 只有校验通过才落盘
			if (req.method === 'PUT' && path.startsWith('/api/modes/')) {
				const id = decodeURIComponent(path.slice('/api/modes/'.length));
				const body = await readBody(req);
				const { json } = JSON.parse(body || '{}') as { json?: string };
				if (typeof json !== 'string') {
					sendJson(res, 400, { ok: false, error: '请求体需要 { json: "<mode.json 的文本内容>" }' });
					return;
				}
				const result = saveModeJson(id, json);
				if (!result.ok) {
					sendJson(res, 400, { ok: false, error: result.error });
					return;
				}
				logMsg(`[HttpServer] 已保存 mode.json：${id}`);
				sendJson(res, 200, { ok: true, mode: result.mode ? toModeSummary(result.mode) : null });
				return;
			}

			// ---------- Agent 运行 ----------

			if (req.method === 'POST' && path === '/api/agent/run') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}') as AgentRunRequest;
				const result = await handleAgentRun(params);
				sendJson(res, 200, result);
				return;
			}

			if (req.method === 'POST' && path === '/api/agent/cancel') {
				const body = await readBody(req);
				const { conversationId } = JSON.parse(body || '{}');
				sendJson(res, 200, handleAgentCancel(conversationId));
				return;
			}

			// 回答 client 工具（ask_user）
			if (req.method === 'POST' && path === '/api/agent/answer') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}') as AgentAnswerRequest;
				sendJson(res, 200, await handleAgentAnswer(params));
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

			// ---------- 会话内的子资源 ----------
			// /api/conversations/:id/{requests|requests/stats|tasklist|agent-instances/:agentInstanceId}

			const convSub = /^\/api\/conversations\/([^/]+)\/(.+)$/.exec(path);
			if (convSub) {
				const conversationId = decodeURIComponent(convSub[1]);
				const rest = convSub[2];

				if (rest === 'tasklist') {
					if (req.method === 'GET') {
						sendJson(res, 200, { taskList: getTaskList(conversationId) });
						return;
					}
					if (req.method === 'PUT') {
						const body = await readBody(req);
						const { taskList } = JSON.parse(body || '{}');
						sendJson(res, 200, setTaskList(conversationId, taskList ?? ''));
						return;
					}
				}

				if (rest === 'requests' || rest === 'requests/stats') {
					if (req.method === 'GET' && rest === 'requests/stats') {
						sendJson(res, 200, readRequestStats(conversationId));
						return;
					}
					if (req.method === 'GET') {
						const limit = Number(url.searchParams.get('limit') ?? 50);
						const records = readRequests(conversationId, {
							limit,
							agentInstanceId: url.searchParams.get('agentInstanceId') ?? undefined,
							purpose: url.searchParams.get('purpose') ?? undefined,
							since: url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined,
						});
						sendJson(res, 200, { requests: records });
						return;
					}
					if (req.method === 'DELETE') {
						clearRequests(conversationId);
						sendJson(res, 200, { ok: true });
						return;
					}
				}

				const instanceMatch = /^agent-instances\/(.+)$/.exec(rest);
				if (instanceMatch && req.method === 'GET') {
					const agentInstanceId = decodeURIComponent(instanceMatch[1]);
					const ctx = getConversationCtxById(conversationId);
					const instance: AgentInstance | undefined = ctx?.agentInstances?.[agentInstanceId];
					sendJson(res, 200, instance ?? { ok: false, error: 'Not found' });
					return;
				}
			}

			// ---------- 会话管理 ----------

			if (req.method === 'GET' && path === '/api/conversations') {
				sendJson(res, 200, { conversations: conversationMetas() });
				return;
			}

			if (req.method === 'POST' && path === '/api/conversations') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				sendJson(res, 200, createConversation(params));
				return;
			}

			if (req.method === 'GET' && path.startsWith('/api/conversations/')) {
				const id = decodeURIComponent(path.slice('/api/conversations/'.length));
				sendJson(res, 200, conversations[id] ?? { ok: false, error: 'Not found' });
				return;
			}

			if (req.method === 'DELETE' && path.startsWith('/api/conversations/')) {
				const id = decodeURIComponent(path.slice('/api/conversations/'.length));
				activeRunners.get(id)?.cancel();
				activeRunners.delete(id);
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

			// 前端只写 UI 消息：agentCtx 归后端 Runner 所有（ctx.json 是 agent 层的唯一真相），
			// 前端手上那份只是打开会话时的快照，回写会把实例树 / 轮次 / 预算回滚成旧值。
			if (req.method === 'PUT' && path.startsWith('/api/conversation-data/')) {
				const id = decodeURIComponent(path.slice('/api/conversation-data/'.length));
				const body = await readBody(req);
				const data = JSON.parse(body || '{}');
				const conv = conversations[id];
				if (conv) conv.messages = data.messages;
				sendJson(res, 200, conv ?? { ok: false, error: 'Not found' });
				return;
			}

			// ---------- 设置 — 模型提供商 ----------

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

			// 「当前模式」不再由后端持久化：它只是前端 composer 的选择，跟着前端偏好走。

			// 设置 — 基座提示词（由各 Agent 的 prompt.md 用 {{ basePrompt }} 决定是否内嵌）
			// 没有默认值：没填就返回空串，前端文本框也就是空的
			if (req.method === 'GET' && path === '/api/settings/base-prompt') {
				sendJson(res, 200, { basePrompt: settings.basePrompt ?? '' });
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/base-prompt') {
				const body = await readBody(req);
				const { basePrompt } = JSON.parse(body || '{}') as { basePrompt?: string };
				if (typeof basePrompt !== 'string') {
					sendJson(res, 400, { ok: false, error: '请求体需要 { basePrompt: "<markdown 文本>" }' });
					return;
				}
				settings.basePrompt = basePrompt;
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
		// 启动时加载插件 + 同步 requestLog 配置 + 订阅 usage 事件
		const loaded = reloadPlugins();
		setRequestLogOptions(getRequestLogOptionsFromSettings());
		setUsageEmitter((e) => {
			broadcastAgentStream(e.conversationId, {
				type: 'usage',
				agentInstanceId: e.agentInstanceId,
				logId: e.logId,
				tokens: e.tokens,
				scope: 'call',
				seq: e.seq,
				round: e.round,
				purpose: e.purpose,
				agentName: e.agentName,
				depth: e.depth,
				durationMs: e.durationMs,
				model: e.model,
			});
		});
		for (const plugin of listPlugins()) {
			logMsg(`[HttpServer] 插件 ${plugin.id} (${plugin.source}) → 模式 ${plugin.modes.join(', ')}`);
		}
		logMsg(`[HttpServer] 模式就绪：${loaded.modes.join(', ')}`);
	});
	return server;
}

/** 从 settings 里读 requestLog 配置（带默认值兜底） */
function getRequestLogOptionsFromSettings() {
	const cfg = settings.debug?.requestLog;
	return {
		enabled: cfg?.enabled ?? true,
		includeToolNames: cfg?.includeToolNames ?? true,
		maxBytes: cfg?.maxBytes ?? 8 * 1024 * 1024,
		dumpPayload: cfg?.dumpPayload ?? false,
	};
}