/**
 * 主进程 RPC Handlers — MindTheGap-Harness（精简版）
 *
 * 窗口控制需要拿到 BrowserWindow 实例，但它是在 index.ts 里创建的（晚于 RPC 定义），
 * 所以这里用一个模块级引用 + setMainWindow() 在窗口创建后再注入。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir, platform, arch } from "node:os";
import { execSync } from "node:child_process";
import { Utils } from "electrobun/main";
import type { BrowserWindow } from "electrobun/main";
import type { RpcResult } from "@shared/rpc";
import { version } from "@shared/buildInfo";
import { reportExitStage } from "./exitSequence";
import { setWindowFrameUnlocked } from "./windowsPatch";
import type { ServiceHandle } from "./service";

// #region 主窗口引用（见文件头说明）

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow) {
	mainWindow = win;
}

/**
 * Service 的托管句柄。和 mainWindow 同样的道理：RPC 先于 ensureService 定义，
 * 所以这里留一个模块级引用，由 index.ts 在 ensureService 之后注入。
 * 前端靠它区分「本应用 spawn 的服务」与「接入的现有服务」。
 */
let serviceHandle: ServiceHandle | null = null;

export function setServiceHandle(handle: ServiceHandle) {
	serviceHandle = handle;
}

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
	getEnvInfo: (): RpcResult<{ platform: string; arch: string; osVersion: string; userDataPath: string; appVersion: string, build: typeof buildInfo }> =>
		safe(() => ({
			platform: platform(),
			arch: arch(),
			osVersion: execSync("ver 2>nul || sw_vers 2>/dev/null || echo unknown").toString().trim(),
			userDataPath: getUserDataDir().replace(/\\/g, "/"),
			appVersion: version,
			build: buildInfo,
		})),

	/** Service 来源（spawn / adopt）+ 端口：界面上的「服务来源」指示靠它 */
	getServiceInfo: (): RpcResult<{ mode: "spawned" | "adopted"; pid: number | null; port: number }> =>
		safe(() => ({
			mode: serviceHandle?.mode ?? "adopted",
			pid: serviceHandle?.child?.pid ?? null,
			port: 18999,
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

// #endregion

// #region 窗口控制（无边框窗口的三大金刚键）

export const windowHandlers = {
	windowMinimize: (): RpcResult<void> =>
		safe(() => {
			mainWindow?.minimize();
		}),

	windowToggleMaximize: (): RpcResult<boolean> =>
		safe(() => {
			if (!mainWindow) return false;
			if (mainWindow.isMaximized()) mainWindow.unmaximize();
			else mainWindow.maximize();
			// 部分平台切换是异步生效的，这里立即回读一次作为返回值
			return mainWindow.isMaximized();
		}),

	windowClose: (): RpcResult<void> =>
		safe(() => {
			mainWindow?.requestClose();
		}),

	/** 读外框：退场动效的起点。最大化状态下拿到的是最大化后的实际外框 */
	windowGetFrame: (): RpcResult<{ x: number; y: number; width: number; height: number }> =>
		safe(() => mainWindow?.getFrame() ?? { x: 0, y: 0, width: 0, height: 0 }),

	/** 写外框：退场动效逐帧调用（一次同时改位置与尺寸） */
	windowSetFrame: (params: { x: number; y: number; width: number; height: number }): RpcResult<void> =>
		safe(() => {
			mainWindow?.setFrame(params.x, params.y, Math.max(1, params.width), Math.max(1, params.height));
		}),

	/**
	 * 退场动画解限：系统会把带 caption/thickframe 的窗口钳在最小跟踪尺寸（~131x36），
	 * 收不到 1x1。这里临时把窗口转成 WS_POPUP，动画结束（预览）再还原。
	 */
	windowSetFrameUnlocked: async (params: { unlocked: boolean }): Promise<RpcResult<void>> => {
		try {
			await setWindowFrameUnlocked(params.unlocked);
			return ok(undefined);
		} catch (e: any) {
			return fail(e?.message ?? String(e));
		}
	},

	/** 启动动画收尾时退出全屏（进全屏在建窗时做，见 index.ts） */
	windowSetFullScreen: (params: { fullScreen: boolean }): RpcResult<void> =>
		safe(() => {
			mainWindow?.setFullScreen(params.fullScreen);
		}),

	/**
	 * 前端报告退场进度。只有这一个入口（不再为每个时点加一条 RPC）：
	 *   collapse = 外壳开始收 → 先停会话与 Service，窗口留着放完动画
	 *   finished = 动画放完 → 关窗、退进程
	 */
	exitStage: (params: { stage: 'collapse' | 'finished' }): RpcResult<void> =>
		safe(() => {
			reportExitStage(params.stage);
		}),

	windowIsMaximized: (): RpcResult<boolean> =>
		safe(() => mainWindow?.isMaximized() ?? false),
};

// #endregion

export function buildRpcHandlers() {
	return {
		requests: {
			dialogOpen: systemHandlers.dialogOpen,
			dialogSave: systemHandlers.dialogSave,
			shellOpenPath: systemHandlers.shellOpenPath,
			shellOpenExternal: systemHandlers.shellOpenExternal,
			getEnvInfo: systemHandlers.getEnvInfo,
			getServiceInfo: systemHandlers.getServiceInfo,
			windowMinimize: windowHandlers.windowMinimize,
			windowToggleMaximize: windowHandlers.windowToggleMaximize,
			windowClose: windowHandlers.windowClose,
			windowIsMaximized: windowHandlers.windowIsMaximized,
			windowGetFrame: windowHandlers.windowGetFrame,
			windowSetFrame: windowHandlers.windowSetFrame,
			windowSetFrameUnlocked: windowHandlers.windowSetFrameUnlocked,
			windowSetFullScreen: windowHandlers.windowSetFullScreen,
			exitStage: windowHandlers.exitStage,
		},
		messages: {
			log: ({ level, msg }: { level: string; msg: string }) => {
				console.log(`[${level.toUpperCase()}] ${msg}`);
			},
		},
	};
}
