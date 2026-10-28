import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";
import { electrobunViteAliases } from "../.hutch/devkit/api/config/electrobun-vite";
import { buildDefine } from "./build-info.mjs";
import { svgComponentPlugin } from "./vite-svg";

export default defineConfig(({ command }) => ({
	// 构建信息注入：与主进程共用 config/build-info.mjs，两边看到的一致。
	// vite dev server（serve）算开发构建，vite build 算生产构建。
	define: buildDefine(command === "serve"),
	// SVG → Solid 组件：import X from "./foo.svg" 即可 <X />。见 config/vite-svg.ts
	plugins: [solid(), svgComponentPlugin()],
	resolve: {
		alias: [
			// 前后端共享代码（src/shared）与 mainview 内部目录走 alias，消除 ../.. 深相对引用
			// 字符串 find 的匹配语义是「精确相等或 find + '/' 前缀」：'@shared' 即覆盖 @shared/xxx
			// ⚠️ 顺序敏感：'ffbox-ui/themes' 必须排在 'ffbox-ui' 之前，否则前缀匹配会吞掉主题样式
			...Object.entries({
				"ffbox-ui/themes": resolve(__dirname, "../vendor/ffbox-ui/dist/themes"),
				"ffbox-ui": resolve(__dirname, "../vendor/ffbox-ui/dist/esm/ffbox-ui-autoregister.js"),
				"@shared": resolve(__dirname, "../src/shared"),
				"@mainview": resolve(__dirname, "../src/mainview"),
			}).map(([find, replacement]) => ({ find, replacement })),
			...electrobunViteAliases(resolve(__dirname, "../.hutch/devkit")),
		],
	},
	root: "src/mainview",
	build: {
		// 产物统一收在 dist/ 下，与 Service 的 dist/MTGService/ 并列（各层一个名字）
		outDir: "../../dist/mainview",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
}));
