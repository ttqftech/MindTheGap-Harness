/** 内置工具 —— 待办清单 */

import { FromSchema } from 'json-schema-to-ts';
import { registerTool } from './registry';

// #region 内置工具 —— 待办清单

registerTool({
	name: 'todo_list_read',
	access: 'read',
	description: '读取当前待办清单全文。',
	parameters: { type: 'object', properties: {}, required: [] },
	async execute(_args, ctx) {
		const list = ctx.readTodoList();
		return { success: true, content: list || '(待办清单为空)' };
	},
});

const todoListWriteSchema = {
	type: 'object',
	properties: {
		op:    { type: 'string', enum: ['add', 'update', 'remove', 'replace'] },
		item:  { type: 'string' },
		index: { type: 'integer' },
		done:  { type: 'boolean' },
		list:  { type: 'string' },
	},
	required: ['op'] as const,
} as const;

export type TodoListWriteArgs = FromSchema<typeof todoListWriteSchema>;

registerTool({
	name: 'todo_list_write',
	access: 'read',
	description:
		'修改待办清单。op 可选：add（追加一条）/ update（改第 index 条，可标记 done）/ remove（删除第 index 条）/ replace（整篇替换）。',
	parameters: {
		type: 'object',
		properties: {
			op: { type: 'string', enum: ['add', 'update', 'remove', 'replace'], description: '操作类型' },
			item: { type: 'string', description: 'add / update 的条目文本' },
			index: { type: 'integer', description: 'update / remove 的下标' },
			done: { type: 'boolean', description: 'update 时是否标记完成' },
			list: { type: 'string', description: 'replace 时的清单全文' },
		},
		required: ['op'],
	},
	async execute(args: TodoListWriteArgs, ctx) {
		const result = ctx.writeTodoList({
			op: args.op,
			item: args.item,
			index: args.index,
			done: args.done,
			list: args.list,
		});
		return { success: true, content: `待办清单已更新：\n${result || '(空)'}` };
	},
});

// #endregion
