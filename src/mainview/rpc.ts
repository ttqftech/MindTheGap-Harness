/* ==========================================================================
   渲染进程 RPC 封装 — MindTheGap-Harness

   在 electrobun 环境中，通过 Electroview 与主进程通信。
   在纯浏览器环境中（开发/调试），提供 mock 实现保证不崩溃。

   用法：
     import { rpc } from "./rpc";
     const result = await rpc.request.fileRead({ path: "..." });
     if (result.ok) { ... }
   ========================================================================== */

import type { AppRPC, RpcResult, FileInfo } from '../shared/rpc';
import type { AgentRunRequest, AgentCtx, AgentStreamEvent } from '../shared/agent';
import { Electroview } from 'electrobun/view';

/* ---------- 环境检测 ---------- */

export function isElectrobunEnv(): boolean {
	return typeof window !== 'undefined' &&
		typeof (window as any).__electrobun !== 'undefined';
}

/* ---------- Mock 实现（浏览器回退） ---------- */

const mockStore = new Map<string, string>();

const mockHandlers = {
	fileList: (_p: { dir: string }): RpcResult<FileInfo[]> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileRead: (_p: { path: string }): RpcResult<{ content: string; isBinary: boolean }> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileWrite: (_p: { path: string; content: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	filePatch: (_p: any): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileCreate: (_p: { path: string; content?: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileDelete: (_p: { path: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileRename: (_p: { from: string; to: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	fileCopy: (_p: { from: string; to: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	dirCreate: (_p: { path: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	dirDelete: (_p: { path: string; recursive?: boolean }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	dirCopy: (_p: { from: string; to: string }): RpcResult<void> =>
		({ ok: false, error: '文件操作仅在 electrobun 环境中可用' }),
	dialogOpen: (): RpcResult<string[]> =>
		({ ok: false, error: '文件对话框仅在 electrobun 环境中可用' }),
	dialogSave: (): RpcResult<string | null> =>
		({ ok: false, error: '文件对话框仅在 electrobun 环境中可用' }),
	pathResolve: ({ path }: { path: string }): RpcResult<string> =>
		({ ok: true, data: path }),
	pathUserHome: (): RpcResult<string> =>
		({ ok: true, data: '/' }),
	appDataGet: ({ key }: { key: string }): RpcResult<string | null> =>
		({ ok: true, data: mockStore.get(key) ?? null }),
	appDataSet: ({ key, value }: { key: string; value: string }): RpcResult<void> => {
		mockStore.set(key, value);
		return { ok: true, data: undefined };
	},
	appDataDelete: ({ key }: { key: string }): RpcResult<void> => {
		mockStore.delete(key);
		return { ok: true, data: undefined };
	},
	appDataList: (): RpcResult<string[]> =>
		({ ok: true, data: Array.from(mockStore.keys()) }),
	shellOpenPath: (_p: { path: string }): RpcResult<void> =>
		({ ok: false, error: 'Shell 操作仅在 electrobun 环境中可用' }),
	shellOpenExternal: (_p: { url: string }): RpcResult<void> =>
		({ ok: false, error: 'Shell 操作仅在 electrobun 环境中可用' }),
	envInfo: (): RpcResult<any> => ({
		ok: true,
		data: {
			platform: 'browser',
			arch: navigator.userAgent.includes('Win64') ? 'x64' : 'unknown',
			osVersion: navigator.platform,
			userDataPath: '/',
			appVersion: '0.1.0',
		},
	}),
	// Agent mock —— 返回错误（因为没有真实 LLM）
	agentRun: (_p: AgentRunRequest): RpcResult<{ finalSummary: string; ctx: AgentCtx }> =>
		({ ok: false, error: 'Agent 仅在 electrobun 环境中可用' }),
	agentCancel: (_p: { conversationId: string }): RpcResult<void> =>
		({ ok: true, data: undefined }),
};

/* ---------- 类型化的 RPC 接口 ---------- */

type RequestFn<P, R> = (params: P) => Promise<R>;

interface RpcApi {
	request: {
		fileList: RequestFn<{ dir: string }, RpcResult<FileInfo[]>>;
		fileRead: RequestFn<{ path: string }, RpcResult<{ content: string; isBinary: boolean }>>;
		fileWrite: RequestFn<{ path: string; content: string }, RpcResult<void>>;
		filePatch: RequestFn<{ path: string; startLine: number; endLine: number; newContent: string }, RpcResult<void>>;
		fileCreate: RequestFn<{ path: string; content?: string }, RpcResult<void>>;
		fileDelete: RequestFn<{ path: string }, RpcResult<void>>;
		fileRename: RequestFn<{ from: string; to: string }, RpcResult<void>>;
		fileCopy: RequestFn<{ from: string; to: string }, RpcResult<void>>;
		dirCreate: RequestFn<{ path: string }, RpcResult<void>>;
		dirDelete: RequestFn<{ path: string; recursive?: boolean }, RpcResult<void>>;
		dirCopy: RequestFn<{ from: string; to: string }, RpcResult<void>>;
		dialogOpen: RequestFn<any, RpcResult<string[]>>;
		dialogSave: RequestFn<any, RpcResult<string | null>>;
		pathResolve: RequestFn<{ path: string }, RpcResult<string>>;
		pathUserHome: RequestFn<undefined, RpcResult<string>>;
		appDataGet: RequestFn<{ key: string }, RpcResult<string | null>>;
		appDataSet: RequestFn<{ key: string; value: string }, RpcResult<void>>;
		appDataDelete: RequestFn<{ key: string }, RpcResult<void>>;
		appDataList: RequestFn<undefined, RpcResult<string[]>>;
		shellOpenPath: RequestFn<{ path: string }, RpcResult<void>>;
		shellOpenExternal: RequestFn<{ url: string }, RpcResult<void>>;
		envInfo: RequestFn<undefined, RpcResult<any>>;
		agentRun: RequestFn<AgentRunRequest, RpcResult<{ finalSummary: string; ctx: AgentCtx }>>;
		agentCancel: RequestFn<{ conversationId: string }, RpcResult<void>>;
	};
	send: {
		log: (payload: { level: 'info' | 'warn' | 'error'; msg: string }) => void;
	};
}

/* ---------- 初始化 RPC ---------- */

let _rpc: RpcApi | null = null;
let _ev: Electroview<AppRPC> | null = null;

/** Agent 流式事件监听器 */
type StreamListener = (event: AgentStreamEvent) => void;
const streamListeners = new Map<string, Set<StreamListener>>();

function initRealRpc(): RpcApi {
	const ev = new Electroview<AppRPC>({
		rpc: Electroview.defineRPC<AppRPC>({
			handlers: {
				requests: {},
				messages: {
					agentStream: ({ conversationId, event }) => {
						const listeners = streamListeners.get(conversationId);
						if (listeners) {
							for (const fn of listeners) fn(event);
						}
					},
				},
			},
		}),
	});
	_ev = ev;

	console.log('[RPC] Electroview 已连接');

	return {
		request: ev.rpc.request as unknown as RpcApi['request'],
		send: ev.rpc.send as unknown as RpcApi['send'],
	};
}

function createMockRpc(): RpcApi {
	const request = {} as RpcApi['request'];
	for (const [key, fn] of Object.entries(mockHandlers)) {
		(request as any)[key] = async (params: any) => {
			// localStorage 持久化支持（让 mock 有记忆）
			if (key === 'appDataGet') {
				const stored = localStorage.getItem(`mtg:${params.key}`);
				return { ok: true, data: stored ?? null };
			}
			if (key === 'appDataSet') {
				localStorage.setItem(`mtg:${params.key}`, params.value);
				return { ok: true, data: undefined };
			}
			if (key === 'appDataDelete') {
				localStorage.removeItem(`mtg:${params.key}`);
				return { ok: true, data: undefined };
			}
			if (key === 'appDataList') {
				const keys = Object.keys(localStorage)
					.filter((k) => k.startsWith('mtg:'))
					.map((k) => k.slice(4));
				return { ok: true, data: keys };
			}
			return (fn as any)(params);
		};
	}

	return {
		request,
		send: {
			log: ({ level, msg }) => {
				const prefix = level.toUpperCase();
				console.log(`[${prefix}] ${msg}`);
			},
		},
	};
}

export function getRpc(): RpcApi {
	if (_rpc) return _rpc;

	if (isElectrobunEnv()) {
		try {
			_rpc = initRealRpc();
		} catch (err) {
			console.warn('[RPC] Electroview 初始化失败，使用 mock:', err);
			_rpc = createMockRpc();
		}
	} else {
		console.log('[RPC] 非 electrobun 环境，使用 mock RPC');
		_rpc = createMockRpc();
	}

	return _rpc;
}

/* ---------- Agent 流式订阅 ---------- */

/** 订阅某个 conversation 的 Agent 流式事件 */
export function subscribeAgentStream(
	conversationId: string,
	listener: StreamListener,
): () => void {
	let listeners = streamListeners.get(conversationId);
	if (!listeners) {
		listeners = new Set();
		streamListeners.set(conversationId, listeners);
	}
	listeners.add(listener);

	// 返回取消订阅函数
	return () => {
		const l = streamListeners.get(conversationId);
		if (l) {
			l.delete(listener);
			if (l.size === 0) streamListeners.delete(conversationId);
		}
	};
}

/* ---------- 便捷导出 ---------- */

export const rpc: RpcApi = new Proxy({} as RpcApi, {
	get(_target, prop) {
		return Reflect.get(getRpc(), prop);
	},
}) as RpcApi;

/* ---------- 应用数据便捷方法 ---------- */

export const appData = {
	async get<T = unknown>(key: string): Promise<T | null> {
		const result = await rpc.request.appDataGet({ key });
		if (result.ok && result.data !== null) {
			try {
				return JSON.parse(result.data) as T;
			} catch {
				return null;
			}
		}
		return null;
	},

	async set(key: string, value: unknown): Promise<boolean> {
		const json = typeof value === 'string' ? value : JSON.stringify(value);
		const result = await rpc.request.appDataSet({ key, value: json });
		return result.ok;
	},

	async delete(key: string): Promise<boolean> {
		const result = await rpc.request.appDataDelete({ key });
		return result.ok;
	},

	async list(): Promise<string[]> {
		const result = await rpc.request.appDataList();
		return result.ok ? result.data : [];
	},
};
