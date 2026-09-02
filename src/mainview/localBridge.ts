/* ==========================================================================
   localBridge — 本地基础能力（对齐 FFBox 的 nodeBridge 职责）

   封装 electrobun RPC 的文件系统、AppData 持久化、对话框、路径、Shell、环境信息。
   UI 代码应该从 bridge 引这些方法，不要直接 import { rpc } from "./rpc"。

   分层原则：
   - localBridge → 基础本地能力（同步/异步的文件读写、持久化、对话框）
   - agentBridge → Agent 业务能力（agentRun、流式订阅）
   - rpc.ts       → Electroview 初始化 + 类型定义（bridge 的底层，不直接给 UI 用）

   浏览器模式（无 electrobun RPC）：
   - AppData / 文件操作走 rpc.ts 的 mock（localStorage 记忆）
   - "选择文件夹"不可用原生对话框，回退为 UI 模态框手动输入路径，
     由 requestFolderPath() 触发，应用挂载 PathInputModal 响应
   ========================================================================== */

import { rpc, isElectrobunEnv } from './rpc';
import type { RpcResult, FileInfo } from '../shared/rpc';

/* ---------- 浏览器模式：手动输入路径 ---------- */

// 全局单例：应用挂载 PathInputModal 时注入 resolve/reject，requestFolderPath 等待其完成
let resolveManualPath: ((path: string | null) => void) | null = null;

/** 应用挂载手动输入模态框后调用，注册回调 */
export function registerManualPathHandler(handler: () => Promise<string | null>) {
	resolveManualPath = handler;
}

/** 打断当前等待（应用卸载时调用，避免 Promise 悬挂） */
export function unregisterManualPathHandler() {
	resolveManualPath = null;
}

/** requestFolderPath：返回一个用户选定的文件夹路径，或 null（取消） */
export function requestFolderPath(): Promise<string | null> {
	// electrobun 环境 → 原生目录对话框
	if (isElectrobunEnv()) return dialogOpen();
	// 浏览器环境 → 打开应用的模态框手动输入
	if (resolveManualPath) return resolveManualPath();
	return Promise.resolve(null);
}

/** 原生目录对话框（electrobun 专用） */
async function dialogOpen(): Promise<string | null> {
	const result = await rpc.request.dialogOpen({ pickFolder: true });
	if (result.ok && result.data.length > 0) return result.data[0];
	return null;
}

/* ---------- AppData 持久化 ---------- */

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

/* ---------- 文件系统 ---------- */

export const fs = {
	async list(dir: string): Promise<RpcResult<FileInfo[]>> {
		return rpc.request.fileList({ dir });
	},

	async read(path: string): Promise<RpcResult<{ content: string; isBinary: boolean }>> {
		return rpc.request.fileRead({ path });
	},

	async write(path: string, content: string): Promise<RpcResult<void>> {
		return rpc.request.fileWrite({ path, content });
	},

	async patch(path: string, startLine: number, endLine: number, newContent: string): Promise<RpcResult<void>> {
		return rpc.request.filePatch({ path, startLine, endLine, newContent });
	},

	async create(path: string, content?: string): Promise<RpcResult<void>> {
		return rpc.request.fileCreate({ path, content });
	},

	async delete(path: string): Promise<RpcResult<void>> {
		return rpc.request.fileDelete({ path });
	},

	async rename(from: string, to: string): Promise<RpcResult<void>> {
		return rpc.request.fileRename({ from, to });
	},

	async copy(from: string, to: string): Promise<RpcResult<void>> {
		return rpc.request.fileCopy({ from, to });
	},

	async mkdir(path: string): Promise<RpcResult<void>> {
		return rpc.request.dirCreate({ path });
	},

	async rmdir(path: string, recursive?: boolean): Promise<RpcResult<void>> {
		return rpc.request.dirDelete({ path, recursive });
	},

	async copyDir(from: string, to: string): Promise<RpcResult<void>> {
		return rpc.request.dirCopy({ from, to });
	},
};

/* ---------- 路径 ---------- */

export const paths = {
	async resolve(p: string): Promise<RpcResult<string>> {
		return rpc.request.pathResolve({ path: p });
	},

	async userHome(): Promise<RpcResult<string>> {
		return rpc.request.pathUserHome();
	},
};

/* ---------- 对话框 ---------- */

export const dialog = {
	async open(opts?: { filters?: any; multiple?: boolean; pickFolder?: boolean }): Promise<RpcResult<string[]>> {
		return rpc.request.dialogOpen(opts);
	},

	async save(opts?: { filters?: any; defaultPath?: string }): Promise<RpcResult<string | null>> {
		return rpc.request.dialogSave(opts);
	},

	/** 快捷方法：返回一个选定的文件夹路径（electrobun 原生对话框 / 浏览器手动输入模态框） */
	async pickFolder(): Promise<string | null> {
		return requestFolderPath();
	},
};

/* ---------- Shell ---------- */

export const shell = {
	async openPath(p: string): Promise<RpcResult<void>> {
		return rpc.request.shellOpenPath({ path: p });
	},

	async openExternal(url: string): Promise<RpcResult<void>> {
		return rpc.request.shellOpenExternal({ url });
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

export { isElectrobunEnv };
