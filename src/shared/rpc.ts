/* ==========================================================================
   Electrobun RPC Schema — MindTheGap-Harness（精简版）

   重构后：RPC 只保留本地能力（对话框、Shell、环境信息、窗口控制）。
   所有 Agent 相关操作走 HTTP + SSE（agentBridge）。
   文件操作、appData、Agent 运行全部移除。

   窗口控制存在的原因：主窗口为无边框（titleBarStyle: 'hidden'），
   标题栏与三大金刚键由前端 TitleBar 自绘，只能通过 RPC 驱动原生窗口。
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
            windowMinimize: {
                params?: undefined;
                response: RpcResult<void>;
            };
            /** 在最大化 / 还原之间切换，返回切换后的状态 */
            windowToggleMaximize: {
                params?: undefined;
                response: RpcResult<boolean>;
            };
            /** 走 requestClose（可被 beforeRemoveHooks 拦截），而不是直接销毁窗口 */
            windowClose: {
                params?: undefined;
                response: RpcResult<void>;
            };
            windowIsMaximized: {
                params?: undefined;
                response: RpcResult<boolean>;
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
