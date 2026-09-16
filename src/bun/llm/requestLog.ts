/* ==========================================================================
   LLM 层请求日志 — MindTheGap-Harness

   conversations/<id>/requestLog.jsonl：append-only，每行一条 JSON，记录「每一次发往 LLM
   的 HTTP 请求发生了什么、花了多少」。正文不进来（正文在 ctx.json 里），只有形状与用量。

   设计要点（docs/Agent架构-v2设计.md §8）：
   - 唯一埋点在 src/bun/llm/model.ts 的 callLlm()，agent / runner / 工具都不主动写日志
   - 串行写队列 + 单次 appendFile，避免并发子 Agent 把一行写花
   - 超过 maxBytes 轮转为 requestLog.1.jsonl（只留 1 份历史）
   - **日志是旁路**：写失败只 warn，绝不影响 callLlm 的返回值
   ========================================================================== */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmRequestRecord } from '../../shared/agent';
import { conversationDir } from '../storage';

// #region 常量

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const LOG_NAME = 'requestLog.jsonl';
const ROTATED_NAME = 'requestLog.1.jsonl';

// #endregion

// #region 配置注入（避免 requestLog 依赖 storage 的 settings 代理形状）

export interface RequestLogOptions {
	enabled: boolean;
	includeToolNames: boolean;
	maxBytes: number;
	dumpPayload: boolean;
}

let options: RequestLogOptions = {
	enabled: true,
	includeToolNames: true,
	maxBytes: DEFAULT_MAX_BYTES,
	dumpPayload: false,
};

export function setRequestLogOptions(next: Partial<RequestLogOptions>): void {
	options = { ...options, ...next };
}

export function getRequestLogOptions(): RequestLogOptions {
	return options;
}

// #endregion

// #region 序号 / logId

const seqCache = new Map<string, number>();

function logPath(conversationId: string): string {
	return join(conversationDir(conversationId), LOG_NAME);
}

/** 首次访问时从磁盘已有行数续号（进程重启后序号不回退） */
function nextSeq(conversationId: string): number {
	const cached = seqCache.get(conversationId);
	if (cached !== undefined) return cached + 1;
	let count = 0;
	try {
		const path = logPath(conversationId);
		if (existsSync(path)) {
			const text = readFileSync(path, 'utf-8');
			count = text.split('\n').filter((l) => l.trim()).length;
		}
	} catch {
		count = 0;
	}
	seqCache.set(conversationId, count + 1);
	return count + 1;
}

/** 申请一个 logId（在请求开始前调用，用于把 SSE / dump 文件关联起来） */
export function allocateLogId(conversationId: string): { logId: string; seq: number } {
	const seq = nextSeq(conversationId);
	seqCache.set(conversationId, seq);
	return { logId: `${seq}-${Date.now().toString(36)}`, seq };
}

// #endregion

// #region 串行写队列

const pendingLines = new Map<string, string[]>();
const flushScheduled = new Set<string>();

function ensureDir(conversationId: string) {
	const dir = conversationDir(conversationId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded(conversationId: string, incomingBytes: number) {
	const path = logPath(conversationId);
	if (!existsSync(path)) return;
	try {
		const size = statSync(path).size;
		if (size + incomingBytes <= options.maxBytes) return;
		const rotated = join(conversationDir(conversationId), ROTATED_NAME);
		if (existsSync(rotated)) rmSync(rotated, { force: true });
		renameSync(path, rotated);
		seqCache.delete(conversationId);
	} catch {
		// 轮转失败不阻塞写入
	}
}

function flushNow(conversationId: string) {
	const lines = pendingLines.get(conversationId);
	if (!lines || lines.length === 0) return;
	pendingLines.set(conversationId, []);
	const text = lines.join('\n') + '\n';
	try {
		ensureDir(conversationId);
		rotateIfNeeded(conversationId, text.length);
		appendFileSync(logPath(conversationId), text, 'utf-8');
	} catch (e) {
		// 日志是旁路：写失败不影响 agent 工作
		console.warn(`[llm/requestLog] 写入失败（已忽略）: ${(e as Error).message}`);
	}
}

/** 把一条记录排进写队列（同一条链，整行写入） */
function enqueue(conversationId: string, record: LlmRequestRecord) {
	if (!options.enabled) return;
	if (options.includeToolNames === false && record.request?.toolNames) {
		delete record.request.toolNames;
	}
	const list = pendingLines.get(conversationId) ?? [];
	list.push(JSON.stringify(record));
	pendingLines.set(conversationId, list);
	if (flushScheduled.has(conversationId)) return;
	flushScheduled.add(conversationId);
	queueMicrotask(() => {
		flushScheduled.delete(conversationId);
		flushNow(conversationId);
	});
}

// #endregion

// #region 对外 API

/** 追加一条请求记录（唯一写入口，由 llm/model.ts 调用） */
export function appendRequestRecord(record: LlmRequestRecord): void {
	try {
		enqueue(record.conversationId, record);
	} catch (e) {
		console.warn(`[llm/requestLog] 记录失败（已忽略）: ${(e as Error).message}`);
	}
}

/** dumpPayload 开启时，把完整请求 / 原始响应写到 workspace/tmp/llm/<logId>.json */
export function dumpPayload(conversationId: string, logId: string, payload: unknown): void {
	if (!options.dumpPayload) return;
	try {
		const dir = join(conversationDir(conversationId), 'workspace', 'tmp', 'llm');
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${logId}.json`), JSON.stringify(payload, null, 2), 'utf-8');
	} catch (e) {
		console.warn(`[llm/requestLog] dump 失败（已忽略）: ${(e as Error).message}`);
	}
}

export interface ReadRequestsOptions {
	limit?: number;
	agentInstanceId?: string;
	purpose?: string;
	since?: number;
}

/** 读尾部若干条（倒序返回，最新的在前） */
export function readRequests(conversationId: string, opts: ReadRequestsOptions = {}): LlmRequestRecord[] {
	const out: LlmRequestRecord[] = [];
	try {
		const path = logPath(conversationId);
		if (!existsSync(path)) return out;
		const lines = readFileSync(path, 'utf-8').split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			let rec: LlmRequestRecord;
			try {
				rec = JSON.parse(line) as LlmRequestRecord;
			} catch {
				continue;
			}
			if (opts.agentInstanceId && rec.agentInstanceId !== opts.agentInstanceId) continue;
			if (opts.purpose && rec.purpose !== opts.purpose) continue;
			if (opts.since !== undefined && rec.startedAt < opts.since) continue;
			out.push(rec);
			if (opts.limit && out.length >= opts.limit) break;
		}
	} catch {
		// 读失败按空处理
	}
	return out;
}

export interface RequestStats {
	total: number;
	byStatus: Record<string, number>;
	byPurpose: Record<string, { count: number; input: number; output: number }>;
	byModel: Record<string, { count: number; input: number; output: number }>;
	byAgentInstance: Record<string, { count: number; input: number; output: number; agentName?: string }>;
}

/** 聚合统计（按实例 / 用途 / 模型分组计数与 token） */
export function readRequestStats(conversationId: string): RequestStats {
	const stats: RequestStats = {
		total: 0,
		byStatus: {},
		byPurpose: {},
		byModel: {},
		byAgentInstance: {},
	};
	const bump = (
		map: Record<string, { count: number; input: number; output: number; agentName?: string }>,
		key: string,
		rec: LlmRequestRecord,
	) => {
		const slot = map[key] ?? { count: 0, input: 0, output: 0 };
		slot.count += 1;
		slot.input += rec.usage?.input ?? 0;
		slot.output += rec.usage?.output ?? 0;
		if (rec.agentName) slot.agentName = rec.agentName;
		map[key] = slot;
	};

	try {
		const path = logPath(conversationId);
		if (!existsSync(path)) return stats;
		for (const line of readFileSync(path, 'utf-8').split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let rec: LlmRequestRecord;
			try {
				rec = JSON.parse(trimmed) as LlmRequestRecord;
			} catch {
				continue;
			}
			stats.total += 1;
			stats.byStatus[rec.status] = (stats.byStatus[rec.status] ?? 0) + 1;
			bump(stats.byPurpose, rec.purpose, rec);
			bump(stats.byModel, rec.model, rec);
			bump(stats.byAgentInstance, rec.agentInstanceId ?? '(none)', rec);
		}
	} catch {
		// 读失败按空处理
	}
	return stats;
}

/** 清空请求日志（含轮转历史文件） */
export function clearRequests(conversationId: string): void {
	const dir = conversationDir(conversationId);
	for (const name of [LOG_NAME, ROTATED_NAME]) {
		try {
			const path = join(dir, name);
			if (existsSync(path)) rmSync(path, { force: true });
		} catch {
			// 忽略
		}
	}
	seqCache.delete(conversationId);
	pendingLines.delete(conversationId);
}

// #endregion
