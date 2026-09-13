/* ==========================================================================
   localBridge — 本地基础能力（对齐 FFBox 的 nodeBridge 职责）

   重构后：只保留对话框、Shell、环境信息、日志。
   文件操作、AppData、路径全部移除（Agent 工具在主进程内部直接用 node:fs）。
   前端设置改用 localStorage。
   ========================================================================== */

import { rpc, isElectrobunEnv } from './rpc';

/* ---------- 文件夹选择 ---------- */

/**
 * 选择运行文件夹。
 * electron/electrobun 环境走原生对话框；浏览器（vite dev / playwright）没有
 * 文件系统对话框，用 prompt 兜底即可 —— 不值得为此维护一整个路径输入弹窗。
 */
export async function requestFolderPath(): Promise<string | null> {
	if (isElectrobunEnv()) return dialogPickFolder();
	const input = window.prompt('浏览器模式：请输入文件夹绝对路径');
	return input?.trim() || null;
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

/* ---------- 窗口控制（无边框窗口自绘标题栏用） ---------- */

export const windowControls = {
	async minimize(): Promise<void> {
		await rpc.request.windowMinimize();
	},

	/** 最大化 / 还原切换，返回切换后是否处于最大化 */
	async toggleMaximize(): Promise<boolean> {
		const result = await rpc.request.windowToggleMaximize();
		return result.ok ? result.data : false;
	},

	async close(): Promise<void> {
		await rpc.request.windowClose();
	},

	async isMaximized(): Promise<boolean> {
		const result = await rpc.request.windowIsMaximized();
		return result.ok ? result.data : false;
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
