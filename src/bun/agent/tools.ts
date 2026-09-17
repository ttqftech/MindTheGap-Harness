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
import { fetchMany, fetchUrl, type FetchFormat, type RenderPolicy } from './web/fetch';
import { searchEngines } from './web/engines';
import { rankCandidates, type RankInput } from './web/rank';

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
	/** 本轮 run 的中断信号（工具内部发起的网络 / LLM 请求都该跟着它一起断） */
	signal: AbortSignal;
	// ---- 编排原语 ----
	delegate: (tasks: { agentId: string; task: string }[]) => Promise<ToolResult>;
	finish: (summary: string) => Promise<ToolResult>;
	resumePendingChild: (agentInstanceId: string) => Promise<ToolResult>;
	resumeCompletedChild: (agentInstanceId: string, followUp: string) => Promise<ToolResult>;
	askChild: (agentInstanceId: string, question: string) => Promise<ToolResult>;
	askUser: (q: AskUserArgs) => Promise<ToolResult>;
	readTaskList: () => string;
	writeTaskList: (op: TaskListOp) => string;
	/**
	 * 工具内部发起一次**独立 LLM 请求**的能力（如 web_search 的候选相关性打分）。
	 * 会照常写 requestLog（purpose=web_rank），所以这部分花费在账本里看得到。
	 * 失败不抛异常，返回 ok:false 让工具自己决定降级策略。
	 */
	runLlm: (req: ToolLlmRequest) => Promise<ToolLlmResult>;
}

/** 工具内部 LLM 请求（最小契约：一段 system + 一段 user，可选要求 JSON 输出） */
export interface ToolLlmRequest {
	system: string;
	user: string;
	/** 要求模型只输出 JSON（openai-chat 下会带 response_format=json_object） */
	json?: boolean;
	/**
	 * 结构化输出契约（json_schema）。字段与 web/rank.ts 的 RankLlmRequest 保持一致，
	 * 这样工具层可以直接把 rank 的请求对象透传过来（web/ 不能反向依赖 tools/，类型只能各写一份）。
	 */
	jsonSchema?: { name: string; schema: Record<string, unknown> };
	signal?: AbortSignal;
}

export interface ToolLlmResult {
	ok: boolean;
	text: string;
	error?: string;
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

/**
 * 网络工具的实现体在 ./web/ 下：
 * - web/fetch.ts   统一抓取（先 HTTP，必要时无头浏览器渲染）
 * - web/engines.ts 多引擎搜索结果页抓取与合并
 * - web/rank.ts    候选相关性打分（动态 Schema + 一次独立 LLM 请求）
 * - web/render.ts  桥接到 scripts/web-render.mjs（Node 子进程，负责真正的浏览器渲染）
 * 这里只负责「工具长什么样、参数怎么校验、结果怎么拼成给模型看的文本」。
 */

const WEB_MAX_CHARS = 20000;
const SEARCH_DEFAULT_PAGES = 3;
const SEARCH_MAX_PAGES = 6;
const SEARCH_PAGE_CHARS = 4000;
const SEARCH_TOTAL_CHARS = 24000;

registerTool({
	name: 'web_fetch',
	description:
		'抓取一个 URL 的正文，转成 Markdown（自动剥掉导航 / 脚本 / 样式等噪声，超长会截断）。' +
		'默认先用轻量 HTTP 请求；如果页面是靠 JS 渲染的空壳（SPA / 懒加载），或 HTTP 直接失败，' +
		'会自动改用无头浏览器渲染 —— 你不用自己判断该用哪种。' +
		'如果 URL 本来就是 API / JSON / 纯文本，会原样返回，不做转换。',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: '要抓取的完整 URL（http/https）' },
			format: {
				type: 'string',
				enum: ['auto', 'markdown', 'text', 'html', 'raw'],
				description: '返回格式。auto（默认）= HTML 转 Markdown，非 HTML 原样返回；raw = 不做任何转换',
			},
			render: {
				type: 'string',
				enum: ['auto', 'always', 'never'],
				description: '是否允许用无头浏览器渲染。auto（默认）= HTTP 拿不到正文时才渲染；never = 只用 HTTP（更快）',
			},
			maxChars: { type: 'integer', description: `最多返回多少字符，默认 ${WEB_MAX_CHARS}` },
			waitMs: { type: 'integer', description: '渲染时：页面加载完再等多久（毫秒），慢站点用，默认 0' },
			selector: { type: 'string', description: '渲染时：等待该 CSS 选择器出现后再取正文（如 "#root"）' },
		},
		required: ['url'],
	},
	async execute(args, ctx) {
		const outcome = await fetchUrl(String(args.url ?? ''), {
			format: (args.format as FetchFormat) ?? 'auto',
			render: (args.render as RenderPolicy) ?? 'auto',
			maxChars: (args.maxChars as number) ?? WEB_MAX_CHARS,
			waitMs: args.waitMs as number | undefined,
			selector: args.selector as string | undefined,
			signal: ctx.signal,
		});

		if (!outcome.ok) {
			return {
				success: false,
				content: `抓取失败：${outcome.error}\nURL: ${outcome.url}`,
				error: outcome.error,
				structured: { url: outcome.url, via: outcome.via, status: outcome.status },
			};
		}

		const footer = [
			`（${outcome.url}${outcome.finalUrl !== outcome.url ? ` → ${outcome.finalUrl}` : ''}`,
			outcome.status ? `HTTP ${outcome.status}` : '',
			outcome.via === 'browser' ? '浏览器渲染' : 'HTTP 直取',
			`${outcome.format}`,
			`${outcome.chars} 字符${outcome.truncated ? '（已截断）' : ''}）`,
		]
			.filter(Boolean)
			.join(' ｜ ');

		const head = outcome.title ? `# ${outcome.title}\n\n` : '';
		const note = outcome.note ? `\n\n> 说明：${outcome.note}` : '';

		return {
			success: true,
			content: `${head}${outcome.content}\n\n---\n${footer}${note}`,
			structured: {
				url: outcome.url,
				finalUrl: outcome.finalUrl,
				status: outcome.status,
				via: outcome.via,
				format: outcome.format,
				chars: outcome.chars,
				truncated: outcome.truncated,
			},
		};
	},
});

registerTool({
	name: 'web_search',
	description:
		'多引擎网络搜索，并且**直接把最相关页面的正文抓回来**。流程：同一个关键词并发查多个搜索引擎' +
		'（必应 / 百度 / 搜狗 / 360 / 谷歌，某个引擎在当前网络下不可达时会如实标注、不影响其余结果）' +
		'→ 合并去重得到「标题 + 链接 + 摘要」候选 → 用一次独立模型调用按相关性给每条候选打分 ' +
		'→ 取分数最高的若干条展开正文。所以返回的是**经过相关性筛选、带正文的调研材料**，不是链接列表。' +
		'需要外部世界的事实时优先用它；只有一个明确 URL 时用 web_fetch 更直接。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '检索词：带上具体的产品名 / 版本号 / 报错原文，比泛泛的关键词有效得多' },
			limit: {
				type: 'integer',
				description: `展开正文的条数，默认 ${SEARCH_DEFAULT_PAGES}（最多 ${SEARCH_MAX_PAGES}）。1~2 条适合只要一个事实，3~4 条适合需要对照多个来源`,
			},
			engines: {
				type: 'array',
				items: { type: 'string', enum: ['bing', 'baidu', 'sogou', 'so', 'google'] },
				description: '只用这些引擎（默认全部）。一般不用填',
			},
			maxCharsPerPage: { type: 'integer', description: `每篇正文最多返回多少字符，默认 ${SEARCH_PAGE_CHARS}` },
		},
		required: ['query'],
	},
	async execute(args, ctx) {
		const query = String(args.query ?? '').trim();
		if (!query) return { success: false, content: 'query 不能为空' };

		const limit = Math.max(1, Math.min((args.limit as number) ?? SEARCH_DEFAULT_PAGES, SEARCH_MAX_PAGES));
		const perPage = Math.max(500, (args.maxCharsPerPage as number) ?? SEARCH_PAGE_CHARS);

		// ---- 1. 多引擎检索 ----
		const searched = await searchEngines(query, {
			engines: args.engines as string[] | undefined,
			signal: ctx.signal,
		});
		if (searched.hits.length === 0) {
			const detail = searched.reports.map((r) => `${r.name}：${r.error ?? '无结果'}`).join('；');
			return {
				success: false,
				content: `所有搜索引擎都没有返回可解析的结果（${detail}）。可以换关键词重试，或用 web_fetch 直接打开已知 URL。`,
				error: 'NO_SEARCH_RESULTS',
				structured: { query, engines: searched.reports },
			};
		}

		// ---- 2. 相关性打分（独立 LLM 请求，失败则退回引擎原始名次）----
		const rankInput: RankInput[] = searched.hits.map((h, i) => ({
			id: `c${i + 1}`,
			title: h.title,
			url: h.url,
			snippet: h.snippet,
			engines: h.engines,
		}));
		const ranked = await rankCandidates(query, rankInput, (req) => ctx.runLlm(req), ctx.signal);
		const picked = ranked.items.slice(0, limit);

		// ---- 3. 展开正文（一次浏览器调用覆盖所有需要渲染的页面）----
		const fetched = await fetchMany(picked.map((p) => p.url), {
			format: 'markdown',
			maxChars: perPage,
			signal: ctx.signal,
		});

		// ---- 4. 拼装 ----
		const engineLine = searched.reports
			.map((r) => (r.ok ? `${r.name} ${r.count} 条` : `${r.name} 不可用(${r.error})`))
			.join(' · ');

		const header = [
			`# 搜索：${query}`,
			'',
			`引擎：${engineLine}`,
			`去重后候选：${searched.hits.length} 条；相关性打分：${ranked.ranked ? '已完成' : `未完成（${ranked.note ?? '未知原因'}）`}；已展开正文 ${picked.length} 篇。`,
		].join('\n');

		const sections: string[] = [];
		picked.forEach((item, i) => {
			const got = fetched[i]?.outcome;
			const score = item.score === null ? '未打分' : `相关性 ${item.score.toFixed(1)}`;
			const lines = [`## ${i + 1}. ${item.title}`, '', `链接：${got?.finalUrl ?? item.url}（${item.engines.join('/')} ｜ ${score}）`, ''];
			if (got?.ok) {
				lines.push(got.content || '(正文为空)');
				if (got.note) lines.push('', `> 说明：${got.note}`);
			} else {
				lines.push(`（正文抓取失败：${got?.error ?? '未知原因'}。摘要：${item.snippet || '无'}）`);
			}
			sections.push(lines.join('\n'));
		});

		// 没被展开的候选也列出来——它们是「已经过筛选」的备选，比让模型重新搜一遍便宜
		const rest = ranked.items.slice(limit);
		if (rest.length > 0) {
			const restLines = rest
				.slice(0, 12)
				.map((r) => `- ${r.score === null ? '(未打分)' : r.score.toFixed(1)}  ${r.title} — ${r.url}  ← ${r.engines.join('/')}`);
			sections.push(`## 未展开的候选（按相关性排序）\n\n${restLines.join('\n')}`);
		}

		let content = `${header}\n\n---\n\n${sections.join('\n\n---\n\n')}`;
		let truncated = false;
		if (content.length > SEARCH_TOTAL_CHARS) {
			content = `${content.slice(0, SEARCH_TOTAL_CHARS)}\n\n...(搜索结果总长超过 ${SEARCH_TOTAL_CHARS} 字符，已截断。需要更多内容时用 web_fetch 打开上面某个链接)`;
			truncated = true;
		}

		return {
			success: true,
			content,
			structured: {
				query,
				engines: searched.reports,
				candidates: searched.hits.length,
				ranked: ranked.ranked,
				picked: picked.map((p, i) => ({
					title: p.title,
					url: fetched[i]?.outcome.finalUrl ?? p.url,
					score: p.score,
					ok: fetched[i]?.outcome.ok ?? false,
				})),
				truncated,
			},
		};
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
