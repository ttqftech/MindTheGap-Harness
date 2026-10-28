import { BrowserWindow, BrowserView, Updater } from 'electrobun/main';
import { buildRpcHandlers, setMainWindow } from './rpc-handlers';
import { installExitSequence } from './exitSequence';
import { ensureService, cancelAllRuns, stopService, type ServiceHandle } from './service';
import { patchFramelessWindowFrame } from './windowsPatch';
import { logMsg } from '../shared/utils';
import type { AppRPC } from '../shared/rpc';

logMsg('[main] MindTheGap-Harness - GAPPERS SAVE THE WORLD!');

// 开发模式下自动打开 WebView2 DevTools
// 注意：不能通过 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量实现，
// 因为 electrobun 原生层已通过 put_AdditionalBrowserArguments() API 设了自己的浏览器参数，
// API 级设置优先级高于环境变量，导致环境变量被忽略。
// 改用 BrowserView.openDevTools()（底层调用 ICoreWebView2::OpenDevToolsWindow()）在窗口创建后手动打开。
const channel = await Updater.getLocalInfo().then((info) => info?.channel);
const isDevChannel = !channel || channel === 'dev';
logMsg(`[main] 当前环境：${channel}`);

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// 创建 RPC
const rpc = BrowserView.defineRPC<AppRPC>({
	handlers: buildRpcHandlers(),
});

// 创建主窗口
let mainWindow: BrowserWindow | null = null;
async function createMainWindow(service: ServiceHandle) {
	async function getMainViewUrl(): Promise<string> {
		if (isDevChannel) {
			const maxRetries = 5;
			const retryDelayMs = 500;
			for (let i = 0; i < maxRetries; i++) {
				try {
					await fetch(DEV_SERVER_URL, { method: 'HEAD' });
					logMsg(`[mainWindow] 检测到开发环境，使用 HMR 模式，连接到 Vite dev server: ${DEV_SERVER_URL}`);
					return DEV_SERVER_URL;
				} catch {
					if (i < maxRetries - 1) {
						logMsg(`[mainWindow] 等待 Vite dev server... (尝试 ${i + 1}/${maxRetries})`);
						await new Promise((r) => setTimeout(r, retryDelayMs));
					}
				}
			}
			logMsg('[mainWindow] Vite dev server 未启动，将使用生产环境 url 启动页面');
		}
		logMsg('[mainWindow] 检测到生产环境，将使用生产环境 url 启动页面');
		return 'views://mainview/index.html';
	}

	logMsg('[main] 正在创建主窗口');

	const url = await getMainViewUrl();

	mainWindow = new BrowserWindow({
		title: 'MindTheGap-Harness',
		url,
		frame: {
			width: 1200,
			height: 800,
			// x: 200,
			// y: 200,
		},
		// 无边框：去掉原生标题栏与三大金刚键，改由前端 TitleBar 组件自绘（见 mainview/App/TitleBar）
		//
		// 必须用 'hiddenInset' 而不是 'hidden'：
		//   · 'hidden'      → Titled:false → Windows 上建成 WS_POPUP 裸窗口，丢掉 DWM 投影、Win11 圆角、边缘缩放和 snap（实测 GWL_STYLE=0x94000000）
		//   · 'hiddenInset' → Titled:true + FullSizeContentView:true → 有 WS_CAPTION|WS_THICKFRAME，
		//                     投影 / 圆角 / 缩放边框都在；且 electrobun 处理了 WM_NCCALCSIZE，
		//                     实测客户区上偏移仍是 0，原生标题栏不占顶部空间（实测 GWL_STYLE=0x16C40000）
		//
		// styleMask 补不出 WS_SYSMENU/WS_MINIMIZEBOX/WS_MAXIMIZEBOX（试过 FullScreen:true 无效），
		// 那三个位由 windowsPatch.ts 在窗口创建后用 Win32 API 补上，用于启用 Win11 snap layouts。
		titleBarStyle: 'hiddenInset',
		styleMask: { Resizable: true, Closable: true, Miniaturizable: true },
		rpc,
	});
	
	// 窗口控制类 RPC 需要实例，创建后再注入（详见 rpc-handlers.ts 文件头）
	setMainWindow(mainWindow);

	// 关闭拦截：所有关闭路径（右上角 / Alt+F4 / 系统菜单 / 任务栏）都先走退场序列
	installExitSequence({
		getWindow: () => mainWindow,
		notifyFrontend: () => {
			rpc.send.exitSequence({});	// 通过 RPC 通知前端退出序列
			mainWindow?.webview.executeJavascript('window.__mtgExitSequence?.()');	// 直接往页面打脚本 —— dev 下 HMR 换掉模块后 Electroview 不会重建，message handler 可能还是旧的（没注册 exitSequence），需要手动调用
		},
		// 停会话 / 停服务都走 HTTP：主进程不 import 任何 service 代码（见 service.ts 文件头）
		stopAllRuns: () => {
			void cancelAllRuns();
		},
		stopServer: () => {
			// 只停自己 spawn 的那个；adopt 的调试服务（开发者手动起的）不碰
			void stopService(service);
		},
	});

	// Windows：给无边框窗口补回系统窗口样式位，拿回投影 / 圆角 / snap（详见 windowsPatch.ts 文件头）
	await patchFramelessWindowFrame('MindTheGap-Harness');

	// 开发模式下自动打开 DevTools
	if (isDevChannel) {
		mainWindow.webview.openDevTools();
	}
}	

// 启动顺序：先确保 Service 可用（adopt 已在跑的 / spawn 新的并等就绪），再建窗口。
// 反过来（先建窗后起服务）会让前端首波 HTTP 请求撞上一个还没监听的服务。
// 主进程自己不读设置 —— settings 由 Service 进程自己加载（src/service/index.ts）。
logMsg('[main] 正在启动 Service');
const service = await ensureService({ channel: channel ?? 'unknown', isDev: isDevChannel });

await createMainWindow(service);
