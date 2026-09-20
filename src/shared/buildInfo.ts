/* ==========================================================================
   buildInfo — 构建期注入的全局常量（这里只有类型，运行时没有任何代码）

   值由三份构建配置的 define 注入，统一来自 config/build-info.mjs（参考 FFBox 的
   injectProcessEnv）。**故意不做运行时兜底**：没注入就是构建配置漏了 define，
   应当立刻炸出来，而不是悄悄显示一个 'unknown' 让人误以为查过了。
   ========================================================================== */

export type BuildInfo = {
	/** git 短哈希；工作区有未提交改动时带 `*` 前缀；读不到 git 时为 'unknown' */
	gitCommit: string;
	/** 是否开发构建（vite dev server / `hutch electrobun dev`） */
	isDev: boolean;
	/** 构建时间，ISO 8601 **UTC**（构建配置跑在 Cottontail 里，那里时区是 UTC，展示侧自行转本地） */
	buildTime: string;
};

/** `GET /api/health` 的返回体：构建信息 + 运行时信息，用来判断「18999 上跑的是哪个进程」 */
export type ServiceHealth = {
	ok: boolean;
	service: string;
	port: number;
	/** 进程号 —— 端口被旧进程占着时，用它和 netstat 的结果对得上 */
	pid: number;
	/** electrobun 发布通道（dev / canary / stable）；脱离 electrobun 独立运行时为 'unknown' */
	channel: string;
	/** 本服务启动时间，ISO 8601 UTC（区分「进程刚起」和「跑了很久的旧进程」） */
	startedAt: string;
	build: BuildInfo;
};

declare global {
	/** 由 bundler 的 define 整体替换成对象字面量 */
	const buildInfo: BuildInfo;
}
