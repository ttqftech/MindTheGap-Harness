import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
	plugins: [solid()],
	resolve: {
		alias: [
			// FFBox-UI 未发布到 npm，直接指向 vendor 目录下的构建产物（自动注册版）
			{
				find: /^ffbox-ui$/,
				replacement: resolve(__dirname, "vendor/ffbox-ui/dist/esm/ffbox-ui-autoregister.js"),
			},
			// 主题样式：ffbox-ui/themes/light.css、ffbox-ui/themes/dark.css
			{
				find: /^ffbox-ui\/themes\/(.*)$/,
				replacement: resolve(__dirname, "vendor/ffbox-ui/dist/themes/$1"),
			},
			...electrobunViteAliases(resolve(__dirname, ".hutch/devkit")),
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
