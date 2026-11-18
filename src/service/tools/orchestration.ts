/** 内置工具 —— 编排（实现即调用 Runner 注入的原语） */

import type { AskUserArgs } from '@shared/agent';
import { registerTool } from './registry';

// #region 内置工具 —— 编排（实现即调用 Runner 注入的原语）

registerTool({
	name: 'delegate',
	access: 'read',
	description:
		'把一个子任务委托给其他 Agent 执行。需要并行委托多个子任务时，请同时发起多个 delegate 调用。',
	parameters: {
		type: 'object',
		properties: {
			agentId: { type: 'string', description: '目标 Agent id（见「你可以委托的 Agent」清单）' },
			task: { type: 'string', description: '自包含的任务说明：背景 / 范围 / 交付 / 约束' },
		},
		required: ['agentId', 'task'],
	},
	async execute(args, ctx) {
		const agentId = String(args.agentId ?? '');
		const task = String(args.task ?? '').trim();
		if (!agentId) return { success: false, content: 'agentId 不能为空' };
		if (!task) return { success: false, content: 'task 不能为空' };
		const allowed = (ctx.def.delegatable ?? []).filter((id) => ctx.mode.agents[id]);
		if (!ctx.mode.agents[agentId]) {
			return { success: false, content: `不存在的 agentId: ${agentId}。可用：${allowed.join(', ') || '(无)'}` };
		}
		if (!allowed.includes(agentId)) {
			return { success: false, content: `当前 Agent 不能委托给 ${agentId}。可用：${allowed.join(', ') || '(无)'}` };
		}
		return ctx.delegate(agentId, task);
	},
});

registerTool({
	name: 'finish',
	access: 'read',
	description:
		'提交本次工作的总结并结束你这一轮。必须调用它来收尾，而不是把结论写在正文里。' +
		'总结会被回填给父 Agent，并写进你自己的消息记录。',
	parameters: {
		type: 'object',
		properties: {
			summary: { type: 'string', description: '总结：做了什么 / 改了哪些文件 / 怎么验证 / 未完成项' },
		},
		required: ['summary'],
	},
	async execute(args, ctx) {
		const summary = String(args.summary ?? '').trim();
		if (!summary) return { success: false, content: 'summary 不能为空' };
		return ctx.finish(summary);
	},
});

registerTool({
	name: 'resume_pending_child',
	access: 'read',
	description:
		'恢复一个被中断 / 挂起的子 Agent，让它接着干。一次调用只恢复一个：' +
		'从直接子实例里挑「最深的、状态为 pending 或 interrupted」的那个。不要对同一个子 Agent 反复调用。',
	parameters: {
		type: 'object',
		properties: {
			agentInstanceId: { type: 'string', description: '目标子实例 ID（见「尚未完成的子 Agent」清单）' },
		},
		required: ['agentInstanceId'],
	},
	async execute(args, ctx) {
		const id = String(args.agentInstanceId ?? '').trim();
		if (!id) return { success: false, content: 'agentInstanceId 不能为空' };
		return ctx.resumePendingChild(id);
	},
});

registerTool({
	name: 'resume_completed_child',
	access: 'read',
	description:
		'重新唤醒一个已经完成的子 Agent：保留它原来的消息历史，追加一条「被重新唤醒」的提示和你的补充任务。',
	parameters: {
		type: 'object',
		properties: {
			agentInstanceId: { type: 'string', description: '目标子实例 ID' },
			followUp: { type: 'string', description: '补充任务：要它接着做什么' },
		},
		required: ['agentInstanceId', 'followUp'],
	},
	async execute(args, ctx) {
		const id = String(args.agentInstanceId ?? '').trim();
		const followUp = String(args.followUp ?? '').trim();
		if (!id || !followUp) return { success: false, content: 'agentInstanceId 与 followUp 都必须填写' };
		return ctx.resumeCompletedChild(id, followUp);
	},
});

registerTool({
	name: 'ask_child',
	access: 'read',
	description:
		'向某个子 Agent 提问。用固定提示词 + 它除首条 system 外的全部记录，做一次**不携带工具的 LLM 请求**。' +
		'不会修改目标实例的消息、状态或 ctx。',
	parameters: {
		type: 'object',
		properties: {
			agentInstanceId: { type: 'string', description: '目标子实例 ID' },
			question: { type: 'string', description: '要问的问题' },
		},
		required: ['agentInstanceId', 'question'],
	},
	async execute(args, ctx) {
		const id = String(args.agentInstanceId ?? '').trim();
		const question = String(args.question ?? '').trim();
		if (!id || !question) return { success: false, content: 'agentInstanceId 与 question 都必须填写' };
		return ctx.askChild(id, question);
	},
});

registerTool({
	name: 'ask_user',
	access: 'read',
	description:
		'向用户提问并获得回答。注意：调用后你会**暂停**（进入等待），用户回答之后才继续。' +
		'高风险操作（删除 / 覆盖 / 批量改名 / 有写效果的 git 操作）必须先问用户。',
	parameters: {
		type: 'object',
		properties: {
			questions: {
				type: 'array',
				description: '0~多个问题；为空时前端只给自由输入',
				items: {
					type: 'object',
					properties: {
						question: { type: 'string', description: '问题文本' },
						selectionMode: {
							type: 'string',
							enum: ['single', 'multi'],
							description: '选择模式：single = 单选（默认），multi = 多选',
						},
						options: {
							type: 'array',
							description: '选项（每个可带描述）；为空时该问题只接受自由输入',
							items: {
								type: 'object',
								properties: {
									label: { type: 'string' },
									description: { type: 'string' },
								},
								required: ['label'],
							},
						},
					},
					required: ['question'],
				},
			},
		},
		required: ['questions'],
	},
	async execute(args, ctx) {
		const rawQuestions = args.questions as unknown[];
		if (!Array.isArray(rawQuestions)) return { success: false, content: 'questions 必须是数组' };
		const questions: AskUserArgs['questions'] = rawQuestions
			.map((q) => {
				if (!q || typeof q !== 'object') return null;
				const question = String((q as Record<string, unknown>).question ?? '').trim();
				if (!question) return null;
				const selectionMode = (q as Record<string, unknown>).selectionMode === 'multi' ? 'multi' as const : 'single' as const;
				const options = Array.isArray((q as Record<string, unknown>).options)
					? ((q as Record<string, unknown>).options as { label: string; description?: string }[]).filter((o) => o?.label)
					: [];
				return { question, selectionMode, options };
			})
			.filter((q): q is NonNullable<typeof q> => q !== null);
		return ctx.askUser({ questions });
	},
});

// #endregion
