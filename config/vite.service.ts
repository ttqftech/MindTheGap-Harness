import { defineConfig } from "vite";
import { resolve } from "node:path";
import { buildDefine } from "./build-info.mjs";

/**
 * Service 独立构建 — 产物 dist/MTGService/MTGService.mjs
 *
 * 与主进程（electrobun.config.ts 的 cottontail entry）和前端（vite.mainview.ts）
 * 共用 config/build-info.mjs 的 define 注入，漏了 define 会直接
 * `buildInfo is not defined`（故意的，见 AGENTS.md「构建信息注入」）。
 *
 * 三层构建产物统一收在 dist/ 下、各层一个名字：
 *   dist/mainview/          前端（vite.mainview.ts）
 *   dist/MTGService/        本配置 —— Service 独立进程
 * 入口 src/service/index.ts 用了 top-level await ⇒ target 必须 esnext。
 * node: 内置模块保持 external（node 与 cottontail 都认），只打包项目代码。
 * ⚠️ 文件名 MTGService.mjs 必须是独有的：叫 server.mjs 会跟 WorkBuddy 自己的
 *    mcp-server.mjs 撞子串，devWindows.cjs 按命令行收子进程时会误杀（见其注释）。
 */
export default defineConfig(({ command }) => ({
	define: buildDefine(command === "serve"),
	resolve: {
		alias: [
			{ find: "@shared", replacement: resolve(__dirname, "../src/shared") },
		],
	},
	build: {
		target: "esnext",
		ssr: "src/service/index.ts",
		// outDir 相对 root（未设 root ⇒ cwd = 仓库根）
		outDir: "dist/MTGService",
		emptyOutDir: true,
		minify: false,
		sourcemap: true,
		rollupOptions: {
			output: {
				entryFileNames: "MTGService.mjs",
				format: "esm",
			},
		},
	},
}));
