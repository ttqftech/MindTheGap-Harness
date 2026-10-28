/**
 * Service 独立进程入口 — MindTheGap-Harness
 *
 * 复刻主进程的启动顺序（loadSettings → startHttpServer → mcpManager.syncAll），
 * 但不创建窗口、不注册 RPC —— 本文件是纯 Service 侧，零 electrobun 依赖。
 *
 * 三种跑法：
 *   dev   ：node dist/MTGService/MTGService.mjs [--channel=dev]   （可 --inspect 下断点）
 *   e2e   ：同上，channel=e2e                                （离线探针 / mock LLM）
 *   prod  ：<app>/bin/cottontail.exe <app>/Resources/.../MTGService/MTGService.mjs --channel=stable
 *            （同一份产物，由 electrobun 主进程 spawn，见 src/desktop/service.ts）
 *
 * 停机有两条路：
 *   ① POST /api/shutdown（主进程退场时调用，优雅：cancel → flush → stopAll → 退出）
 *   ② SIGINT / SIGTERM（手动 Ctrl+C / 被信号杀）
 */

import { loadSettings, settings, snapshot } from './storage';
import { startHttpServer, gracefulShutdown } from './http-server';
import { mcpManager } from './mcp/manager';
import { logMsg } from '../shared/utils';

const channel =
	process.argv.find((a) => a.startsWith('--channel='))?.slice('--channel='.length) ??
	process.env.MTG_CHANNEL ??
	'unknown';

await loadSettings();
startHttpServer({ channel });
await mcpManager.syncAll(snapshot(settings.mcpServers)).catch((e) => {
	logMsg.error(`[service] MCP 同步失败: ${(e as Error).message}`);
});
logMsg(`[service] Service 已就绪（channel=${channel}，pid=${process.pid}）`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
	process.on(sig, () => gracefulShutdown(`signal:${sig}`));
}

// 父进程死亡检测：主进程被强杀（dev watch 重启 / 崩溃）时没人来调 /api/shutdown，
// 孤儿服务会占着 18999，让重启后的主进程 adopt 到旧代码。父进程在 spawn 时注入 MTG_PARENT_PID。
// 手动起的调试进程没有这个环境变量 ⇒ 不受影响。interval 已 unref，不替进程续命。
const parentPid = Number(process.env.MTG_PARENT_PID);
if (parentPid > 0 && typeof process.kill === 'function') {
	setInterval(() => {
		try {
			process.kill(parentPid, 0);
		} catch {
			gracefulShutdown('parent-gone');
		}
	}, 2000).unref();
}
