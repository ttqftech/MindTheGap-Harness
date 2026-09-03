/* ==========================================================================
   localBridge — 本地基础能力（对齐 FFBox 的 nodeBridge 职责）

   重构后：只保留对话框、Shell、环境信息、日志。
   文件操作、AppData、路径全部移除（Agent 工具在主进程内部直接用 node:fs）。
   前端设置改用 localStorage。
   ========================================================================== */

import { rpc, isElectrobunEnv } from './rpc';

/* ---------- 浏览器模式：手动输入路径 ---------- */

let resolveManualPath: ((path: string | null) => void) | null = null;

export function registerManualPathHandler(handler: () => Promise<string | null>) {
	resolveManualPath = handler;
}

export function unregisterManualPathHandler() {
	resolveManualPath = null;
}

export function requestFolderPath(): Promise<string | null> {
	if (isElectrobunEnv()) return dialogPickFolder();
	if (resolveManualPath) return resolveManualPath();
	return Promise.resolve(null);
}

/* ---------- 对话框 ---------- */

export const dialog = {
	async open(opts?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }): Promise<string[]> {
		const result = await rpc.request.dialogOpen(opts);
		if (result.ok) return result.data;
		return [];
	},

	async save(opts?: { filters?: { name: string; extensions: string[] }[]; defaultPath?: string }): Promise<string | null> {
		const result = await rpc.request.dialogSave(opts);
		if (result.ok) return result.data;
		return null;
	},
};

async function dialogPickFolder(): Promise<string | null> {
	const result = await rpc.request.dialogOpen({ multiple: false } as any);
	if (result.ok && result.data.length > 0) return result.data[0];
	return null;
}

/* ---------- Shell ---------- */

export const shell = {
	async openPath(p: string): Promise<void> {
		await rpc.request.shellOpenPath({ path: p });
	},

	async openExternal(url: string): Promise<void> {
		await rpc.request.shellOpenExternal({ url });
	},
};

/* ---------- 环境 ---------- */

export async function getEnvInfo() {
	const result = await rpc.request.envInfo();
	return result.ok ? result.data : null;
}

/* ---------- 日志 ---------- */

export function log(level: 'info' | 'warn' | 'error', msg: string) {
	rpc.send.log({ level, msg });
}

/* ---------- 前端设置（localStorage） ---------- */

export const localSettings = {
	get<T = unknown>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(`mtg:${key}`);
			if (raw === null) return fallback;
			return JSON.parse(raw) as T;
		} catch {
			return fallback;
		}
	},

	set(key: string, value: unknown): void {
		localStorage.setItem(`mtg:${key}`, JSON.stringify(value));
	},

	remove(key: string): void {
		localStorage.removeItem(`mtg:${key}`);
	},
};

export { isElectrobunEnv };
