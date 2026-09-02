export default {
	// 委托 pnpm 管理 JS 依赖与前端二进制执行（hutch 内置解析器不稳定，详见 docs/hutch-to-pnpm-迁移.md）
	// 设置后：hutch install 委托 pnpm install；hutch pm ... 转发给 pnpm
	packageManager: "pnpm",
	scripts: {
		// pnpm install --frozen-lockfile
		// 严格按照 pnpm-lock.yaml 锁文件安装依赖（pnpm-lock.yaml 是本项目唯一正确的 JS 锁文件）
		install: ["pnpm", "install", "--frozen-lockfile"],

		// hutch electrobun prepare  → 下载并准备 electrobun 运行时/SDK/原生二进制（不可替代）
		// pnpm exec vite build  → 用 pnpm 直接执行 vite 构建，绕过 hutch pm 层
		// hutch electrobun dev  → 以开发模式启动 electrobun 桌面应用（不可替代）
		start: "hutch electrobun prepare && pnpm exec vite build && hutch electrobun dev",

		// 与 start 类似，但末尾加 --watch：文件变更时自动重新构建并重载应用
		dev: "hutch electrobun prepare && hutch pm exec -- vite build && hutch electrobun dev --watch",
		// dev: "hutch electrobun prepare && pnpm exec vite build && hutch electrobun dev --watch",

		// pnpm exec concurrently ...  → 并行运行两个 hutch 脚本
		//   hutch run hmr   → 启动 Vite HMR 热更新开发服务器（端口 5173）
		//   hutch run start → 构建前端 + 启动 electrobun 桌面应用
		// 效果：前端代码修改后浏览器端即时热更新，无需整包重构建
		"dev:hmr": ["pnpm", "exec", "concurrently", "hutch run hmr", "hutch run start"],

		// hutch electrobun prepare  → 准备运行时（不可替代）
		// pnpm exec vite --port 5173  → 用 pnpm 启动 Vite 开发服务器，监听 5173 端口，提供 HMR
		hmr: "hutch electrobun prepare && pnpm exec vite --port 5173",

		// hutch electrobun prepare  → 准备运行时（不可替代）
		// pnpm exec vite build  → 构建前端生产包
		// hutch electrobun build --env=stable  → 以 stable（稳定）环境打包桌面应用安装程序（不可替代）
		build: "hutch electrobun prepare && pnpm exec vite build && hutch electrobun build --env=stable",

		// 与 build 类似，但 --env=canary：以 canary（金丝雀/预发布）环境打包，用于测试新功能
		"build:canary": "hutch electrobun prepare && pnpm exec vite build && hutch electrobun build --env=canary",
	},
	electrobun: {
		// 指定项目使用的 electrobun 版本，hutch 会据此下载对应 SDK
		version: "2.0.1",
	},
};