/* ==========================================================================
   提示词拼接器 — MindTheGap-Harness

   代码里唯一允许出现的提示词逻辑是「拼接」，不是「内容」。
   内容全部来自：prompts/_base.md、prompts/_reflection.md、各 agent 的 prompt.md。

   拼接顺序见 docs/Agent架构-v2设计.md §5。空段自动跳过；
   若最终结果为空白串，则不下发 system message（这是「空」模式的准确落地方式）。

   模板语法（自写，零依赖）：
     {{var}}                       变量替换，未定义 → 空串
     {{#if var}} ... {{/if}}       条件段
     {{#each list}} ... {{/each}}  循环段（{{.}} 取当前项，对象项可直接取字段）
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	AgentDefinition,
	AgentInstance,
	ModeConfigDefaults,
	ModeDefinition,
} from '../../shared/agent';
import { resolvePromptsDir } from '../plugins/loader';

// #region 模板引擎（60 行）

type Scope = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object';
}

/** 支持 `a.b` 逐级取值；`.x` 表示当前循环项 */
function lookupVar(scope: Scope, key: string): unknown {
	if (key === '.') return scope['.'];
	const parts = key.split('.');
	let cur: unknown = scope;
	for (const part of parts) {
		if (isRecord(cur)) {
			cur = cur[part];
		} else {
			return undefined;
		}
	}
	return cur;
}

function truthy(v: unknown): boolean {
	if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

/** 渲染模板。支持 {{var}} / {{#if}} / {{#each}}（不支持嵌套同类型段，模板里也没用到） */
export function renderTemplate(template: string, scope: Scope): string {
	let out = template.replace(
		/\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
		(_m, key: string, body: string) => {
			const list = lookupVar(scope, key);
			if (!Array.isArray(list)) return '';
			return list
				.map((item) =>
					renderTemplate(body, isRecord(item) ? { ...scope, '.': item, ...item } : { ...scope, '.': item }),
				)
				.join('');
		},
	);

	out = out.replace(
		/\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
		(_m, key: string, body: string) => (truthy(lookupVar(scope, key)) ? renderTemplate(body, scope) : ''),
	);

	out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
		const v = lookupVar(scope, key);
		return v === undefined || v === null ? '' : String(v);
	});

	return out;
}

// #endregion

// #region 基座文件

const basePromptCache = new Map<string, string>();

function readPromptsFile(name: string): string {
	const dir = resolvePromptsDir();
	if (!dir) return '';
	const path = join(dir, name);
	const cached = basePromptCache.get(path);
	if (cached !== undefined) return cached;
	let text = '';
	try {
		text = readFileSync(path, 'utf-8');
	} catch {
		text = '';
	}
	basePromptCache.set(path, text);
	return text;
}

/** 插件重载 / 文件变更后清缓存 */
export function clearPromptCache(): void {
	basePromptCache.clear();
}

/** prompts/_base.md 的原始内容（未替换变量） */
export function loadBasePromptTemplate(): string {
	return readPromptsFile('_base.md');
}

/**
 * prompts/_reflection.md —— 反思问题构造器的固定部分。
 * 模式可以用 mode.json 的 `reflectionPromptFile` 指向别处
 * （例如 prompts/daily/_reflection.md 用一套宽松得多的追问口径）。
 */
export function loadReflectionPrompt(fileName = '_reflection.md'): string {
	return readPromptsFile(fileName);
}

// #endregion

// #region 工具的「人话」说明

/**
 * 工具用途标签：拼接器输出的是用途分组说明，不是 JSON Schema 的复制品。
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

function toolUsageLine(name: string, description: string): string {
	const label = TOOL_USAGE[name] ?? description;
	return `- \`${name}\`：${label}`;
}

// #endregion

// #region 拼接上下文

export interface PromptToolInfo {
	name: string;
	description: string;
}

export interface PromptContext {
	agentInstance: AgentInstance;
	def: AgentDefinition;
	mode: ModeDefinition;
	modeConfig: ModeConfigDefaults;
	runningDir: string;
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
	/** 已耗尽的强制收尾指令是否要立刻注入（下一轮直接收尾） */
}

// #endregion

// #region 各段落

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

/** 第 1 段：基座（含运行环境 / 通用原则 / 风险控制 / 输出约定） */
function renderBase(ctx: PromptContext): string {
	if (!ctx.mode.injectBasePrompt) return '';
	const tpl = loadBasePromptTemplate();
	if (!tpl.trim()) return '';
	return renderTemplate(tpl, {
		platform: platformLabel(),
		shell: shellLabel(),
		time: nowLabel(),
		runningDir: ctx.runningDir || '(未指定)',
	});
}

/** 第 4 段：委托规则 */
function renderDelegation(ctx: PromptContext): string {
	const delegatable = (ctx.def.delegatable ?? []).filter((id) => ctx.mode.agents[id]);
	if (delegatable.length === 0) return '';
	const list = delegatable
		.map((id) => `- \`${id}\`（${ctx.mode.agents[id].name}）`)
		.join('\n');
	return `# 你可以委托的 Agent

${list}

委托规则：

- 用 \`delegate\` 工具，参数是 \`tasks: [{ agentId, task }]\`，一次可以提交多条（并行执行）。
- 委托的 \`task\` 必须**自包含**：子 Agent 看不到用户的原话，也看不到你的思考过程。
- 并行的子任务必须彼此独立，不要让两个子 Agent 改同一个文件。
- 委托不会阻塞你：子 Agent 跑完之前你会进入等待，跑完后你被自动唤醒。
- 当前深度 ${ctx.agentInstance.depth} / 最大深度 ${ctx.mode.maxDepth}。`;
}

/**
 * 该实例手里有没有 `finish`。
 * 根实例（如 `intent`）按设计不给 `finish`——它走「不再调用工具即结束」的隐式路径；
 * 完成约定必须跟着实际工具集走，否则模型会去找一个不存在的工具。
 */
function hasFinishTool(ctx: PromptContext): boolean {
	return ctx.tools.some((t) => t.name === 'finish');
}

/** 第 5 段：委托已达上限 */
function renderDepthExhausted(ctx: PromptContext): string {
	const tail = hasFinishTool(ctx)
		? '确实做不完的部分，明确写进 `finish` 的总结里报告未完成的内容与原因。'
		: '确实做不完的部分，直接写进你的正文总结，说明未完成的内容与原因，然后结束本轮。';
	return `# 委托已达上限

你已经到达最大委托深度，**不能再委托任何子 Agent**。

必须在本实例的能力范围内自行完成本次工作；${tail}`;
}

/** 第 6 段：完成约定 */
function renderFinishConvention(ctx: PromptContext): string {
	if (!hasFinishTool(ctx)) {
		return `# 完成约定

- 你没有 \`finish\` 工具：干完活（或确认无法继续）时，**把总结直接写在正文里，并且不再调用任何工具** —— 本轮就此结束。
- 总结里要写：做了什么 / 改动了哪些文件 / 怎么验证的 / 还有什么没完成 / 需要上级决策的事项。
- 需要用户拍板的事就调用 \`ask_user\` 提问，不要替用户决定。`;
	}
	return `# 完成约定

- 干完活（或确认无法继续）时，调用 \`finish\` 工具提交总结，而不是直接把结论写在正文里。
- 总结里要写：做了什么 / 改动了哪些文件 / 怎么验证的 / 还有什么没完成 / 需要上级决策的事项。
- 调用 \`finish\` 之后你这一轮就结束了，不会再有新的输入（除非被父 Agent 重新唤醒）。`;
}

/** 第 7 段：可用工具说明 */
function renderTools(ctx: PromptContext): string {
	if (ctx.tools.length === 0) return '';
	const lines = ctx.tools.map((t) => toolUsageLine(t.name, t.description)).join('\n');
	return `# 你可以使用的工具

${lines}`;
}

/** 第 8 段：工具调用理由要求 */
function renderReasonRequirement(ctx: PromptContext): string {
	if (ctx.tools.length === 0) return '';
	if (ctx.def.ability.requireReason === false) return '';
	return `# 调用理由

每次调用工具都**必须**填 \`reason\` 字段，说明这次调用要做什么。它会展示在界面上给用户看。

- 说明「要做什么 + 为什么」，不要写「执行工具」这种废话。
- 高风险操作（删除 / 覆盖 / 批量改名 / 有写效果的 git 命令）要在 reason 里写清影响面，并先调用 \`ask_user\` 获得用户同意。`;
}

/** 第 11 段：子实例名册 */
function renderChildRoster(ctx: PromptContext): string {
	const children = ctx.childAgentInstances ?? [];
	if (children.length === 0) return '';
	const lines = children
		.map((c) => `- [${c.agentId}] \`${c.agentInstanceId}\`（${c.agentName}）状态=${statusLabel(c.status)}｜任务：${oneLine(c.task)}`)
		.join('\n');
	return `# 你的子 Agent

${lines}`;
}

/** 第 12 段：尚未完成的子 Agent */
function renderUnfinished(ctx: PromptContext): string {
	const list = ctx.unfinishedAgentInstances ?? [];
	if (list.length === 0) return '';
	const lines = list
		.map((c) => `- [${c.agentId}] \`${c.agentInstanceId}\`（${c.agentName}）状态=${statusLabel(c.status)}${c.interruptReason ? `｜原因：${c.interruptReason}` : ''}｜任务：${oneLine(c.task)}`)
		.join('\n');
	return `# 尚未完成的子 Agent

${lines}

你可以用 \`resume_pending_child\` 让它接着干（一次只恢复一个：从直接子实例里挑最深的那个未完成实例）。
已经完成但需要它继续做别的事，用 \`resume_completed_child\` 并附上补充任务。
**不要对同一个子 Agent 反复 resume**——那会造成恢复风暴。`;
}

/** 第 13 段：循环预算 */
function renderBudget(ctx: PromptContext): string {
	const b = ctx.budget;
	if (!b) return '';
	const endNoun = hasFinishTool(ctx) ? '用 `finish` 输出' : '在正文里给出';
	if (b.exhausted) {
		return `# 循环预算已耗尽

总预算与本实例预算都已用尽。**立刻停止一切探索**，${endNoun}当前结论、已完成的部分和未完成项（连同原因）。`;
	}
	if (!b.warn) {
		return `# 循环预算

剩余轮数：总预算 ${b.totalLeft}，本实例 ${b.agentInstanceLeft}。`;
	}
	return `# 循环预算即将耗尽

剩余轮数：总预算 ${b.totalLeft}，本实例 ${b.agentInstanceLeft}。

请**尽快收敛**：停止扩展性探索，把当前进展整理成可交付的结论，${hasFinishTool(ctx) ? '必要时用 `finish` 交还。' : '然后结束本轮。'}`;
}

/** 第 10 段：任务清单 */
function renderTaskList(ctx: PromptContext): string {
	if (!ctx.def.taskListInject) return '';
	const list = (ctx.taskList ?? '').trim();
	if (!list) return '';
	return `# 任务清单（当前）

${list}`;
}

/** 第 14 段：后台任务（占位 —— 本版不实现，恒为空，保留段落位置避免以后加功能时改结构） */
function renderBackgroundTasks(_ctx: PromptContext): string {
	return '';
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

// #endregion

// #region 主入口

/**
 * 拼接某个实例的 system prompt。
 * 返回空串时调用方**不应下发 system message**。
 */
export function assembleSystemPrompt(ctx: PromptContext): string {
	// 「真正空」的判定：没有基座、没有身份提示词、没有工具、没有委托、不注入清单
	const trulyEmpty =
		!ctx.mode.injectBasePrompt &&
		!ctx.def.prompt.trim() &&
		ctx.tools.length === 0 &&
		!ctx.def.taskListInject &&
		(ctx.def.delegatable ?? []).length === 0;
	if (trulyEmpty) return '';

	const sections: string[] = [
		renderBase(ctx),
		ctx.def.prompt.trim(),
		renderParentTask(ctx),
		renderDelegation(ctx),
		ctx.depthExhausted ? renderDepthExhausted(ctx) : '',
		renderFinishConvention(ctx),
		renderTools(ctx),
		renderReasonRequirement(ctx),
		ctx.mcpSection ?? '',
		renderTaskList(ctx),
		renderChildRoster(ctx),
		renderUnfinished(ctx),
		renderBudget(ctx),
		renderBackgroundTasks(ctx),
	];

	return sections
		.map((s) => s.trim())
		.filter(Boolean)
		.join('\n\n---\n\n');
}

/** 第 3 段：父 Agent 下发的任务 */
function renderParentTask(ctx: PromptContext): string {
	const task = (ctx.parentPrompt ?? ctx.agentInstance.task ?? '').trim();
	if (!task) return '';
	if (!ctx.agentInstance.parentAgentInstanceId) {
		// 根实例：task 就是用户的原话，由 messages 里的 user 消息承载
		return '';
	}
	return `# 来自父 Agent 的任务

${task}`;
}

// #endregion
