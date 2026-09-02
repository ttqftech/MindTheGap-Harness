/* ==========================================================================
   主进程 RPC Handlers — MindTheGap-Harness
   
   所有文件操作、应用数据存储、系统对话框等都在这里实现。
   使用 Bun 原生 API（fs, path, os）。
   ========================================================================== */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync, renameSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, basename, relative, sep } from "node:path";
import { homedir, platform, arch } from "node:os";
import { execSync } from "node:child_process";
import { Utils } from "electrobun/main";
import type { AppRPC, FileInfo, RpcResult } from "../shared/rpc";

// #region 错误处理

function ok<T>(data: T): RpcResult<T> {
    return { ok: true, data };
}

function fail<T>(error: string): RpcResult<T> {
    return { ok: false, error };
}

function safe<T>(fn: () => T): RpcResult<T> {
    try {
        return ok(fn());
    } catch (e: any) {
        return fail(e?.message ?? String(e));
    }
}

// #endregion

// #region 路径安全检查

// 允许的根目录（可以动态配置）
const ALLOWED_ROOTS: string[] = [];  // 空 = 允许所有

function isPathAllowed(path: string): boolean {
    if (ALLOWED_ROOTS.length === 0) return true;  // 开发期放开
    const resolved = resolve(path);
    return ALLOWED_ROOTS.some((root) => resolved.startsWith(resolve(root)));
}

function normalizePath(p: string): string {
    return resolve(p).replace(/\\/g, "/");
}

// #endregion

// #region 文件操作

function fileInfo(fullPath: string): FileInfo {
    const stat = statSync(fullPath);
    return {
        name: basename(fullPath),
        path: normalizePath(fullPath),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
    };
}

export const fileHandlers = {
    list: ({ dir }: { dir: string }): RpcResult<FileInfo[]> =>
        safe(() => {
            if (!isPathAllowed(dir)) throw new Error("路径不在允许范围内");
            const resolved = resolve(dir);
            const entries = readdirSync(resolved);
            return entries.map((name) => fileInfo(join(resolved, name)));
        }),

    read: ({ path }: { path: string }): RpcResult<{ content: string; isBinary: boolean }> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            if (!existsSync(path)) throw new Error("文件不存在");
            // 先尝试读文本
            const buf = readFileSync(path);
            const text = buf.toString("utf-8");
            // 简单的二进制检测：包含 null 字节
            const isBinary = buf.includes(0);
            return { content: isBinary ? "" : text, isBinary };
        }),

    write: ({ path, content }: { path: string; content: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            const dir = dirname(path);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(path, content, "utf-8");
        }),

    patch: ({ path, startLine, endLine, newContent }: { path: string; startLine: number; endLine: number; newContent: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            if (!existsSync(path)) throw new Error("文件不存在");
            const original = readFileSync(path, "utf-8");
            const lines = original.split("\n");
            // startLine 和 endLine 都是 1-indexed，包含
            const before = lines.slice(0, Math.max(0, startLine - 1));
            const after = lines.slice(endLine);
            const newLines = newContent.split("\n");
            const result = [...before, ...newLines, ...after].join("\n");
            writeFileSync(path, result, "utf-8");
        }),

    create: ({ path, content }: { path: string; content?: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            const dir = dirname(path);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(path, content ?? "", "utf-8");
        }),

    delete: ({ path }: { path: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            if (!existsSync(path)) throw new Error("文件/目录不存在");
            const stat = statSync(path);
            if (stat.isDirectory()) {
                rmSync(path, { recursive: true, force: true });
            } else {
                unlinkSync(path);
            }
        }),

    rename: ({ from, to }: { from: string; to: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(from) || !isPathAllowed(to)) throw new Error("路径不在允许范围内");
            if (!existsSync(from)) throw new Error("源不存在");
            const dir = dirname(to);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            renameSync(from, to);
        }),

    copy: ({ from, to }: { from: string; to: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(from) || !isPathAllowed(to)) throw new Error("路径不在允许范围内");
            if (!existsSync(from)) throw new Error("源不存在");
            const stat = statSync(from);
            if (stat.isDirectory()) {
                // 递归复制目录
                mkdirSync(to, { recursive: true });
                const entries = readdirSync(from);
                for (const entry of entries) {
                    const srcEntry = join(from, entry);
                    const destEntry = join(to, entry);
                    fileHandlers.copy({ from: srcEntry, to: destEntry });
                }
            } else {
                const dir = dirname(to);
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                copyFileSync(from, to);
            }
        }),

    dirCreate: ({ path }: { path: string }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            mkdirSync(path, { recursive: true });
        }),

    dirDelete: ({ path, recursive = true }: { path: string; recursive?: boolean }): RpcResult<void> =>
        safe(() => {
            if (!isPathAllowed(path)) throw new Error("路径不在允许范围内");
            if (!existsSync(path)) throw new Error("目录不存在");
            rmSync(path, { recursive, force: true });
        }),

    dirCopy: ({ from, to }: { from: string; to: string }): RpcResult<void> =>
        fileHandlers.copy({ from, to }),  // copy 已处理目录递归
};

// #endregion

// #region 应用数据持久化

// 数据存到用户目录下的 mindthegap-harness 文件夹
function getUserDataDir(): string {
    const base = homedir();
    const dir = join(base, ".mindthegap-harness");
    console.log(`[AppData] getUserDataDir: homedir()="${base}", dir="${dir}", exists=${existsSync(dir)}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

function getDataFilePath(key: string): string {
    // 安全化 key：只允许字母数字和-_
    const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return join(getUserDataDir(), `${safeKey}.json`);
}

export const appDataHandlers = {
    get: ({ key }: { key: string }): RpcResult<string | null> =>
        safe(() => {
            const path = getDataFilePath(key);
            console.log(`[AppData] get("${key}") → path="${path}", exists=${existsSync(path)}`);
            if (!existsSync(path)) return null;
            return readFileSync(path, "utf-8");
        }),

    set: ({ key, value }: { key: string; value: string }): RpcResult<void> =>
        safe(() => {
            const path = getDataFilePath(key);
            writeFileSync(path, value, "utf-8");
        }),

    delete: ({ key }: { key: string }): RpcResult<void> =>
        safe(() => {
            const path = getDataFilePath(key);
            if (existsSync(path)) unlinkSync(path);
        }),

    list: (): RpcResult<string[]> =>
        safe(() => {
            const dir = getUserDataDir();
            return readdirSync(dir)
                .filter((f) => f.endsWith(".json"))
                .map((f) => f.replace(/\.json$/, ""));
        }),
};

// #endregion

// #region 系统 & Shell

export const systemHandlers = {
    pathResolve: ({ path }: { path: string }): RpcResult<string> =>
        safe(() => resolve(path).replace(/\\/g, "/")),

    userHome: (): RpcResult<string> =>
        safe(() => homedir().replace(/\\/g, "/")),

    envInfo: (): RpcResult<{ platform: string; arch: string; osVersion: string; userDataPath: string; appVersion: string }> =>
        safe(() => ({
            platform: platform(),
            arch: arch(),
            osVersion: execSync("ver 2>nul || sw_vers 2>/dev/null || echo unknown").toString().trim(),
            userDataPath: getUserDataDir().replace(/\\/g, "/"),
            appVersion: "0.1.0",
        })),

    // 真正的文件/文件夹选择对话框（electrobun 原生）
    async dialogOpen(params?: { filters?: any; multiple?: boolean; pickFolder?: boolean }): Promise<RpcResult<string[]>> {
        try {
            const paths = await Utils.openFileDialog({
                canChooseFiles: !params?.pickFolder,
                canChooseDirectory: true,
                allowsMultipleSelection: params?.multiple ?? false,
                startingFolder: homedir(),
            });
            return ok(paths);
        } catch (e: any) {
            return fail(`对话框取消或出错: ${e?.message ?? String(e)}`);
        }
    },

    dialogSave: (_params?: { filters?: any; defaultPath?: string }): RpcResult<string | null> =>
        safe(() => {
            // TODO: 接入真正的保存对话框
            return null;
        }),

    shellOpenPath: ({ path }: { path: string }): RpcResult<void> =>
        safe(() => {
            const p = resolve(path);
            if (platform() === "win32") {
                execSync(`start "" "${p}"`);
            } else if (platform() === "darwin") {
                execSync(`open "${p}"`);
            } else {
                execSync(`xdg-open "${p}"`);
            }
        }),

    shellOpenExternal: ({ url }: { url: string }): RpcResult<void> =>
        safe(() => {
            if (platform() === "win32") {
                execSync(`start "" "${url}"`);
            } else if (platform() === "darwin") {
                execSync(`open "${url}"`);
            } else {
                execSync(`xdg-open "${url}"`);
            }
        }),
};

// #endregion

// #region Agent 运行管理

import { AgentEngine } from './agent/engine';
import type { AgentRunRequest, AgentStreamEvent } from '../shared/agent';
import { broadcastAgentStream } from './http-server';

// 当前正在运行的 Agent 引擎实例（按 conversationId 跟踪）
const activeEngines = new Map<string, AgentEngine>();
// 用于向渲染进程推送流式事件的回调（RPC webview）
let pushStream: ((conversationId: string, event: AgentStreamEvent) => void) | null = null;

/** 设置流式推送函数（由 index.ts 在窗口创建后调用） */
export function setStreamPusher(fn: typeof pushStream): void {
	pushStream = fn;
}

/** 流式事件分发：同时推给 RPC webview 与 HTTP SSE 订阅者 */
function dispatchStream(conversationId: string, event: AgentStreamEvent) {
	pushStream?.(conversationId, event);
	broadcastAgentStream(conversationId, event);
}

/** Agent 运行 handler */
export async function agentRun(params: AgentRunRequest): Promise<RpcResult<{ finalSummary: string; ctx: import('../shared/agent').AgentCtx }>> {
	const { conversationId } = params;

	// 如果已有运行中的实例，先取消
	const existing = activeEngines.get(conversationId);
	if (existing) {
		console.warn(`[Agent] Conversation ${conversationId} already has a running agent. Cancel it first or wait.`);
	}

	try {
		const engine = new AgentEngine(params, {
			onStream: (event) => {
				dispatchStream(conversationId, event);
			},
		});

		activeEngines.set(conversationId, engine);

		// 不 await — 让 engine 后台跑，流式事件通过 onStream 推送
		// 最终结果由前端从 agentStream 的 done 事件汇总
		engine.run().then(() => {
			activeEngines.delete(conversationId);
		}).catch((err) => {
			activeEngines.delete(conversationId);
			console.error(`[Agent] Engine ${conversationId} error:`, err);
			// 补发 error 事件，保证前端不会一直卡在"生成中"
			dispatchStream(conversationId, {
				type: 'error',
				message: err?.message ?? String(err),
			});
		});

		// 立即返回，不等 LLM 完成
		return ok({ finalSummary: '', ctx: { events: [], works: [], messages: [] } });
	} catch (e: any) {
		activeEngines.delete(conversationId);
		return fail(`Agent error: ${e?.message ?? String(e)}`);
	}
}

/** Agent 取消 handler */
export function agentCancel({ conversationId }: { conversationId: string }): RpcResult<void> {
	const engine = activeEngines.get(conversationId);
	if (!engine) {
		return fail(`No running agent for conversation ${conversationId}`);
	}
	// 真实取消：abort fetch + 标记 aborted
	engine.abort();
	activeEngines.delete(conversationId);
	return ok(undefined);
}

// #endregion

// #region 组装成 RPC handlers

export function buildRpcHandlers() {
    return {
        requests: {
            // 文件
            fileList: fileHandlers.list,
            fileRead: fileHandlers.read,
            fileWrite: fileHandlers.write,
            filePatch: fileHandlers.patch,
            fileCreate: fileHandlers.create,
            fileDelete: fileHandlers.delete,
            fileRename: fileHandlers.rename,
            fileCopy: fileHandlers.copy,
            dirCreate: fileHandlers.dirCreate,
            dirDelete: fileHandlers.dirDelete,
            dirCopy: fileHandlers.dirCopy,

            // 系统
            dialogOpen: systemHandlers.dialogOpen,
            dialogSave: systemHandlers.dialogSave,
            pathResolve: systemHandlers.pathResolve,
            pathUserHome: systemHandlers.userHome,

            // 应用数据
            appDataGet: appDataHandlers.get,
            appDataSet: appDataHandlers.set,
            appDataDelete: appDataHandlers.delete,
            appDataList: appDataHandlers.list,

            // Agent
            agentRun,
            agentCancel,

            // Shell
            shellOpenPath: systemHandlers.shellOpenPath,
            shellOpenExternal: systemHandlers.shellOpenExternal,

            // 环境
            envInfo: systemHandlers.envInfo,
        },
        messages: {
            log: ({ level, msg }: { level: string; msg: string }) => {
                const prefix = level.toUpperCase();
                console.log(`[${prefix}] ${msg}`);
            },
        },
    };
}

// #endregion

export { getUserDataDir };
