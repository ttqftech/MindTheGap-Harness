/* ==========================================================================
   工具系统 — MindTheGap-Harness

   注意：主进程运行时是 Cottontail（JSC），不是 Bun。
   所以必须用 node:* 系列 API，不能用 Bun.xxx。

   本文件只负责「工具是什么、怎么执行」，不负责「谁来编排」：
   - 编排类工具（delegate / finish / resume_* / ask_child / ask_user / task_list_*）
     的实现就是调用 Runner 注入的编排原语，自己不碰 ctx 的状态机。
   - `reason` 由工具层统一注入 JSON Schema 的 required，执行前再从 args 里剥离。

   能力过滤：AgentDefinition.ability.tools 白名单 + ability.mcp 策略
   （见 getToolsForAgentInstance）。
   ========================================================================== */

import {
	existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync,
	readdirSync, statSync, rmSync,
} from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type {
	AgentCtx, AgentDefinition, AgentInstance, AskUserArgs, LlmTool, ModeConfigDefaults,
	ModeDefinition, ToolResult,
} from '../../shared/agent';

// #region 类型

/** 任务清单操作（见设计 §10） */
export interface TaskListOp {
	op: 'add' | 'update' | 'remove' | 'replace';
	/** add / update 的条目文本（形如 "实现 delegate 工具"） */
	item?: string;
	/** update / remove 的下标（从 0 开始，对应清单里第 n 条） */
	index?: number;
	/** update 时是否标记完成 */
	done?: boolean;
	/** replace 时的全文 */
	list?: string;
}

/**
 * 工具执行上下文（即设计稿里的「大 Context」）。
 * 编排原语由 Runner 注入，工具不直接改 ctx。
 */
export interface ToolContext {
	ctx: AgentCtx;
	agentInstanceId: string;
	runningDir: string;
	/** 会话目录（workspace / docs / backups 的根） */
	conversationDir: string;
	/** 本次调用的理由（已从 args 剥离） */
	reason: string;
	def: AgentDefinition;
	mode: ModeDefinition;
	// ---- 编排原语 ----
	delegate: (tasks: { agentId: string; task: string }[]) => Promise<ToolResult>;
	finish: (summary: string) => Promise<ToolResult>;
	resumePendingChild: (agentInstanceId: string) => Promise<ToolResult>;
	resumeCompletedChild: (agentInstanceId: string, followUp: string) => Promise<ToolResult>;
	askChild: (agentInstanceId: string, question: string) => Promise<ToolResult>;
	askUser: (q: AskUserArgs) => Promise<ToolResult>;
	readTaskList: () => string;
	writeTaskList: (op: TaskListOp) => string;
}

/** 工具定义 */
export interface AgentTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
	/** 'server' = 后端直接执行；'client' = 需要客户端（前端/用户）响应后才算完成 */
	origin?: 'server' | 'client';
}

/** 审批钩子（预留，本版恒 allow） */
export interface ToolCallInfo {
	callId: string;
	agentInstanceId: string;
	toolName: string;
	args: Record<string, unknown>;
	reason: string;
}
export type ToolGate = (call: ToolCallInfo) => Promise<'allow' | 'deny' | 'ask-user'>;

// #endregion

// #region 工具注册表

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

/** 内置（静态注册表）工具名，用于插件加载时的校验 */
export function getBuiltinToolNames(): string[] {
	return Array.from(toolRegistry.keys());
}

/** 注册/替换某个来源的全部动态工具（如 MCP 服务器连上后） */
export function setDynamicTools(sourceId: string, tools: AgentTool[]): void {
	dynamicToolSources.set(sourceId, tools);
}

/** 注销某个来源的全部动态工具（如 MCP 服务器断开时） */
export function clearDynamicTools(sourceId: string): void {
	dynamicToolSources.delete(sourceId);
}

// #endregion

// #region 能力过滤

/** 某个 Agent 实际可见的 MCP 工具 */
function mcpToolsFor(policy: 'none' | 'all' | string[]): AgentTool[] {
	if (policy === 'none') return [];
	const out: AgentTool[] = [];
	for (const [sourceId, list] of dynamicToolSources) {
		if (!sourceId.startsWith('mcp:')) continue;
		const serverId = sourceId.slice('mcp:'.length);
		if (policy === 'all' || policy.includes(serverId)) out.push(...list);
	}
	return out;
}

/**
 * MCP 策略解析优先级：
 * agent.ability.mcp（最具体）> modeConfig.includeMcp（明示 true/false）> mode.mcp > none
 */
export function resolveMcpPolicy(
	def: AgentDefinition,
	mode: ModeDefinition,
	modeConfig: ModeConfigDefaults,
): 'none' | 'all' | string[] {
	if (def.ability.mcp) return def.ability.mcp;
	if (modeConfig.includeMcp === true) return 'all';
	if (modeConfig.includeMcp === false) return 'none';
	return mode.mcp ?? 'none';
}

/** 该模式在「空」模式下是否把 MCP 放进提示词（与工具表保持一致） */
export function modeIncludesMcp(modeConfig: ModeConfigDefaults): boolean {
	return modeConfig.includeMcp === true;
}

/**
 * 某个实例可见的工具集合。
 * - 不写 allow = 全部内置（减去 deny）；写了 = 只保留 allow 内且不在 deny 内的
 * - 编排类工具（delegate）在达到 maxDepth 时被移除
 * - MCP 工具按策略过滤
 */
export function getToolsForAgentInstance(
	agentInstance: AgentInstance,
	def: AgentDefinition,
	mode: ModeDefinition,
	modeConfig: ModeConfigDefaults,
): AgentTool[] {
	const allow = def.ability.tools?.allow;
	const deny = new Set(def.ability.tools?.deny ?? []);
	const depthExhausted = agentInstance.depth >= mode.maxDepth;

	const builtin = Array.from(toolRegistry.values()).filter((t) => {
		if (allow && !allow.includes(t.name)) return false;
		if (deny.has(t.name)) return false;
		if (depthExhausted && t.name === 'delegate') return false;
		// 模式没开任务清单 → 不展示对应工具
		if (t.name.startsWith('task_list_') && !mode.taskList?.enabled) return false;
		if (t.name === 'task_list_write' && !mode.taskList?.writable) return false;
		return true;
	});

	const mcpPolicy = resolveMcpPolicy(def, mode, modeConfig);
	return [...builtin, ...mcpToolsFor(mcpPolicy)];
}

// #endregion

// #region LLM 工具定义（reason 注入）

/**
 * 把 reason 注入参数表：
 * 它不是某个工具自己声明的，而是所有工具的共同要求。
 * 写进 `required` 之后，reason 与 file_path / command 处于同一等级——
 * 模型不填 = 参数非法，各家 tool-calling 实现都会按必填字段生成。
 */
export function withReasonParam(tool: AgentTool): LlmTool {
	const params = JSON.parse(JSON.stringify(tool.parameters ?? { type: 'object', properties: {} })) as {
		type?: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
	params.properties = {
		reason: { type: 'string', description: '你调用这个工具要做什么（必填，会展示在界面上）' },
		...(params.properties ?? {}),
	};
	params.required = ['reason', ...(params.required ?? []).filter((r) => r !== 'reason')];
	return {
		type: 'function',
		function: { name: tool.name, description: tool.description, parameters: params as Record<string, unknown> },
	};
}

/** 该实例的工具 → 发给 LLM 的工具表（requireReason === false 时不注入） */
export function toLlmTools(tools: AgentTool[], requireReason = true): LlmTool[] {
	return tools.map((t) => (requireReason ? withReasonParam(t) : {
		type: 'function' as const,
		function: { name: t.name, description: t.description, parameters: t.parameters },
	}));
}

// #endregion

// #region 执行

/** 剥离 reason 后执行工具 */
export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ToolContext,
): Promise<ToolResult> {
	const tool = getTool(name);
	if (!tool) {
		return { success: false, content: `Tool "${name}" not found`, error: 'UNKNOWN_TOOL' };
	}

	const { reason: _reason, ...rest } = args ?? {};
	try {
		return await tool.execute(rest, ctx);
	} catch (err) {
		return {
			success: false,
			content: `Tool "${name}" error: ${(err as Error).message}`,
			error: (err as Error).message,
		};
	}
}

// #endregion

// #region 路径安全

function resolvePath(inputPath: string, runningDir: string): string {
	// 相对路径 → 基于 runningDir
	const base = isAbsolute(inputPath) ? inputPath : join(runningDir, inputPath);
	// 沙箱已禁用：不做穿越检查（Harness 无沙箱 / 无权限 / 无还原机制，风险靠提示词约束）
	return resolve(base);
}

const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.hutch', 'artifacts', '.cottontail-tmp', '.workbuddy']);
const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const SEARCH_MAX_RESULTS = 50;

// #endregion

// #region 内置工具 —— 文件操作

// --- 只读 ---

registerTool({
	name: 'file_read',
	description: '读取指定文件的完整内容。如果文件太大，请使用 offset/limit 参数分段读取。',
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
			const recursive = (args.recursive as boolean) ?? false;
			const maxDepth = recursive ? 3 : 1;

			// Windows 上没有 ls/find，用 node:fs 遍历（跨平台）
			const lines: string[] = [];
			const walk = (dir: string, depth: number) => {
				const entries = readdirSync(dir, { withFileTypes: true });
				for (const e of entries) {
					if (SEARCH_SKIP_DIRS.has(e.name)) continue;
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
	name: 'file_search',
	description:
		'按关键词或正则搜索文件内容（不依赖 ripgrep，纯 node:fs 遍历）。' +
		'自动跳过 node_modules/.git/dist/build 等目录，单文件上限 1MB，最多返回 50 条。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '关键词，或 isRegex=true 时的正则表达式' },
			path: { type: 'string', description: '搜索根目录，默认为运行目录' },
			isRegex: { type: 'boolean', description: '是否把 query 当作正则' },
			ext: { type: 'string', description: '只看这些扩展名，逗号分隔，如 ".ts,.tsx"' },
			caseSensitive: { type: 'boolean', description: '是否区分大小写（默认 false）' },
		},
		required: ['query'],
	},
	async execute(args, ctx) {
		const root = args.path ? resolvePath(args.path as string, ctx.runningDir) : ctx.runningDir;
		const query = String(args.query ?? '');
		if (!query) return { success: false, content: 'query 不能为空' };

		const caseSensitive = args.caseSensitive === true;
		const exts = String(args.ext ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);

		let pattern: RegExp;
		try {
			pattern = args.isRegex
				? new RegExp(query, caseSensitive ? 'g' : 'gi')
				: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
		} catch (e) {
			return { success: false, content: `正则无效: ${(e as Error).message}` };
		}

		const hits: string[] = [];
		let truncated = false;

		const walk = (dir: string, depth: number) => {
			if (truncated || depth > 12) return;
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (truncated) return;
				if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full, depth + 1);
					continue;
				}
				if (!entry.isFile()) continue;
				if (exts.length > 0 && !exts.includes(extname(entry.name).toLowerCase())) continue;
				try {
					if (statSync(full).size > SEARCH_MAX_FILE_BYTES) continue;
					const text = readFileSync(full, 'utf-8');
					const lines = text.split('\n');
					for (let i = 0; i < lines.length; i++) {
						pattern.lastIndex = 0;
						if (!pattern.test(lines[i])) continue;
						hits.push(`${relative(root, full) || full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
						if (hits.length >= SEARCH_MAX_RESULTS) {
							truncated = true;
							return;
						}
					}
				} catch {
					// 二进制 / 无权限 / 编码问题：跳过
				}
			}
		};

		walk(root, 1);
		return {
			success: true,
			content: hits.length > 0 ? hits.join('\n') : '(没有匹配)',
			structured: { count: hits.length, truncated },
		};
	},
});

// --- 写入 ---

registerTool({
	name: 'file_write',
	description: '将内容写入指定文件（覆盖）。如果文件不存在会自动创建。覆盖前建议先用 file_rename 备份原文件（高风险操作，先 ask_user）。',
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
	description: '删除指定文件。高风险操作：删除前应先得到用户同意（ask_user），必要时先 file_rename 到 backups/。',
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
	description:
		'重命名或移动文件（也用于「重命名迁移」备份：把要改的原文件移到 ' +
		'workspace/backups/<时间戳>-<原名>，再写新内容，避免直接覆盖造成不可逆丢失）。',
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
			const dir = dirname(to);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			renameSync(from, to);
			return { success: true, content: `Renamed: ${from} → ${to}` };
		} catch (err) {
			return { success: false, content: `Failed to rename: ${(err as Error).message}` };
		}
	},
});

// #endregion

// #region 内置工具 —— 进程

registerTool({
	name: 'bash',
	description: `在运行目录中执行 shell 命令。当前运行环境是 Windows（shell 为 cmd.exe），请使用 Windows 兼容命令（如 dir、type、echo），不要用 Unix 专属命令（如 ls、date +%Y、grep -r）。`,
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
				cwd: ctx.runningDir && existsSync(ctx.runningDir) ? ctx.runningDir : undefined,
				encoding: 'utf-8',
				timeout,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			return { success: true, content: output || '(no output)' };
		} catch (err: any) {
			return {
				success: false,
				content: `Command failed (exit ${err.status}):\n${err.stderr ?? err.message}`,
				error: err.message,
			};
		}
	},
});

// #endregion

// #region 内置工具 —— 网络

const WEB_TIMEOUT_MS = 15000;
const WEB_MAX_CHARS = 20000;

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

registerTool({
	name: 'web_fetch',
	description: '抓取一个 URL 的正文（自动剥离 HTML 标签，超长会截断）。',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: '要抓取的完整 URL' },
			maxChars: { type: 'integer', description: `最多返回多少字符，默认 ${WEB_MAX_CHARS}` },
		},
		required: ['url'],
	},
	async execute(args) {
		const url = String(args.url ?? '');
		if (!/^https?:\/\//i.test(url)) return { success: false, content: 'url 必须以 http(s):// 开头' };
		const maxChars = (args.maxChars as number) ?? WEB_MAX_CHARS;

		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), WEB_TIMEOUT_MS);
		try {
			const resp = await fetch(url, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MindTheGap-Harness/0.1)' },
			});
			const raw = await resp.text();
			if (!resp.ok) {
				return { success: false, content: `HTTP ${resp.status}: ${raw.slice(0, 500)}` };
			}
			const text = stripHtml(raw);
			const truncated = text.length > maxChars;
			return {
				success: true,
				content: truncated ? `${text.slice(0, maxChars)}\n\n...(已截断，原文 ${text.length} 字符)` : text,
				structured: { url, status: resp.status, chars: text.length, truncated },
			};
		} catch (err) {
			return { success: false, content: `Failed to fetch: ${(err as Error).message}` };
		} finally {
			clearTimeout(timer);
		}
	},
});

registerTool({
	name: 'web_search',
	description:
		'网络搜索（基于 DuckDuckGo HTML 端点，无需 API Key）。返回标题 + 链接 + 摘要列表。' +
		'需要正文时再用 web_fetch 打开具体链接。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '检索词' },
			limit: { type: 'integer', description: '返回条数，默认 8' },
		},
		required: ['query'],
	},
	async execute(args) {
		const query = String(args.query ?? '').trim();
		if (!query) return { success: false, content: 'query 不能为空' };
		const limit = Math.min((args.limit as number) ?? 8, 20);

		const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), WEB_TIMEOUT_MS);
		try {
			const resp = await fetch(endpoint, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MindTheGap-Harness/0.1)' },
			});
			const html = await resp.text();
			if (!resp.ok) {
				return { success: false, content: `搜索失败 HTTP ${resp.status}（可能是端点被限流）` };
			}

			const results: { title: string; url: string; snippet: string }[] = [];
			const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
			let m: RegExpExecArray | null;
			while ((m = linkRe.exec(html)) && results.length < limit) {
				let href = m[1];
				// DDG 的跳转链接：/l/?uddg=<encoded>
				const uddg = /[?&]uddg=([^&]+)/.exec(href);
				if (uddg) href = decodeURIComponent(uddg[1]);
				results.push({ title: stripHtml(m[2]), url: href, snippet: '' });
			}

			const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
			let s: RegExpExecArray | null;
			let i = 0;
			while ((s = snippetRe.exec(html)) && i < results.length) {
				results[i].snippet = stripHtml(s[1]);
				i++;
			}

			if (results.length === 0) {
				return {
					success: false,
					content: '没有解析出搜索结果（端点可能改版或被限流）。可以改用 web_fetch 直接打开已知 URL。',
				};
			}

			const text = results
				.map((r, idx) => `${idx + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
				.join('\n');
			return { success: true, content: text, structured: { query, count: results.length, results } };
		} catch (err) {
			return { success: false, content: `搜索失败: ${(err as Error).message}` };
		} finally {
			clearTimeout(timer);
		}
	},
});

// #endregion

// #region 内置工具 —— 任务清单

registerTool({
	name: 'task_list_read',
	description: '读取当前任务清单全文。',
	parameters: { type: 'object', properties: {}, required: [] },
	async execute(_args, ctx) {
		const list = ctx.readTaskList();
		return { success: true, content: list || '(任务清单为空)' };
	},
});

registerTool({
	name: 'task_list_write',
	description:
		'修改任务清单。op 可选：add（追加一条）/ update（改第 index 条，可标记 done）/ remove（删除第 index 条）/ replace（整篇替换）。',
	parameters: {
		type: 'object',
		properties: {
			op: { type: 'string', enum: ['add', 'update', 'remove', 'replace'], description: '操作类型' },
			item: { type: 'string', description: 'add / update 的条目文本' },
			index: { type: 'integer', description: 'update / remove 的下标（从 0 开始）' },
			done: { type: 'boolean', description: 'update 时是否标记完成' },
			list: { type: 'string', description: 'replace 时的清单全文' },
		},
		required: ['op'],
	},
	async execute(args, ctx) {
		const result = ctx.writeTaskList({
			op: args.op as TaskListOp['op'],
			item: args.item as string | undefined,
			index: args.index as number | undefined,
			done: args.done as boolean | undefined,
			list: args.list as string | undefined,
		});
		return { success: true, content: `任务清单已更新：\n${result || '(空)'}` };
	},
});

// #endregion

// #region 内置工具 —— 编排（实现即调用 Runner 注入的原语）

registerTool({
	name: 'delegate',
	description:
		'把一批子任务委托给其他 Agent 执行（并行）。每个子 Agent 独立工作，完成后把总结回填给你。' +
		'委托不会阻塞你：你会先进入等待，全部子实例结束后被自动唤醒。',
	parameters: {
		type: 'object',
		properties: {
			tasks: {
				type: 'array',
				description: '要委托的子任务列表',
				items: {
					type: 'object',
					properties: {
						agentId: { type: 'string', description: '目标 Agent 的 id（见「你可以委托的 Agent」清单）' },
						task: { type: 'string', description: '自包含的任务说明：背景 / 范围 / 交付 / 约束' },
					},
					required: ['agentId', 'task'],
				},
			},
		},
		required: ['tasks'],
	},
	async execute(args, ctx) {
		const tasks = (args.tasks as { agentId: string; task: string }[]) ?? [];
		if (!Array.isArray(tasks) || tasks.length === 0) {
			return { success: false, content: 'tasks 必须是非空数组' };
		}
		// 白名单校验：def.delegatable ∩ mode.agents
		const allowed = (ctx.def.delegatable ?? []).filter((id) => ctx.mode.agents[id]);
		for (const t of tasks) {
			if (!ctx.mode.agents[t.agentId]) {
				return { success: false, content: `不存在的 agentId: ${t.agentId}。可用：${allowed.join(', ') || '(无)'}` };
			}
			if (!allowed.includes(t.agentId)) {
				return { success: false, content: `当前 Agent 不能委托给 ${t.agentId}。可用：${allowed.join(', ') || '(无)'}` };
			}
			if (!t.task?.trim()) {
				return { success: false, content: `agentId=${t.agentId} 的 task 不能为空` };
			}
		}
		return ctx.delegate(tasks);
	},
});

registerTool({
	name: 'finish',
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
	description:
		'向用户提问并获得回答。注意：调用后你会**暂停**（进入等待），用户回答之后才继续。' +
		'高风险操作（删除 / 覆盖 / 批量改名 / 有写效果的 git 操作）必须先问用户。',
	parameters: {
		type: 'object',
		properties: {
			question: { type: 'string', description: '要问的问题' },
			options: {
				type: 'array',
				description: '单选选项（可留空，只做自由输入）',
				items: {
					type: 'object',
					properties: {
						label: { type: 'string' },
						description: { type: 'string' },
					},
					required: ['label'],
				},
			},
			extraPrompt: { type: 'string', description: '追加的补充说明' },
		},
		required: ['question'],
	},
	origin: 'client',
	async execute(args, ctx) {
		const question = String(args.question ?? '').trim();
		if (!question) return { success: false, content: 'question 不能为空' };
		return ctx.askUser({
			question,
			options: (args.options as AskUserArgs['options']) ?? [],
			extraPrompt: args.extraPrompt as string | undefined,
		});
	},
});

// #endregion

// #region 供其它模块使用的辅助

/** 列出目录（递归，带黑名单）—— 供 runner 组装目录概览等场景复用 */
export function listDirSafe(dir: string, maxDepth = 3): string[] {
	const out: string[] = [];
	const walk = (current: string, depth: number) => {
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (SEARCH_SKIP_DIRS.has(e.name)) continue;
			const full = join(current, e.name);
			out.push(e.isDirectory() ? `${full}/` : full);
			if (e.isDirectory() && depth < maxDepth) walk(full, depth + 1);
		}
	};
	walk(dir, 1);
	return out;
}

/** 清空整个会话工作目录（用于会话删除时的清理，由 storage 调用） */
export function removeDirSafe(dir: string): void {
	try {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	} catch {
		// 忽略
	}
}

// #endregion
