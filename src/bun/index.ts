import { BrowserWindow, BrowserView, Updater } from 'electrobun/main';
import { buildRpcHandlers, setMainWindow } from './rpc-handlers';
import { startHttpServer } from './http-server';
import type { AppRPC } from '../shared/rpc';
import { logMsg } from './utils';

// === 开发模式：自动打开 WebView2 DevTools ===
// WebView2 原生支持这个环境变量，启动时会自动弹出 devtools
// 生产环境打包时不会走 hutch run dev，所以默认开 devtools 没问题
const isDev = true; // electrobun dev 模式下默认 true
if (isDev && typeof process !== 'undefined') {
	// @ts-ignore
	process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--auto-open-devtools-for-tabs';
}

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.getLocalInfo().then((info) => info?.channel ?? 'dev');
	if (channel === 'dev') {
		const maxRetries = 10;
		const retryDelayMs = 500;
		for (let i = 0; i < maxRetries; i++) {
			try {
				await fetch(DEV_SERVER_URL, { method: 'HEAD' });
				logMsg(`检测到开发环境，使用 HMR 模式，连接到 Vite dev server: ${DEV_SERVER_URL}`);
				return DEV_SERVER_URL;
			} catch {
				if (i < maxRetries - 1) {
					logMsg(`等待 Vite dev server... (尝试 ${i + 1}/${maxRetries})`);
					await new Promise((r) => setTimeout(r, retryDelayMs));
				}
			}
		}
		logMsg('Vite dev server 未启动，将使用生产环境 url 启动页面');
	}
	logMsg('检测到生产环境，将使用生产环境 url 启动页面');
	return 'views://mainview/index.html';
}

// 创建 RPC —— 使用 electrobun 正确的 API
// console.log('[RPC] Defining RPC handlers...');
const rpc = BrowserView.defineRPC<AppRPC>({
	handlers: buildRpcHandlers(),
});
// console.log('[RPC] RPC defined successfully');

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: 'MindTheGap-Harness',
	url,
	frame: {
		width: 1200,
		height: 800,
		// x: 200,
		// y: 200,
	},
	titleBarStyle: 'hidden',	// 无边框：去掉原生标题栏与三大金刚键，改由前端 TitleBar 组件自绘（见 mainview/App/TitleBar）
	styleMask: { Resizable: true, Closable: true, Miniaturizable: true },	// 保留原生缩放边框，否则无边框窗口在 Windows 上无法拖动边缘调整大小
	rpc,
});

// 窗口控制类 RPC 需要实例，创建后再注入（详见 rpc-handlers.ts 文件头）
setMainWindow(mainWindow);

console.log('MindTheGap-Harness started!');
console.log(`[Main] Window ID: ${mainWindow.id}`);

// 启动 Agent HTTP Server（浏览器 / WebView2 均可访问，参照 FFBox serviceBridge）
// 流式推送通过 SSE（EventSource），不再需要 RPC send.agentStream
startHttpServer();
