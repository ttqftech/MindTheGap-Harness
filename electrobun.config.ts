import type { ElectrobunConfig } from 'electrobun';
import { buildDefine } from "./config/build-info.mjs";

// 本配置同时服务 dev 与 build，只能嗅探 argv：hutch 用临时 loader 求值它，命令行里带着 `--env=dev`（dev）或 `--env=stable`（build，见 hutch.config.ts）。
// 猜错的后果只是 /api/health 里一个布尔不准，不值得为它多引一层判断。
const isDev = process.argv.some((arg) => arg === 'dev' || arg === '--env=dev');

export default {
	app: {
		name: "MindTheGap-Harness",
		identifier: "mindthegap.ttqf.tech",
		version: "0.1.0",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/desktop/index.ts",
			define: buildDefine(isDev),
			sourcemap: "inline",
		},
		copy: {
			"dist/mainview/index.html": "views/mainview/index.html",
			"dist/mainview/assets": "views/mainview/assets",
			// Service 独立进程的产物：主进程 spawn <app>/bin/cottontail.exe 跑它（见 src/desktop/service.ts）
			// dev 下没有这份拷贝也无妨 —— dev 走 node <repo>/dist/MTGService/MTGService.mjs
			// ⚠️ 目标目录不能是 views/（views:// 资源根，前端可 fetch 到后端代码），也不能是 app/bun/（electrobun 写死的主进程 bundle 输出）
			"dist/MTGService/MTGService.mjs": "service/MTGService.mjs",
			// Service 运行时的随包资源：它靠「从 cwd 逐级向上找」定位，prod 下 cwd = Resources/app（见 service.ts）
			"plugins": "plugins",
			"mcp-servers": "mcp-servers",
			// runtime/ = 运行时脚本（web-render.mjs，被 Service spawn 的无头渲染器）；
			"runtime": "runtime",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
			icon: "MTG-logo_带底板_256.png",
		},
	},
} satisfies ElectrobunConfig;
