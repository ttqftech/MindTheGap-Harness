/* ==========================================================================
   后台任务 — MindTheGap-Harness

   `background_start` 拉起的常驻 shell 归这里管：起进程、收输出、停进程。
   与 `shell` 工具的区别只有一条：**工具立刻返回任务 id，不等进程结束**。

   设计要点：
   - 进程本体只活在内存里（Map<conversationId, Map<taskId, BgTask>>），
     元信息由 Runner 同步进 `ctx.backgroundTasks` 随 ctx 落盘 —— 服务重启后进程已经没了，但「曾经有过什么任务」还看得见。
   - 输出是**内存里的定长缓冲**（保留尾部 MAX_OUTPUT 字符），不写文件：
     后台任务的用途是「跑着，偶尔看两眼」，不值当为它维护一套落盘 / 轮转。
   - 读取有游标：`background_output` 默认只给「上次读到现在」的增量，
     `full: true` 才给全文。游标存在任务对象上（一次会话一个读者，够用）。
   ========================================================================== */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { BackgroundTask, BackgroundTaskStatus } from '@shared/agent';
import { logMsg } from '../shared/utils';

/** 每个任务最多保留多少输出字符（超出只留尾部） */
const MAX_OUTPUT = 200_000;

/** 启动判定的宽限窗口：窗口内就退出的，不算「已经跑起来了」 */
const START_GRACE_MS = 1000;

const uid = () => Math.random().toString(36).slice(2, 8);

/** 运行时任务（= 落盘元信息 + 内存字段） */
interface InnerBackgroundTask extends BackgroundTask {
	output: string;			// 已收集的全部输出（尾部 MAX_OUTPUT 字符）
	droppedChars: number;	// 被截断掉的字符数（>0 说明输出头部已经丢了）
	cursor: number;			// 增量读取游标（output 内的下标）
	stopRequested: boolean;	// 是我们主动杀的（用来区分 stopped 与 failed）
	done: Promise<void>;	// 结束信号本身：`background_wait` 对它 await（与 resolveDone 配套）
	resolveDone: () => void;// 结束信号：进程真的退出（或启动失败 / 被停止）时 resolve —— `background_wait` 就等它
	acknowledged: boolean;	// 模型用 background_wait 亲自等过它的结束 → 不再重复发「已结束」通知
	/** 上一段输出走的是哪个通道（用来在混排日志里插 `[stderr]` / `[stdout]` 分界） */
	lastChannel?: 'stdout' | 'stderr';
	child?: ChildProcess;
}

/** conversationId → <taskId → 任务> */
const registry = new Map<string, Map<string, InnerBackgroundTask>>();

function bucket(conversationId: string): Map<string, InnerBackgroundTask> {
	let map = registry.get(conversationId);
	if (!map) {
		map = new Map();
		registry.set(conversationId, map);
	}
	return map;
}

/** 剥离 Inner 信息，取元信息副本（不外泄内存字段，避免被 ctx 代理拿走后跟着落盘） */
function meta(task: InnerBackgroundTask): BackgroundTask {
	return {
		id: task.id,
		command: task.command,
		description: task.description,
		status: task.status,
		pid: task.pid,
		startedAt: task.startedAt,
		endedAt: task.endedAt,
		exitCode: task.exitCode,
		agentInstanceId: task.agentInstanceId,
	};
}

/** 纯追加 + 尾部截断（不做通道标记；我们自己的 `[已由用户停止]` 之类也走这里） */
function appendOutput(task: InnerBackgroundTask, chunk: string): void {
	task.output += chunk;
	if (task.output.length > MAX_OUTPUT) {
		const cut = task.output.length - MAX_OUTPUT;
		task.output = task.output.slice(cut);
		task.droppedChars += cut;
		task.cursor = Math.max(0, task.cursor - cut);
	}
}

/**
 * 追加一段子进程输出，并在**通道切换处**插一行 `[stderr]` / `[stdout]` 分界。
 *
 * 为什么不像 `shell` 那样把两者分成两段拼接：后台是流式的，stderr 与 stdout 的**时序**
 * 本身就是信息（报错紧跟在哪一行之后），分段会把它抹掉。所以保留混排，只标边界。
 *
 * 为什么只标 stderr：正常日志里九成是 stdout，给它也标一遍纯属噪声；
 * 但 stderr 段结束后必须标回 `[stdout]`，否则后面正常的日志会被误读成错误。
 */
function appendStream(task: InnerBackgroundTask, chunk: string, channel: 'stdout' | 'stderr'): void {
	if (!chunk) return;
	if (channel !== task.lastChannel) {
		// 首段是 stdout 时不标（常见情况，标了全是噪声）
		if (channel === 'stderr' || task.lastChannel === 'stderr') {
			// 标记必须落在行首：上一段没以换行收尾就补一个，别让标记粘在半行后面
			const needNl = task.output.length > 0 && !task.output.endsWith('\n');
			appendOutput(task, `${needNl ? '\n' : ''}[${channel}]\n`);
		}
		task.lastChannel = channel;
	}
	appendOutput(task, chunk);
}

// #region 启动

export interface StartOptions {
	conversationId: string;
	command: string;
	cwd?: string;
	description?: string;
	agentInstanceId?: string;
}

export type StartResult =
	| {
		ok: true;
		task: BackgroundTask;
		/** 宽限窗口内就正常结束了（exit 0）：不是常驻任务，输出已经一并取走 */
		endedEarly?: { elapsedMs: number; output: string };
	}
	| { ok: false; error: string };

/**
 * 启动一个后台任务。
 *
 * ⚠️ 用 `shell: true` 起（与 `shell` 工具一致）：
 * 命令是模型写的一整行，管道 / 重定向 / `&&` 都得由 shell 解释。
 * 代价是「命令不存在」不会抛 ENOENT，而是 cmd.exe / sh 自己报一句然后退出 —— 所以下面要看**启动后极短时间里有没有立刻退出**。
 *
 * 判定方式见函数末尾：等 `START_GRACE_MS` 看它是否还活着（**不是**等 spawn 事件 —— 那个必然先到）。
 */
export async function startTask(opts: StartOptions): Promise<StartResult> {
	const command = opts.command.trim();
	if (!command) return { ok: false, error: '命令为空' };

	const id = `bg_${uid()}`;
	let resolveDone!: () => void;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const task: InnerBackgroundTask = {
		id,
		command,
		description: (opts.description ?? '').trim(),
		status: 'running',
		startedAt: Date.now(),
		agentInstanceId: opts.agentInstanceId,
		output: '',
		droppedChars: 0,
		cursor: 0,
		stopRequested: false,
		done,
		resolveDone,
		acknowledged: false,
	};

	let child: ChildProcess;
	try {
		// unix 下 detached 起一个独立进程组，停的时候能连子孙一起收掉（Windows 走 taskkill /T）
		child = spawn(command, {
			cwd: opts.cwd,
			shell: true,
			windowsHide: true,
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (err) {
		return { ok: false, error: `进程启动失败：${(err as Error).message}` };
	}

	task.child = child;
	task.pid = child.pid;
	bucket(opts.conversationId).set(id, task);

	child.stdout?.on('data', (chunk: Buffer | string) => appendStream(task, chunk.toString(), 'stdout'));
	child.stderr?.on('data', (chunk: Buffer | string) => appendStream(task, chunk.toString(), 'stderr'));

	child.once('error', (err) => {
		task.status = 'failed';
		task.endedAt = Date.now();
		task.exitCode = null;
		appendOutput(task, `\n[启动失败] ${err.message}\n`);
		logMsg.error(`[Background] 任务 ${id} 启动失败: ${err.message}`);
		task.resolveDone();
	});
	child.once('close', (code, signal) => {
		task.endedAt = Date.now();
		task.exitCode = code;
		if (task.status !== 'failed') {
			task.status = task.stopRequested
				? 'stopped'
				: code === 0 ? 'completed' : 'failed';
		}
		if (signal) appendOutput(task, `\n[signal ${signal}]\n`);
		logMsg(`[Background] 任务 ${id} 结束（${task.status}，code=${code ?? 'null'}）`);
		task.resolveDone();
	});

	// ⚠️ 判「起来没起来」只能靠**它 600ms 后还活着吗**，不能等 `spawn` 事件：
	//    shell:true 下 cmd.exe / sh 几乎是立刻 spawn 成功的，命令本身写错也照样 spawn
	await Promise.race([done, new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, START_GRACE_MS);
		(timer as unknown as { unref?: () => void }).unref?.();
	})]);

	if (task.status !== 'running') {
		// 窗口期内就结束了：这不是一个「常驻任务」，别骗模型说它在后台跑着。
		// 但也不能一律当失败 —— 「跑一下就完事」的活（转码 / 一次性脚本）本来就该 exit 0 正常收尾。
		if (task.exitCode !== 0) {
			// 非零退出 = 命令大概率写错了（找不到 / 语法错），别给模型留一个假的「已启动」
			bucket(opts.conversationId).delete(id);
			const tail = task.output.trim().slice(-1024);
			return {
				ok: false,
				error: `进程启动后立即退出（${task.endedAt! - task.startedAt}ms，exit ${task.exitCode ?? 'null'}）${tail ? `：\n${tail}` : ''}`,
			};
		}
		// exit 0 的快速任务：记录留着（界面上看得到），把输出连同「已经结束了」一起回报
		const read = readTask(opts.conversationId, id, { full: true });
		return {
			ok: true,
			task: meta(task),
			endedEarly: {
				elapsedMs: (task.endedAt ?? Date.now()) - task.startedAt,
				output: read.ok ? read.content : '',
			},
		};
	}

	return { ok: true, task: meta(task) };
}

// #endregion

// #region 查询 / 读取

export function listTasks(conversationId: string): BackgroundTask[] {
	return Array.from(bucket(conversationId).values()).map(meta);
}

export function getTask(conversationId: string, taskId: string): BackgroundTask | undefined {
	const t = bucket(conversationId).get(taskId);
	return t ? meta(t) : undefined;
}

export type ReadResult =
	| { ok: true; content: string; status: BackgroundTaskStatus; exitCode?: number | null; truncated: boolean; totalChars: number }
	| { ok: false; error: string };

/**
 * 读任务输出。
 * - 默认：从上次读到的位置到现在的增量（读完推进游标）
 * - `full: true`：整段（同样受 MAX_OUTPUT 限制，超出会说明头部已丢弃）
 */
export function readTask(conversationId: string, taskId: string, opts: { full?: boolean } = {}): ReadResult {
	const task = bucket(conversationId).get(taskId);
	if (!task) return { ok: false, error: `找不到后台任务 ${taskId}` };

	let content: string;
	let truncated = false;
	if (opts.full) {
		content = task.output;
		truncated = task.droppedChars > 0;
		if (truncated) content = `[已丢弃前 ${task.droppedChars} 个字符]\n${content}`;
		task.cursor = task.output.length;
	} else {
		content = task.output.slice(task.cursor);
		task.cursor = task.output.length;
	}

	return {
		ok: true,
		content,
		status: task.status,
		exitCode: task.exitCode,
		truncated,
		totalChars: task.output.length + task.droppedChars,
	};
}

// #endregion

// #region 等待结束

export interface WaitOptions {
	/** 最长等多久（毫秒） */
	timeoutMs?: number;
	/** true = 返回全文；默认返回「上次读取到现在」的增量 */
	full?: boolean;
	/** 本次 run 的中断信号：用户点了停止就别再干等了 */
	signal?: AbortSignal;
}

export type WaitResult =
	| {
		ok: true;
		content: string;
		status: BackgroundTaskStatus;
		exitCode?: number | null;
		/** 等到超时它还在跑 */
		timedOut: boolean;
		/** 本次 run 被中断，提前返回（任务本身还在跑） */
		aborted: boolean;
		/** 从启动到现在过了多久 */
		elapsedMs: number;
		truncated: boolean;
	}
	| { ok: false; error: string };

/**
 * 等一个后台任务结束 —— 相当于把它临时变回普通 `shell`：等到退出，顺带把输出取走。
 *
 * 超时不算错误：返回 `timedOut: true` + 这期间新产生的输出，模型可以选择再等一次、
 * 或者先干别的。等待期间**不占 CPU**（就是 await 进程的 close 信号）。
 */
export async function waitTask(
	conversationId: string,
	taskId: string,
	opts: WaitOptions = {},
): Promise<WaitResult> {
	const task = bucket(conversationId).get(taskId);
	if (!task) return { ok: false, error: `找不到后台任务 ${taskId}（可能启动失败，或会话已被清理）` };

	let timedOut = false;
	let aborted = false;
	if (task.status === 'running') {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const gates: Promise<void>[] = [
			task.done,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, Math.max(1000, opts.timeoutMs ?? 180_000));
				// 不让这个定时器把 Service 拖着不退出
				(timer as unknown as { unref?: () => void }).unref?.();
			}),
		];

		// 用户中途点停止：别再干等下去（不然「停止」要等到 timeout 才生效）
		let abortHandler: (() => void) | undefined;
		if (opts.signal) {
			if (opts.signal.aborted) gates.push(Promise.resolve());
			else {
				let resolveAbort!: () => void;
				gates.push(new Promise<void>((resolve) => {
					resolveAbort = resolve;
				}));
				const handler = () => resolveAbort();
				abortHandler = handler;
				opts.signal.addEventListener('abort', handler, { once: true });
			}
		}

		await Promise.race(gates);
		if (timer) clearTimeout(timer);
		if (abortHandler && opts.signal) opts.signal.removeEventListener('abort', abortHandler);
		timedOut = task.status === 'running';
		aborted = timedOut && !!opts.signal?.aborted;
	}

	// 模型已经亲自看到它结束了 → 下一轮不必再发「这个任务已结束」的提示
	if (!timedOut) task.acknowledged = true;

	const read = readTask(conversationId, taskId, { full: opts.full });
	if (!read.ok) return { ok: false, error: read.error };

	return {
		ok: true,
		content: read.content,
		status: read.status,
		exitCode: read.exitCode,
		timedOut,
		aborted,
		elapsedMs: (task.endedAt ?? Date.now()) - task.startedAt,
		truncated: read.truncated,
	};
}

/** 这个任务的「结束」是否已经被模型用 background_wait 亲眼看到了（Runner 用它去重通知） */
export function wasAcknowledged(conversationId: string, taskId: string): boolean {
	return bucket(conversationId).get(taskId)?.acknowledged === true;
}

// #endregion

// #region 停止

export type StopResult = { ok: true; task: BackgroundTask } | { ok: false; error: string };

/** 停掉一个后台任务（连子孙进程一起）。已经结束的返回当前状态，不报错。 */
export function stopTask(conversationId: string, taskId: string): StopResult {
	const task = bucket(conversationId).get(taskId);
	if (!task) return { ok: false, error: `找不到后台任务 ${taskId}` };
	if (task.status !== 'running') return { ok: true, task: meta(task) };

	task.stopRequested = true;
	const pid = task.pid;
	try {
		if (process.platform === 'win32' && pid) {
			// Windows 上 child.kill() 只杀 cmd.exe 自己，node/python 那些孙子会活下来
			spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
		} else if (pid && process.platform !== 'win32') {
			try {
				process.kill(-pid, 'SIGTERM');	// detached 起的进程组
			} catch {
				task.child?.kill('SIGTERM');
			}
		} else {
			task.child?.kill();
		}
	} catch (err) {
		logMsg.error(`[Background] 停止任务 ${taskId} 失败: ${(err as Error).message}`);
	}

	task.status = 'stopped';
	task.endedAt = Date.now();
	appendOutput(task, '\n[已由用户停止]\n');
	// 进程可能还要一小会儿才真的退出（SIGTERM / taskkill 是异步的），
	// 但状态已经定了，等着的人不必再干等。
	task.resolveDone();
	return { ok: true, task: meta(task) };
}

/** 退场时调用：把所有还活着的后台任务收掉（进程不能留下来变孤儿） */
export function stopAll(): void {
	for (const [conversationId, tasks] of registry) {
		for (const task of tasks.values()) {
			if (task.status === 'running') stopTask(conversationId, task.id);
		}
	}
}

/** 会话被删除时清掉它的任务记录 */
export function forgetConversation(conversationId: string): void {
	const tasks = registry.get(conversationId);
	if (!tasks) return;
	for (const task of tasks.values()) if (task.status === 'running') stopTask(conversationId, task.id);
	registry.delete(conversationId);
}

// #endregion