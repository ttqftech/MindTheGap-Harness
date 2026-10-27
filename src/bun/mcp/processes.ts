/* ==========================================================================
   MCP 托管进程 — MindTheGap-Harness

   HTTP 传输的 MCP 服务器如果由本应用拉起（config.launch），子进程就归这里管：
   - ensureStarted：没起就起；起过但已退出就重新起
   - kill / killAll：断开连接与退场时收掉

   ⚠️ 为什么必须显式收：stdio 服务器会因为父进程退出、stdin 管道关闭而自己退出，
   但 HTTP 服务器没有这回事 —— 不 kill 就会变成孤儿，而且长期占着端口，下次启动直接 EADDRINUSE，只能去任务管理器手杀。

   索引键用 serverId 而不是 pid：进程重启后 pid 会变，而调用方只认服务器。
   ========================================================================== */

import { spawn, type ChildProcess } from 'node:child_process';
import type { McpServerConfig } from '@shared/agent';
import { resolveCommand } from './client';
import { logMsg } from '../utils';

interface ManagedProcess {
	serverId: string;
	child: ChildProcess;
	stderrTail: string;
}

const registry = new Map<string, ManagedProcess>();	// serverId -> process

function isAlive(p: ManagedProcess): boolean {
	return p.child.exitCode === null && p.child.signalCode === null && !p.child.killed;
}

export function isRunning(serverId: string): boolean {
	const p = registry.get(serverId);
	return p ? isAlive(p) : false;
}

/** 最近一段 stderr，探测失败时贴进错误信息里，省得再去找日志 */
export function getStderrTail(serverId: string): string {
	return registry.get(serverId)?.stderrTail ?? '';
}

/**
 * 确保该服务器对应的进程在跑。
 * @returns 是否有一个活着的进程（配置里没有 launch 时返回 false —— 无从拉起）
 */
export async function ensureStarted(config: McpServerConfig): Promise<boolean> {
	const launch = config.launch;
	if (!launch?.command) return false;

	const existing = registry.get(config.id);
	if (existing) {
		if (isAlive(existing)) return true;
		// 已经退出了：清掉旧记录再重新起，避免注册表里留着尸体
		kill(config.id);
	}

	const child = spawn(resolveCommand(launch.command), launch.args ?? [], {
		cwd: launch.cwd,
		env: { ...process.env, ...(launch.env ?? {}) } as NodeJS.ProcessEnv,
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
	});

	const entry: ManagedProcess = { serverId: config.id, child, stderrTail: '' };
	registry.set(config.id, entry);

	child.stderr?.on('data', (chunk: Buffer | string) => {
		entry.stderrTail = (entry.stderrTail + chunk.toString()).slice(-2000);
	});
	child.on('error', (err) => {
		logMsg.error(`[MCP] 托管进程启动失败（${config.name}）: ${err.message}`);
	});
	child.on('close', (code) => {
		// 只有仍是当前记录才移除：重启时被顶掉的旧进程不该删掉新记录
		if (registry.get(config.id) === entry) registry.delete(config.id);
		logMsg(`[MCP] 托管进程退出（${config.name}），code=${code}`);
	});

	logMsg(`[MCP] 拉起托管进程（${config.name}）: ${launch.command} ${(launch.args ?? []).join(' ')}`);
	return true;
}

export function kill(serverId: string): void {
	const p = registry.get(serverId);
	if (!p) return;
	registry.delete(serverId);
	try {
		p.child.kill();
	} catch {
		/* 已经没了就算了 */
	}
}

/** 退场时调用：把所有托管进程收掉 */
export function killAll(): void {
	for (const id of Array.from(registry.keys())) kill(id);
}

/** 供状态展示：谁被托管着、pid 多少、还活着吗 */
export function list(): Array<{ serverId: string; pid: number | undefined; alive: boolean }> {
	return Array.from(registry.values()).map((p) => ({
		serverId: p.serverId,
		pid: p.child.pid,
		alive: isAlive(p),
	}));
}
