// @hutch cli=0.28.2
// 工具链版本：hutch 0.28.2 / cottontail 0.7.3 / electrobun 2.0.5（三者在 2.0.5 的 native-devkit.json 里自洽）。
// 历史上曾用 hutch 0.25 / cottontail 0.5.0 / electrobun 2.0.1。
//
// ⚠️ 跑 `hutch run <script>` 必须带 HUTCH_RUNTIME=cottontail：
//    默认 runtime 是 Bun，hutch 会先下 `bun 1.4.4 toolchain`（GitHub 直连，本机必失败 → HttpConnectionClosing）；
//    手动往 ~/.hutch/toolchains/bun/1.4.4/ 放 bun.exe 没用，hutch 每次重试会先清空该目录再下。
//    cottontail runtime 不依赖 bun，脚本层只要不写 `pnpm`（改用 `hutch pm`）就没有别的差异。
export default {
	// 委托 pnpm 管理 JS 依赖与前端二进制执行（hutch 内置解析器不稳定，详见 docs/hutch-to-pnpm-迁移.md）
	// 设置后：hutch install 委托 pnpm install；hutch pm ... 转发给 pnpm
	packageManager: "pnpm",
	scripts: {
		// pnpm install --frozen-lockfile → 严格按照 pnpm-lock.yaml 安装 JS 依赖
		// hutch electrobun prepare     → 下载 electrobun 运行时/SDK 到 .hutch/devkit（首次 clone 后必需）
		//   注：dev/build/run 也会隐式 prepare，但 install 里显式跑一次可确保 clone 后立即可用
		// TODO node scripts/patch-devkit.mjs → prepare/sync 会覆盖 devkit，重新打上 TS4094 补丁（幂等，见脚本注释），后期版本更新无此问题后必须移除，因为这只是 AI 自作主张写的东西，与 MTG 无关
		install: "hutch pm install --frozen-lockfile && hutch electrobun prepare && node scripts/patch-devkit.mjs",

		// 【日常开发主力】前端 HMR + 桌面壳 两路并行（**不含 Service**）
		//   pnpm run dev:fe            → vite dev server:5173，壳里的 WebView 检测到就连它，改前端即时热更新
		//   hutch electrobun dev --watch → 编译并启动桌面壳，主进程文件变更时自动重载
		// 前提：Service 已经有人在跑（VSCode 里 F5 的 "Debug Service (:18999)"），或至少 dist/MTGService/MTGService.mjs 存在。壳启动时会探活 18999：通了就 adopt 你的调试进程（不 spawn、不杀），没通才自己 spawn。
		// ⚠️ 数组脚本的第一项是程序名，不能写 pnpm（.cmd shim 在 Bun.$ 里直接报错）；子命令字符串由 concurrently 经 cmd.exe 执行，里面的 pnpm 正常
		dev: ["hutch", "pm", "exec", "concurrently", "pnpm run dev:fe", "hutch electrobun dev --watch --inspect=9230"],

		// 【一条命令全起】前端 + Service watch + 桌面壳，三路并行。适合「不调后端、也不想开两个窗口」的场合；Service 由壳自己 spawn，改 src/service 后需重启应用才生效。
		"dev:all": ["hutch", "pm", "exec", "concurrently", "pnpm run dev:fe", "pnpm run dev:service", "hutch electrobun dev --watch --inspect=9230"],

		// 构建 + 启动（无 HMR，用于调试或预览生产产物）
		start: "hutch pm exec vite build --config config/vite.mainview.ts && hutch pm run build:service && hutch electrobun dev",

		// 生产打包
		//   hutch pm exec vite build --config config/vite.mainview.ts → 构建前端生产包（hutch pm 就是 pnpm 的转发）
		//   hutch pm run build:service → 构建 Service 独立进程产物（由 electrobun.config.ts 的 copy 收进安装包）
		//   hutch electrobun build --env=stable → 打包桌面应用安装程序（stable 稳定通道）
		build: "hutch pm exec vite build --config config/vite.mainview.ts && hutch pm run build:service && hutch electrobun build --env=stable",

		// 与 build 类似，但 --env=canary：以 canary（金丝雀/预发布）环境打包，用于测试新功能
		"build:canary": "hutch pm exec vite build --config config/vite.mainview.ts && hutch pm run build:service && hutch electrobun build --env=canary",
	},
	electrobun: {
		// 指定项目使用的 electrobun 版本，hutch 会据此下载对应 SDK
		version: "2.0.5",
	},
};
