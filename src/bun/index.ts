import { BrowserWindow, BrowserView, Updater } from 'electrobun/main';
import { buildRpcHandlers } from './rpc-handlers';
import { startHttpServer } from './http-server';
import type { AppRPC } from '../shared/rpc';

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

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.getLocalInfo().then((info) => info?.channel ?? 'dev');
	if (channel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'hutch run dev:hmr' for HMR support.",);
		}
	}
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
	rpc,
});

console.log('MindTheGap-Harness started!');
console.log(`[Main] Window ID: ${mainWindow.id}`);

// 启动 Agent HTTP Server（浏览器 / WebView2 均可访问，参照 FFBox serviceBridge）
// 流式推送通过 SSE（EventSource），不再需要 RPC send.agentStream
startHttpServer();
