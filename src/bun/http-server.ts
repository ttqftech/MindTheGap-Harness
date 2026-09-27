/**
 * Agent HTTP Server — MindTheGap-Harness
 *
 * 所有 Agent 相关操作走 HTTP（对齐 FFBox 的 serviceBridge）。
 * Agent Service 可脱离 electrobun 独立运行。
 *
 * v2 的接口见 docs/Agent架构-v2设计.md §12：
 * modes / agent/answer / plugins/reload / requests / tasklist
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentAnswerRequest, AgentCtx, AgentRunRequest, AgentStreamEvent, McpServerConfig, ModeDefinition, ModeSummary } from '@shared/agent';
import type { ServiceHealth } from '@shared/buildInfo';
import * as agentRunner from './agent/runner';
import { getBuiltinToolNames } from './agent/tools';
import { setMockResolver, setUsageEmitter, type UsageEmit } from './llm/model';
import { ensureMockServer, MOCK_SCENARIOS, setMockScenario } from './llm/mock';
import { clearRequests, readRequests, setRequestLogOptions } from './llm/requestLog';
import { getLoadErrors, listModes, listPlugins, loadAllPlugins, saveModeJson } from './plugins/loader';
import { mcpManager } from './mcp/manager';
import { settings, conversations, conversationMetas, getConversationCtxById, createConversation, getFolderExtraInfo, snapshot } from './storage';
import { logMsg } from './utils';

export const HTTP_PORT = 18999;

const SERVICE_STARTED_AT = new Date().toISOString();

const sseClients = new Map<string, Set<ServerResponse>>();

const activeRunners = new Map<string, agentRunner.AgentRunner>();	// conversationId → runner

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
	agentRunner.ensurePluginsLoaded();
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
	// ⚠️ 判据是「run 还活着」（running 或 waiting），不是「正在产出」：用户给**同一个会话**再发一条消息时，即使上一轮还挂在 ask_user 上等回答，也要先停掉旧的那轮。
	if (existing && existing.runStatus() !== 'stopped') {
		existing.cancel();
		activeRunners.delete(conversationId);
	}

	const { runner, error } = agentRunner.createRunner(params, {
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

// #endregion

/**
 * 把一次 LLM 请求的账本落进 ctx。
 *
 * 唯一埋点是 `callLlm` 的 usage emitter —— 主循环 / 反思 / ask_child / web_rank 四条路径都会经过它，所以账本只在这一处审计，不必在四个调用点各写一遍。
 *
 * 为什么导出：它不依赖 HTTP。`artifacts/e2e/probe-conversation.ts` 这类**进程内**探针不启本服务，需要手动 `setUsageEmitter(recordUsageInCtx)` 才能覆盖到账本落 ctx 这条链路（否则探针里账本恒为空）。
 */
export function recordUsageInCtx(e: UsageEmit) {
	if (!e.agentInstanceId) return;
	const instance = getConversationCtxById(e.conversationId)?.agentInstances?.[e.agentInstanceId];
	if (!instance) return;
	instance.llmCalls = (instance.llmCalls ?? 0) + 1;
	// 账本挂到「这次调用的产出物」上，不单开一条 system 条目（见 shared/agent.ts 的 `usages`）。
	// emitter 在 callLlm 内部触发，比 runner push assistant 更早，所以先暂存在实例上，由 runner 取走。
	instance.pendingUsage = [
		...(instance.pendingUsage ?? []),
		{
			seq: e.seq,
			round: e.round,
			purpose: e.purpose,
			model: e.model ?? '',
			logId: e.logId,
			input: e.tokens.input,
			output: e.tokens.output,
			cached: e.tokens.inputCached,
			total: e.tokens.total,
			durationMs: e.durationMs ?? 0,
		},
	];
}

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

			// #region 插件 / 模式

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

			// #endregion

			// #region Agent 运行

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

			// #endregion

			// #region 会话内的子资源

			// /api/conversations/:id/{tasklist|requests}

			const convSub = /^\/api\/conversations\/([^/]+)\/(.+)$/.exec(path);
			if (convSub) {
				const conversationId = decodeURIComponent(convSub[1]);
				const rest = convSub[2];

				if (rest === 'tasklist') {
					if (req.method === 'GET') {
						sendJson(res, 200, { taskList: getTaskList(conversationId) });
						return;
					}
				}

				if (rest === 'requests') {
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
			}

			// #endregion

			// #region 会话管理

			if (req.method === 'GET' && path === '/api/conversations') {
			// ⚠️ `runStatus` 是**运行态**（后端 activeRunners 里有没有这个会话 + 根实例 status），
			//   不落盘、不进 ctx，所以每次列表请求都现算一次 —— 成本就是遍历 activeRunners（通常 0~1 个）。
			// ⚠️ 三态：running / waiting 都算「活着」（侧边栏要点亮），stopped / undefined 不亮。
			const aliveIds = new Set<string>();
			for (const [id, runner] of activeRunners) if (runner.runStatus() !== 'stopped') aliveIds.add(id);
				sendJson(res, 200, {
					conversations: conversationMetas().map((meta) => ({
						...meta,
						runStatus: aliveIds.has(meta.id) ? (activeRunners.get(meta.id)!.runStatus()) : undefined,
					})),
				});
				return;
			}

			if (req.method === 'POST' && path === '/api/conversations') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}');
				const conversation = createConversation(params);
				// ⚠️ extraInfo 是运行时计算（不落盘），创建接口的返回值里也现算一次，
				//   否则「刚建好的会话」要等到下次列表刷新才能在面包屑里看到 branch @ commit。
				sendJson(res, 200, { ...conversation, extraInfo: getFolderExtraInfo(conversation.folderId) });
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

			// #endregion

			// #region 设置 — 模型提供商

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

			// #endregion

			// #region 设置 — 基座提示词

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

			// #endregion

			// #region 设置 — 内置 mock

			if (req.method === 'GET' && path === '/api/settings/mock') {
				const mock = settings.debug?.mock;
				sendJson(res, 200, {
					enabled: mock?.enabled ?? false,
					scenario: mock?.scenario ?? 'web',
					scenarios: MOCK_SCENARIOS,
				});
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/mock') {
				// 运行期间禁止切换：它改的是「下一次 LLM 请求走谁」，中途改会让同一个 run 混入两种响应。
				// 前端也会把开关禁用，这里是兜底（headless 调用同样受保护）。
				for (const runner of activeRunners.values()) {
					// running 或 waiting 都算「有 run 在飞」：ask_user 挂起时也禁止切换，否则同一个 run 会混入两种响应。
					if (runner.runStatus() !== 'stopped') {
						sendJson(res, 409, { ok: false, error: 'Agent 正在运行，等它结束再切换 mock' });
						return;
					}
				}
				const body = await readBody(req);
				const params = JSON.parse(body || '{}') as { enabled?: boolean; scenario?: string };
				const current = settings.debug?.mock ?? { enabled: false, scenario: 'web' };
				settings.debug.mock = {
					enabled: typeof params.enabled === 'boolean' ? params.enabled : current.enabled,
					scenario: typeof params.scenario === 'string' && params.scenario ? params.scenario : current.scenario,
				};
				logMsg(`[HttpServer] 内置 mock：${settings.debug.mock.enabled ? `开（${settings.debug.mock.scenario}）` : '关'}`);
				sendJson(res, 200, { ok: true, ...settings.debug.mock, scenarios: MOCK_SCENARIOS });
				return;
			}

			// #endregion

			// #region 设置 — MCP 服务器

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

			// #endregion

			// #region MCP — 运行态

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

			// #endregion

			// #region MCP — 用一份临时配置试连

			if (req.method === 'POST' && path === '/api/mcp/test') {
				const body = await readBody(req);
				const config = JSON.parse(body || '{}') as McpServerConfig;
				const result = await mcpManager.test(config);
				sendJson(res, 200, result);
				return;
			}

			// #endregion

			// #region MCP — 直接调用某个工具

			if (req.method === 'POST' && path === '/api/mcp/call') {
				const body = await readBody(req);
				const { name, arguments: args } = JSON.parse(body || '{}');
				const result = await mcpManager.callTool(name, args ?? {});
				sendJson(res, 200, result);
				return;
			}

			// #endregion

			// #region 设置 — 文件夹

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

			// #endregion

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
		// 内置 mock：**每次请求现读**设置（开关/剧本改了下一轮立即生效；运行期间由路由守卫禁止切换）
		setMockResolver(() => {
			const mock = settings.debug?.mock;
			if (!mock?.enabled) return null;
			setMockScenario(mock.scenario);
			return { baseUrl: ensureMockServer(), scenario: mock.scenario };
		});
		setUsageEmitter((e) => {
			// 先落 ctx（真相），再广播（实时显示）：两者互不依赖，前端刷新后能从 ctx 重建
			recordUsageInCtx(e);
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
