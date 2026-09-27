/**
 * localBridge — 本地基础能力（对齐 FFBox 的 nodeBridge 职责）
 */

import { rpc, isElectrobunEnv } from './rpc';

// #region 文件夹选择

/**
 * 选择运行文件夹。
 * electrobun 环境走原生对话框；浏览器（vite dev / playwright）没有文件系统对话框，用 prompt 兜底即可
 */
export async function requestFolderPath(): Promise<{ path: string | null; error: string | null }> {
	if (isElectrobunEnv()) return dialogPickFolder();
	// 正常应用里 __electrobun 一定存在，「在 WebView2 里却没有 __electrobun」= 预加载桥没注入，属于异常，必须说清楚。
	if (typeof window !== 'undefined' && (window as any).chrome?.webview) {
		const msg = '当前是 WebView2 环境但 electrobun 桥没有注入（window.__electrobun 不存在），拿不到目录对话框';
		console.error('[localBridge] ' + msg);
		return { path: null, error: msg };
	}
	console.warn('[localBridge] 非 electrobun 环境：文件夹选择退化为 window.prompt（仅供 vite dev / playwright 探针）');
	const input = window.prompt('浏览器模式：请输入文件夹绝对路径');
	return { path: input?.trim() || null, error: null };
}

// #endregion

// #region 对话框

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

async function dialogPickFolder(): Promise<{ path: string | null; error: string | null }> {
	const result = await rpc.request.dialogOpen({ pickFolder: true, multiple: false });
	if (!result.ok) {
		return { path: null, error: result.error || '目录对话框调用失败' };
	}
	if (result.data.length === 0) return { path: null, error: null };	// 用户取消
	return { path: result.data[0], error: null };
}

// #endregion

// #region Shell

export const shell = {
	async openPath(p: string): Promise<void> {
		await rpc.request.shellOpenPath({ path: p });
	},

	async openExternal(url: string): Promise<void> {
		await rpc.request.shellOpenExternal({ url });
	},
};

// #endregion

// #region 窗口控制（无边框窗口自绘标题栏用）

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

// #endregion

// #region 环境信息

export async function getEnvInfo() {
	const result = await rpc.request.envInfo();
	return result.ok ? result.data : null;
}

// #endregion

// #region 日志

export function log(level: 'info' | 'warn' | 'error', msg: string) {
	rpc.send.log({ level, msg });
}

// #endregion

// #region 前端设置（localStorage）

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

// #endregion
