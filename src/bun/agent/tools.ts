/* ==========================================================================
   工具系统 — MindTheGap-Harness Agent
   
   注意：主进程运行时是 Cottontail（JSC），不是 Bun。
   所以必须用 node:* 系列 API，不能用 Bun.xxx。
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentCtx, AgentName, ToolResult } from '../../shared/agent';
import type { LlmTool } from './model';

/** 工具执行上下文 */
export interface ToolContext {
	ctx: AgentCtx;
	workId: string;
	runningDir: string;
	spawnAgent: (targetAgentName: AgentName, task: string) => Promise<string>;
}

/** 工具定义 */
export interface AgentTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/* ---------- 工具注册表 ---------- */

const toolRegistry = new Map<string, AgentTool>();

/**
 * 动态工具源（当前只有 MCP）。
 * 静态注册表放内置工具，动态源放运行时连上才有的工具，
 * 两者在 getAllTools() 里合并，断开时按 sourceId 整体注销。
 */
const dynamicToolSources = new Map<string, AgentTool[]>();

export function registerTool(tool: AgentTool): void {
	toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): AgentTool | undefined {
	return toolRegistry.get(name) ?? allDynamicTools().find((t) => t.name === name);
}

function allDynamicTools(): AgentTool[] {
	const out: AgentTool[] = [];
	for (const list of dynamicToolSources.values()) out.push(...list);
	return out;
}

export function getAllTools(): AgentTool[] {
	return [...toolRegistry.values(), ...allDynamicTools()];
}

/** 注册/替换某个来源的全部动态工具（如 MCP 服务器连上后） */
export function setDynamicTools(sourceId: string, tools: AgentTool[]): void {
	dynamicToolSources.set(sourceId, tools);
}

/** 注销某个来源的全部动态工具（如 MCP 服务器断开时） */
export function clearDynamicTools(sourceId: string): void {
	dynamicToolSources.delete(sourceId);
}

/** 导出给 LLM 的工具定义列表 */
export function getLlmTools(): LlmTool[] {
	return getAllTools().map((t) => ({
		type: 'function' as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

/** 执行工具 */
export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const tool = getTool(name);
	if (!tool) {
		return {
			success: false,
			content: `Tool "${name}" not found`,
			error: 'UNKNOWN_TOOL',
		};
	}

	try {
		return await tool.execute(args, ctx);
	} catch (err) {
		return {
			success: false,
			content: `Tool "${name}" error: ${(err as Error).message}`,
			error: (err as Error).message,
		};
	}
}

/* ---------- 路径安全 ---------- */

function resolvePath(inputPath: string, runningDir: string): string {
	// 相对路径 → 基于 runningDir
	const base = isAbsolute(inputPath) ? inputPath : join(runningDir, inputPath);
	const normalized = resolve(base);
	// const allowed = resolve(runningDir);

	// // 沙箱已禁用：安全检查（防止路径穿越）
	// if (!normalized.startsWith(allowed)) {
	// 	throw new Error(`Path "${inputPath}" is outside the allowed directory "${runningDir}"`);
	// }
	return normalized;
}

/* ---------- 内置工具 ---------- */

// --- 文件操作 ---

registerTool({
	name: 'file_read',
	description: '读取指定文件的完整内容。如果文件太大，请使用 file_read 的 offset/limit 参数分段读取。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			offset: { type: 'integer', description: '起始行号（从 1 开始）' },
			limit: { type: 'integer', description: '读取的行数' },
		},
		required: ['path'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const content = readFileSync(path, 'utf-8');
			const lines = content.split('\n');
			const offset = ((args.offset as number) ?? 1) - 1;
			const limit = args.limit as number | undefined;
			const selected = limit ? lines.slice(offset, offset + limit) : lines.slice(offset);
			const result = selected.join('\n');

			return {
				success: true,
				content: result,
				structured: { totalLines: lines.length, readLines: selected.length },
			};
		} catch (err) {
			return { success: false, content: `Failed to read file: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_write',
	description: '将内容写入指定文件（覆盖）。如果文件不存在会自动创建。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			content: { type: 'string', description: '要写入的完整内容' },
		},
		required: ['path', 'content'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			// 确保父目录存在
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(path, args.content as string, 'utf-8');
			return { success: true, content: `File written: ${path}` };
		} catch (err) {
			return { success: false, content: `Failed to write file: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_edit',
	description: '编辑文件的指定行范围（startLine 到 endLine，含两端），替换为 newContent。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			startLine: { type: 'integer', description: '起始行号（从 1 开始）' },
			endLine: { type: 'integer', description: '结束行号（含）' },
			newContent: { type: 'string', description: '替换后的新内容（可能是多行）' },
		},
		required: ['path', 'startLine', 'endLine', 'newContent'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const content = readFileSync(path, 'utf-8');
			const lines = content.split('\n');
			const start = ((args.startLine as number) ?? 1) - 1;
			const end = args.endLine as number;

			if (start < 0 || end > lines.length || start >= end) {
				return {
					success: false,
					content: `Invalid line range: ${start + 1}-${end}. File has ${lines.length} lines.`,
				};
			}

			const newLines = (args.newContent as string).split('\n');
			const result = [...lines.slice(0, start), ...newLines, ...lines.slice(end)].join('\n');
			writeFileSync(path, result, 'utf-8');

			return {
				success: true,
				content: `Edited lines ${start + 1}-${end} in ${path}. Old: ${end - start} lines, New: ${newLines.length} lines.`,
			};
		} catch (err) {
			return { success: false, content: `Failed to edit file: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_list',
	description: '列出指定目录下的文件和子目录。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '目录路径，默认为运行目录' },
			recursive: { type: 'boolean', description: '是否递归列出' },
		},
		required: [],
	},
	async execute(args, ctx) {
		const targetPath = args.path
			? resolvePath(args.path as string, ctx.runningDir)
			: ctx.runningDir;
		try {
			const recursive = args.recursive as boolean ?? false;
			const maxDepth = recursive ? 3 : 1;

			// Windows 上没有 ls/find，用 node:fs 遍历（跨平台）
			const lines: string[] = [];
			const walk = (dir: string, depth: number) => {
				const entries = readdirSync(dir, { withFileTypes: true });
				for (const e of entries) {
					if (e.name === 'node_modules' || e.name === '.git') continue;
					const full = join(dir, e.name);
					lines.push(e.isDirectory() ? `${full}/` : full);
					if (e.isDirectory() && depth < maxDepth) walk(full, depth + 1);
				}
			};
			walk(targetPath, 1);

			return {
				success: true,
				content: lines.join('\n') || '(empty directory)',
				structured: { path: targetPath, recursive },
			};
		} catch (err) {
			return { success: false, content: `Failed to list directory: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_create',
	description: '创建一个新文件（可以是空文件或带初始内容）。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '文件路径' },
			content: { type: 'string', description: '初始内容（可选）' },
		},
		required: ['path'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(path, (args.content as string) ?? '', 'utf-8');
			return { success: true, content: `Created file: ${path}` };
		} catch (err) {
			return { success: false, content: `Failed to create file: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_delete',
	description: '删除指定文件。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '文件路径' },
		},
		required: ['path'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			// Windows 上没有 rm，用 node:fs（跨平台）
			unlinkSync(path);
			return { success: true, content: `Deleted file: ${path}` };
		} catch (err) {
			return { success: false, content: `Failed to delete file: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_rename',
	description: '重命名或移动文件。',
	parameters: {
		type: 'object',
		properties: {
			from: { type: 'string', description: '源路径' },
			to: { type: 'string', description: '目标路径' },
		},
		required: ['from', 'to'],
	},
	async execute(args, ctx) {
		const from = resolvePath(args.from as string, ctx.runningDir);
		const to = resolvePath(args.to as string, ctx.runningDir);
		try {
			// Windows 上没有 mv，用 node:fs（跨平台）
			renameSync(from, to);
			return { success: true, content: `Renamed: ${from} → ${to}` };
		} catch (err) {
			return { success: false, content: `Failed to rename: ${(err as Error).message}` };
		}
	},
});

// --- Bash ---

registerTool({
	name: 'bash',
	description: '在运行目录中执行 shell 命令。注意：当前运行环境是 Windows（shell 为 cmd.exe），请使用 Windows 兼容命令（如 dir、type、echo），不要用 Unix 专属命令（如 ls、date +%Y、grep -r）。',
	parameters: {
		type: 'object',
		properties: {
			command: { type: 'string', description: '要执行的 shell 命令' },
			timeout: { type: 'integer', description: '超时时间（毫秒），默认 10000' },
		},
		required: ['command'],
	},
	async execute(args, ctx) {
		const cmd = args.command as string;
		const timeout = (args.timeout as number) ?? 10000;

		try {
			const output = execSync(cmd, {
				// 沙箱已禁用：cwd: ctx.runningDir,
				encoding: 'utf-8',
				timeout,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			return {
				success: true,
				content: output || '(no output)',
			};
		} catch (err: any) {
			return {
				success: false,
				content: `Command failed (exit ${err.status}):\n${err.stderr ?? err.message}`,
				error: err.message,
			};
		}
	},
});

// --- Agent 编排 ---

registerTool({
	name: 'transfer',
	description:
		'将当前任务的一部分转接给另一个 Agent 模式。' +
		'子 Agent 会独立工作并返回详细结果。' +
		'可一次调用多个 transfer 来并行执行子任务。' +
		'可用模式: 默认, 编码, 文件夹浏览总结。',
	parameters: {
		type: 'object',
		properties: {
			agentName: {
				type: 'string',
				description: '目标 Agent 名称。必须是当前 Agent 的可转接列表中的一个。',
				enum: ['默认', '编码', '文件夹浏览总结'],
			},
			task: {
				type: 'string',
				description: '给子 Agent 的详细任务描述。应包含足够上下文让子 Agent 独立工作。',
			},
		},
		required: ['agentName', 'task'],
	},
	async execute(args, ctx) {
		const agentName = args.agentName as AgentName;
		const task = args.task as string;

		const currentWork = ctx.ctx.works[ctx.workId];
		if (!currentWork) {
			return { success: false, content: 'Current work not found in context' };
		}
		if (!currentWork.transferableAgents.includes(agentName)) {
			return {
				success: false,
				content: `Agent "${agentName}" is not transferable from "${currentWork.agentName}". Available: ${currentWork.transferableAgents.join(', ')}`,
			};
		}

		const childWorkId = await ctx.spawnAgent(agentName, task);

		return {
			success: true,
			content: `Transferred to "${agentName}" (workId: ${childWorkId}). Task: ${task.slice(0, 200)}${task.length > 200 ? '...' : ''}`,
			structured: { childWorkId, targetAgentName: agentName },
		};
	},
});

registerTool({
	name: 'think',
	description: '进行内部推理和思考。不会对用户可见，用于复杂问题的分步分析。',
	parameters: {
		type: 'object',
		properties: {
			content: { type: 'string', description: '你的思考内容' },
		},
		required: ['content'],
	},
	async execute(args) {
		return {
			success: true,
			content: '(思考完成)',
			structured: { thought: args.content },
		};
	},
});
