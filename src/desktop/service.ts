/**
 * Service 进程托管 — MindTheGap-Harness（electrobun 主进程侧）
 *
 * 本文件是**纯 HTTP 客户端**：不 import 任何 src/service 代码（那是子进程里的事）。
 * 主进程与 Service 之间只有 HTTP 一条信道，与前端同构。
 *
 * adopt-or-spawn：
 *   ① GET /api/health 探活 → 已有健康服务即 adopt，**不拥有其生命周期**
 *      （开发者手动 `node dist/MTGService/MTGService.mjs --inspect` 起的调试服务不碰，这是调试工作流的核心）
 *   ② 探活失败 → spawn 子进程并轮询就绪（30s 超时）
 *
 * 产物与运行时（都可用环境变量覆盖）：
 *   dev  ：node    <repo>/dist/MTGService/MTGService.mjs   repo 由 cwd 逐级向上定位
 *   prod ：cottontail.exe <app>/Resources/app/service/MTGService.mjs
 *   MTG_SERVICE / MTG_SERVICE_RUNTIME 可显式指定（调试 / 特殊部署）
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logMsg } from '../shared/utils';

const HTTP_PORT = 18999;
const HEALTH_URL = `http://127.0.0.1:${HTTP_PORT}/api/health`;
const PROBE_TIMEOUT_MS = 2000;
const READY_TIMEOUT_MS = 30000;
const READY_INTERVAL_MS = 300;
const SHUTDOWN_GRACE_MS = 3000;

export interface ServiceHandle {
	/** adopted = 探活时已在跑（不拥有生命周期）；spawned = 本进程拉起的（退场时负责收） */
	mode: 'adopted' | 'spawned';
	child?: ChildProcess;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 探活：可达且回 { ok: true } 才算健康。不用 AbortController —— Cottontail 的 fetch 是自研实现， race 兜底更稳 */
async function probeHealth(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const resp = await Promise.race([
			fetch(HEALTH_URL),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), timeoutMs);
			}),
		]);
		if (!resp || !resp.ok) return false;
		const info = JSON.parse(await resp.text()) as { ok?: boolean };
		return info?.ok === true;
	} catch {
		return false;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** 从 cwd 逐级向上找第一个存在 relPath 的文件，找不到返回 null */
function findUp(relPath: string, maxLevels = 8): string | null {
	let dir = process.cwd();
	for (let i = 0; i < maxLevels; i++) {
		const candidate = join(dir, ...relPath.split('/'));
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

interface SpawnTarget {
	/** 运行时命令（node 或 cottontail.exe 的路径） */
	runtime: string;
	/** MTGService.mjs 的绝对路径 */
	bundle: string;
	/** 子进程 cwd —— 决定插件 / mcp-servers 的「逐级向上找」从哪开始 */
	cwd: string;
}

function resolveSpawnTarget(isDev: boolean): SpawnTarget {
	// 显式覆盖优先（调试 / 特殊部署）
	const envBundle = process.env.MTG_SERVICE;
	if (envBundle && existsSync(envBundle)) {
		return {
			runtime: process.env.MTG_SERVICE_RUNTIME || 'node',
			bundle: envBundle,
			cwd: dirname(envBundle),
		};
	}

	if (isDev) {
		// dev：node 跑 vite 产物；repo 根 = dist/MTGService/MTGService.mjs 再往上三级
		const bundle = findUp('dist/MTGService/MTGService.mjs');
		if (!bundle) {
			throw new Error('找不到 dist/MTGService/MTGService.mjs —— 请先执行 pnpm build:service（或 pnpm dev:service 保持其常新）');
		}
		const repoRoot = dirname(dirname(dirname(bundle)));
		return { runtime: process.env.MTG_SERVICE_RUNTIME || 'node', bundle, cwd: repoRoot };
	}

	// prod：同一份产物由 electrobun.config.ts 的 copy 收进 Resources/app/service，运行时换成 app 自带的 cottontail
	const execDir = process.execPath ? dirname(process.execPath) : process.cwd();
	const appDir = join(execDir, '..', 'Resources', 'app');
	// ⚠️ 不放 views/：那是 views:// 的资源根，前端能直接 fetch 到；也不放 app/bun/（electrobun 写死的主进程 bundle 输出，会覆盖）
	const candidates = [join(appDir, 'service', 'MTGService.mjs')];
	const bundle = candidates.find((p) => existsSync(p));
	if (!bundle) {
		throw new Error(`打包产物里找不到 Service（试过：${candidates.join('、 ')}）`);
	}
	// ⚠️ cwd 必须是 **app 目录**（Resources/app）而不是 bin：plugins/、mcp-servers/、runtime/ 都随包放在那，
	//    Service 里所有「从 cwd 逐级向上找」的定位（plugins/loader.ts、storage.ts、web/render.ts）都依赖它。
	//    用 bin 当 cwd 时，只有开发机上能侥幸向上摸到仓库里的 plugins/，用户机器上 /api/modes 就是空的。
	const cwd = existsSync(appDir) ? appDir : execDir;
	return { runtime: process.env.MTG_SERVICE_RUNTIME || join(execDir, 'cottontail.exe'), bundle, cwd };
}

/**
 * 确保 Service 可用：adopt 已在跑的，或 spawn 一个并等它就绪。
 * 就绪前不返回 —— 调用方（index.ts）保证「建窗口 ⇒ 前端首波 HTTP 请求」打到一个活的服务。
 */
export async function ensureService(options: { channel: string; isDev: boolean }): Promise<ServiceHandle> {
	if (await probeHealth()) {
		logMsg(`[service] 检测到已在运行的 Service（:${HTTP_PORT}），adopt —— 不拥有其生命周期`);
		return { mode: 'adopted' };
	}

	const target = resolveSpawnTarget(options.isDev);
	logMsg(`[service] spawn Service：${target.runtime} ${target.bundle}（channel=${options.channel}）`);

	const child = spawn(
		target.runtime,
		[target.bundle, `--channel=${options.channel}`],
		{
			cwd: target.cwd,
			stdio: 'inherit',
			// 注入父 pid：子进程轮询发现父进程没了就自杀，避免孤儿服务占着 18999
			// （dev watch 重启 / 主进程崩溃时没人来调 /api/shutdown）
			env: { ...process.env, MTG_PARENT_PID: String(process.pid) },
		},
	);
	child.on('exit', (code) => logMsg(`[service] Service 子进程退出（code=${code}）`));
	child.on('error', (err) => logMsg.error(`[service] spawn 失败: ${err.message}`));

	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		// 子进程提前退出要立刻失败，别干等 30s
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`Service 启动后立即退出（code=${child.exitCode}）—— 常见原因：端口 ${HTTP_PORT} 被别的进程占用`);
		}
		if (await probeHealth(1000)) {
			logMsg(`[service] Service 就绪（pid=${child.pid}）`);
			return { mode: 'spawned', child };
		}
		await sleep(READY_INTERVAL_MS);
	}
	child.kill();
	throw new Error(`Service ${READY_TIMEOUT_MS / 1000}s 内未就绪`);
}

/**
 * 停掉所有还在飞的会话。走 HTTP（GET /api/conversations 拿 runStatus，逐个 cancel），
 * 不 import agent 代码 —— 退场序列的 stopAllRuns 用它。
 */
export async function cancelAllRuns(): Promise<number> {
	try {
		const resp = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/conversations`);
		const data = JSON.parse(await resp.text()) as { conversations?: Array<{ id: string; runStatus?: string }> };
		const alive = (data.conversations ?? []).filter((c) => c.runStatus === 'running' || c.runStatus === 'waiting');
		for (const c of alive) {
			await fetch(`http://127.0.0.1:${HTTP_PORT}/api/agent/cancel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ conversationId: c.id }),
			}).catch(() => { /* 单个取消失败不阻断其余 */ });
		}
		if (alive.length > 0) logMsg(`[service] 已取消 ${alive.length} 个进行中的会话`);
		return alive.length;
	} catch (e) {
		logMsg.error(`[service] 取消会话失败: ${(e as Error).message}`);
		return 0;
	}
}

/**
 * 停掉**自己 spawn 的** Service（adopt 的调试服务不碰）。
 * 优雅停机：POST /api/shutdown → 等子进程退出（3s）→ kill 兜底。
 * ⚠️ 不能只靠 kill：Windows 上 child.kill() 是 TerminateProcess，
 *    优雅停机里的 flushAll / stopAll 都不会跑，丢 700ms 防抖窗内的写盘、留 MCP 孤儿。
 */
export async function stopService(handle: ServiceHandle | null): Promise<void> {
	if (!handle || handle.mode !== 'spawned' || !handle.child) return;
	const child = handle.child;
	if (child.exitCode !== null) return;

	logMsg('[service] 正在停止 Service（优雅停机）');
	try {
		await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shutdown`, { method: 'POST' });
	} catch {
		// 服务可能已经没了（子进程自己崩了），直接等退出
	}

	const deadline = Date.now() + SHUTDOWN_GRACE_MS;
	while (Date.now() < deadline && child.exitCode === null) {
		await sleep(100);
	}
	if (child.exitCode === null) {
		logMsg('[service] 优雅停机超时，强杀子进程');
		child.kill();
	}
}
