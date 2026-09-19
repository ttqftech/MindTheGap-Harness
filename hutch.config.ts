export default {
	// 委托 pnpm 管理 JS 依赖与前端二进制执行（hutch 内置解析器不稳定，详见 docs/hutch-to-pnpm-迁移.md）
	// 设置后：hutch install 委托 pnpm install；hutch pm ... 转发给 pnpm
	packageManager: "pnpm",
	scripts: {
		// pnpm install --frozen-lockfile → 严格按照 pnpm-lock.yaml 安装 JS 依赖
		// hutch electrobun prepare     → 下载 electrobun 运行时/SDK 到 .hutch/devkit（首次 clone 后必需）
		//   注：dev/build/run 也会隐式 prepare，但 install 里显式跑一次可确保 clone 后立即可用
		install: "pnpm install --frozen-lockfile && hutch electrobun prepare",

		// 并行启动 Vite dev server + electrobun dev --watch
		//   pnpm exec vite --port 5173 --config config/vite.mainview.ts → Vite 开发服务器，提供前端 HMR
		//   hutch electrobun dev --watch → electrobun 桌面应用，主进程变更时自动重载
		// webview 通过 getMainViewUrl() 检测 Vite dev server 并连接 http://localhost:5173
		// 效果：保存前端文件 → Vite HMR 即时热更新；保存主进程文件 → electrobun --watch 自动重载
		dev: ["pnpm", "exec", "concurrently", "pnpm exec vite --port 5173 --config config/vite.mainview.ts", "hutch electrobun dev --watch"],

		// 构建 + 启动（无 HMR，用于调试或预览生产产物）
		start: "pnpm exec vite build --config config/vite.mainview.ts && hutch electrobun dev",

		// 生产打包
		//   pnpm exec vite build --config config/vite.mainview.ts → 构建前端生产包
		//   hutch electrobun build --env=stable → 打包桌面应用安装程序（stable 稳定通道）
		build: "pnpm exec vite build --config config/vite.mainview.ts && hutch electrobun build --env=stable",
		build2: "hutch pm exec vite build --config config/vite.mainview.ts && hutch electrobun build --env=stable",

		// 与 build 类似，但 --env=canary：以 canary（金丝雀/预发布）环境打包，用于测试新功能
		"build:canary": "pnpm exec vite build --config config/vite.mainview.ts && hutch electrobun build --env=canary",
	},
	electrobun: {
		// 指定项目使用的 electrobun 版本，hutch 会据此下载对应 SDK
		version: "2.0.1",
	},
};
