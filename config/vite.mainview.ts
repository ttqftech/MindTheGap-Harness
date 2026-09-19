import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";
import { electrobunViteAliases } from "../.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
	plugins: [solid()],
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
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
