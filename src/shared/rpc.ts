/* ==========================================================================
   Electrobun RPC Schema — MindTheGap-Harness
   
   Schema 格式参考 electrobun 的 ElectrobunRPCSchema：
   {
       bun:     { requests?, messages? }  // 主进程提供的 API（渲染进程调用）
       webview: { requests?, messages? }  // 渲染进程提供的 API（主进程调用）
   }
   
   主进程：defineElectrobunRPC("bun", { handlers: { requests, messages } })
   渲染进程：Electroview.defineRPC({ handlers: { requests, messages } })
   
   渲染进程调用：
     const ev = new Electroview({ rpc: Electroview.defineRPC<Schema>({...}) });
     const result = await ev.rpc.request.fileRead({ path: "..." });
   
   主进程调用（如果 webview.requests 定义了）：
     win.webview.rpc.request.xxx(...)
     win.webview.rpc.send.onNotification({...})
   ========================================================================== */

import type { AgentStreamEvent, AgentRunRequest, AgentCtx } from './agent';

/* ---------- 类型定义 ---------- */

export type FileInfo = {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: number;
};

export type RpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

/* ---------- AppRPC Schema ---------- */

export interface AppRPC {
    // === 主进程暴露给渲染进程 ===
    bun: {
        requests: {
            // --- 文件操作 ---
            fileList: {
                params: { dir: string };
                response: RpcResult<FileInfo[]>;
            };
            fileRead: {
                params: { path: string };
                response: RpcResult<{ content: string; isBinary: boolean }>;
            };
            fileWrite: {
                params: { path: string; content: string };
                response: RpcResult<void>;
            };
            filePatch: {
                params: {
                    path: string;
                    startLine: number;
                    endLine: number;
                    newContent: string;
                };
                response: RpcResult<void>;
            };
            fileCreate: {
                params: { path: string; content?: string };
                response: RpcResult<void>;
            };
            fileDelete: {
                params: { path: string };
                response: RpcResult<void>;
            };
            fileRename: {
                params: { from: string; to: string };
                response: RpcResult<void>;
            };
            fileCopy: {
                params: { from: string; to: string };
                response: RpcResult<void>;
            };
            dirCreate: {
                params: { path: string };
                response: RpcResult<void>;
            };
            dirDelete: {
                params: { path: string; recursive?: boolean };
                response: RpcResult<void>;
            };
            dirCopy: {
                params: { from: string; to: string };
                response: RpcResult<void>;
            };

            // --- 系统 ---
            dialogOpen: {
                params?: {
                    filters?: { name: string; extensions: string[] }[];
                    multiple?: boolean;
                };
                response: RpcResult<string[]>;
            };
            dialogSave: {
                params?: {
                    filters?: { name: string; extensions: string[] }[];
                    defaultPath?: string;
                };
                response: RpcResult<string | null>;
            };
            pathResolve: {
                params: { path: string };
                response: RpcResult<string>;
            };
            pathUserHome: {
                params?: undefined;
                response: RpcResult<string>;
            };

            // --- 应用数据持久化 ---
            appDataGet: {
                params: { key: string };
                response: RpcResult<string | null>;
            };
            appDataSet: {
                params: { key: string; value: string };
                response: RpcResult<void>;
            };
            appDataDelete: {
                params: { key: string };
                response: RpcResult<void>;
            };
            appDataList: {
                params?: undefined;
                response: RpcResult<string[]>;
            };

            // --- Agent ---
            agentRun: {
                params: AgentRunRequest;
                response: RpcResult<{ finalSummary: string; ctx: AgentCtx }>;
            };
            agentCancel: {
                params: { conversationId: string };
                response: RpcResult<void>;
            };

            // --- Shell ---
            shellOpenPath: {
                params: { path: string };
                response: RpcResult<void>;
            };
            shellOpenExternal: {
                params: { url: string };
                response: RpcResult<void>;
            };

            // --- 环境 ---
            envInfo: {
                params?: undefined;
                response: RpcResult<{
                    platform: string;
                    arch: string;
                    osVersion: string;
                    userDataPath: string;
                    appVersion: string;
                }>;
            };
        };

        messages: {
            log: { level: 'info' | 'warn' | 'error'; msg: string };
            // Agent 流式事件（主进程 → 渲染进程推送）
            agentStream: { conversationId: string; event: AgentStreamEvent };
        };
    };

    // === 渲染进程暴露给主进程 ===
    webview: {
        requests: Record<string, never>;
        messages: {
            onFileChanged: { path: string };
            onDownloadProgress: { progress: number };
            onNotification: { title: string; body: string };
        };
    };
}
