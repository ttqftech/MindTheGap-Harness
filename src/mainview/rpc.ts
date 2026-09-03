/* ==========================================================================
   渲染进程 RPC 封装 — MindTheGap-Harness（精简版）

   重构后：RPC 只保留对话框、Shell、环境信息、日志。
   Agent 相关、文件操作、AppData 全部移除。
   ========================================================================== */

import type { AppRPC, RpcResult } from '../shared/rpc';
import { Electroview } from 'electrobun/view';

/* ---------- 环境检测 ---------- */

export function isElectrobunEnv(): boolean {
	return typeof window !== 'undefined' &&
		typeof (window as any).__electrobun !== 'undefined';
}

/* ---------- Mock 实现（浏览器回退） ---------- */

const mockHandlers = {
	dialogOpen: (): RpcResult<string[]> =>
		({ ok: false, error: '文件对话框仅在 electrobun 环境中可用' }),
	dialogSave: (): RpcResult<string | null> =>
		({ ok: false, error: '文件对话框仅在 electrobun 环境中可用' }),
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
};

/* ---------- 类型化的 RPC 接口 ---------- */

type RequestFn<P, R> = (params: P) => Promise<R>;

interface RpcApi {
	request: {
		dialogOpen: RequestFn<any, RpcResult<string[]>>;
		dialogSave: RequestFn<any, RpcResult<string | null>>;
		shellOpenPath: RequestFn<{ path: string }, RpcResult<void>>;
		shellOpenExternal: RequestFn<{ url: string }, RpcResult<void>>;
		envInfo: RequestFn<undefined, RpcResult<any>>;
	};
	send: {
		log: (payload: { level: 'info' | 'warn' | 'error'; msg: string }) => void;
	};
}

/* ---------- 初始化 RPC ---------- */

let _rpc: RpcApi | null = null;

function initRealRpc(): RpcApi {
	const ev = new Electroview<AppRPC>({
		rpc: Electroview.defineRPC<AppRPC>({
			handlers: {
				requests: {},
				messages: {},
			},
		}),
	});

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
			return (fn as any)(params);
		};
	}

	return {
		request,
		send: {
			log: ({ level, msg }) => {
				console.log(`[${level.toUpperCase()}] ${msg}`);
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

/* ---------- 便捷导出 ---------- */

export const rpc: RpcApi = new Proxy({} as RpcApi, {
	get(_target, prop) {
		return Reflect.get(getRpc(), prop);
	},
}) as RpcApi;