/**
 * 工具系统 — MindTheGap-Harness
 *
 * 本文件只负责「工具是什么、怎么执行」，不负责「谁来编排」：
 * - 编排类工具（delegate / finish / resume_* / ask_child / ask_user / todo_list_*）的实现就是调用 Runner 注入的编排原语，自己不碰 ctx 的状态机。
 * - `reason` 由工具层统一注入 JSON Schema 的 required，执行前再从 args 里剥离。
 *
 * 能力过滤：AgentDefinition.ability.tools 白名单（工作流）+ 全局安全档位（settings.safety，安全）+ mcpDisabled 策略（见 getToolsForAgentInstance）。
 *
 * 注意：主进程运行时是 Cottontail（JSC），不是 Bun。所以必须用 node:* 系列 API，不能用 Bun.xxx。
 */

import type { AgentCtx, AgentDefinition, AgentInstance, AskUserArgs, LlmTool, ModeDefinition, ToolResult, ToolSafety} from '@shared/agent';
import { isReadonlySafety, normalizeSafety, reviewShellCommand } from '../safety';
import { allBuiltinTools, allDynamicTools, getTool } from './registry';
export * from './registry';

// 内置工具靠模块加载时的 registerTool() 副作用注册；这里只负责让打包器扫到全部模块
import './file';
import './shell';
import './web';
import './todoList';
import './background';
import './orchestration';

// #region 类型

/**
 * 工具执行上下文（即设计稿里的「大 Context」）。
 * 编排原语由 Runner 注入，工具不直接改 ctx。
 */
export interface ToolContext {
	ctx: AgentCtx;
	agentInstanceId: string;
	/**
	 * 模型的工作目录：文件相对路径的基准 + shell 的 cwd。
	 * = 用户指定的工作目录；没指定时 = 本会话的临时工作空间（conversationDir/workspace）。
	 */
	runningDir: string;
	/** 会话目录 = 内务区（ctx.json / requestLog.jsonl / backups/），不是模型的作业区 */
	conversationDir: string;
	reason: string;
	def: AgentDefinition;
	mode: ModeDefinition;
	safety: ToolSafety;
	signal: AbortSignal;
	// ---- 编排原语 ----
	delegate: (agentId: string, task: string) => Promise<ToolResult>;
	finish: (summary: string) => Promise<ToolResult>;
	resumePendingChild: (agentInstanceId: string) => Promise<ToolResult>;
	resumeCompletedChild: (agentInstanceId: string, followUp: string) => Promise<ToolResult>;
	askChild: (agentInstanceId: string, question: string) => Promise<ToolResult>;
	askUser: (q: AskUserArgs) => Promise<ToolResult>;
	readTodoList: () => string;
	writeTodoList: (op: { op: 'add' | 'update' | 'remove' | 'replace'; item?: string; index?: number; done?: boolean; list?: string }) => string;
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
	/** 账本里的用途标签（默认 web_rank；如安全审核传 safety_review） */
	purpose?: string;
}

export interface ToolLlmResult {
	ok: boolean;
	text: string;
	error?: string;
	logId?: string;	// 这次请求的日志 id（工具可以把它放进 structured，界面就能回放这次调用）
}

/**
 * 工具的副作用等级 —— 安全闸门（`service/safety.ts`）按它决定可见性与放行条件。
 * - `read`：不落盘、不起进程（含编排类：delegate / finish / ask_user / todo_list_*）
 * - `write`：改盘（file_write / file_append / file_edit / file_delete / file_rename）
 * - `exec`：可以干任何事（shell）
 * - `unknown`：能力不可判定（MCP 远端工具）
 *
 * ⚠️ 它与 `agent.json` 的 `ability.tools` 名单是**两件事**：名单是「这个角色有哪些工具」（工作流），
 * 这里是「这批工具里带副作用的那部分能不能真跑」（安全）。
 */
export type ToolAccess = 'read' | 'write' | 'exec' | 'unknown';

/** 工具定义 */
export interface AgentTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	/** 副作用等级，见 ToolAccess。缺省按 `unknown` 处理（保守） */
	access: ToolAccess;
	execute: (args: TArgs, ctx: ToolContext) => Promise<ToolResult>;
}

// #endregion

// #region 能力过滤

/**
 * 某个实例可见的工具集合。
 * - 不写 allow = 全部内置（减去 deny）；写了 = 只保留 allow 内且不在 deny 内的
 * - 编排类工具（delegate）在达到 maxDepth 时被移除
 * - MCP 工具按 mcpDisabled 过滤（agent 级优先，否则回退 mode 级，默认开放）
 * - **安全档位再裁一层**（全局 `settings.safety`，由 Runner 传进来）：只读两档只留 `read`，strict 连 `exec` 也不给；
 *   MCP 工具能力不可判定（`unknown`），只读两档一律不给
 *
 * ⚠️ allow / deny 是「这个角色该有哪些工具」（工作流），档位是「带副作用的那部分能不能真跑」，
 *    两层是**叠加**的：先名单、后档位。别把两者混成一个概念。
 */
export function getToolsForAgentInstance(agentInstance: AgentInstance, agentDefinition: AgentDefinition, mode: ModeDefinition, safetyInput: ToolSafety): AgentTool[] {
	// ⚠️ 这两个字段可能是「模式参数引用」（`"[mode.writeTools]"`）：加载期是字符串，
	//    运行时才被 `applyModeVars` 换成数组。这里必须按数组判，别对字符串做 includes / new Set（会退化成字符级）。
	const rawAllow = agentDefinition.ability.tools?.allow as unknown;
	const rawDeny = agentDefinition.ability.tools?.deny as unknown;
	const allow = Array.isArray(rawAllow) ? (rawAllow as string[]) : undefined;
	const deny = new Set(Array.isArray(rawDeny) ? (rawDeny as string[]) : []);
	const depthExhausted = agentInstance.depth >= mode.maxDepth;
	const safety = normalizeSafety(safetyInput);
	const readonly = isReadonlySafety(safety);
	// 只读智能档保留 shell（每次调用过 LLM 审核）；只读严格档连 shell 也不给
	const keepExec = safety === 'readonly-smart';

	// 模式没开待办清单 → 不展示对应工具
	const todoList = mode.todoList;
	const builtin = allBuiltinTools().filter((t) => {
		if (allow && !allow.includes(t.name)) return false;
		if (deny.has(t.name)) return false;
		if (depthExhausted && t.name === 'delegate') return false;
		if (t.name.startsWith('todo_list_') && !todoList?.enabled) return false;
		if (t.name === 'todo_list_write' && !todoList?.writable) return false;
		if (readonly && t.access !== 'read' && !(keepExec && t.access === 'exec')) return false;
		return true;
	});

	const mcpDisabled = agentDefinition.ability.mcpDisabled ?? (mode.mcpDisabled ?? false);
	// 只读两档连 MCP 也不给：远端工具的能力我们无从判定，不能按「只读」放行
	const mcpTools = mcpDisabled || readonly ? [] : allDynamicTools().filter((t) => t.name.startsWith('mcp__'));
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
		reason: { type: 'string', description: '简述你调用这个工具要做什么（描述将用于界面展示和权限审核）' },
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

	// 安全闸门 1：只读档不该出现写盘工具（工具表已经裁过，这里是兜底）
	// ⚠️ 只读智能档保留 shell（exec），它要走下面的审核闸门，这里不能一并拦掉
	const safety = normalizeSafety(ctx.safety);
	const reviewableExec = safety === 'readonly-smart' && tool.access === 'exec';
	if (isReadonlySafety(safety) && tool.access !== 'read' && !reviewableExec) {
		return {
			success: false,
			content: `工具 \`${name}\` 不是只读工具，当前不允许执行。`,
			error: 'SAFETY_DENIED',
			structured: { safety: { verdict: 'deny', policy: safety, reason: '只读档位' } },
		};
	}

	// 安全闸门 2：shell / background_start 在执行前过一遍 LLM 审核（只读智能 / 智能两档；其他档直接放行）
	//   ⚠️ background_start 一样是「跑任意命令」，只是不等它结束 —— 不审等于给了一条绕过审核的后门。
	let shellSafety: Record<string, unknown> | undefined;
	if (name === 'shell' || name === 'background_start') {
		const verdict = await reviewShellCommand(String(rest.command ?? ''), ctx);
		if (verdict.logId) {
			// 审核过的命令（allow / deny 都算）把这次审核的 logId 带进 structured.safety，界面右键工具卡就能回放「审核员看到了什么、回了什么」。
			shellSafety = { verdict: verdict.allow ? 'allow' : 'deny', policy: verdict.policy, reason: verdict.reason, logId: verdict.logId };
		}
		if (!verdict.allow) {
			return {
				success: false,
				content:
					`命令被 AI 安全审核拒绝：${verdict.reason}\n` +
					'尝试换更保守的做法，或带上用户需求作为背景重试，或先用 ask_user 向用户说明你想跑什么。',
				error: 'SAFETY_DENIED',
				structured: { safety: shellSafety ?? { verdict: 'deny', policy: verdict.policy, reason: verdict.reason } },
			};
		}
	}

	try {
		const result = await tool.execute(rest, ctx);
		// 放行也要留痕（否则界面上完全看不出这条命令被审过）
		if (shellSafety) return { ...result, structured: { ...result.structured, safety: shellSafety } };
		return result;
	} catch (err) {
		return {
			success: false,
			content: `Tool "${name}" error: ${(err as Error).message}`,
			error: (err as Error).message,
		};
	}
}

// #endregion
