/** 内置工具 —— 后台任务 */

import * as background from '../background';
import { registerTool } from './registry';

// #region 内置工具 —— 后台任务

/**
 * 后台任务 = 起一条常驻 shell，**立刻返回任务 id**，之后用 background_output 看输出、
 * background_wait 等它结束、background_stop 收掉。适合 dev server / watch / 长时间跑的服务；
 * 一次性命令仍然用 `shell`（它会等命令跑完并直接把输出给模型）。
 */
registerTool({
	name: 'background_start',
	access: 'exec',	// 起进程 = 能干活，与 shell 同级过安全闸门
	description:
		'在后台启动一条常驻 shell 命令（dev server / watch / 长跑服务）。进程启动成功会返回任务 id，不等它结束。' +
		'适用于 dev server，或者较慢的下载 / 编译场景，启动后先去做别的事，等待结果返回或定时轮询',
	parameters: {
		type: 'object',
		properties: {
			command: { type: 'string', description: '要执行的 shell 命令（Windows 下为 cmd.exe）' },
			description: { type: 'string', description: '这个任务在干什么（会显示在界面的后台任务列表里）' },
		},
		required: ['command'],
	},
	async execute(args, ctx) {
		const res = await background.startTask({
			conversationId: ctx.ctx.conversationId,
			command: String(args.command ?? ''),
			cwd: ctx.runningDir || undefined,
			description: String(args.description ?? ctx.reason ?? ''),
			agentInstanceId: ctx.agentInstanceId,
		});
		if (!res.ok) return { success: false, content: `后台任务启动失败：${res.error}`, error: res.error };
		if (res.endedEarly) {
			// 一次性快活（转码 / 批量脚本）在宽限窗口里就跑完了 —— 别谎称「已在后台运行」
			const ms = res.endedEarly.elapsedMs;
			return {
				success: true,
				content:
					`后台任务 ${res.task.id} 启动后 ${ms}ms 已结束（状态=${res.task.status}，exit ${res.task.exitCode ?? 0}）。以下为输出：` +
					res.endedEarly.output || '(无输出)',
				structured: { taskId: res.task.id, status: res.task.status, exitCode: res.task.exitCode ?? 0, endedEarly: true },
			};
		}
		return {
			success: true,
			content: `后台任务已启动，任务 id = ${res.task.id}（命令：${res.task.command}，pid=${res.task.pid ?? '?'}）`,
			structured: { taskId: res.task.id, pid: res.task.pid },
		};
	},
});

registerTool({
	name: 'background_output',
	access: 'read',
	description:
		'读取某个后台任务的终端输出。',
	parameters: {
		type: 'object',
		properties: {
			taskId: { type: 'string', description: 'background_start 返回的任务 id' },
			full: { type: 'boolean', description: '默认只返回**从上次读取到现在的增量**，true=输出全文' },
		},
		required: ['taskId'],
	},
	async execute(args, ctx) {
		const taskId = String(args.taskId ?? '');
		const res = background.readTask(ctx.ctx.conversationId, taskId, { full: !!args.full });
		if (!res.ok) return { success: false, content: res.error, error: res.error };
		const head = `[${taskId}] 状态=${res.status}${res.exitCode !== undefined && res.exitCode !== null ? ` exit=${res.exitCode}` : ''}${res.truncated ? `（输出过长，只保留尾部）` : ''}`;
		return {
			success: true,
			content: `${head}\n${res.content || '(本次没有新输出)'}`,
			structured: { taskId, status: res.status, exitCode: res.exitCode ?? null },
		};
	},
});

registerTool({
	name: 'background_wait',
	access: 'read',
	description:
		'等待后台任务结束，然后把它这期间的终端输出拿回来 —— 等于把它 fg。' +
		'超时还没结束不算失败：会返回「仍在运行」和这期间的新输出，可以再等一次或先做别的。',
	parameters: {
		type: 'object',
		properties: {
			taskId: { type: 'string', description: 'background_start 返回的任务 id' },
			timeout: { type: 'integer', description: '最多等多少秒，默认 180，最长 600' },
			full: { type: 'boolean', description: 'true = 返回全文，默认只返回上次读取到现在的增量' },
		},
		required: ['taskId'],
	},
	async execute(args, ctx) {
		const taskId = String(args.taskId ?? '');
		const secs = Math.min(600, Math.max(1, Number(args.timeout ?? 180) || 180));
		const res = await background.waitTask(ctx.ctx.conversationId, taskId, {
			timeoutMs: secs * 1000,
			full: !!args.full,
			signal: ctx.signal,
		});
		if (!res.ok) return { success: false, content: res.error, error: res.error };

		const sec = Math.round(res.elapsedMs / 1000);
		const elapsed = sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
		const parts: string[] = [];
		if (res.timedOut) {
			parts.push(
				res.aborted
					? `[${taskId}] 等待被中断（任务仍在运行，已运行 ${elapsed}），以下是这期间的新输出：`
					: `[${taskId}] 等待 ${secs} 秒仍未结束（已运行 ${elapsed}），以下是这期间的新输出：`,
			);
			parts.push(res.content || '(这期间没有新输出)');
			if (!res.aborted) parts.push('可以再调 background_wait 继续等，或先做别的事。');
		} else {
			parts.push(`[${taskId}] 已结束：状态=${res.status}，共运行 ${elapsed}`);
			parts.push(res.content || '(没有新输出)');
			parts.push(`[exit ${res.exitCode ?? 'null'}]`);
		}
		return {
			success: true,
			content: parts.join('\n'),
			structured: { taskId, status: res.status, exitCode: res.exitCode ?? null, timedOut: res.timedOut },
		};
	},
});

registerTool({
	name: 'background_stop',
	access: 'exec',
	description: '停止一个还在跑的后台任务（连它的子进程一起收掉）。',
	parameters: {
		type: 'object',
		properties: {
			taskId: { type: 'string', description: 'background_start 返回的任务 id' },
		},
		required: ['taskId'],
	},
	async execute(args, ctx) {
		const taskId = String(args.taskId ?? '');
		const res = background.stopTask(ctx.ctx.conversationId, taskId);
		if (!res.ok) return { success: false, content: res.error, error: res.error };
		return {
			success: true,
			content: `后台任务 ${taskId} 已停止（状态=${res.task.status}）`,
			structured: { taskId, status: res.task.status },
		};
	},
});

// #endregion
