/* ==========================================================================
   Electrobun RPC Schema — MindTheGap-Harness（精简版）

   重构后：RPC 只保留本地能力（对话框、Shell、环境信息、窗口控制）。
   所有 Agent 相关操作走 HTTP + SSE（agentBridge）。
   文件操作、appData、Agent 运行全部移除。

   窗口控制存在的原因：主窗口为无边框（titleBarStyle: 'hiddenInset'），
   标题栏与三大金刚键由前端 TitleBar 自绘，只能通过 RPC 驱动原生窗口。

   ⚠️ devkit 的 BaseRPCRequestsSchema 要求每个 request 的 params 是必填字段
   （{ params: unknown; response: unknown }），所以无参请求写成 params: undefined，
   而不是 params? 可选——可选会被 ElectrobunRPCSchema 约束直接拒绝（TS2344）。
   ========================================================================== */

import type { BuildInfo } from './buildInfo';

export type RpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

export interface AppRPC {
    bun: {
        requests: {
            dialogOpen: {
                params: {
                    filters?: { name: string; extensions: string[] }[];
                    multiple?: boolean;
                    /** ⚠️ 选目录必须显式传 true：handler 里是 canChooseFiles: !pickFolder，
                     *  漏传会弹出「选文件」框 —— 用户选不中目录，表现为「添加文件夹没反应」 */
                    pickFolder?: boolean;
                };
                response: RpcResult<string[]>;
            };
            dialogSave: {
                params: {
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
            getEnvInfo: {
                params: undefined;
                response: RpcResult<{
                    platform: string;
                    arch: string;
                    osVersion: string;
                    userDataPath: string;
                    appVersion: string;
                    /** 构建信息（与 /api/health 的 build 同源，见 buildInfo.ts） */
                    build: BuildInfo;
                }>;
            };
            /**
             * Service 的来源：本应用自己 spawn 的，还是探测到已在跑而 adopt 的。
             * 界面上要明确标出来 —— 这是**主进程**才知道的事实（Service 自己只知道自己的 pid）。
             */
            getServiceInfo: {
                params: undefined;
                response: RpcResult<{
                    mode: 'spawned' | 'adopted';
                    pid: number | null; // spawned 时是子进程 pid；adopted 时为 null（那是别人的进程）
                    port: number;
                }>;
            };
            windowMinimize: {
                params: undefined;
                response: RpcResult<void>;
            };
            /** 在最大化 / 还原之间切换，返回切换后的状态 */
            windowToggleMaximize: {
                params: undefined;
                response: RpcResult<boolean>;
            };
            /** 走 requestClose（可被 beforeRemoveHooks 拦截），而不是直接销毁窗口 */
            windowClose: {
                params: undefined;
                response: RpcResult<void>;
            };
            windowIsMaximized: {
                params: undefined;
                response: RpcResult<boolean>;
            };
            windowGetFrame: {
                params: undefined;
                response: RpcResult<{ x: number; y: number; width: number; height: number }>;
            };
            /** 写原生窗口外框：一次同时改位置与尺寸（避免 setSize + setPosition 两步之间闪一下），逐帧调用 */
            windowSetFrame: {
                params: { x: number; y: number; width: number; height: number };
                response: RpcResult<void>;
            };
            /**
             * 退场动画专用：临时解除 / 恢复窗口的系统最小尺寸限制。
             * Win32 会把带标题栏·可缩放边框的窗口钳在 SM_CXMINTRACK（实测 ~131x36），转成 WS_POPUP 才能收到 1x1。见 desktop/windowsPatch.ts
             */
            windowSetFrameUnlocked: {
                params: { unlocked: boolean };
                response: RpcResult<void>;
            };
            /**
             * 全屏开关。启动动画期间窗口是全屏的（进全屏由主进程建窗时做，见 desktop/index.ts），
             * 动画收尾时前端调这条退出 —— 页面自己 requestFullscreen() 在没有用户手势时会被 WebView2 拒掉，所以必须走主进程。
             */
            windowSetFullScreen: {
                params: { fullScreen: boolean };
                response: RpcResult<void>;
            };
            /**
             * 前端报告退场进度（全程只有这一条，别再为每个时点加一条 RPC）。
             *   'collapse' = 外壳开始收、画面已进入尾声 → 主进程先停会话与 Service
             *   'finished' = 动画放完 → 主进程关窗口、退进程
             */
            exitStage: {
                params: { stage: 'collapse' | 'finished' };
                response: RpcResult<void>;
            };
        };
        messages: {
            log: { level: 'info' | 'warn' | 'error'; msg: string };
        };
    };
    webview: {
        requests: Record<string, never>;
        messages: {
            /** 主进程截获到关闭事件 → 通知前端铺开退场动画并开始播音乐 */
            exitSequence: Record<string, never>;
        };
    };
}
