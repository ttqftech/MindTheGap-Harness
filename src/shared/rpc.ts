/* ==========================================================================
   Electrobun RPC Schema — MindTheGap-Harness（精简版）

   重构后：RPC 只保留本地能力（对话框、Shell、环境信息）。
   所有 Agent 相关操作走 HTTP + SSE（agentBridge）。
   文件操作、appData、Agent 运行全部移除。
   ========================================================================== */

export type RpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

export interface AppRPC {
    bun: {
        requests: {
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
            shellOpenPath: {
                params: { path: string };
                response: RpcResult<void>;
            };
            shellOpenExternal: {
                params: { url: string };
                response: RpcResult<void>;
            };
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
        };
    };
    webview: {
        requests: Record<string, never>;
        messages: Record<string, never>;
    };
}
