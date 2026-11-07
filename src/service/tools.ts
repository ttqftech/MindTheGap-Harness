/**
 * 工具系统 — MindTheGap-Harness
 *
 * 本文件只负责「工具是什么、怎么执行」，不负责「谁来编排」：
 * - 编排类工具（delegate / finish / resume_* / ask_child / ask_user / task_list_*）的实现就是调用 Runner 注入的编排原语，自己不碰 ctx 的状态机。
 * - `reason` 由工具层统一注入 JSON Schema 的 required，执行前再从 args 里剥离。
 *
 * 能力过滤：AgentDefinition.ability.tools 白名单 + mcpDisabled 策略（见 getToolsForAgentInstance）。
 *
 * 注意：主进程运行时是 Cottontail（JSC），不是 Bun。所以必须用 node:* 系列 API，不能用 Bun.xxx。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, statSync, openSync, readSync, closeSync, rmSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative, extname } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FromSchema } from 'json-schema-to-ts';
import type {
	AgentCtx, AgentDefinition, AgentInstance, AskUserArgs, LlmTool,
	ModeDefinition, ToolResult,
} from '@shared/agent';
import { fetchMany, fetchUrl, type FetchFormat, type RenderPolicy } from './web/fetch';
import { searchEngines } from './web/engines';
import { rankCandidates, type RankInput } from './web/rank';

// #region 类型

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
	delegate: (agentId: string, task: string) => Promise<ToolResult>;
	finish: (summary: string) => Promise<ToolResult>;
	resumePendingChild: (agentInstanceId: string) => Promise<ToolResult>;
	resumeCompletedChild: (agentInstanceId: string, followUp: string) => Promise<ToolResult>;
	askChild: (agentInstanceId: string, question: string) => Promise<ToolResult>;
	askUser: (q: AskUserArgs) => Promise<ToolResult>;
	readTaskList: () => string;
	writeTaskList: (op: { op: 'add' | 'update' | 'remove' | 'replace'; item?: string; index?: number; done?: boolean; list?: string }) => string;
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
export interface AgentTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: TArgs, ctx: ToolContext) => Promise<ToolResult>;
}

// #endregion

// #region 工具注册表

const toolRegistry = new Map<string, AgentTool>();

/**
 * 动态工具源（当前只有 MCP）。
 * 静态注册表放内置工具，动态源放运行时连上才有的工具，
 * 两者在 getToolsForAgentInstance() 里合并，断开时按 sourceId 整体注销。
 */
const dynamicToolSources = new Map<string, AgentTool[]>();

export function registerTool<TArgs extends Record<string, unknown> = Record<string, unknown>>(tool: AgentTool<TArgs>): void {
	toolRegistry.set(tool.name, tool as AgentTool);
}

export function getTool(name: string): AgentTool | undefined {
	return toolRegistry.get(name) ?? allDynamicTools().find((t) => t.name === name);
}

function allDynamicTools(): AgentTool[] {
	const out: AgentTool[] = [];
	for (const list of dynamicToolSources.values()) out.push(...list);
	return out;
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

/**
 * 某个实例可见的工具集合。
 * - 不写 allow = 全部内置（减去 deny）；写了 = 只保留 allow 内且不在 deny 内的
 * - 编排类工具（delegate）在达到 maxDepth 时被移除
 * - MCP 工具按 mcpDisabled 过滤（agent 级优先，否则回退 mode 级，默认开放）
 */
export function getToolsForAgentInstance(agentInstance: AgentInstance, agentDefinition: AgentDefinition, mode: ModeDefinition): AgentTool[] {
	// ⚠️ 这两个字段可能是「模式参数引用」（`"[mode.writeTools]"`）：加载期是字符串，
	//    运行时才被 `applyModeVars` 换成数组。这里必须按数组判，别对字符串做 includes / new Set（会退化成字符级）。
	const rawAllow = agentDefinition.ability.tools?.allow as unknown;
	const rawDeny = agentDefinition.ability.tools?.deny as unknown;
	const allow = Array.isArray(rawAllow) ? (rawAllow as string[]) : undefined;
	const deny = new Set(Array.isArray(rawDeny) ? (rawDeny as string[]) : []);
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

	const mcpDisabled = agentDefinition.ability.mcpDisabled ?? (mode.mcpDisabled ?? false);
	const mcpTools = mcpDisabled ? [] : Array.from(dynamicToolSources.values()).flat().filter((t) => t.name.startsWith('mcp__'));
	return [...builtin, ...mcpTools];
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
		reason: { type: 'string', description: '简述你调用这个工具要做什么（会展示在界面上）' },
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
export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
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

// #region 文件探测（file_read 用）

/**
 * 为什么需要探测：
 * - UTF-8 解码器**从不报错**，非法字节一律变 U+FFFD。用文本模式读二进制不会失败，只会返回一整片替换字符（1MB 图片 ≈ 100 万字符）。
 */

/** 魔数表：命中即判定二进制并给出类型名。短的放后面（"BM"/"MZ" 只有 2 字节，容易误判） */
const MAGIC_NUMBERS: Array<{ type: string; bytes: number[] }> = [
	{ type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
	{ type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
	{ type: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] },
	{ type: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
	{ type: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
	{ type: 'gzip', bytes: [0x1f, 0x8b] },
	{ type: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
	{ type: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
	{ type: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },
	{ type: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
	{ type: 'glb', bytes: [0x67, 0x6c, 0x54, 0x46] },
	{ type: 'bmp', bytes: [0x42, 0x4d] },
	{ type: 'pe', bytes: [0x4d, 0x5a] },
];

const SNIFF_BYTES = 8 * 1000;	// 探测用采样长度（只读文件头，不整份加载）
const TEXT_MAX_FILE_BYTES = 8 * 1000 * 1000;	// 文本单次读取的总字节上限：超过就直接拒绝（读 200 行不值得为 1GB 文件分配内存）
const TEXT_DEFAULT_LIMIT = 200;	// 文本单次读取的默认行数上限
const TEXT_MAX_LIMIT = 2000;	// 文本单次读取的最大行数上限
const TEXT_MAX_LINE_CHARS = 500;	// 单行字符上限：minified js / 一行 2MB 的 json，只限行数是挡不住的
const TEXT_MAX_RETURN_CHARS = 100 * 1000;	// 单次返回的总字符上限（防止 2000 行 × 500 字符）
const BIN_DEFAULT_LIMIT = 256;
const BIN_MAX_LIMIT = 4096;
const BIN_PROBE_BYTES = 64;	// 二进制文件探测时头尾各探多少字节
const BIN_SMALL_FILE = 512;	// 二进制文件小于这个大小就直接整份 dump（头尾会重叠）

type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1';

type SniffResult =
	| { kind: 'binary'; type: string; detected: string }
	| { kind: 'text'; encoding: TextEncoding; detected: string; bom: boolean };

/** 定位读一段字节（二进制模式绝不整份 readFileSync：读 200MB 图片的第 0x1000 字节不该载入整个文件） */
function readRange(path: string, offset: number, length: number, fileSize: number): Buffer {
	if (length <= 0) return Buffer.alloc(0);
	try {
		const fd = openSync(path, 'r');
		try {
			const buf = Buffer.alloc(length);
			let done = 0;
			while (done < length) {
				const n = readSync(fd, buf, done, length - done, offset + done);
				if (n <= 0) break;
				done += n;
			}
			return done === length ? buf : buf.subarray(0, done);
		} finally {
			closeSync(fd);
		}
	} catch (err) {
		// 运行时不支持 fd 定位读时的兜底：小文件整份读再切
		if (fileSize > TEXT_MAX_FILE_BYTES) throw err;
		return readFileSync(path).subarray(offset, offset + length);
	}
}

// 通过文件头的魔数判断文件类型
function matchMagic(head: Buffer): string | null {
	for (const m of MAGIC_NUMBERS) {
		if (head.length < m.bytes.length) continue;
		if (m.bytes.every((b, i) => head[i] === b)) return m.type;
	}
	return null;
}

/** 手写严格 UTF-8 校验（不依赖 TextDecoder 的 fatal 选项，JSC 不保证有） */
function utf8LooksValid(buf: Buffer): boolean {
	let i = 0;
	while (i < buf.length) {
		const b = buf[i];
		if (b < 0x80) { i++; continue; }
		let extra = 0;
		let cp = 0;
		if ((b & 0xe0) === 0xc0) { extra = 1; cp = b & 0x1f; }
		else if ((b & 0xf0) === 0xe0) { extra = 2; cp = b & 0x0f; }
		else if ((b & 0xf8) === 0xf0) { extra = 3; cp = b & 0x07; }
		else return false;
		// 采样在多字节字符中间被截断 → 不算非法
		if (i + extra >= buf.length) return true;
		for (let k = 1; k <= extra; k++) {
			const c = buf[i + k];
			if ((c & 0xc0) !== 0x80) return false;
			cp = (cp << 6) | (c & 0x3f);
		}
		if (extra === 1 && cp < 0x80) return false;
		if (extra === 2 && cp < 0x800) return false;
		if (extra === 3 && cp < 0x10000) return false;
		if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
		i += extra + 1;
	}
	return true;
}

/** 无 BOM 的 UTF-16：ASCII 字符的高位字节是 0，据此判断零字节集中在奇位还是偶位 */
function guessUtf16WithoutBom(buf: Buffer): 'utf-16le' | 'utf-16be' | null {
	const n = Math.min(buf.length, 512) & ~1;
	if (n < 8) return null;
	let evenZeros = 0;
	let oddZeros = 0;
	for (let i = 0; i < n; i += 2) {
		if (buf[i] === 0) evenZeros++;
		if (buf[i + 1] === 0) oddZeros++;
	}
	const pairs = n / 2;
	if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.1) return 'utf-16le';
	if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.1) return 'utf-16be';
	return null;
}

/** 计算控制字符（排除 \t \n \r \x1b、DEL）的占比：高就判断为二进制 */
function controlRatio(buf: Buffer): number {
	if (!buf.length) return 0;
	let n = 0;
	for (let i = 0; i < buf.length; i++) {
		const b = buf[i];
		if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x1b) n++;
		else if (b === 0x7f) n++;
	}
	return n / buf.length;
}

/**
 * 写回前的语法体检。
 *
 * 行替换（`file_edit`）最容易出的错是「改完少了半个括号/引号」——文件一坏，整个项目的测试全挂，而模型要花好几轮才意识到是自己刚刚那次编辑造成的。
 * 这里在落盘之前先体检一遍，语法坏了就**不写**并返回错误，磁盘上的文件保持原样。一次 `node --check` 远比一轮 LLM 便宜。
 */
function syntaxCheck(path: string, content: string): { ok: true } | { ok: false; message: string } {
	const ext = extname(path).toLowerCase();
	if (ext === '.json') {
		try {
			JSON.parse(content);
			return { ok: true };
		} catch (e) {
			return { ok: false, message: `JSON 解析失败：${(e as Error).message}` };
		}
	}
	// 只拦 node 自己能静态检查的扩展名；TS/TSX 不是 JS 的子集，跳过
	if (!['.js', '.mjs', '.cjs'].includes(ext)) return { ok: true };

	const tmp = join(tmpdir(), `mtg-syntax-${randomUUID()}${ext}`);
	try {
		writeFileSync(tmp, content, 'utf-8');
		const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf-8', timeout: 10_000, windowsHide: true });
		if (res.status === 0) return { ok: true };
		const raw = String(res.stderr || '');
		const lines = raw.split('\n').filter(Boolean);
		// node --check 的报错是「文件名:行号 / 源码行 / 脱字符 / SyntaxError: … / 堆栈」。
		// 只取前面那半截——堆栈全是 node 内部帧，占了行数会把真正有用的源码行挤出去。
		const errAt = lines.findIndex((l) => /^\s*(Syntax)?Error\b/.test(l));
		const frame = (errAt >= 0 ? lines.slice(Math.max(0, errAt - 3), errAt + 1) : lines.slice(0, 4)).join('\n');
		const line = raw.match(/:(\d+)\s*$/m)?.[1] ?? raw.match(/:(\d+)\n/)?.[1];
		// 把出事那几行的内容一起给回去：否则模型为了看清自己刚刚写了什么，会先浪费一轮重新读文件。
		const around = line ? content.split('\n').slice(Math.max(0, Number(line) - 3), Number(line) + 1).map((l, i) => ` ${Math.max(1, Number(line) - 2) + i}| ${l}`).join('\n') : '';
		return {
			ok: false,
			message: `会让 ${path} 语法错误${line ? `（第 ${line} 行附近）` : ''}：\n${frame}${around ? `\n写入后那段长这样：\n${around}` : ''}`,
		};
	} catch {
		return { ok: true }; // 体检本身失败时不阻塞写入
	} finally {
		try {
			rmSync(tmp, { force: true });
		} catch {}
	}
}

/**
 * 给 file_search 用的廉价判定：文件已经被整份读成 UTF-8 字符串了，就不必再单独探测文件头。
 * NUL，或采样区里 U+FFFD 占比高（非法字节被解码器替换）⇒ 二进制。
 */
function looksBinaryText(text: string): boolean {
	const sample = text.length > 8192 ? text.slice(0, 8192) : text;
	if (sample.indexOf('\u0000') >= 0) return true;
	let bad = 0;
	for (let i = 0; i < sample.length; i++) if (sample.charCodeAt(i) === 0xfffd) bad++;
	return bad > 0 && bad / sample.length > 0.1;
}

/**
 * 判定顺序：魔数 > BOM > NUL（含无 BOM 的 UTF-16 启发式）> 严格 UTF-8 > 控制字符比例 > latin1 兜底。
 * latin1 兜底是给 GBK 这类「非 UTF-8 但仍是文本」的文件留的路，不然中文用户会看到「二进制」。
 */
function sniffBuffer(head: Buffer, size: number): SniffResult {
	if (size === 0) return { kind: 'text', encoding: 'utf-8', detected: 'empty', bom: false };

	const magic = matchMagic(head);
	if (magic) return { kind: 'binary', type: magic, detected: `magic:${magic}` };

	if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
		return { kind: 'text', encoding: 'utf-8', detected: 'bom:utf-8', bom: true };
	}
	if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
		return { kind: 'text', encoding: 'utf-16le', detected: 'bom:utf-16le', bom: true };
	}
	if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) {
		return { kind: 'text', encoding: 'utf-16be', detected: 'bom:utf-16be', bom: true };
	}

	let hasNul = false;
	for (let i = 0; i < head.length; i++) if (head[i] === 0) { hasNul = true; break; }
	if (hasNul) {
		const u16 = guessUtf16WithoutBom(head);
		if (u16) return { kind: 'text', encoding: u16, detected: `${u16}:no-bom`, bom: false };
		return { kind: 'binary', type: 'unknown', detected: 'nul-bytes' };
	}

	if (utf8LooksValid(head)) return { kind: 'text', encoding: 'utf-8', detected: 'utf8', bom: false };

	if (controlRatio(head) > 0.1) return { kind: 'binary', type: 'unknown', detected: 'control-chars' };

	return { kind: 'text', encoding: 'latin1', detected: 'non-utf8', bom: false };
}

/** 文本 → 字节。写回一律用文件原本的编码与 BOM，别把 UTF-16 / 带 BOM 的文件悄悄改写成 UTF-8 */
function encodeBuffer(text: string, encoding: TextEncoding, bom: boolean): Buffer {
	if (encoding === 'utf-8') return Buffer.from(bom ? `\uFEFF${text}` : text, 'utf8');
	if (encoding === 'latin1') {
		const bytes = Buffer.alloc(text.length);
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code > 0xff) {
				const err = new Error(
					`目标文件按 latin1（非 UTF-8/UTF-16，可能是 GBK）读写，写回内容里第 ${i + 1} 个字符「${text[i]}」无法表示。请改用脚本按目标编码写入`,
				) as Error & { code?: string };
				err.code = 'ENCODING_UNSUPPORTED';
				throw err;
			}
			bytes[i] = code;
		}
		return bytes;
	}
	// utf-16le / utf-16be：逐码元写（代理对是两个码元，保持相邻即正确）
	const units: number[] = bom ? [0xfeff] : [];
	for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
	const bytes = Buffer.alloc(units.length * 2);
	for (let i = 0; i < units.length; i++) {
		const u = units[i];
		if (encoding === 'utf-16le') {
			bytes[i * 2] = u & 0xff;
			bytes[i * 2 + 1] = (u >> 8) & 0xff;
		} else {
			bytes[i * 2] = (u >> 8) & 0xff;
			bytes[i * 2 + 1] = u & 0xff;
		}
	}
	return bytes;
}

type Eol = '\n' | '\r\n';

/**
 * 按 `\n` 切行，但**保留每行自己的行尾**（`'\r\n'` / `'\n'` / `''`）。
 * 这样编辑时未改动的行写回后字节完全不变（混合行尾也不会被整份改写），
 * 同时也去掉了 `split('\n')` 在「文件以 \n 结尾」时凭空多出来的那个空行。
 */
function splitLines(text: string): Array<{ body: string; eol: string }> {
	const out: Array<{ body: string; eol: string }> = [];
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '\n') continue;
		if (i > start && text[i - 1] === '\r') out.push({ body: text.slice(start, i - 1), eol: '\r\n' });
		else out.push({ body: text.slice(start, i), eol: '\n' });
		start = i + 1;
	}
	if (start < text.length) out.push({ body: text.slice(start), eol: '' });
	return out;
}

/** 判断主行尾：CRLF 不少于 LF 且至少一个 CRLF → CRLF，否则 LF（无行尾的单行文件按 LF） */
function dominantEol(parts: Array<{ eol: string }>): Eol {
	let crlf = 0;
	let lf = 0;
	for (const p of parts) {
		if (p.eol === '\r\n') crlf++;
		else if (p.eol === '\n') lf++;
	}
	return crlf > 0 && crlf >= lf ? '\r\n' : '\n';
}

/** 把任意行尾统一成目标行尾（整份覆盖写时用，避免把 CRLF 文件整体改成 LF） */
function applyEol(text: string, eol: Eol): string {
	const normalized = text.replace(/\r\n/g, '\n');
	return eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

type WriteGuard =
	| { ok: true; exists: boolean; encoding: TextEncoding; bom: boolean; eol: Eol }
	| { ok: false; message: string };

/**
 * 写操作前的闸门：**二进制文件一律拒写**。
 * 文本写入把一张图毁掉是静默的（解码成 latin1 再编码回去，字节全变），而这种损坏既不可逆也看不出原因，所以宁可让工具直接失败。
 * 新文件（不存在）放行。
 */
function guardWritableFile(path: string): WriteGuard {
	if (!existsSync(path)) return { ok: true, exists: false, encoding: 'utf-8', bom: false, eol: '\n' };
	const st = statSync(path);
	if (st.isDirectory()) return { ok: false, message: `"${path}" 是目录，不是文件` };
	const size = st.size;
	const head = readRange(path, 0, Math.min(SNIFF_BYTES, size), size);
	const sniff = sniffBuffer(head, size);
	if (sniff.kind === 'binary') {
		return {
			ok: false,
			message:
				`"${path}" 是二进制文件（${sniff.type}，${formatBytes(size)}，detected=${sniff.detected}），不应用文本方式写入。` +
				'若要整体替换，先 file_delete 再 file_create。若需特殊操作请自行写脚本执行。',
		};
	}
	// 行尾按文件头采样判断（头部 8KB 足够代表整个文件；真要判错也只影响整份覆盖写）
	const eol = dominantEol(splitLines(decodeBuffer(head, sniff.encoding)));
	return { ok: true, exists: true, encoding: sniff.encoding, bom: sniff.bom, eol };
}

/** 按探测结果解码。UTF-8 交给运行时的 TextDecoder；UTF-16/GBK 手工拼码元（不依赖编码器支持） */
function decodeBuffer(raw: Buffer, encoding: TextEncoding): string {
	if (encoding === 'utf-8') {
		const text = new TextDecoder('utf-8').decode(raw);
		return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	}
	if (encoding === 'latin1') {
		const parts: string[] = [];
		for (let i = 0; i < raw.length; i += 4096) {
			const slice: number[] = [];
			for (let k = i; k < Math.min(i + 4096, raw.length); k++) slice.push(raw[k]);
			parts.push(String.fromCharCode.apply(null, slice));
		}
		return parts.join('');
	}
	// utf-16le / utf-16be：先按小端取出码元，big-endian 交换高低字节
	const start = raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) ? 2 : 0;
	const units: number[] = [];
	for (let i = start; i + 1 < raw.length; i += 2) {
		units.push(encoding === 'utf-16le' ? raw[i] | (raw[i + 1] << 8) : (raw[i] << 8) | raw[i + 1]);
	}
	const parts: string[] = [];
	for (let i = 0; i < units.length; i += 4096) parts.push(String.fromCharCode.apply(null, units.slice(i, i + 4096)));
	return parts.join('');
}

/** 16 字节一行的 hexdump，带 ASCII 旁列（旁列是把「可读字符串 / 结构标记」从字节里认出来的唯一线索） */
function hexdump(buf: Buffer, baseOffset: number): string {
	const lines: string[] = [];
	for (let i = 0; i < buf.length; i += 16) {
		const chunk = buf.subarray(i, i + 16);
		const hex: string[] = [];
		const ascii: string[] = [];
		for (let k = 0; k < chunk.length; k++) {
			const b = chunk[k];
			hex.push((b < 16 ? '0' : '') + b.toString(16));
			ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');
		}
		const addr = (baseOffset + i).toString(16).padStart(8, '0');
		lines.push(`${addr}  ${hex.join(' ').padEnd(47)}  |${ascii.join('')}|`);
	}
	return lines.join('\n');
}

function formatBytes(n: number): string {
	if (n < 1000) return `${n} B`;
	if (n < 1000 * 1000) return `${(n / 1000).toFixed(1)} KB`;
	return `${(n / 1000 / 1000).toFixed(1)} MB`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

// #endregion

// #region 内置工具 —— 文件操作

// --- 只读 ---

registerTool({
	name: 'file_read',
	description:
		'读取文件内容，自动识别文本/二进制与编码。',
		// `文本模式：按行返回，**恒带行号与总行数**，默认 ${TEXT_DEFAULT_LIMIT} 行（上限 ${TEXT_MAX_LIMIT}），超长行会截断，末尾提示下一段 offset；二进制模式：不输出内容，只给类型/大小/hexdump（默认头尾各 ${BIN_PROBE_BYTES} 字节，用 offset+limit 可指定字节区间，单次上限 ${BIN_MAX_LIMIT} 字节）。` +
		// '二进制分析（修图片、提取嵌入数据、逆向格式）请自己写脚本用 shell 执行，不要逐段硬读字节。' +
		// '不确定内容在哪个文件时先用 file_search 或 file_list 定位。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			offset: {
				type: 'integer',
				description: '文本模式：起始行号（从 1 开始）；二进制模式：起始字节偏移（从 0 开始）。省略则从头读',
			},
			limit: {
				type: 'integer',
				description: `文本模式：行数；二进制模式：字节数`,
			},
			mode: {
				type: 'string',
				enum: ['auto', 'text', 'binary'],
				description: '推荐不填以自动判断。仅当自动判断明显不对时手动指定',
			},
		},
		required: ['path'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);

		let size: number;
		try {
			const st = statSync(path);
			if (st.isDirectory()) {
				return { success: false, content: `"${path}" 是目录，不是文件，请用 file_list 列出其内容`, error: 'IS_DIRECTORY' };
			}
			size = st.size;
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code === 'ENOENT') return { success: false, content: `文件不存在：${path}`, error: 'NOT_FOUND' };
			if (code === 'EACCES' || code === 'EPERM') return { success: false, content: `没有权限读取：${path}`, error: 'NO_PERMISSION' };
			return { success: false, content: `无法访问 ${path}：${(err as Error).message}`, error: code ?? 'STAT_FAILED' };
		}

		// 探测（只看文件头，不整份加载）
		const head = readRange(path, 0, Math.min(SNIFF_BYTES, size), size);
		const sniff = sniffBuffer(head, size);
		const forcedMode = args.mode === 'text' || args.mode === 'binary' ? args.mode : null;
		const mode = forcedMode ?? sniff.kind;
		// const modeLabel = forcedMode && forcedMode !== sniff.kind ? `${mode}（forced）` : mode;
		const modeLabel = mode;

		// ---------- 二进制 ----------
		if (mode === 'binary') {
			const probeOnly = args.offset === undefined && args.limit === undefined;
			const parts: string[] = [];
			let rangeNote: string;

			if (probeOnly && size > BIN_SMALL_FILE) {
				const headN = Math.min(BIN_PROBE_BYTES, size);
				const tailStart = Math.max(headN, size - BIN_PROBE_BYTES);
				parts.push(hexdump(readRange(path, 0, headN, size), 0));
				parts.push('...');
				parts.push(hexdump(readRange(path, tailStart, size - tailStart, size), tailStart));
				rangeNote = `head 0x0-0x${headN.toString(16)} + tail 0x${tailStart.toString(16)}-0x${size.toString(16)}`;
			} else if (probeOnly) {
				parts.push(hexdump(readRange(path, 0, size, size), 0));
				rangeNote = `whole 0x0-0x${size.toString(16)}`;
			} else {
				const off = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
				if (off >= size) {
					return {
						success: false,
						content: `offset=${off} 超出范围：文件共 ${size} 字节（0x${size.toString(16)}）。`,
						error: 'OFFSET_OUT_OF_RANGE',
					};
				}
				const want = clampInt(args.limit, BIN_DEFAULT_LIMIT, 1, BIN_MAX_LIMIT);
				const len = Math.min(want, size - off);
				parts.push(hexdump(readRange(path, off, len, size), off));
				rangeNote = `0x${off.toString(16)}-0x${(off + len).toString(16)}（${len} / ${size} 字节）`;
			}

			const header = `<file path="${path}" mode="${modeLabel}" type="${sniff.kind}" detected="${sniff.detected}" size=${size} offset_unit="byte(0-based)">`;
			const footer = `[字节区间：${rangeNote}]`;

			return {
				success: true,
				content: `${header}\n${parts.join('\n')}\n${footer}`,
				structured: {
					mode: 'binary',
					type: sniff.kind === 'binary' ? sniff.type : 'by-request',
					detected: sniff.detected,
					forced: forcedMode !== null && forcedMode !== sniff.kind,
					totalBytes: size,
					probeOnly,
				},
			};
		}

		// ---------- 文本 ----------
		const notes: string[] = [];
		if (size > TEXT_MAX_FILE_BYTES) {
			return {
				success: false,
				content: `文件 ${formatBytes(size)} 超过单次文本读取上限（${formatBytes(TEXT_MAX_FILE_BYTES)}）。请用 file_search 定位关键行，或用 shell 抽取片段（如 findstr / Select-String），或显式传 mode="binary" 只看指定字节区间。`,
				error: 'FILE_TOO_LARGE',
			};
		}
		if (sniff.kind === 'binary') {
			notes.push(`[注意：该文件自动判定为二进制（${sniff.detected}），已按 mode="text" 强制解码，内容可能是乱码]`);
		}
		if (sniff.kind === 'text' && sniff.encoding === 'latin1') {
			notes.push('[注意：文件不是合法 UTF-8（可能是 GBK/GB18030），已用 latin1 兜底解码，中文会乱码]');
		}

		const raw = readFileSync(path);
		const content = decodeBuffer(raw, sniff.kind === 'text' ? sniff.encoding : 'latin1');
		const encoding = sniff.kind === 'text' ? sniff.encoding : 'latin1';

		if (size === 0) {
			return {
				success: true,
				content: `<file path="${path}" mode="${modeLabel}" encoding="${encoding}" detected="empty" lines=0 size=0>\n（空文件）`,
				structured: {
					mode: 'text', encoding, detected: 'empty', forced: false,
					totalLines: 0, totalBytes: 0, startLine: 0, endLine: 0, readLines: 0, truncated: false,
				},
			};
		}

		const lines = splitLines(content);

		const offsetLine = Math.max(1, Math.floor(Number(args.offset ?? 1)) || 1);
		const limit = clampInt(args.limit, TEXT_DEFAULT_LIMIT, 1, TEXT_MAX_LIMIT);
		if (offsetLine > lines.length) {
			return {
				success: false,
				content: `offset=${offsetLine} 超出范围：文件共 ${lines.length} 行`,
				error: 'OFFSET_OUT_OF_RANGE',
			};
		}

		const width = String(lines.length).length;
		const body: string[] = [];
		let chars = 0;
		let cutByChars = false;
		let endLine = offsetLine - 1;
		for (let i = offsetLine - 1; i < lines.length && i < offsetLine - 1 + limit; i++) {
			const textLine = lines[i].body;
			const shown = textLine.length > TEXT_MAX_LINE_CHARS
				? `${textLine.slice(0, TEXT_MAX_LINE_CHARS)} …(+${textLine.length - TEXT_MAX_LINE_CHARS} chars)`
				: textLine;
			const rendered = `${String(i + 1).padStart(width)}→${shown}`;
			if (body.length > 0 && chars + rendered.length > TEXT_MAX_RETURN_CHARS) {
				cutByChars = true;
				break;
			}
			body.push(rendered);
			chars += rendered.length + 1;
			endLine = i + 1;
		}

		const header = `<file path="${path}" mode="${modeLabel}" encoding="${encoding}" detected="${sniff.detected}" lines=${lines.length} size=${size}>`;
		const footer = endLine < lines.length
			? `[已读 ${offsetLine}-${endLine} / 共 ${lines.length} 行${cutByChars ? '（已达单次返回上限，提前截断）' : ''}]`
			: `[已读 ${offsetLine}-${endLine} / 共 ${lines.length} 行（已到文件末尾）]`;

		return {
			success: true,
			content: [header, ...notes, body.join('\n'), footer].filter((s) => s !== '').join('\n'),
			structured: {
				mode: 'text',
				encoding,
				detected: sniff.detected,
				forced: forcedMode !== null && forcedMode !== sniff.kind,
				totalLines: lines.length,
				totalBytes: size,
				startLine: offsetLine,
				endLine,
				readLines: body.length,
				truncated: endLine < lines.length,
				nextOffset: endLine < lines.length ? endLine + 1 : undefined,
			},
		};
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
		'自动跳过 node_modules/.git/dist/build 等目录与二进制文件，单文件上限 1MB，最多返回 50 条。',
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
		let skippedBinary = 0;

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
					// 跳过二进制：这里已经有解码后的字符串，判 NUL / 替换字符比例即可，不必再单独探测一遍文件头
					if (looksBinaryText(text)) {
						skippedBinary++;
						continue;
					}
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
		const note = skippedBinary > 0 ? `\n（已跳过 ${skippedBinary} 个二进制文件）` : '';
		return {
			success: true,
			content: (hits.length > 0 ? hits.join('\n') : '(没有匹配)') + note,
			structured: { count: hits.length, truncated, skippedBinary },
		};
	},
});

// --- 写入 ---

registerTool({
	name: 'file_write',
	description: '将文本写入指定文件（覆盖），沿用文件原有编码（UTF-8 / UTF-16 / BOM 都保持）。如果文件不存在会自动创建。覆盖前建议先用 file_rename 备份原文件。',
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
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			// 已存在的文件沿用其行尾（整份覆盖不该把 CRLF 文件改成 LF）；新文件用给定的内容
			const text = guard.exists ? applyEol(args.content as string, guard.eol) : (args.content as string);
			const bad = syntaxCheck(path, text);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n磁盘上的 ${path} 没动，请修好后重发整份内容。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(text, guard.encoding, guard.bom));
			const tail = guard.encoding === 'utf-8' ? '' : `（沿用原编码 ${guard.encoding}）`;
			return { success: true, content: `File written: ${path}${tail}` };
		} catch (err) {
			return { success: false, content: `Failed to write file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'WRITE_FAILED' };
		}
	},
});

registerTool({
	name: 'file_append',
	description:
		'把一段文本追加到文件末尾（新调试用例、新条目这类「加在最后」的场景专用）。',
		// '跟 file_edit 的区别：不需要先 file_read 数行号，一次调用就完事——省一轮，也省下那份文件内容常驻上下文。' +
		// '插入中间某一行时不要用这个，用 file_edit。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			content: { type: 'string', description: '要追加的内容' },
		},
		required: ['path', 'content'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			const tail = (args.content as string).replace(/\r?\n$/, '');
			// 原文件非空且没换行结尾时补一个，否则会把新内容粘到最后一行的屁股上
			const prev = guard.exists ? readFileSync(path, guard.encoding === 'utf-8' ? 'utf-8' : guard.encoding as BufferEncoding) : '';
			const lead = prev && !/\r?\n$/.test(prev) ? guard.eol : '';
			const text = applyEol(prev + lead + tail + guard.eol, guard.eol);
			const bad = syntaxCheck(path, text);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n磁盘上的 ${path} 没动，请修好后重新追加。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(text, guard.encoding, guard.bom));
			return { success: true, content: `Appended ${tail.split('\n').length} lines to ${path}（现 ${text.split('\n').length - 1} 行）` };
		} catch (err) {
			return { success: false, content: `Failed to append file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'APPEND_FAILED' };
		}
	},
});

registerTool({
	name: 'file_edit',
	description: '编辑文本文件的指定行范围（startLine 到 endLine，含两端），替换为 newContent。行号与 file_read 输出的一致；写回沿用原编码。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			startLine: { type: 'integer', description: '起始行号（从 1 开始）' },
			endLine: { type: 'integer', description: '结束行号（含）' },
			newContent: { type: 'string', description: '替换后的新内容（可能是多行）（整行覆盖，因此需带上原有的缩进（tab 或空格））' },
		},
		required: ['path', 'startLine', 'endLine', 'newContent'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			if (!guard.exists) return { success: false, content: `文件不存在：${path}（新建请用 file_create）`, error: 'NOT_FOUND' };

			const content = decodeBuffer(readFileSync(path), guard.encoding);
			const lines = splitLines(content);
			const start = ((args.startLine as number) ?? 1) - 1;
			const end = args.endLine as number;

			if (start < 0 || end > lines.length || start >= end) {
				return {
					success: false,
					content: `Invalid line range: ${start + 1}-${end}. File has ${lines.length} lines.`,
				};
			}

			// 新行沿用「被替换区间第一行」的行尾；区间末行原本没有行尾（文件结尾无换行）时，新末行也不加
			const replacedEol = lines[start].eol || dominantEol(lines);
			const tailHasEol = lines[end - 1].eol !== '';
			const newLines = (args.newContent as string)
				.split('\n')
				.map((s) => (s.endsWith('\r') ? s.slice(0, -1) : s));
			const replacement = newLines.map((body, i) => ({
				body,
				eol: i === newLines.length - 1 && !tailHasEol ? '' : replacedEol,
			}));
			const result = [...lines.slice(0, start), ...replacement, ...lines.slice(end)]
				.map((l) => l.body + l.eol)
				.join('');
			const bad = syntaxCheck(path, result);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n磁盘上的 ${path} 没动，请缩小要替换的行范围重来（通常是多删了个括号/引号，或 newContent 少了一行）。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(result, guard.encoding, guard.bom));

			const written = result.length === 0 ? [] : splitLines(result).slice(start, start + newLines.length);
			const preview = written.map((l, i) => ` ${start + 1 + i}→${l.body}`).join('\n');
			return {
				success: true,
				content:
					`Edited lines ${start + 1}-${end} in ${path}. Old: ${end - start} lines, New: ${newLines.length} lines.\n` +
					`现在这一段的实际内容：\n${preview}`,
				structured: { path, startLine: start + 1, endLine: end, lines: newLines.length },
			};
		} catch (err) {
			return { success: false, content: `Failed to edit file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'EDIT_FAILED' };
		}
	},
});

registerTool({
	name: 'file_create',
	description: '创建一个新文本文件。已存在的二进制文件不会被覆盖（会被拒绝）。',
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
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const raw = (args.content as string) ?? '';
			const text = guard.exists ? applyEol(raw, guard.eol) : raw;
			writeFileSync(path, encodeBuffer(text, guard.encoding, guard.bom));
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
		'重命名或移动文件（也用于「重命名迁移」备份：把要改的原文件移到 workspace/backups/<时间戳>-<原名>，再写新内容，避免直接覆盖造成不可逆丢失）。',
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
	name: 'shell',
	description: `在运行目录中执行 shell 命令。${
		process.platform === 'win32'
			? [
					'当前运行环境是 Windows（shell 为 cmd.exe），请使用 Windows 兼容命令（如 dir、type、echo），不要用 Unix 专属命令（如 ls、date +%Y、grep -r）。',
					// '实测踩过的坑，照下面写：临时环境变量要用 `set X=1 && node a.mjs`（写成 `X=1 node a.mjs` 会报「不是内部或外部命令」）；多条命令按顺序用 `&&` 串，不要用 `;`（不是分隔符）也不要用单个 `&`（会把前一条扔到后台，输出跟后一条搅在一起）；退出码在结果末尾（形如 [exit 2]），不要自己去 echo %ERRORLEVEL% 或 $?（拿不到）；不要试图用 `echo ... >> 文件` 写多行内容，换行会被截断、中文还会乱码——要往文件里写超过一行的东西就用 file_write / file_create。',
				].join('\n')
			: process.platform === 'darwin'
				? '当前运行环境是 macOS（shell 为 /bin/sh），请使用 Unix 兼容命令（如 ls、cat、echo、grep）。'
				: '当前运行环境是 Linux（shell 为 /bin/sh），请使用 Unix 兼容命令（如 ls、cat、echo、grep）。'
		}\n超过一行的脚本先用 file_create 写成文件再运行——命令行里的换行会被截断。`,
	parameters: {
		type: 'object',
		properties: {
			command: { type: 'string', description: '要执行的 shell 命令' },
			timeout: { type: 'integer', description: '超时时间（秒），默认 180' },
		},
		required: ['command'],
	},
	async execute(args, ctx) {
		const cmd = args.command as string;
		const timeout = (args.timeout as number) ?? 180;

		try {
			const res = spawnSync(cmd, {
				cwd: ctx.runningDir && existsSync(ctx.runningDir) ? ctx.runningDir : undefined,
				encoding: 'utf-8',
				timeout: timeout * 1000,
				shell: true,
				windowsHide: true,
			});
			if (res.error) {
				const msg = res.signal
					? `执行超时或被终止（${res.signal}）`
					: res.error.message;
				return { success: false, content: msg, error: msg };
			}
			const parts: string[] = [];
			if (res.stdout?.trim()) parts.push(res.stdout.trimEnd());
			if (res.stderr?.trim()) parts.push(`[stderr]\n${res.stderr.trimEnd()}`);
			parts.push(`[exit ${res.status}]`);	// 退出码
			return { success: true, content: parts.join('\n') };
		} catch (err: any) {
			return {
				success: false,
				content: `执行失败：${err.message}`,
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
 * - web/render.ts  桥接到 runtime/web-render.mjs（Node 子进程，负责真正的浏览器渲染）
 * 这里只负责「工具长什么样、参数怎么校验、结果怎么拼成给模型看的文本」。
 */

const WEB_MAX_CHARS = 20000;
const SEARCH_DEFAULT_PAGES = 3;
const SEARCH_MAX_PAGES = 10;
const SEARCH_PAGE_CHARS = 4000;
const SEARCH_TOTAL_CHARS = 24000;

/**
 * 抓取一个 URL 的正文，转成 Markdown（自动剥掉导航 / 脚本 / 样式等噪声，超长会截断）。
 * 默认先用轻量 HTTP 请求；如果页面是靠 JS 渲染的空壳（SPA / 懒加载），或 HTTP 直接失败，
 * 会自动改用无头浏览器渲染 —— 你不用自己判断该用哪种。
 * 如果 URL 本来就是 API / JSON / 纯文本，会原样返回，不做转换。
 */
registerTool({
	name: 'web_fetch',
	description:
		'抓取一个 URL 的正文，支持转成 Markdown（自动剥掉导航、脚本、样式等噪声）或原样返回。',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: '要抓取的完整 URL（http/https）' },
			format: {
				type: 'string',
				enum: ['auto', 'markdown', 'text', 'html', 'raw'],
				description: '返回格式。auto（默认）= 若为 HTML 则转 Markdown，否则原样返回；raw = 不转换',
			},
			render: {
				type: 'string',
				enum: ['auto', 'always', 'never'],
				description: '是否用无头浏览器渲染。auto（默认）= HTTP 无有效正文时使用；never = 只用 HTTP（更快）',
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

/**
 * 多引擎网络搜索，并且**直接把最相关页面的正文抓回来**。
 * 流程：同一个关键词并发查多个搜索引擎（必应 / 百度 / 搜狗 / 360 / 谷歌，某个引擎在当前网络下不可达时会如实标注、不影响其余结果）
 * → 合并去重得到「标题 + 链接 + 摘要」候选 → 用一次独立模型调用按相关性给每条候选打分
 * → 取分数最高的若干条展开正文。所以返回的是**经过相关性筛选、带正文的调研材料**，不是链接列表。
 */
registerTool({
	name: 'web_search',
	description:
		'多引擎网络搜索，返回最相关页面的**正文**。' +
		'该工具将并发调用多个搜索引擎，合并去重后进行 AI 打分，并返回**经过相关性筛选、的正文材料**，不是链接列表。' +
		'需要外部世界事实时优先用它；只有一个明确 URL 时建议用 web_fetch 而非本工具。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '检索词' },
			limit: {
				type: 'integer',
				description: `展开正文的条数，默认 ${SEARCH_DEFAULT_PAGES}（最多 ${SEARCH_MAX_PAGES}）。2~3 条适合只要一个事实，4~6 条适合需要对照多个来源`,
			},
			engines: {
				type: 'array',
				items: { type: 'string', enum: ['bing', 'baidu', 'sogou', 'so', 'google'] },
				description: '引擎白名单（默认全部）。建议不填',
			},
			maxCharsPerPage: { type: 'integer', description: `每篇正文最多返回多少字符，默认 ${SEARCH_PAGE_CHARS}` },
		},
		required: ['query'],
	},
	async execute(args, ctx) {
		const query = String(args.query ?? '').trim();
		if (!query) return { success: false, content: 'query 不能为空' };

		const limitResults = Math.max(1, Math.min((args.limit as number) ?? SEARCH_DEFAULT_PAGES, SEARCH_MAX_PAGES));
		const limitPerPage = Math.max(500, (args.maxCharsPerPage as number) ?? SEARCH_PAGE_CHARS);

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
		const picked = ranked.items.slice(0, limitResults);

		// ---- 3. 展开正文（一次浏览器调用覆盖所有需要渲染的页面）----
		const fetched = await fetchMany(picked.map((p) => p.url), {
			format: 'markdown',
			maxChars: limitPerPage,
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
		const rest = ranked.items.slice(limitResults);
		if (rest.length > 0) {
			const restLines = rest
				.slice(0, 12)
				.map((r) => `- ${r.score === null ? '(未打分)' : r.score.toFixed(1)}  ${r.title} — ${r.url}  ← ${r.engines.join('/')}`);
			sections.push(`## 未展开的候选（按相关性排序）\n\n${restLines.join('\n')}`);
		}

		let content = `${header}\n\n---\n\n${sections.join('\n\n---\n\n')}`;
		let truncated = false;
		if (content.length > SEARCH_TOTAL_CHARS) {
			content = `${content.slice(0, SEARCH_TOTAL_CHARS)}\n\n...(搜索结果过长，已截断。需要更多内容时请用 web_fetch 直接打开链接)`;
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

// task_list_write
const taskListWriteSchema = {
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
export type TaskListWriteArgs = FromSchema<typeof taskListWriteSchema>;
registerTool({
	name: 'task_list_write',
	description:
		'修改任务清单。op 可选：add（追加一条）/ update（改第 index 条，可标记 done）/ remove（删除第 index 条）/ replace（整篇替换）。',
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
	async execute(args: TaskListWriteArgs, ctx) {
		const result = ctx.writeTaskList({
			op: args.op,
			item: args.item,
			index: args.index,
			done: args.done,
			list: args.list,
		});
		return { success: true, content: `任务清单已更新：\n${result || '(空)'}` };
	},
});

// #endregion

// #region 内置工具 —— 编排（实现即调用 Runner 注入的原语）

registerTool({
	name: 'delegate',
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