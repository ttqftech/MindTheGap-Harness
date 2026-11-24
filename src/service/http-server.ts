/**
 * Service HTTP Server — MindTheGap-Harness
 *
 * 所有 Agent 相关操作走 HTTP（对齐 FFBox 的 serviceBridge）。
 * Service 可脱离 electrobun 独立运行。
 *
 * v2 的接口见 docs/Agent架构-v2设计.md §12：
 * modes / agent/answer / plugins/reload / requests / todolist
 */

import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AgentAnswerRequest, AgentCtx, AgentRunRequest, AgentStreamEvent, AuthInfo, LlmRequestRecord, McpServerConfig, MediaPrepareRequest, ModeDefinition, ModeSummary, ModelConfig, RequestLogLevel, SettingsPatch, SettingsSnapshot, UserConfig } from '@shared/agent';
import { DEFAULT_CHAT_CONFIG, DEFAULT_MEDIA_SETTINGS, DRAFT_MEDIA_CONVERSATION_ID, IMAGE_QUALITY_VALUES, VIDEO_QUALITY_VALUES } from '@shared/agent';
import type { ServiceHealth } from '@shared/buildInfo';
import * as agentRunner from './runner';
import * as auth from './auth';
import { getBuiltinToolNames } from './tools';
import { normalizeSafety } from './safety';
import { setMockResolver, testModelConnectivity } from './llm/model';
import { ensureMockServer, MOCK_SCENARIOS, setMockScenario } from './llm/mock';
import { clearRequests, readRequest, readRequests, setRequestLogOptions } from './llm/requestLog';
import { getLoadErrors, listModes, listPlugins, loadAllPlugins, saveModeJson } from './plugins/loader';
import { mcpManager } from './mcp/manager';
import * as background from './background';
import { settings, conversations, conversationMetas, getConversationCtxById, createConversation, getFolderExtraInfo, snapshot, defaultMcpServers, flushAll } from './storage';
import { guessMimeByFileName, attachmentPath, prepareMedia, uploadAndEncode } from './attachments';
import { logMsg } from '../shared/utils';

// 端口可用 MTG_HTTP_PORT 覆盖：调试时想起第二个实例（不杀正在跑的那个）就走它。
// 主进程（src/desktop/service.ts）与前端都固定用 18999，不受影响。
export const HTTP_PORT = Number(process.env.MTG_HTTP_PORT) || 18999;

const SERVICE_STARTED_AT = new Date().toISOString();

const sseClients = new Map<string, Set<ServerResponse>>();

const activeRunners = new Map<string, agentRunner.AgentRunner>();	// conversationId → runner

/** 上次插件加载结果里「被用户插件覆盖」的 mode id */
let overriddenModeIds: string[] = [];

/** electrobun 发布通道，由 startHttpServer 的调用方注入（本文件不引 electrobun，便于独立运行） */
let serviceChannel = 'unknown';

/** listen 起来的 server 实例，退场时用它收端口 */
let serverRef: Server | null = null;

/** 组装 /api/health 的返回体：构建信息 + 运行时信息 */
function healthInfo(): ServiceHealth {
	return {
		ok: true,
		service: 'mindthegap-service',
		port: HTTP_PORT,
		pid: process.pid,
		channel: serviceChannel,
		startedAt: SERVICE_STARTED_AT,
		build: buildInfo,
	};
}

function setCors(res: ServerResponse) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	// Authorization 必须放行：登录后所有请求都带 `Bearer <sessionId>`
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 取请求头里的 sessionId（`Authorization: Bearer xxx`） */
function bearerToken(req: IncomingMessage): string {
	const raw = req.headers['authorization'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value?.startsWith('Bearer ') ? value.slice(7) : '';
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
		// 模式参数：默认变量表 + Composer 下方的动态表单（前端据此渲染控件）
		params: mode.params,
		form: mode.form,
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
		onStream: (event) => broadcastAgentStream(conversationId, event),
	});
	if (!runner) {
		broadcastAgentStream(conversationId, { type: 'error', timestamp: Date.now(), message: error ?? 'Agent 启动失败' });
		broadcastAgentStream(conversationId, { type: 'done', timestamp: Date.now(), summary: '' });
		return { ok: false, error };
	}

	activeRunners.set(conversationId, runner);

	runner
		.run(params.userMessage, params.attachments)
		.then(() => runner.waitDone())
		.then(() => {
			if (activeRunners.get(conversationId) === runner) activeRunners.delete(conversationId);
		})
		.catch((err) => {
			activeRunners.delete(conversationId);
			console.error(`[Agent] Runner ${conversationId} error:`, err);
			broadcastAgentStream(conversationId, { type: 'error', timestamp: Date.now(), message: err?.message ?? String(err) });
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

/**
 * 启动 Service HTTP 服务。
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

			// 优雅停机（仅 loopback）：主进程退场 / 父进程死亡时调。
			// 先回响应再收尾，别让调用方干等一个不会到的响应。
			if (req.method === 'POST' && path === '/api/shutdown') {
				const remote = req.socket.remoteAddress ?? '';
				const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
				if (!isLoopback) {
					sendJson(res, 403, { ok: false, error: '仅允许本机调用' });
					return;
				}
				sendJson(res, 200, { ok: true });
				gracefulShutdown('api');
				return;
			}

			// #region 认证（未登录也要能访问：登录本身、登出）

			// 登录。请求体的 passkey 是**前端算好的 SHA-256 十六进制**（明文口令不上线）
			if (req.method === 'POST' && path === '/api/auth/login') {
				const body = await readBody(req);
				const { username, passkey } = JSON.parse(body || '{}') as { username?: string; passkey?: string };
				sendJson(res, 200, auth.login(username ?? '', passkey ?? ''));
				return;
			}

			// 登出：删掉这个 sessionId 对应的会话。不要求 session 仍然有效（过期了也得能登出）
			if (req.method === 'POST' && path === '/api/auth/logout') {
				const token = bearerToken(req);
				if (token) auth.deleteSession(token);
				sendJson(res, 200, { ok: true });
				return;
			}

			// #endregion

			// ⚠️ 鉴权闸门：以下**所有**接口都要求登录态（或管理员无密码时的匿名放行）。
			//    位置很关键 —— 必须排在 /api/health（主进程探活）、/api/shutdown（仅 loopback）、
			//    /api/auth/*（登录 / 登出本身）之后，否则「登不进去」和「停不下来」。
			// ⚠️ SSE 例外：EventSource 不能自定义请求头，前端把 sessionId 放 query 里（与 FFBox 的 WS 同一做法）。
			//    `<img>` 同理不能带 Authorization 头，所以附件读取也认 query；别的接口一律只认 Authorization 头。
			const isStreamPath = path === '/api/agent/stream';
			const isAttachmentPath = /^\/api\/conversations\/[^/]+\/attachments\//.test(path);
			const querySession = isStreamPath || isAttachmentPath ? url.searchParams.get('sessionId') : null;
			const authInfo: AuthInfo | null = auth.resolveAuth(
				req.headers['authorization'] ?? (querySession ? `Bearer ${querySession}` : undefined),
			);
			if (!authInfo) {
				sendJson(res, 401, { ok: false, error: '需要登录（未携带有效的 sessionId）' });
				return;
			}

			// 当前登录态：前端 10s 轮询用它确认 session 还有效（服务重启后会话全失效）
			if (req.method === 'GET' && path === '/api/auth/session') {
				sendJson(res, 200, {
					username: authInfo.username,
					permissions: authInfo.permissions,
					anonymous: authInfo.anonymous ?? false,
				});
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

			// /api/conversations/:id/{todolist|tasks|requests}

			const convSub = /^\/api\/conversations\/([^/]+)\/(.+)$/.exec(path);
			if (convSub) {
				const conversationId = decodeURIComponent(convSub[1]);
				const rest = convSub[2];

				// 待办清单
				if (rest === 'todolist') {
					if (req.method === 'GET') {
						sendJson(res, 200, { todoList: getConversationCtxById(conversationId)?.todoList ?? '' });
						return;
					}
				}

				// 后台任务：列表 / 输出 / 停止
				if (rest === 'tasks' && req.method === 'GET') {
					sendJson(res, 200, { tasks: background.listTasks(conversationId) });
					return;
				}
				if (rest.startsWith('tasks/')) {
					const [taskId, action] = rest.slice('tasks/'.length).split('/');
					const id = decodeURIComponent(taskId ?? '');
					if (!action && req.method === 'GET') {
						const task = background.getTask(conversationId, id);
						if (!task) {
							sendJson(res, 404, { ok: false, error: '后台任务不存在' });
							return;
						}
						sendJson(res, 200, { ok: true, task });
						return;
					}
					if (action === 'output' && req.method === 'GET') {
						const full = url.searchParams.get('full') === '1' || url.searchParams.get('full') === 'true';
						const result = background.readTask(conversationId, id, { full });
						if (!result.ok) {
							sendJson(res, 404, { ok: false, error: result.error });
							return;
						}
						sendJson(res, 200, {
							ok: true,
							output: result.content,
							status: result.status,
							exitCode: result.exitCode ?? null,
							truncated: result.truncated,
						});
						return;
					}
					if (action === 'stop' && req.method === 'POST') {
						const result = background.stopTask(conversationId, id);
						if (!result.ok) {
							sendJson(res, 404, { ok: false, error: result.error });
							return;
						}
						sendJson(res, 200, { ok: true, task: result.task });
						return;
					}
				}

			// 媒体附件（图片 / 视频 / 音频）：prepare 判重 → 缺原始字节才 upload → 编码完成才返回
			if (rest === 'media/prepare' && req.method === 'POST') {
				if (conversationId !== DRAFT_MEDIA_CONVERSATION_ID && !conversations[conversationId]) {
					sendJson(res, 404, { ok: false, error: '会话不存在' });
					return;
				}
				const body = await readBody(req);
				let params: MediaPrepareRequest;
				try { params = JSON.parse(body || '{}') as MediaPrepareRequest; } catch {
					sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
					return;
				}
				const result = await prepareMedia(conversationId, params);
				sendJson(res, result.ok ? 200 : 400, result);
				return;
			}

			if (rest === 'media/upload' && req.method === 'POST') {
				if (conversationId !== DRAFT_MEDIA_CONVERSATION_ID && !conversations[conversationId]) {
					sendJson(res, 404, { ok: false, error: '会话不存在' });
					return;
				}
				// 参数走 query：body 是原始字节，不能混 JSON（文件名 / MIME 都是 ASCII，编码无忧）
			const rawKind = url.searchParams.get('kind');
			const params: MediaPrepareRequest = {
				kind: rawKind === 'video' || rawKind === 'audio' ? rawKind : 'image',
					hash: url.searchParams.get('hash') ?? '',
					name: url.searchParams.get('name') ?? '',
					mime: url.searchParams.get('mime') ?? String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(),
					quality: (url.searchParams.get('quality') ?? 'normal') as MediaPrepareRequest['quality'],
					codec: (url.searchParams.get('codec') ?? undefined) as MediaPrepareRequest['codec'],
				};
				const result = await uploadAndEncode(conversationId, params, req);
				sendJson(res, result.ok ? 200 : 400, result);
				return;
			}

			// 会话附件（图片 / 视频 / 音频）：`<img>` `<video>` `<audio>` 直接读，鉴权走 query sessionId（见上面的闸门例外）
			if (rest.startsWith('attachments/')) {
					if (req.method === 'GET') {
						const file = decodeURIComponent(rest.slice('attachments/'.length));
						const filePath = attachmentPath(conversationId, file);
						if (!existsSync(filePath)) {
							sendJson(res, 404, { ok: false, error: '附件不存在' });
							return;
						}
						// 文件名带随机串、内容不会变，可以放心长缓存
						res.writeHead(200, {
							'Content-Type': guessMimeByFileName(file),
							'Cache-Control': 'private, max-age=31536000, immutable',
						});
						createReadStream(filePath).pipe(res);
						return;
					}
				}

				// 读、删请求日志
				if (rest === 'requests') {
					if (req.method === 'GET') {
						const limit = Number(url.searchParams.get('limit') ?? 50);
						const records = readRequests(conversationId, {
							limit,
							agentInstanceId: url.searchParams.get('agentInstanceId') ?? undefined,
							purpose: url.searchParams.get('purpose') ?? undefined,
							since: url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined,
						}).map(stripRequestMessages);
						sendJson(res, 200, { requests: records });
						return;
					}
					if (req.method === 'DELETE') {
						clearRequests(conversationId);
						sendJson(res, 200, { ok: true });
						return;
					}
				}

				// 单条请求日志：渲染树里右键某个 LLM 块「导出详细信息」时，前端拿 logId 来取全文
				if (rest.startsWith('requests/')) {
					if (req.method === 'GET') {
						const logId = decodeURIComponent(rest.slice('requests/'.length));
						const record = readRequest(conversationId, logId);
						if (!record) {
							sendJson(res, 404, { ok: false, error: '没找到这条请求日志（可能已被清空或轮转覆盖）' });
							return;
						}
						sendJson(res, 200, { ok: true, record });
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
				// 会话没了，它的后台进程也不能留
				background.forgetConversation(id);
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

			// #region 设置 — 一次快照读 + 按字段 patch 写

			/**
			 * 纯数据设置的快照。前端登录成功后只读这一次，取代原来 8 个并行的 settings GET。
			 * ⚠️ 不含 users（写要权限）、不含 MCP 运行态、不含插件目录里的 mode.json。
			 */
			if (req.method === 'GET' && path === '/api/settings/snapshot') {
				const mock = settings.debug?.mock;
				const result: SettingsSnapshot = {
					providers: snapshot(settings.providers),
					chatDefaults: snapshot(settings.chatDefaults),
					basePrompt: settings.basePrompt ?? '',
					media: snapshot(settings.media) ?? DEFAULT_MEDIA_SETTINGS,
					folders: snapshot(settings.folders),
					mcpServers: snapshot(settings.mcpServers),
					mock: {
						enabled: mock?.enabled ?? false,
						scenario: mock?.scenario ?? 'web',
						scenarios: MOCK_SCENARIOS,
					},
				};
				sendJson(res, 200, result);
				return;
			}

			/**
			 * 只写请求里出现的 key。前端按脏字段提交，避免整份旧快照把别的窗口刚改过的字段盖回去。
			 * mcp-servers（要 syncAll）/ users（权限）/ safety / mock / request-log 仍走各自的独立接口。
			 */
			if (req.method === 'PATCH' && path === '/api/settings') {
				const body = await readBody(req);
				const patch = JSON.parse(body || '{}') as SettingsPatch;
				const keys: string[] = [];
				if (patch.providers !== undefined) {
					if (!Array.isArray(patch.providers)) {
						sendJson(res, 400, { ok: false, error: 'providers 必须是数组' });
						return;
					}
					settings.providers = patch.providers;
					keys.push('providers');
				}
				if (patch.chatDefaults !== undefined) {
					const next = patch.chatDefaults;
					if (!next || typeof next !== 'object') {
						sendJson(res, 400, { ok: false, error: 'chatDefaults 必须是对象' });
						return;
					}
					settings.chatDefaults = {
						...DEFAULT_CHAT_CONFIG,
						...next,
						modeId: typeof next.modeId === 'string' && next.modeId ? next.modeId : DEFAULT_CHAT_CONFIG.modeId,
						safety: normalizeSafety(next.safety),
						thinkingLevels: next.thinkingLevels ?? {},
						modeParams: next.modeParams ?? {},
					};
					keys.push('chatDefaults');
				}
				if (patch.basePrompt !== undefined) {
					if (typeof patch.basePrompt !== 'string') {
						sendJson(res, 400, { ok: false, error: 'basePrompt 必须是字符串' });
						return;
					}
					settings.basePrompt = patch.basePrompt;
					keys.push('basePrompt');
				}
				if (patch.media !== undefined) {
					const imageQuality = patch.media?.imageQuality;
					const videoQuality = patch.media?.videoQuality;
					if (!IMAGE_QUALITY_VALUES.includes(imageQuality) || !VIDEO_QUALITY_VALUES.includes(videoQuality)) {
						sendJson(res, 400, { ok: false, error: 'media 清晰度档位不合法' });
						return;
					}
					settings.media = { imageQuality, videoQuality };
					keys.push('media');
				}
				if (patch.folders !== undefined) {
					if (!Array.isArray(patch.folders)) {
						sendJson(res, 400, { ok: false, error: 'folders 必须是数组' });
						return;
					}
					settings.folders = patch.folders;
					keys.push('folders');
				}
				sendJson(res, 200, { ok: true, keys });
				return;
			}

			// #endregion

			// #region 设置 — 模型连通性测试（配置本身走 snapshot / PATCH）

			// 测试连通性：设置页每个模型行上的按钮。
			// 不写 requestLog、不碰会话 —— 只是拿「地址 + Key + 模型名」换一个 2xx。
			if (req.method === 'POST' && path === '/api/settings/test-model') {
				const body = await readBody(req);
				const config = JSON.parse(body || '{}') as ModelConfig;
				if (!config.baseUrl || !config.modelId || !config.apiFormat) {
					sendJson(res, 400, { ok: false, error: '需要 { apiFormat, baseUrl, modelId, apiKey }' });
					return;
				}
				sendJson(res, 200, await testModelConnectivity(config));
				return;
			}

			// #endregion

			// #region 设置 — 基座提示词（读走 snapshot；这里只留设置页点「保存」时的即时 PUT）

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

			// 工具安全性 / 媒体默认清晰度都是纯数据，统一走 snapshot / PATCH（会话级 safety 在 chatConfig 里）

			// #region 设置 — 内置 mock

			// mock 状态（含剧本清单）由 snapshot 带回；这里只留带 409 守卫的切换接口
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

			// #region 设置 — LLM 请求日志等级

			// 只暴露「等级」这一项：enabled / maxBytes 等仍是 settings.json 里的手工项
			if (req.method === 'GET' && path === '/api/settings/request-log') {
				sendJson(res, 200, { level: getRequestLogOptionsFromSettings().level });
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/request-log') {
				const body = await readBody(req);
				const params = JSON.parse(body || '{}') as { level?: string };
				const requested = params.level;
				// 三档：默认（只留形状）/ 仅输入（messages 全文）/ 完整（入参 + 输出）
				if (requested !== 'default' && requested !== 'input' && requested !== 'full') {
					sendJson(res, 400, { ok: false, error: "level 只能是 'default' / 'input' / 'full'" });
					return;
				}
				// 整份写回：老 settings.json 里可能连 requestLog 都没有，四要素由读侧兜底
				const level: RequestLogLevel = requested;
				const next = { ...getRequestLogOptionsFromSettings(), level };
				settings.debug = { ...settings.debug, requestLog: next };
				// 立刻同步给 llm 层：下一次请求就按新等级记录
				setRequestLogOptions(next);
				logMsg(`[HttpServer] LLM 请求日志等级：${next.level}`);
				sendJson(res, 200, { ok: true, level: next.level });
				return;
			}

			// #endregion

			// #region 设置 — MCP 服务器（配置由 snapshot 读回；写必须走独立 PUT 以 await syncAll）

			if (req.method === 'PUT' && path === '/api/settings/mcp-servers') {
				const body = await readBody(req);
				const servers = JSON.parse(body || '[]') as McpServerConfig[];
				settings.mcpServers = servers;
				// 配置变了立即同步连接（内部串行化，UI 连续保存也安全）
				// 传裸数据而不是 settings.mcpServers 代理：manager 会长期持有 config 做新旧比对
				// ⚠️ 必须 await：PUT 返回即代表连接已同步完，前端紧跟着读 /api/mcp/status 才是新状态。
				//    （带 launch 的 http 服务器要拉进程 + 探活，可能要几秒，这正是以前状态点不更新的原因）
				await mcpManager.syncAll(servers);
				sendJson(res, 200, { ok: true });
				return;
			}

			// 重置为默认：整份写回内置示例配置（用户自己加的服务器不保留）
			if (req.method === 'POST' && path === '/api/settings/mcp-servers/reset') {
				const defaults = snapshot(defaultMcpServers());
				settings.mcpServers = defaults;
				await mcpManager.syncAll(snapshot(settings.mcpServers));
				sendJson(res, 200, { ok: true, servers: defaults });
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

			// #region 设置 — 用户（读：任意登录用户；写：需要「用户管理」权限）

			if (req.method === 'GET' && path === '/api/settings/users') {
				sendJson(res, 200, auth.getUsers());
				return;
			}

			if (req.method === 'PUT' && path === '/api/settings/users') {
				if (!auth.hasPermission(authInfo, 'userManagement')) {
					sendJson(res, 403, { ok: false, error: '没有「用户管理」权限' });
					return;
				}
				const body = await readBody(req);
				const users = JSON.parse(body || '[]') as UserConfig[];
				if (!Array.isArray(users)) {
					sendJson(res, 400, { ok: false, error: '请求体需要是用户数组' });
					return;
				}
				auth.setUsers(users);
				logMsg(`[HttpServer] 用户配置已更新（${users.length} 个账号）`);
				sendJson(res, 200, { ok: true });
				return;
			}

			// #endregion

			// 文件夹列表走 snapshot / PATCH

			sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
		} catch (e: any) {
			sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
		}
	});

	serverRef = server;
	// 端口被占要说人话：独立进程化后最常见的启动失败就是「已经有一个 Service 在跑」
	// （旧进程 / 开发者手动起的调试服务），裸崩一个 EADDRINUSE 没法定位。
	server.on('error', (err: NodeJS.ErrnoException) => {
		if (err.code === 'EADDRINUSE') {
			logMsg.error(`[HttpServer] 端口 ${HTTP_PORT} 已被占用 —— 已有一个 Service 在跑（旧进程或调试服务）。若要独占，请先结束它；若只是想复用，什么都不用做。`);
		} else {
			logMsg.error(`[HttpServer] 监听 ${HTTP_PORT} 失败: ${err.message}`);
		}
		process.exit(1);
	});
	server.listen(HTTP_PORT, () => {
		logMsg(`[HttpServer] Agent HTTP API 开始监听 http://localhost:${HTTP_PORT}`);
		const loaded = reloadPlugins();
		setRequestLogOptions(getRequestLogOptionsFromSettings());
		// 内置 mock：**每次请求现读**设置（开关/剧本改了下一轮立即生效；运行期间由路由守卫禁止切换）
		setMockResolver(() => {
			const mock = settings.debug?.mock;
			if (!mock?.enabled) return null;
			setMockScenario(mock.scenario);
			return { baseUrl: ensureMockServer(), scenario: mock.scenario };
		});
		for (const plugin of listPlugins()) {
			logMsg(`[HttpServer] 插件 ${plugin.id} (${plugin.source}) → 模式 ${plugin.modes.join(', ')}`);
		}
		logMsg(`[HttpServer] 模式就绪：${loaded.modes.join(', ')}`);
	});
	return server;
}

// #region 停止和退出

/**
 * 优雅停机。两条调用路：`POST /api/shutdown`（主进程退场，主路径）与
 * 独立入口 `src/service/index.ts` 的 SIGINT/SIGTERM/父进程死亡（兜底）。
 *
 * 顺序有讲究：
 *   ① cancelAllRunners —— 先停会话，runner 收尾会写 ctx
 *   ② stopHttpServer  —— 再关监听：让「重启后的新主进程」探活时立刻失败而不是 adopt 到将死服务
 *   ③ flushAll        —— 补落 storage 700ms 防抖窗内的待写（硬杀会丢）
 *   ④ mcpManager.stopAll —— 收托管进程（HTTP 传输的 MCP 不会随 stdin 关闭自杀，会成孤儿占端口）
 */
export function gracefulShutdown(reason: string) {
	logMsg(`[HttpServer] 优雅停机（${reason}）`);
	cancelAllRunners();
	stopHttpServer();
	flushAll();
	try {
		mcpManager.stopAll();
	} catch (e) {
		logMsg.error(`[HttpServer] 停止 MCP 托管进程失败: ${(e as Error).message}`);
	}
	// ⑤ 后台任务同样是子进程：留着就变孤儿（dev server 还会占着端口）
	try {
		background.stopAll();
	} catch (e) {
		logMsg.error(`[HttpServer] 停止后台任务失败: ${(e as Error).message}`);
	}
	// 给 close 回调（日志）一点时间，之后无论如何强制退
	setTimeout(() => process.exit(0), 150).unref();
}

/**
 * 掐掉所有还在飞的 run（含挂在 ask_user 上的），返回被掐掉的个数。
 * ⚠️ 只 cancel 不 await：退场不等 LLM 收尾，runner 内部有自己的 abort 与收尾流程。
 */
export function cancelAllRunners(): number {
	let n = 0;
	for (const [id, runner] of activeRunners) {
		try {
			runner.cancel();
			n++;
		} catch (e) {
			logMsg(`[HttpServer] 取消会话 ${id} 失败: ${(e as Error).message}`);
		}
	}
	activeRunners.clear();
	if (n > 0) logMsg(`[HttpServer] 已停止 ${n} 个进行中的会话`);
	return n;
}

/** 关掉 HTTP 端口监听（SSE 长连接随之断开） */
export function stopHttpServer(): void {
	if (!serverRef) return;
	serverRef.closeAllConnections?.();
	serverRef.close(() => logMsg('[HttpServer] Agent HTTP API 已停止监听'));
	serverRef = null;
}

// #endregion

/**
 * 列表接口只给元信息：`request.messages` / `response`（等级 ≥「仅输入」时才有）只在单条查询里返回。
 * 否则一次拉 50 条会把几十 MB 正文拖到设置面板里。
 */
function stripRequestMessages(rec: LlmRequestRecord): LlmRequestRecord {
	if (!rec.request?.messages && !rec.response) return rec;
	if (!rec.request?.messages) return { ...rec, response: undefined };
	const { messages: _messages, ...rest } = rec.request;
	return { ...rec, request: rest, response: undefined };
}

/** 从 settings 里读 requestLog 配置（带默认值兜底） */
function getRequestLogOptionsFromSettings() {
	const cfg = settings.debug?.requestLog;
	return {
		enabled: cfg?.enabled ?? true,
		includeToolNames: cfg?.includeToolNames ?? true,
		maxBytes: cfg?.maxBytes ?? 8 * 1024 * 1024,
		dumpPayload: cfg?.dumpPayload ?? false,
		level: cfg?.level === 'full' ? ('full' as const) : cfg?.level === 'input' ? ('input' as const) : ('default' as const),
	};
}
