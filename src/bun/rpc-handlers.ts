/* ==========================================================================
   主进程 RPC Handlers — MindTheGap-Harness（精简版）

   重构后：RPC 只保留对话框、Shell、环境信息、日志。
   文件操作、AppData、Agent 运行全部移除（Agent 工具在主进程内部直接用 node:fs，
   Agent 运行走 HTTP API，AppData 由 Agent Service 的 storage 层管理）。
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, platform, arch } from "node:os";
import { execSync } from "node:child_process";
import { Utils } from "electrobun/main";
import type { AppRPC, RpcResult } from "../shared/rpc";

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

function getUserDataDir(): string {
    const base = homedir();
    const dir = join(base, ".mindthegap-harness");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

export const systemHandlers = {
    envInfo: (): RpcResult<{ platform: string; arch: string; osVersion: string; userDataPath: string; appVersion: string }> =>
        safe(() => ({
            platform: platform(),
            arch: arch(),
            osVersion: execSync("ver 2>nul || sw_vers 2>/dev/null || echo unknown").toString().trim(),
            userDataPath: getUserDataDir().replace(/\\/g, "/"),
            appVersion: "0.1.0",
        })),

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

export function buildRpcHandlers() {
    return {
        requests: {
            dialogOpen: systemHandlers.dialogOpen,
            dialogSave: systemHandlers.dialogSave,
            shellOpenPath: systemHandlers.shellOpenPath,
            shellOpenExternal: systemHandlers.shellOpenExternal,
            envInfo: systemHandlers.envInfo,
        },
        messages: {
            log: ({ level, msg }: { level: string; msg: string }) => {
                console.log(`[${level.toUpperCase()}] ${msg}`);
            },
        },
    };
}

export { getUserDataDir };
