import type { ElectrobunConfig } from 'electrobun';
import { buildDefine } from "./config/build-info.mjs";

// 本配置同时服务 dev 与 build，只能嗅探 argv：hutch 用临时 loader 求值它，命令行里带着 `--env=dev`（dev）或 `--env=stable`（build，见 hutch.config.ts）。
// 猜错的后果只是 /api/health 里一个布尔不准，不值得为它多引一层判断。
const isDev = process.argv.some((arg) => arg === 'dev' || arg === '--env=dev');

export default {
	app: {
		name: "MindTheGap-Harness",
		identifier: "mindthegap.electrobun.dev",
		version: "0.1.0",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
			define: buildDefine(isDev),
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
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
		},
	},
} satisfies ElectrobunConfig;
