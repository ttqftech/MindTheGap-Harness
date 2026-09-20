/*
   build-info — 构建信息（git 提交 / 是否开发构建 / 构建时间）

   三份构建配置（主进程 electrobun / 前端 vite / e2e 服务 vite）注入，暴露成全局常量 buildInfo（类型见 src/shared/buildInfo.ts）。
   做法参考 A:\Code\FFBox\scripts\dev-frontend.mjs 的 injectProcessEnv。

   ⚠️ 本模块被 hutch 在 **Cottontail** 里求值（不是 Node），实测该进程的时区是 UTC —— 直接拼「YYYY-MM-DD HH:mm:ss」会偏 8 小时。
   所以 buildTime 输出 ISO 8601 UTC，由展示侧（前端）自己转本地时区。
 */

import { execFileSync } from 'node:child_process';

/** 跑一条命令取输出；失败（无 git / 非仓库 / 权限）返回 failValue，绝不阻断构建 */
function emptyableExec(command, args, failValue = '') {
	try {
		return execFileSync(command, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return failValue;
	}
}

/** 短哈希，工作区有未提交改动时加 `*` 前缀（一眼看出编的不是干净提交） */
function gitCommit() {
	const hash = emptyableExec('git', ['show', '-s', '--format=%h']);
	return hash ? `${emptyableExec('git', ['status', '-s']) ? '*' : ''}${hash.slice(0, 7)}` : 'unknown';
}

/**
 * 产出可直接塞给 bundler `define` 的键值对（值是 JSON，会被整体替换成对象字面量）。
 */
export function buildDefine(isDev) {
	return {
		buildInfo: JSON.stringify({
			gitCommit: gitCommit(),
			isDev: !!isDev,
			buildTime: new Date().toISOString(),
		}),
	};
}
