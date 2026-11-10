// 只给 MarkdownText / RenderTree 探针用的最小 vite 配置（不参与正式构建）
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';
import { electrobunViteAliases } from '../.hutch/devkit/api/config/electrobun-vite';

export default defineConfig({
	plugins: [solid()],
	resolve: {
		// 与 config/vite.mainview.ts 保持同一套 alias —— RenderTree 会一路 import 到 ffbox-ui / shared，少一个就 500（模块解析失败）
		alias: [
			{ find: 'ffbox-ui/themes', replacement: resolve(__dirname, '../vendor/ffbox-ui/dist/themes') },
			{ find: 'ffbox-ui', replacement: resolve(__dirname, '../vendor/ffbox-ui/dist/esm/ffbox-ui-autoregister.js') },
			{ find: '@shared', replacement: resolve(__dirname, '../src/shared') },
			{ find: '@mainview', replacement: resolve(__dirname, '../src/mainview') },
			// RenderTree 一路 import 到 bridges/rpc.ts（`electrobun/view`）。浏览器里没有桌面壳，
			// 直接给个替身，避免去解析 .hutch/devkit 那套 alias
			{ find: 'electrobun/view', replacement: resolve(__dirname, '../artifacts/md-probe/stub-electrobun.ts') },
			...electrobunViteAliases(resolve(__dirname, '../.hutch/devkit')),
		],
	},
	root: 'artifacts/md-probe',
	// 独立预构建缓存：与正式构建的 node_modules/.vite 互不干扰，也避开「改 config → 重新预构建 → 批量删 deps」被安全钩子拦下导致 dev server 起不来
	cacheDir: 'node_modules/.vite-probe',
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
	server: {
		port: 5199,
		strictPort: true,
	},
});
