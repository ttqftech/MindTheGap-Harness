/* ==========================================================================
   提示词模板渲染器 — MindTheGap-Harness

   代码里既没有「提示词内容」，也没有「拼接顺序」：
   每个 Agent 的 `prompt.md` **本身就是**这份 system prompt 的模板 ——写什么、放在哪、要不要放，全部由模板里的占位符决定。

   本文件只做两件事：
     1. `buildPromptScope(ctx)` —— 把运行时状态整理成变量（唯一的作用域出口）；
     2. `renderTemplate()`      —— 渲染模板。

   模板语法（自写，零依赖）：

     {{var}} / {{a.b}} / {{.}}          变量替换，未定义 → 空串
     {{#if var}} … {{else}} … {{/if}}   条件段
     {{#each list}} … {{else}} … {{/each}}  循环段（对象项可直接写字段名，{{.}} 是当前项）
     {{! 单行说明 }}                     注释，不进入输出
     {{!-- 整块说明 --}}                 块注释，**体内可以写 {{ 花括号 }}**（写模板说明用这个）

   标签内允许空格（`{{ #if x }}` ≡ `{{#if x}}`），段可以任意层级嵌套。
   ========================================================================== */

import { join } from 'node:path';
import type { AgentDefinition, AgentInstance, ModeDefinition } from '@shared/agent';

// #region 模板引擎

interface TemplateTextNode {
	kind: 'text';
	value: string;
}

interface TemplateVarNode {
	kind: 'var';
	key: string;
}

interface TemplateSectionNode {
	kind: 'section';
	/** if = 条件段；each = 循环段 */
	mode: 'if' | 'each';
	key: string;
	body: TemplateNode[];
	alt: TemplateNode[] | null;
}

type TemplateNode = TemplateTextNode | TemplateVarNode | TemplateSectionNode;

/** 解析中的段：inAlt 表示「已经过了 {{else}}」 */
interface TemplateFrame {
	node: TemplateSectionNode;
	inAlt: boolean;
}

/** 标签体里不允许出现花括号；md 里要写 `{{` 字面量时请用块注释包起来 */
const TAG_PATTERN = /\{\{([^{}]*)\}\}/g;

const COMMENT_OPEN = '{{!--';
const COMMENT_CLOSE = '--}}';

/**
 * 剥掉块注释 `{{!-- … --}}`（在解析标签之前做，所以体内可以随便写花括号）。
 *
 * 用「配平扫描」而不是正则：注释里再写一对 `{{!-- … --}}`（写语法示例时很自然）不会提前结束。
 * 唯一会吃掉正文的写法是**注释里落了孤立的 `--}}`** —— 那之后的内容会被当成注释直到文件结尾。
 */
function stripBlockComments(template: string): string {
	let out = '';
	let cursor = 0;
	for (;;) {
		const start = template.indexOf(COMMENT_OPEN, cursor);
		if (start < 0) return out + template.slice(cursor);
		out += template.slice(cursor, start);
		let depth = 1;
		let scan = start + COMMENT_OPEN.length;
		while (depth > 0) {
			const nextOpen = template.indexOf(COMMENT_OPEN, scan);
			const nextClose = template.indexOf(COMMENT_CLOSE, scan);
			if (nextClose < 0) {
				scan = template.length;			// 没闭合：一直吃到结尾
				break;
			}
			if (nextOpen >= 0 && nextOpen < nextClose) {
				depth += 1;
				scan = nextOpen + COMMENT_OPEN.length;
				continue;
			}
			depth -= 1;
			scan = nextClose + COMMENT_CLOSE.length;
		}
		cursor = scan;
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object';
}

/**
 * 解析成节点树。
 * md 写坏了（段没闭合、多余的结束标签）不抛错：未闭合的段按已解析的内容收尾。
 */
function parseTemplate(template: string): TemplateNode[] {
	const root: TemplateNode[] = [];
	const stack: TemplateFrame[] = [];

	const append = (node: TemplateNode): void => {
		const frame = stack[stack.length - 1];
		if (!frame) {
			root.push(node);
			return;
		}
		if (frame.inAlt) {
			if (!frame.node.alt) frame.node.alt = [];
			frame.node.alt.push(node);
			return;
		}
		frame.node.body.push(node);
	};

	const tagRe = new RegExp(TAG_PATTERN.source, 'g');
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = tagRe.exec(template))) {
		if (match.index > cursor) append({ kind: 'text', value: template.slice(cursor, match.index) });
		cursor = match.index + match[0].length;

		const tag = match[1].trim();
		if (!tag || tag.startsWith('!')) continue;				// 空标签 / 注释
		if (tag === 'else') {
			const frame = stack[stack.length - 1];
			if (frame) frame.inAlt = true;
			continue;
		}
		if (tag.startsWith('/')) {						// 段结束
			const frame = stack.pop();
			if (frame) append(frame.node);
			continue;
		}
		if (tag.startsWith('#')) {						// 段开始：{{#if x}} / {{#each x}}
			const key = tag.replace(/^#(?:each|if)\s*/, '').trim();
			stack.push({
				node: { kind: 'section', mode: tag.startsWith('#each') ? 'each' : 'if', key, body: [], alt: null },
				inAlt: false,
			});
			continue;
		}
		append({ kind: 'var', key: tag });
	}
	if (cursor < template.length) append({ kind: 'text', value: template.slice(cursor) });

	while (stack.length > 0) {
		const frame = stack.pop() as TemplateFrame;
		append(frame.node);
	}
	return root;
}

/** 支持 `a.b` 逐级取值；`.` 表示当前循环项 */
function lookupVar(scope: Record<string, unknown>, key: string): unknown {
	if (key === '.') return scope['.'];
	let cur: unknown = scope;
	for (const part of key.split('.')) {
		if (!isRecord(cur)) return undefined;
		cur = cur[part];
	}
	return cur;
}

function truthy(v: unknown): boolean {
	if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

function stringify(v: unknown): string {
	if (v === undefined || v === null) return '';
	if (Array.isArray(v)) return v.map(stringify).filter(Boolean).join('\n');
	if (isRecord(v)) return JSON.stringify(v);
	return String(v);
}

/** 循环项的局部作用域：对象项把字段摊平，同时用 `.` 指向整项 */
function itemScope(scope: Record<string, unknown>, item: unknown): Record<string, unknown> {
	return isRecord(item) ? { ...scope, '.': item, ...item } : { ...scope, '.': item };
}

function renderNodes(nodes: TemplateNode[], scope: Record<string, unknown>): string {
	let out = '';
	for (const node of nodes) {
		if (node.kind === 'text') {
			out += node.value;
			continue;
		}
		if (node.kind === 'var') {
			out += stringify(lookupVar(scope, node.key));
			continue;
		}
		const value = lookupVar(scope, node.key);
		if (node.mode === 'if') {
			if (truthy(value)) out += renderNodes(node.body, scope);
			else if (node.alt) out += renderNodes(node.alt, scope);
			continue;
		}
		if (Array.isArray(value) && value.length > 0) {
			for (const item of value) out += renderNodes(node.body, itemScope(scope, item));
		} else if (node.alt) {
			out += renderNodes(node.alt, scope);
		}
	}
	return out;
}

/** 渲染模板（模板解析不缓存：每轮 agentLoop 只有个位数 KB，开销可忽略） */
export function renderTemplate(template: string, scope: Record<string, unknown>): string {
	return renderNodes(parseTemplate(stripBlockComments(template)), scope);
}

// #endregion

// #region 作用域

export interface PromptToolInfo {
	name: string;
	description: string;
}

export interface PromptContext {
	agentInstance: AgentInstance;
	def: AgentDefinition;
	mode: ModeDefinition;
	/** 基座提示词（settings.basePrompt，由调用方传入；模板里不写 `{{ basePrompt }}` 就不进入 system prompt） */
	basePrompt: string;
	runningDir: string;
	/** 会话目录（workspace / docs / backups 的根）。缺省时对应变量为空串 */
	conversationDir?: string;
	/** 该实例实际可见的工具（已按白名单过滤） */
	tools: PromptToolInfo[];
	/** 父 Agent 传入的提示词（task + 可能的 followUp） */
	parentPrompt?: string;
	/** 该实例的完整子实例名册（有子时才有） */
	childAgentInstances?: AgentInstance[];
	/** 尚未完成的子实例 */
	unfinishedAgentInstances?: AgentInstance[];
	/** 循环预算剩余 */
	budget?: { totalLeft: number; agentInstanceLeft: number; warn: boolean; exhausted: boolean };
	/** 委托是否已达最大深度 */
	depthExhausted?: boolean;
	taskList?: string;
	/** MCP 外部工具说明（按策略过滤后的） */
	mcpSection?: string;
}

/**
 * 工具清单里的「人话说明」：模板输出的是一行用途，不是 JSON Schema 的复制品。
 * 未登记的工具（MCP / 动态源）退回自己的 description。
 */
const TOOL_USAGE: Record<string, string> = {
	file_read: '读取文件内容（支持 offset/limit 分段）',
	file_list: '列出目录内容',
	file_search: '按关键词 / 正则搜索文件内容',
	file_write: '写入文件（覆盖，不存在则创建）',
	file_edit: '按行号区间替换文件内容',
	file_create: '创建新文件',
	file_delete: '删除文件',
	file_rename: '重命名 / 移动文件（高风险操作请先 ask_user）',
	bash: '执行 shell 命令（Windows / cmd.exe 兼容）',
	web_search: '多引擎网络搜索：合并各引擎候选 → 独立模型按相关性打分 → 直接返回最相关页面的正文',
	web_fetch: '抓取一个 URL 的正文（先 HTTP 直取，页面是 JS 空壳时自动改用无头浏览器渲染）',
	task_list_read: '读取当前任务清单',
	task_list_write: '增删改任务清单',
	delegate: '把子任务委托给其他 Agent（可一次委托多条，并行执行）',
	finish: '提交本次工作的总结，结束你这一轮',
	resume_pending_child: '恢复一个被中断 / 挂起的子 Agent',
	resume_completed_child: '重新唤醒一个已完成的子 Agent，让它接着做',
	ask_child: '向某个子 Agent 提问（只读它已有的记录，不改变它的状态）',
	ask_user: '向用户提问并等待回答（会暂停你的进程，用户回答后继续）',
};

function platformLabel(): string {
	const p = process.platform;
	if (p === 'win32') return 'Windows';
	if (p === 'darwin') return 'macOS';
	return 'Linux';
}

function shellLabel(): string {
	return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
}

function nowLabel(): string {
	try {
		return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
	} catch {
		return new Date().toISOString();
	}
}

function statusLabel(status: AgentInstance['status']): string {
	switch (status) {
		case 'running': return '运行中';
		case 'pending': return '等待中';
		case 'succeeded': return '已完成';
		case 'failed': return '已失败';
		case 'interrupted': return '已中断';
		default: return String(status);
	}
}

function oneLine(text?: string): string {
	if (!text) return '(未说明)';
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/** 子实例在模板里的形状（名册 / 未完成清单共用） */
function childEntry(agentInstance: AgentInstance): Record<string, unknown> {
	return {
		agentInstanceId: agentInstance.agentInstanceId,
		agentId: agentInstance.agentId,
		agentName: agentInstance.agentName,
		depth: agentInstance.depth,
		status: agentInstance.status,
		statusLabel: statusLabel(agentInstance.status),
		taskLine: oneLine(agentInstance.task),
		interruptReason: agentInstance.interruptReason ?? '',
	};
}

/** 会话目录下的几个固定子目录（模板里可以直接给 md 用绝对路径） */
function conversationDirs(conversationDir: string): Record<string, string> {
	if (!conversationDir) return { conversationDir: '', workspaceDir: '', docsDir: '', backupsDir: '', tmpDir: '' };
	return {
		conversationDir,
		workspaceDir: join(conversationDir, 'workspace'),
		docsDir: join(conversationDir, 'workspace', 'docs'),
		backupsDir: join(conversationDir, 'workspace', 'backups'),
		tmpDir: join(conversationDir, 'workspace', 'tmp'),
	};
}

/**
 * 模板里可见的**全部**变量 —— 这是提示词与运行时之间唯一的接口。
 * 加变量只改这里，md 里用不用由模板作者决定。
 *
 * | 变量 | 说明 |
 * | --- | --- |
 * | `agentId` `agentName` `agentInstanceId` | 本实例是谁 |
 * | `modeId` `modeName` `depth` `maxDepth` | 所处模式与层级 |
 * | `isRoot` `isSubAgent` `parentAgentInstanceId` | 树上位置（根实例没有父任务） |
 * | `platform` `shell` `time` `runningDir` | 运行环境 |
 * | `conversationDir` `workspaceDir` `docsDir` `backupsDir` `tmpDir` | 会话目录（由调用方传入，缺省为空串） |
 * | `basePrompt` | 基座提示词正文（**模板里不写这个占位符就不会出现在 system prompt 里**） |
 * | `parentPrompt` `hasParentPrompt` | 父 Agent 下发的任务 |
 * | `tools` `hasTools` `hasTool` | 工具清单（`hasTool.finish` / `hasTool.delegate` …） |
 * | `delegatableAgents` `canDelegate` `depthExhausted` | 委托能力 |
 * | `taskList` `hasTaskList` `taskListEnabled` | 任务清单 |
 * | `children` `hasChildren` | 子实例名册 |
 * | `unfinished` `hasUnfinished` | 尚未完成的子实例（含 `interruptReason`） |
 * | `hasBudget` `budgetTotalLeft` `budgetAgentInstanceLeft` `budgetWarn` `budgetExhausted` | 循环预算 |
 * | `mcpSection` `hasMcp` | MCP 外部工具说明 |
 * | `backgroundTasks` `hasBackgroundTasks` | 后台任务（占位，恒空 / 恒 false） |
 *
 * `children` / `unfinished` 的每一项：`agentInstanceId` `agentId` `agentName` `depth`
 * `status` `statusLabel` `taskLine` `interruptReason`。
 */
export function buildPromptScope(ctx: PromptContext): Record<string, unknown> {
	const agentInstance = ctx.agentInstance;
	const tools = ctx.tools.map((t) => ({ name: t.name, description: TOOL_USAGE[t.name] ?? t.description }));
	const delegatableAgents = (ctx.def.delegatable ?? [])
		.filter((id) => ctx.mode.agents[id])
		.map((id) => ({ id, name: ctx.mode.agents[id].name }));
	const children = (ctx.childAgentInstances ?? []).map(childEntry);
	const unfinished = (ctx.unfinishedAgentInstances ?? []).map(childEntry);
	const budget = ctx.budget;
	const taskList = (ctx.taskList ?? '').trim();
	const mcpSection = (ctx.mcpSection ?? '').trim();
	const isSubAgent = !!agentInstance.parentAgentInstanceId;
	// 根实例的 task 就是用户的原话（由 messages 里的 user 消息承载），不在 system prompt 里重复
	const parentPrompt = isSubAgent ? (ctx.parentPrompt ?? agentInstance.task ?? '').trim() : '';

	const scope: Record<string, unknown> = {
		// 身份 / 位置
		agentId: agentInstance.agentId,
		agentName: agentInstance.agentName,
		agentInstanceId: agentInstance.agentInstanceId,
		modeId: ctx.mode.id,
		modeName: ctx.mode.name,
		depth: agentInstance.depth,
		maxDepth: ctx.mode.maxDepth,
		isRoot: !isSubAgent,
		isSubAgent,
		parentAgentInstanceId: agentInstance.parentAgentInstanceId ?? '',

		// 运行环境
		platform: platformLabel(),
		shell: shellLabel(),
		time: nowLabel(),
		runningDir: ctx.runningDir || '(未指定)',
		...conversationDirs(ctx.conversationDir ?? ''),

		// 基座（先占位，最后再渲染，避免自引用）
		basePrompt: '',

		// 父 Agent 下发的任务
		parentPrompt,
		hasParentPrompt: !!parentPrompt,

		// 工具
		tools,
		hasTools: tools.length > 0,
		hasTool: Object.fromEntries(tools.map((t) => [t.name, true])),

		// 委托
		delegatableAgents,
		canDelegate: delegatableAgents.length > 0,
		depthExhausted: !!ctx.depthExhausted,

		// 任务清单
		taskList,
		hasTaskList: !!taskList,
		taskListEnabled: !!ctx.mode.taskList?.enabled,

		// 子实例
		children,
		hasChildren: children.length > 0,
		unfinished,
		hasUnfinished: unfinished.length > 0,

		// 循环预算
		hasBudget: !!budget,
		budgetTotalLeft: budget?.totalLeft ?? 0,
		budgetAgentInstanceLeft: budget?.agentInstanceLeft ?? 0,
		budgetWarn: !!budget?.warn,
		budgetExhausted: !!budget?.exhausted,

		// MCP
		mcpSection,
		hasMcp: !!mcpSection,

		// 后台任务（本版不实现，保留变量位置）
		backgroundTasks: [],
		hasBackgroundTasks: false,
	};

	// 基座自己也可以带 {{platform}} / {{time}} 之类的变量：
	// 用当前作用域再渲染一遍。此刻 scope.basePrompt 还是空串，所以基座里写 {{ basePrompt }}
	// 不会自引用。要不要把基座放进 system prompt，由 prompt.md 里有没有 {{ basePrompt }} 决定。
	scope.basePrompt = renderTemplate(ctx.basePrompt ?? '', scope).trim();
	return scope;
}

// #endregion

// #region 主入口

/**
 * 渲染某个实例的 system prompt：**模板就是该 Agent 的 `prompt.md`**。
 * 返回空串时调用方**不应下发 system message**（「空」模式的 prompt.md 就是空的）。
 *
 * 最后会把连续 3 个以上的换行压成 2 个 —— md 里的 `{{#if}}` / `{{#each}}` 独占一行时
 * 难免留下多余空行，压一下省 token 也省得作者为了排版去抠标签位置。
 */
export function renderSystemPrompt(ctx: PromptContext): string {
	const template = ctx.def.prompt ?? '';
	if (!template.trim()) return '';
	return renderTemplate(template, buildPromptScope(ctx))
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// #endregion
