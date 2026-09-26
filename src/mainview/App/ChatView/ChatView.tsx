/* ==========================================================================
   主聊天视图 — MindTheGap-Harness

   渲染模型（2026-09-14 重构后）：
   - 界面内容 = `foldCtxToRenderTree(mergeOverlayCtx(ctx, overlay))`，**不再有 UI 消息**
   - ctx 是唯一真相（后端 Runner 写）；overlay 是组件内的「在飞」增量（SSE 翻译成 ctx 形状的条目）
   - **一次 LLM 调用 = 一个块**（`RenderLlmBlock`）：思考 / 正文 / 各次工具调用都是它的**子块**，工具结果贴在对应调用处（不单独成块），账本（usages）贴在块的下方
   - 子 Agent 不再靠 depth 缩进：委托工具的**子块**下面同级挂它的节点，一个实例 = 一个可整块折叠的块
   - ask_user 走 client_tool_call：渲染提问卡片，回答后 POST /api/agent/answer 续接

   设计稿：docs/设计-ctx唯一真相与动态投影.md（§5.3 是 SSE → 条目的翻译表）
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { MenuItem } from 'ffbox-ui';
import { state as appState, actions, getActiveConversation, getProviderById, loadConversationCtx, refreshConversationMeta } from '@mainview/store';
import type { ModelConfig } from '@shared/agent';
import { createEmptyOverlay, diffRenderTree, foldCtxToRenderTree, mergeOverlayCtx } from '@mainview/projection';
import type { OverlayCtx, RenderAgentNode, RenderAskInfo, RenderBlock, RenderSubBlock, RenderToolSub } from '@mainview/projection';
import * as agentBridge from '@mainview/agentBridge';
import type { AgentInstanceMessage, AgentStreamEvent, ToolResult, UsageEntry } from '@shared/agent';
import { requestFolderPath, getGitInfo, type GitInfo } from '@mainview/localBridge';
import { mirrorRunning, registerStop } from '@mainview/runState';
import { folderLabel, sameFolderPath } from '@shared/utils';
import { alertMsgbox, showMenu } from '@mainview/ffboxBridge';
import DiagramView from './DiagramView';
import styles from './ChatView.module.css';

// #region 图标

/** 上下文标记（运行文件夹）用的小目录图标 */
function FolderChipIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		</svg>
	);
}

/** 反思卡片的图标：一个带靶心的圆 */
function ReflectionIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.2">
			<circle cx="6.5" cy="6.5" r="5.1" />
			<circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

/** MCP 服务图标：两层「服务器」+ 中间一根连线 */
function McpIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1">
			<rect x="1.6" y="1.8" width="8.8" height="3.2" rx="1" />
			<rect x="1.6" y="7" width="8.8" height="3.2" rx="1" />
			<line x1="3.8" y1="3.4" x2="3.8" y2="8.6" />
		</svg>
	);
}

function SendIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<line x1="22" y1="2" x2="11" y2="13"/>
			<polygon points="22 2 15 22 11 13 2 9 22 2"/>
		</svg>
	);
}

function StopIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
			<rect x="6" y="6" width="12" height="12" rx="2"/>
		</svg>
	);
}

function SparkleIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>
		</svg>
	);
}

// #endregion

// #region 常量

/* 工具入参 / 输出的展示上限：「透明」不等于「无上限」：一条 web_search 的结果动辄几万字符，
   全量渲染会把界面卡死。截断是**渲染层**的事——投影本身给全文，完整内容始终在 ctx 里。 */
const TOOL_ARGS_LIMIT = 1500;
const TOOL_OUTPUT_LIMIT = 8000;

/** LLM 用途 → 中文标签。账本里的 purpose 是内部枚举，直接显示用户看不懂 */
const PURPOSE_LABEL: Record<string, string> = {
	agent_loop: '主循环',
	reflection: '反思',
	ask_child: '询问子 Agent',
	web_rank: '搜索结果打分',
	other: '其他',
};

/** 实例状态 → 中文标签 */
const STATUS_LABEL: Record<string, string> = {
	running: '进行中',
	pending: '等待中',
	succeeded: '已完成',
	failed: '失败',
	interrupted: '已中断',
};

/**
 * mock 开着时允许没有配置 provider：这份占位配置只是让请求能发出去，
 * 后端会把 baseUrl / apiFormat 覆盖成内置 mock 的（见 `bun/llm/model.ts` 的 mockResolver）。
 */
const MOCK_PLACEHOLDER_MODEL: ModelConfig = {
	providerId: 'mock',
	modelId: 'mock',
	apiFormat: 'openai-chat',
	baseUrl: '',
	apiKey: 'mock',
	customParams: {},
};

// #endregion

// #region 工具函数

/** 截断到 limit（用于显示） */
function truncateWithNote(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = text.slice(0, Math.floor(limit * 0.8));
	const tail = text.slice(-Math.floor(limit * 0.2));
	return `${head}\n\n…（已省略 ${text.length - head.length - tail.length} 字符）\n\n${tail}`;
}

/** 1234 → "1.2k"：账本里数字位数差别很大，统一压成短形式才不会把一行撑爆 */
function fmtTokens(n?: number): string {
	if (n === undefined || n === null) return '?';
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(2)}k`;
	if (n < 100000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
}

function fmtDuration(ms?: number): string {
	if (!ms && ms !== 0) return '';
	return ms < 100 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 字节数 → "1.2 KB" / "820 B"（MCP 卡的响应行要显示体量） */
function fmtSize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	return `${(bytes / 1000).toFixed(1)} KB`;
}

/**
 * MCP 工具的命名是 `mcp__<server>__<tool>`（见 `tools.ts` 的注册约定）。
 * 拆开是为了让 MCP 调用按设计稿渲染成「服务名 + 方法」两段。
 */
function parseMcpName(name: string): { server: string; method: string } | null {
	if (!name.startsWith('mcp__')) return null;
	const rest = name.slice(5);
	const sep = rest.indexOf('__');
	if (sep <= 0) return null;
	return { server: rest.slice(0, sep), method: rest.slice(sep + 2) };
}

// #endregion

// #region SSE → 在飞 overlay

/**
 * 把一条 SSE 事件翻译成「ctx 形状」的在飞条目（翻译表见设计稿 §5.3）。
 *
 * ⚠️ overlay 必须与 ctx 同形状（实例 → 条目），否则子 Agent 的在飞内容就没法嵌进上级的
 * delegate 块里，只能再写一套拼树逻辑 —— 那正是旧设计病根的复现。
 */
function applyEvent(draft: OverlayCtx, event: AgentStreamEvent): void {
	const getInstanceMessagesByIdSafe = (instanceId: string) => {
		if (!draft.instances[instanceId]) draft.instances[instanceId] = { messages: [] };
		return draft.instances[instanceId]!.messages;
	};

	/**
	 * 取「当前正在写」的 assistant 条目，通常是最后一条，根据尾部情况决定是否另起一条
	 */
	const assistantEntry = (instanceId: string, kind: 'text' | 'toolCall'): AgentInstanceMessage => {
		const messages = getInstanceMessagesByIdSafe(instanceId);
		const tail = messages[messages.length - 1];
		if (tail?.role === 'assistant') {
			if (kind === 'toolCall') return tail;
			if (!tail.toolCalls?.length) return tail;
		}
		// 尾部不是 assistant 消息，另起一条
		messages.push({ role: 'assistant', content: '', updatedAt: Date.now() });
		return messages[messages.length - 1]!;
	};

	/**
	 * 工具结果按 callId 写（后到的覆盖先到的）。
	 *
	 * 同一个 callId 会来两次：`delegate` / `resume_*` 先发「占位」，等子实例全部终态后再来一次「终态」；
	 * 其余工具只来一次。两次都走同一条「有则改、无则建」的分支，不必区分谁是谁。
	 *
	 * ⚠️ **「无则建」是正常路径，不是异常**：`tool_start` 只往 assistant 条目上挂了 `toolCalls`，overlay 里
	 *    并没有对应的 `role:'tool'` 条目，所以第一次 `tool_end` 一定是「找不到」。
	 *    早先这里写的是「找不到就抛错」，而 SSE 回调外面还有一层 try/catch（`agentBridge.subscribeStream`）
	 *    把异常原样吞掉 —— 于是每条工具结果都在翻译时被丢掉，工具行一直停在「执行中…」，
	 *    直到整轮跑完重拉 ctx（ctx 里有完整结果）才显示出来，界面上还不留任何报错。（2026-09-15）
	 */
	const upsertToolResult = (id: string, event: Extract<AgentStreamEvent, { type: 'tool_end' }>) => {
		function toolOutputText(result: ToolResult): string {
			const body = result.content ?? '';
			if (!result.success) {
				return `[工具执行失败] ${result.error ? `${result.error}\n${body}` : body}`.trim();
			}
			return body;
		}

		const messages = getInstanceMessagesByIdSafe(id);
		const content = toolOutputText(event.result);
		const data = { success: event.result.success, structured: event.result.structured, error: event.result.error };
		const existing = messages.find((m) => m.role === 'tool' && m.toolCallId === event.callId);
		if (existing) {
			existing.content = content;
			existing.kind = 'tool_result';
			existing.data = data;
			existing.updatedAt = Date.now();
		} else {
			messages.push({
				role: 'tool',
				content,
				toolCallId: event.callId,
				kind: 'tool_result',
				data,
				updatedAt: Date.now(),
			});
		}
	};

	// done / error 已在 handleStreamEvent 里提前返回，但这里仍要防一手类型（它们没有 agentInstanceId）
	const instanceId = 'agentInstanceId' in event ? event.agentInstanceId ?? '' : '';
	switch (event.type) {
		case 'agent_start': {
			getInstanceMessagesByIdSafe(instanceId);
			draft.meta[instanceId] = {
				agentInstanceId: instanceId,
				agentId: event.agentId,
				agentName: event.agentName,
				parentAgentInstanceId: event.parentAgentInstanceId,
				depth: event.depth,
				status: 'running',
				task: event.task,
				startedAt: Date.now(),
			};
			if (!event.parentAgentInstanceId) draft.rootAgentInstanceId = instanceId;
			// 首条 user 条目 = 该实例的任务（与 ctx 里的形态一致）
			getInstanceMessagesByIdSafe(instanceId).push({
				role: 'user',
				content: event.parentAgentInstanceId ? `[来自父 Agent 的任务]\n${event.task ?? ''}` : (event.task ?? ''),
				updatedAt: Date.now(),
			});
			break;
		}
		case 'text': {
			const entry = assistantEntry(instanceId, 'text');
			entry.content += event.chunk;
			entry.updatedAt = Date.now();
			break;
		}
		case 'reasoning': {
			const entry = assistantEntry(instanceId, 'text');
			entry.reasoningContent = (entry.reasoningContent ?? '') + event.chunk;
			entry.updatedAt = Date.now();
			break;
		}
		case 'tool_start': {
			const entry = assistantEntry(instanceId, 'toolCall');
			if (!entry.toolCalls) entry.toolCalls = [];
			entry.toolCalls.push({
				id: event.callId,
				type: 'function',
				function: { name: event.toolName, arguments: JSON.stringify(event.args ?? {}) },
			});
			entry.updatedAt = Date.now();
			break;
		}
		case 'tool_end': {
			// ask_user 的「工具块」不渲染（它渲染成提问卡片），所以不必进 overlay
			if (event.toolName !== 'ask_user') upsertToolResult(instanceId, event);
			break;
		}
		case 'usage': {
			// 只记单次调用（scope='call'）；agentLoop 的「本段小计」是派生值，不落任何一处。
			if (event.scope === 'loop') break;
			const data: UsageEntry = {
				seq: event.seq ?? 0,
				round: event.round,
				purpose: event.purpose ?? 'agent_loop',
				model: event.model ?? '',
				logId: event.logId,
				input: event.tokens.input,
				output: event.tokens.output,
				cached: event.tokens.inputCached,
				total: event.tokens.total,
				durationMs: event.durationMs ?? 0,
			};
			const messages = getInstanceMessagesByIdSafe(instanceId);
			if (event.purpose === 'reflection') {
				const refl = messages.findLast((m) => m.kind === 'reflection');
				if (refl) {
					refl.usages = [...(refl.usages ?? []), data];
					refl.updatedAt = Date.now();
					break;
				}
			}
			const entry = assistantEntry(instanceId, 'text');
			entry.usages = [...(entry.usages ?? []), data];
			entry.updatedAt = Date.now();
			break;
		}
		case 'reflection_start': {
			const messages = getInstanceMessagesByIdSafe(instanceId);
			messages.push({
				role: 'system',
				content: '',
				uiOnly: true,
				kind: 'reflection',
				data: { remaining: event.remaining },
				updatedAt: Date.now(),
			});
			break;
		}
		case 'reflection_chunk': {
			const messages = getInstanceMessagesByIdSafe(instanceId);
			const refl = messages.findLast((m) => m.kind === 'reflection');
			if (refl) {
				refl.content += event.chunk;
				refl.updatedAt = Date.now();
			}
			break;
		}
		case 'client_tool_call': {
			getInstanceMessagesByIdSafe(instanceId).push({
				role: 'system',
				content: '',
				uiOnly: true,
				kind: 'ask_user_state',
				data: { callId: event.callId, status: 'waiting' },
				updatedAt: Date.now(),
			});
			break;
		}
		case 'agent_end': {
			const meta = draft.meta[instanceId];
			if (meta) meta.status = event.status;
			break;
		}
		default:
			break;
	}
}

// #endregion

// #region ask_user 组件

/**
 * 提问卡片：序号选项（可按数字键选）+ 自由输入 +「还有什么要补充的吗？」+ 提交 / 跳过本轮。
 * 等待期间右上角显示已阻塞多久 —— 数据是前端自己数出来的，不依赖后端。
 */
function AskUserCard(props: { block: RenderAskInfo; onSubmit: (text: string) => void }) {
	const [choice, setChoice] = createSignal<string | null>(null);
	const [extra, setExtra] = createSignal('');
	const [freeText, setFreeText] = createSignal('');
	const [elapsed, setElapsed] = createSignal(0);
	const answered = () => props.block.status !== 'waiting';
	const options = () => props.block.options;

	// 阻塞计时：只在等待时走
	const timer = setInterval(() => {
		if (!answered()) setElapsed((v) => v + 1);
	}, 1000);
	onCleanup(() => clearInterval(timer));

	const elapsedText = () => {
		const total = elapsed();
		const mm = String(Math.floor(total / 60)).padStart(2, '0');
		const ss = String(total % 60).padStart(2, '0');
		return `阻塞中 ${mm}:${ss}`;
	};

	const submit = () => {
		const parts: string[] = [];
		if (choice()) parts.push(`选择：${choice()}`);
		if (freeText().trim()) parts.push(freeText().trim());
		if (extra().trim()) parts.push(`补充：${extra().trim()}`);
		props.onSubmit(parts.join('\n') || '(未填写内容)');
	};

	// 数字键直接选第 N 项（设计稿「按 1 / 2 选择」）。只在等待中生效，且不抢输入框里的数字。
	const onKeyDown = (e: KeyboardEvent) => {
		if (answered()) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
		const n = Number(e.key);
		if (!Number.isInteger(n) || n < 1 || n > options().length) return;
		e.preventDefault();
		setChoice(options()[n - 1].label);
	};

	onMount(() => {
		window.addEventListener('keydown', onKeyDown);
	});
	onCleanup(() => window.removeEventListener('keydown', onKeyDown));

	return (
		<div class={styles['ask-card']} classList={{ [styles['is-answered']]: answered() }}>
			<div class={styles['ask-card-head']}>
				<span class={styles['ask-card-icon']}>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
						<path d="M4.3 4.4a1.7 1.7 0 1 1 2.2 1.9c-.4.15-.6.5-.6.9v.3" />
						<circle cx="6" cy="9.4" r="0.7" fill="currentColor" stroke="none" />
					</svg>
				</span>
				<span class={styles['ask-card-title']}>需要你的确认</span>
				<Show when={!answered()}>
					<span class={styles['ask-card-timer']}>{elapsedText()}</span>
				</Show>
			</div>

			<div class={styles['ask-card-question']}>{props.block.question}</div>

			<Show when={!answered()}>
				<Show when={options().length > 0}>
					<div class={styles['ask-card-options']}>
						<For each={options()}>
							{(opt, index) => (
								<button
									class={styles['ask-card-option']}
									classList={{ [styles['is-picked']]: choice() === opt.label }}
									onclick={() => setChoice(opt.label)}
								>
									<span class={styles['ask-card-option-index']}>{index() + 1}</span>
									<span class={styles['ask-card-option-label']}>{opt.label}</span>
									<Show when={opt.description}>
										<span class={styles['ask-card-option-desc']}>{opt.description}</span>
									</Show>
								</button>
							)}
						</For>
					</div>
				</Show>

				{/* 自由输入常驻：选项之外总能自己写一句（设计稿的「其它数值直接输入」） */}
				<textarea
					class={styles['ask-card-input']}
					placeholder="或直接输入你的回答..."
					rows={2}
					value={freeText()}
					oninput={(e) => setFreeText(e.currentTarget.value)}
				/>

				<div class={styles['ask-card-extra-label']}>还有什么要补充的吗？（可留空）</div>
				<textarea
					class={styles['ask-card-input']}
					placeholder="补充说明会一起交给 Agent。"
					rows={2}
					value={extra()}
					oninput={(e) => setExtra(e.currentTarget.value)}
				/>

				<div class={styles['ask-card-foot']}>
					<span class={styles['ask-card-hint']}>
						{options().length > 0 ? `按 1 - ${options().length} 选择 · 也可以直接输入` : '直接输入回答 · esc 跳过本轮'}
					</span>
					<span class={styles['ask-card-foot-spacer']} />
					<button class={styles['ask-card-submit']} onclick={submit}>
						提交
					</button>
					<button class={styles['ask-card-skip']} onclick={() => props.onSubmit('用户已跳过此提问')}>
						跳过本轮
					</button>
				</div>
			</Show>

			<Show when={answered()}>
				<div class={styles['ask-card-answer']}>{props.block.answer}</div>
			</Show>
		</div>
	);
}

// #endregion

// #region 主组件

export default function ChatView() {
	const [inputText, setInputText] = createSignal('');
	const [isGenerating, setIsGenerating] = createSignal(false);
	const [runError, setRunError] = createSignal<string | null>(null);	// 本轮 run 的即时错误（重拉 ctx 后由实例的 interruptReason 接管显示）
	const [taskList, setTaskList] = createSignal('');	// 任务清单面板
	const [taskListOpen, setTaskListOpen] = createSignal(false);
	const [overlay, setOverlay] = createStore<OverlayCtx>(createEmptyOverlay());	// 在飞 overlay：SSE 事件翻译成的「ctx 形状的增量」
	const [streamTick, setStreamTick] = createSignal(0);	// 流式期间的滚动触发（overlay 是 store，深度访问不好追踪，用一个计数器带一下）
	let unsubscribeFn: (() => void) | null = null;	// 取消订阅函数

	/** 界面内容：已提交的 ctx + 在飞的 overlay，共用同一个投影函数 */
	const ENABLE_RENDER_TREE_DIFF = false;
	let prevTree: RenderAgentNode | null = null;
	const renderTree = createMemo(() => {
		const conversation = getActiveConversation();
		streamTick();
		// overlay 只属于**它正在跑的那个会话**：切走之后不能再拿它去合成别的会话，
		// 否则「上一轮还在跑的时候点了新建会话」会把上一个会话的在飞内容搬进新会话（看起来就像「没切过去、还停在那条会话上」）。
		const overlayForActive = overlay.conversationId === appState.activeConversationId ? overlay : undefined;
		const newTree = foldCtxToRenderTree(mergeOverlayCtx(conversation?.agentCtx, overlayForActive));
		const result = ENABLE_RENDER_TREE_DIFF ? diffRenderTree(prevTree, newTree) : newTree;
		prevTree = result;
		return result;
	});

	// #region 显示文本

	const currentModelDisplay = () => {
		const ref = appState.currentStandardModel;
		if (!ref) return '未选择模型';
		const provider = getProviderById(ref.providerId);
		const model = provider?.models.find((m) => m.id === ref.modelId);
		if (!provider || !model) return '未选择模型';
		return `${provider.name} / ${model.displayName}`;
	};

	const currentFolderDisplay = () => {
		const conv = getActiveConversation();
		if (!conv) return '选择文件夹...';
		const folder = appState.folders.find((f) => f.id === conv.folderId);
		return folder ? folderLabel(folder) : '本地';
	};

	const conversationTitle = () => getActiveConversation()?.title || '新任务';

	/**
	 * 会话头部面包屑的第二段：当前工作目录的 git 状态。
	 * 不是 git 仓库 / 「本地」分组（没有 path）时为 null，那一段直接不显示。
	 */
	const [gitInfo, setGitInfo] = createSignal<GitInfo | null>(null);
	createEffect(() => {
		const folderId = getActiveConversation()?.folderId;
		const path = appState.folders.find((f) => f.id === folderId)?.path;
		setGitInfo(null);
		if (!path) return;
		void getGitInfo(path).then((info) => setGitInfo(info));
	});

	// 把「有没有 run 在飞」和「停止入口」交给外壳（标题栏菜单 / 全局快捷键 / 侧边栏状态点）
	createEffect(() => mirrorRunning(isGenerating()));
	onMount(() => registerStop(() => void handleStop()));
	onCleanup(() => registerStop(null));

	const parseTaskListLines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['));

	/** 会话头部「更多」菜单：视图模式 + 重新同步 */
	const openSessionMenu = (el: HTMLElement) => {
		const conv = getActiveConversation();
		const menu: MenuItem[] = [
			{
				type: 'submenu',
				label: '视图模式',
				subMenu: [
					{ type: 'radio', value: 'chat', checked: appState.ui.viewMode === 'chat', label: '聊天', onClick: () => actions.setViewMode('chat') },
					{ type: 'radio', value: 'diagram', checked: appState.ui.viewMode === 'diagram', label: '图示', onClick: () => actions.setViewMode('diagram') },
				],
			},
			{ type: 'separator' },
			{
				type: 'normal',
				value: 'resync',
				label: '重新同步当前会话',
				disabled: !conv,
				onClick: () => {
					if (!conv) return;
					void loadConversationCtx(conv.id, true);
					void refreshConversationMeta(conv.id);
				},
			},
		];
		const rect = el.getBoundingClientRect();
		showMenu({
			menu,
			type: 'action',
			triggerRect: { xMin: rect.left, yMin: rect.bottom, xMax: rect.right, yMax: rect.bottom },
		});
	};

	/**
	 * 输入区那排「标记」chip 的通用弹菜单。
	 *
	 * 用 chip + 命令式菜单取代了原来的 `<ffbox-dropdown-input>`：那个控件选中后会把
	 * 自己的 text 设成菜单项的 `value`（我们又是受控写法），导致「选完显示成 __new__」
	 * 这类问题必须靠 `resyncDropdownText()` 手工兜。改成 chip 之后显示值只由 state 决定。
	 */
	const openChipMenu = (menu: MenuItem[], onPick: (value: string) => void, el: HTMLElement) => {
		const rect = el.getBoundingClientRect();
		showMenu({
			menu,
			type: 'action',
			triggerRect: { xMin: rect.left, yMin: rect.bottom, xMax: rect.right, yMax: rect.bottom },
			onSelect: (_event, value) => {
				onPick(String(value));
			},
		});
	};

	// #endregion

	// #region 下拉菜单（文件夹 / 模式 / 模型）

	const folderMenu = createMemo<MenuItem[]>(() => {
		const activeFolderId = getActiveConversation()?.folderId;
		return [
			...appState.folders.map((f) => ({
				type: 'radio' as const,
				value: f.id,
				label: folderLabel(f),
				checked: activeFolderId === f.id,
			})),
			{ type: 'separator' as const },
			{ type: 'normal' as const, value: '__new__', label: '+ 添加文件夹…' },
		];
	});
	/**
	 * 选中一个运行文件夹。
	 * 哨兵值 `__new__` = 去开目录对话框，并把当前会话切到新目录下。
	 */
	const onFolderChange = (value: string) => {
		if (isGenerating()) return;	// 运行期间不让改工作目录（下一轮才生效的那类改动统一锁住）
		if (value === '__new__') {
			void (async () => {
				try {
					const { path, error } = await requestFolderPath();
					if (error) {
						// 拿不到路径（对话框调不起来 / RPC 没接通）：以前这里静默 return，和「用户按了取消」在界面上完全一样 —— 就是「选完还停在本地」那个症状。
						void alertMsgbox('选择文件夹失败', error);
						return;
					}
					if (!path) return;	// 用户取消
					// 从这个菜单里选目录，意图就是「把当前会话放进这个目录」，顺手就切过去。
					// ⚠️ 同一个目录选第二次时 `addFolder()` 返回 null（它只负责「加进列表」）——这时必须复用已有的那个，否则这次选择静默失效。
					const folder = appState.folders.find((f) => sameFolderPath(f.id, path)) ?? actions.addFolder(path);
					if (!folder) return;
					const conv = getActiveConversation();
					if (conv) actions.setConversationFolder(conv.id, folder.id);
				} catch (err) {
					console.error('[ChatView] 选择文件夹出错', err);
					void alertMsgbox('选择文件夹出错', String((err as Error)?.message ?? err));
				}
			})();
			return;
		}
		const conv = getActiveConversation();
		if (conv) actions.setConversationFolder(conv.id, value);
	};

	const modeMenu = createMemo<MenuItem[]>(() =>
		appState.modes.map((m) => ({
			type: 'radio' as const,
			value: m.id,
			label: `${m.ui?.icon ?? ''} ${m.name}`.trim(),
			checked: appState.currentModeId === m.id,
		})),
	);
	const currentModeLabel = () => {
		const mode = appState.modes.find((m) => m.id === appState.currentModeId);
		return mode ? `${mode.ui?.icon ?? ''} ${mode.name}`.trim() : '🤖 默认';
	};
	const applyMode = (value: string) => {
		if (isGenerating()) return;	// 运行期间禁止改模式
		actions.setCurrentModeId(value);
		const conv = getActiveConversation();
		if (conv) void agentBridge.updateConversation(conv.id, { modeId: value });
	};

	const modelMenu = createMemo<MenuItem[]>(() => {
		const current = appState.currentStandardModel;
		if (appState.providers.length === 0) {
			return [{ type: 'normal', value: '__none__', label: '还没有配置模型，去设置里添加吧', disabled: true }];
		}
		return appState.providers.map((provider) => ({
			type: 'submenu' as const,
			label: provider.name,
			subMenu: provider.models.map((model) => ({
				type: 'radio' as const,
				value: `${provider.id}/${model.id}`,
				label: model.displayName,
				tooltip: model.id,
				checked: current?.providerId === provider.id && current?.modelId === model.id,
			})),
		}));
	});
	const applyModel = (value: string) => {
		if (isGenerating()) return;	// 运行期间禁止改运行语义（同「回复过程中不能点发送」）
		if (typeof value !== 'string') return;
		const sep = value.indexOf('/');
		if (sep <= 0) return;
		actions.setCurrentStandardModel({ providerId: value.slice(0, sep), modelId: value.slice(sep + 1) });
	};

	// #endregion

	// #region 内置 mock 开关（开发用）

	/** 剧本下拉：选项由后端给（`GET /api/settings/mock` 里带 scenarios），前端不重复维护 */
	const scenarioMenu = createMemo<MenuItem[]>(() =>
		appState.mock.scenarios.map((s) => ({
			type: 'radio' as const,
			value: s.id,
			label: s.label,
			checked: appState.mock.scenario === s.id,
		})),
	);

	const currentScenarioLabel = () =>
		appState.mock.scenarios.find((s) => s.id === appState.mock.scenario)?.label ?? appState.mock.scenario;

	/** 点一下切换开/关。运行期间后端也会拒绝（409），这里把错误如实弹出来 */
	const toggleMock = async () => {
		if (isGenerating()) return;
		const result = await actions.setMock({ enabled: !appState.mock.enabled });
		if (!result.ok) void alertMsgbox('切换 mock 失败', result.error ?? '未知错误');
	};

	const applyMockScenario = async (value: string) => {
		if (isGenerating()) return;
		const result = await actions.setMock({ scenario: value });
		if (!result.ok) void alertMsgbox('切换剧本失败', result.error ?? '未知错误');
	};

	/** mock chip 的菜单：开关 + 剧本选择 */
	const openMockMenu = (el: HTMLElement) => {
		openChipMenu(
			[
				{
					type: 'checkbox',
					value: '__toggle__',
					checked: appState.mock.enabled,
					label: '启用内置 mock',
					tooltip: 'LLM 走内置 mock，工具仍真实执行',
				},
				{ type: 'separator' },
				{ type: 'submenu', label: 'mock 剧本', subMenu: scenarioMenu() },
			],
			(value) => {
				if (value === '__toggle__') void toggleMock();
				else void applyMockScenario(value);
			},
			el,
		);
	};

	// #endregion

	// #region 滚动与后端刷新

	const SCROLL_TO_BOTTOM_THRESHOLD = 100;
	const chatAreaRef = (el: HTMLDivElement) => {
		createEffect(() => {
			getActiveConversation();
			taskList();
			streamTick();
			const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			queueMicrotask(() => {
				if (distanceFromBottom <= SCROLL_TO_BOTTOM_THRESHOLD) {
					el.scrollTop = el.scrollHeight;
				}
			});
		});
	};

	// #endregion

	// #region 一轮 run 的开始与结束

	// 生命周期只有两个动作：
	//   beginRun —— 清空 overlay（清掉上一轮的残留）后发请求
	//   endRun   —— 重拉 ctx（拿「已提交」的内容）+ 清空 overlay
	// 中间不重拉：§6 决定了「在飞」的内容不在 ctx 里，靠 overlay 呈现即可。

	const beginRun = async (convId: string) => {
		if (unsubscribeFn) {
			unsubscribeFn();
			unsubscribeFn = null;
		}
		// 每轮开始清掉上一轮的折叠记录：根实例是永续的，不清会串到新轮次的同名块上（见块渲染区的说明）
		openOverrides.clear();
		prevTree = null;
		setRunError(null);
		setOverlay(createEmptyOverlay(convId, appState.currentModeId));
		setStreamTick((v) => v + 1);
		// ⚠️ 必须**等 SSE 连接真的建立**再返回：EventSource 建连要几百 ms，而调用方紧接着就发 run，后端在连接建立前发出的头几条事件（含 `agent_start`）不会重放，会永久丢失。
		// 丢了 `agent_start` 的后果：overlay 没有 `rootAgentInstanceId`，在飞期间`foldCtxToRenderTree()` 找不到根实例直接返回 null ⇒ 界面上既看不到用户那条消息、也看不到任何内容（2026-09-15 实测：overlay 里只有后续事件，整轮一片空白）。
		// 超时兜底：连不上也照常返回，宁可丢事件也不能把「发送」卡死。
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 2000);
			unsubscribeFn = agentBridge.subscribeStream(
				convId,
				(event) => handleStreamEvent(convId, event),
				() => {
					clearTimeout(timer);
					resolve();
				},
			);
		});
	};

	const endRun = async (convId: string) => {
		setIsGenerating(false);
		if (unsubscribeFn) {
			unsubscribeFn();
			unsubscribeFn = null;
		}
		await loadConversationCtx(convId, true);
		setOverlay(createEmptyOverlay(convId, appState.currentModeId));
	};

	// #endregion

	// #region 流式事件处理

	/** 刷新任务清单面板 */
	const refreshTaskList = async (convId: string) => {
		const list = await agentBridge.getTaskList(convId);
		setTaskList(list);
	};

	const handleStreamEvent = (convId: string, event: AgentStreamEvent) => {
		if (event.type === 'done') {
			void refreshTaskList(convId);
			void endRun(convId);
			return;
		}
		if (event.type === 'error') {
			setRunError(event.message);
			return;
		}
		// ask_user 挂起：本轮还没结束（实例在等用户），只是让输入框可用，订阅与 overlay 都留着
		if (event.type === 'client_tool_call') {
			setIsGenerating(false);
		}
		setOverlay(produce((draft) => applyEvent(draft, event)));
		setStreamTick((v) => v + 1);
	};

	// #endregion

	// #region 发送 / 停止 / 回答提问

	const handleSend = async () => {
		const text = inputText().trim();
		if (!text || isGenerating()) return;

		/** 从 store 组装完整的 ModelConfig（给 AgentRunRequest 用） */
		function buildModelConfig(): ModelConfig | null {
			const ref = appState.currentStandardModel;
			if (!ref) return null;
			const provider = appState.providers.find((p) => p.id === ref.providerId);
			if (!provider) return null;
			const model = provider.models.find((m) => m.id === ref.modelId);
			if (!model) return null;
			return {
				providerId: provider.id,
				modelId: model.id,
				apiFormat: provider.apiFormat,
				baseUrl: provider.baseUrl,
				apiKey: provider.apiKey,
				customParams: { ...provider.customParams, ...model.customParams },
			};
		}

		// mock 开着时就算没配 provider 也能跑（后端会把请求转给内置 mock）
		const modelConfig = buildModelConfig() ?? (appState.mock.enabled ? MOCK_PLACEHOLDER_MODEL : null);
		if (!modelConfig) {
			void alertMsgbox('未配置模型', '请先在「设置 → 模型」里配置模型提供商与模型，然后再发起任务。');
			return;
		}
		if (appState.modes.length === 0) {
			void alertMsgbox('没有可用模式', '插件里没有加载到任何模式，请到「设置 → 插件 / 模式」检查插件目录。');
			return;
		}

		let conv = getActiveConversation();
		if (!conv) {
			conv = await actions.createConversation('local', text.slice(0, 20) || '新任务');
			if (!conv) return;
		} else if (!conv.agentCtx) {
			// 会话还没有跑过 → 用首句当标题（旧逻辑用 messages 为空判断，现在等价于「没有 ctx」）
			await actions.renameConversation(conv.id, text.slice(0, 30));
		}
		const convId = conv.id;

		// 会话所属的文件夹就是它的工作目录：「本地」没有 path，等于不传，
		// 由后端回退到 process.cwd()。文件夹改过之后，下一轮 run 自动用新目录。
		const runningDir = appState.folders.find((f) => f.id === conv.folderId)?.path;

		setInputText('');
		setIsGenerating(true);
		await beginRun(convId);

		try {
			const result = await agentBridge.runAgent({
				conversationId: convId,
				userMessage: text,
				modeId: appState.currentModeId,
				runningDir,
				model: modelConfig,
			});
			if (!result.ok) {
				setRunError(`❌ Agent 错误: ${result.error}`);
				await endRun(convId);
			}
		} catch (err: any) {
			setRunError(`❌ 调用失败: ${err?.message || String(err)}`);
			await endRun(convId);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	const handleStop = async () => {
		const conv = getActiveConversation();
		if (conv) {
			await agentBridge.cancelAgent(conv.id);
			await endRun(conv.id);
		} else {
			setIsGenerating(false);
		}
	};

	/** 回答提问卡片：本地先把状态改成已回答，再 POST 续接（订阅还开着，后续输出继续进 overlay） */
	const handleAskUserCardSubmit = async (convId: string, callId: string, text: string) => {
		const skipped = text === '用户已跳过此提问';
		setOverlay(produce((draft) => {
			// 在 overlay 里把某次提问的状态改掉（回答 / 跳过）
			for (const instance of Object.values(draft.instances)) {
				const entry = instance.messages.find(
					(m) => m.kind === 'ask_user_state' && (m.data as { callId?: string })?.callId === callId,
				);
				if (entry) {
					entry.data = { callId, status: skipped ? 'skipped' : 'answered', answer: text };
					entry.updatedAt = Date.now();
					return;
				}
			}
		}));
		if (skipped) return;

		setIsGenerating(true);
		const result = await actions.answerToolCall(convId, callId, text);
		if (!result.ok) {
			setRunError(`回答提交失败: ${result.error}`);
			await endRun(convId);
		}
	};

	// #endregion

	// #region 块渲染

	/**
	 * 用户手动折叠/展开过的块。
	 *
	 * 投影每次重算都会**重建块对象**（流式期间每来一个增量就重算一次），DOM 上的 `<details>` 会被换掉，不把用户的意愿记在这里就会被弹回去。key 用块的稳定标识（工具用 callId、子 Agent 用实例 id）
	 * ⚠️ 每轮 run 开始时清空：根实例是永续的，不清的话上一条轮次的展开状态会串到新轮次的同名块上。
	 */
	const openOverrides = new Map<string, boolean>();

	/** 一次 LLM 调用的账本：贴在所属块的**下方**（它是那次调用自带的一条数据，不是独立条目） */
	const renderUsage = (usage: UsageEntry) => {
		const parts: string[] = []
		parts.push(`#${usage.seq ?? '?'}`);	// 总调用 llm 的序号
		if (usage.round) parts.push(`第 ${usage.round} 轮`);	// 不包含反思和子 Agent 的 llm 调用轮序号
		parts.push(`↑${fmtTokens(usage.input)} ↓${fmtTokens(usage.output)}`);
		// parts.push(`共 ${fmtTokens(usage.total)}`);
		if (usage.cached) parts.push(`缓存 ${fmtTokens(usage.cached)}`);
		const duration = fmtDuration(usage.durationMs);
		if (duration) parts.push(duration);
		// if (usage.purpose && usage.purpose !== 'agent_loop') {
		// 	parts.push(PURPOSE_LABEL[usage.purpose] ?? usage.purpose);
		// }
		parts.push(usage.model);
		return (
			<div class={styles['agent-block-usage']}>
				<span class={styles['agent-usage-text']}>{parts.join(' · ')}</span>
			</div>
		);
	};

	/**
	 * LLM 调用块里的**一个子块**：思考 / 正文 / 一次工具调用。
	 * 工具调用的结果贴在同一处（`role:'tool'` 的条目由投影合并进来），不单独成块。
	 */
	const renderSubBlock = (sub: RenderSubBlock) => {
		switch (sub.type) {
			case 'reasoning':
				// 思考过程默认折叠，但 summary 里实时滚出末尾几个字，
				// 这样即使折叠着也能看出「模型还在动」，而不是界面一片死寂。
				return (
					<div class={styles['reasoning']}>
						<span class={styles['reasoning-rail']} />
						<details class={styles['reasoning-main']}>
							<summary class={styles['reasoning-head']}>
								<span class={styles['reasoning-caret']}>▶</span>
								<span class={styles['reasoning-label']}>思考</span>
								<span class={styles['reasoning-peek']}>{sub.content.slice(-72)}</span>
							</summary>
							<div class={styles['reasoning-body']}>{sub.content}</div>
						</details>
					</div>
				);

			case 'text':
				return <div class={styles['agent-block-text']}>{sub.content}</div>;

			case 'reflection':
				// 反思同样是「一次 LLM 调用」，所以它也走 llm 块 —— 只是内容形态固定。
				// 默认展开：设计稿就是展开态，而且它本来就只有一两句话。
				return (
					<details
						class={styles['reflection']}
						open={openOverrides.get(`reflection:${sub.key}`) ?? true}
						ontoggle={(e) => openOverrides.set(`reflection:${sub.key}`, e.currentTarget.open)}
					>
						<summary class={styles['reflection-head']}>
							<span class={styles['reflection-icon']}>
								<ReflectionIcon />
							</span>
							<span class={styles['reflection-title']}>REFLECTION</span>
							<Show when={sub.remaining !== undefined}>
								<span class={styles['reflection-chip']}>剩 {sub.remaining} 次</span>
							</Show>
							<span class={styles['reflection-caret']}>▶</span>
						</summary>
						<div class={styles['reflection-body']}>{sub.content}</div>
					</details>
				);

			case 'tool': {
				const tool = sub as RenderToolSub;

				// ask_user 的工具调用渲染成提问卡片（它的「结果」是用户回答，不是工具输出）
				if (tool.ask) {
					const convId = appState.activeConversationId ?? '';
					return (
						<AskUserCard
							block={tool.ask}
							onSubmit={(text) => void handleAskUserCardSubmit(convId, tool.callId, text)}
						/>
					);
				}

				// 工具调用 = 一行摘要（状态 + 工具名 + 理由 + 输出预览）+ 可展开的入参与完整输出。
				const childCount = tool.children?.length ?? 0;
				const mcp = parseMcpName(tool.name);
				// 普通工具：输出短就直接展开（一眼看到结果），长的折起来。
				// 子节点不再影响展开态 —— 它们已经不在这个 <details> 里了（见下面的注释）。
				const toolBlock = (
					<details
						class={styles['tool-card']}
						classList={{
							[styles['is-error']]: tool.status === 'error',
							[styles['is-mcp']]: !!mcp,
						}}
						open={openOverrides.get(`tool:${tool.callId}`) ?? (tool.status === 'error' || (!!tool.output && tool.output.length <= 240))}
						ontoggle={(e) => openOverrides.set(`tool:${tool.callId}`, e.currentTarget.open)}
					>
						<summary class={styles['tool-head']}>
							<span class={styles['tool-head-caret']}>▶</span>
							<span class={styles['tool-status']}>
								{tool.status === 'running' ? '⏳' : tool.status === 'success' ? '✓' : '✗'}
							</span>
							<Show
								when={mcp}
								fallback={<span class={styles['tool-name']}>{tool.name}</span>}
							>
								<span class={styles['tool-icon']}>
									<McpIcon />
								</span>
								<span class={styles['tool-name']}>mcp:{mcp!.server}</span>
								<span class={styles['tool-name-sub']}>tools/call · {mcp!.method}</span>
							</Show>
							<Show when={childCount > 0}>
								{/* 子 Agent 渲染在这个块**下面**（同级），这里只提示它委托出去了几个 */}
								<span class={styles['tool-owner']}>↳ {childCount} 个子 Agent</span>
							</Show>
							<Show when={tool.reason}>
								<span class={styles['tool-reason']}>{tool.reason}</span>
							</Show>
							<Show when={mcp}>
								<span class={styles['tool-chip']}>JSON-RPC</span>
							</Show>
							<Show
								when={tool.output}
								fallback={
									<Show when={tool.status === 'running'}>
										<span class={styles['tool-preview']}>执行中…</span>
									</Show>
								}
							>
								<span class={styles['tool-preview']}>
									{tool.output.replace(/\s+/g, ' ').trim().slice(0, 120)}
								</span>
							</Show>
						</summary>
						<div class={styles['tool-body']}>
							{/* MCP 卡用设计稿的「→ request / ← response」行；普通工具用「入参 / 输出」小标 */}
							<Show
								when={mcp}
								fallback={
									<>
										<Show when={tool.args}>
											<div class={styles['tool-section']}>入参</div>
											<pre class={styles['tool-pre']}>{truncateWithNote(tool.args, TOOL_ARGS_LIMIT)}</pre>
										</Show>
										<Show when={tool.output}>
											<div class={styles['tool-section']}>输出</div>
											<pre class={styles['tool-pre']}>{truncateWithNote(tool.output, TOOL_OUTPUT_LIMIT)}</pre>
										</Show>
									</>
								}
							>
								<Show when={tool.args}>
									<div class={styles['tool-line']}>→ request</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool.args, TOOL_ARGS_LIMIT)}</pre>
								</Show>
								<Show when={tool.output}>
									<div class={`${styles['tool-line']} ${styles['is-response']}`}>
										← response · {tool.status === 'success' ? '200 OK' : tool.status} · {fmtSize(tool.output.length)}
									</div>
									<pre class={styles['tool-pre']}>{truncateWithNote(tool.output, TOOL_OUTPUT_LIMIT)}</pre>
								</Show>
							</Show>
							<Show when={!tool.args && !tool.output}>
								<div class={styles['tool-hint']}>
									{tool.status === 'running' ? '等待工具返回…' : '（该工具没有输出）'}
								</div>
							</Show>
						</div>
					</details>
				);

				// ⚠️ 委托 / 唤醒类工具：子 Agent **不嵌在上面那个 <details> 里**，而是同级渲染在它下面。
				// 理由：① 折叠工具块不该把整棵子 Agent 树一起藏起来
				//       ② 子 Agent 要有自己的左边距，使「哪一块是一个完整的子 Agent」从结构上就看得出来
				if (childCount === 0) return toolBlock;
				return (
					<div class={styles['agent-tool-group']}>
						{toolBlock}
						<div class={styles['agent-tool-children']}>
							<For each={tool.children}>{(child) => renderNode(child, false)}</For>
						</div>
					</div>
				);
			}
		}
	};

	/**
	 * 用户发言之后的第一个块下标 —— AGENT 头就插在它前面。
	 * （头部必须跟在用户消息**下面**，不能跑到整段对话的最上面。）
	 */
	function getFirstNonUserIndex(node: RenderAgentNode): number {
		let i = 0;
		while (i < node.blocks.length && node.blocks[i].type === 'user') i++;
		return i;
	}

	/** 消息头 / AGENT：指示灯 + AGENT + Agent 名 + 状态标记 */
	const renderAgentHeaderFor = (node: RenderAgentNode) => (
		<div class={styles['message-head']}>
			<span class={styles['message-head-dot']} />
			<span class={`${styles['message-head-label']} ${styles['is-agent']}`}>AGENT</span>
			<span class={styles['message-head-meta']}>{node.agentName || node.agentId}</span>
			<span class={styles['message-head-chip']}>{STATUS_LABEL[node.status] ?? node.status}</span>
			<span class={styles['message-head-spacer']} />
		</div>
	);

	/** 运行摘要：设计稿的指标胶囊（耗时 / 工具调用 / 重入我们暂时拿不到，只出这四项） */
	const renderRunSummaryFor = (node: RenderAgentNode) => (
		<Show when={node.tokens || node.llmCalls > 0}>
			<div class={styles['run-summary']}>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>LLM 调用</span>
					{node.llmCalls}
				</span>
				<span class={styles['summary-chip']}>
					<span class={styles['summary-chip-key']}>tokens</span>
					↑{fmtTokens(node.tokens?.input)} ↓{fmtTokens(node.tokens?.output)}
				</span>
				<Show when={node.tokens?.inputCached}>
					<span class={styles['summary-chip']}>
						<span class={styles['summary-chip-key']}>缓存</span>
						{fmtTokens(node.tokens!.inputCached)}
					</span>
				</Show>
				<Show when={node.rounds > 0}>
					<span class={styles['summary-chip']}>
						<span class={styles['summary-chip-key']}>轮次</span>
						{node.rounds}
					</span>
				</Show>
			</div>
		</Show>
	);

	/** 单个顶层块（`isRoot` 决定用户发言是否渲染成气泡：子 Agent 的任务已在头部显示） */
	const renderBlock = (block: RenderBlock, isRoot: boolean) => {
		switch (block.type) {
			case 'user':
				if (!isRoot) return null;
				// 设计稿里用户消息没有头像：一个「用户」小标 + 一个静态气泡
				return (
					<div class={styles['user-message']}>
						<div class={styles['message-head']}>
							<span class={styles['message-head-label']}>用户</span>
						</div>
						<div class={styles['user-bubble']}>{block.content}</div>
					</div>
				);

			// ⭐ 一次 LLM 调用 = 一个块：思考 / 正文 / 工具调用 / 反思都缩在它里面，账本贴在它下方
			case 'llm':
				return (
					<div class={styles['agent-llm']}>
						<For each={block.subBlocks}>{(sub) => renderSubBlock(sub)}</For>
						<Show when={block.usages}>{(usages) => (
							<For each={usages()}>{(usage) => renderUsage(usage)}</For>
						)}</Show>
					</div>
				);

			case 'error':
				return (
					<div class={styles['agent-block-error']}>
						<span>✗</span>
						<span>{block.message}</span>
					</div>
				);

			case 'agent':
				return renderNode(block.node, false);
		}
	};

	/**
	 * 一个 Agent 实例 = 一个块序列（含它的子节点）。
	 * 子 Agent 用 `<details>` 整块折叠（名字 + 状态 + 任务在头部，展开才是它自己的产出）。
	 */
	const renderNode = (node: RenderAgentNode, isRoot: boolean) => {
		const blockList = () => (
			<For each={node.blocks}>
				{(block, index) => (
					<>
						<Show when={index() === getFirstNonUserIndex(node)}>{renderAgentHeaderFor(node)}</Show>
						{renderBlock(block, true)}
					</>
				)}
			</For>
		);

		if (isRoot) {
			return (
				<div class={styles['agent-reply']}>
					{blockList()}
					{renderRunSummaryFor(node)}
				</div>
			);
		}

		return (
			<details
				class={styles['agent-node']}
				/* ⚠️ 默认展开：要的是「子 Agent 的内容都看得见，想收起来时自己收」。
				   曾经按 status 自动折（跑完就收起），结果是「子 Agent 一完成就从界面上消失」。 */
				open={openOverrides.get(`node:${node.agentInstanceId}`) ?? true}
				ontoggle={(e) => openOverrides.set(`node:${node.agentInstanceId}`, e.currentTarget.open)}
			>
				<summary class={styles['agent-node-header']}>
					<span class={styles['agent-node-caret']}>▶</span>
					<span class={styles['agent-node-name']}>{node.agentName || node.agentId}</span>
					<span class={styles['agent-node-status']}>{STATUS_LABEL[node.status] ?? node.status}</span>
					<Show when={node.task}>
						<span class={styles['agent-node-task']}>{node.task}</span>
					</Show>
				</summary>
				<div class={styles['agent-node-body']}>
					<For each={node.blocks}>{(block) => renderBlock(block, false)}</For>
					{renderRunSummaryFor(node)}
				</div>
			</details>
		);
	};

	// #endregion

	// #region 生命周期

	onCleanup(() => {
		if (unsubscribeFn) unsubscribeFn();
	});

	// #endregion

	return (
		<div class={styles['main-content']}>
			{/* 会话头部：标题 + 面包屑 + 状态 / 操作 */}
			<div class={styles['session-header']}>
				<div class={styles['session-title-block']}>
					<div class={styles['session-title']}>{conversationTitle()}</div>
					<div class={styles['session-breadcrumb']}>
						<span class={styles['breadcrumb-item']}>{currentFolderDisplay()}</span>
						<Show when={gitInfo()}>
							<span class={styles['breadcrumb-sep']}>/</span>
							<span class={styles['breadcrumb-item']}>branch {gitInfo()!.branch}</span>
							<span class={styles['breadcrumb-sep']}>/</span>
							<span class={styles['breadcrumb-item']}>{gitInfo()!.shortCommit}</span>
						</Show>
					</div>
				</div>

				<div class={styles['session-actions']}>
					<Show
						when={isGenerating()}
						fallback={
							<Show when={renderTree()}>
								<span class={styles['session-status']}>等待输入</span>
							</Show>
						}
					>
						<span class={`${styles['session-status']} ${styles['is-running']}`}>
							<span class={styles['session-status-dot']} />
							运行中
						</span>
					</Show>

					<Show when={isGenerating()}>
						<button class={styles['session-btn']} onclick={() => void handleStop()}>
							停止
						</button>
					</Show>

					<button
						class={styles['session-icon-btn']}
						title="更多"
						aria-label="更多"
						onclick={(e) => openSessionMenu(e.currentTarget)}
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
							<circle cx="2.4" cy="7" r="1.4" />
							<circle cx="7" cy="7" r="1.4" />
							<circle cx="11.6" cy="7" r="1.4" />
						</svg>
					</button>
				</div>
			</div>

			{/* 运行进度条：2px 底槽常驻，在飞时跑一段不确定进度 */}
			<div class={styles['progress-track']}>
				<Show when={isGenerating()}>
					<div class={styles['progress-bar']} />
				</Show>
			</div>

			{/* 聊天区域 */}
			<div class={styles['chat-area']} ref={chatAreaRef}>
				<Show when={!renderTree()}>
					<div class={styles['empty-state']}>
						<div class={styles['empty-state-logo']}>
							<SparkleIcon />
						</div>
						<h2>MindTheGap-Harness</h2>
						<p>请小心间隙！Please Mind The Gap！嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟📢</p>
					</div>
				</Show>

				<Show when={appState.ui.viewMode === 'chat' && renderTree()}>
					<div
						class={styles['message-list']}
						ref={(el) => {
							// 以下代码用于性能测试。不需要时可整个都去掉
							let domMutations = 0;
							let lastLogTime = 0;
							const obs = new MutationObserver((mutations) => {
								for (const m of mutations) domMutations += m.addedNodes.length + m.removedNodes.length;
								const now = performance.now();
								if (now - lastLogTime >= 50) {
									console.log(`[dom-mutations] diff=${ENABLE_RENDER_TREE_DIFF} mutations=${domMutations}`);
									lastLogTime = now;
								}
							});
							obs.observe(el, { childList: true, subtree: true });
							onCleanup(() => obs.disconnect());
						}}
					>
						{/* 任务清单小面板（可折叠） */}
						<Show when={parseTaskListLines(taskList()).length > 0}>
							<div class={styles['task-panel']}>
								<button class={styles['task-panel-header']} onclick={() => setTaskListOpen((v) => !v)}>
									📋 任务清单（{parseTaskListLines(taskList()).length}）
									<span>{taskListOpen() ? '▾' : '▸'}</span>
								</button>
								<Show when={taskListOpen()}>
									<For each={parseTaskListLines(taskList())}>
										{(line) => <div class={styles['task-panel-item']}>{line.replace(/^-\s*\[[ xX]\]\s*/, (m) => (/- \[[xX]\]/.test(m) ? '✅ ' : '⬜ '))}</div>}
									</For>
								</Show>
							</div>
						</Show>

						{/* 转写：根实例直接内联渲染，让 <For> 持久化以支持 reconciliation
						    （AGENT 头插在用户发言之后，运行摘要贴在最下面） */}
						<div class={styles['agent-reply']}>
							<For each={renderTree()!.blocks}>
								{(block, index) => (
									<>
										<Show when={index() === getFirstNonUserIndex(renderTree()!)}>{renderAgentHeaderFor(renderTree()!)}</Show>
										{renderBlock(block, true)}
									</>
								)}
							</For>
							{renderRunSummaryFor(renderTree()!)}
						</div>

						{/* 本轮即时错误（重拉 ctx 后由失败的实例自己带错误块） */}
						<Show when={runError()}>
							<div class={styles['agent-block-error']}>
								<span>✗</span>
								<span>{runError()}</span>
							</div>
						</Show>

						<Show when={isGenerating()}>
							<div class={styles['agent-reply']}>
								<span style={{ display: 'inline-flex', gap: '4px', padding: '6px 0' }}>
									<span class={styles['typing-dot']} style={{ animation: 'typing 1.4s infinite' }}>●</span>
									<span class={styles['typing-dot']} style={{ animation: 'typing 1.4s infinite 0.2s' }}>●</span>
									<span class={styles['typing-dot']} style={{ animation: 'typing 1.4s infinite 0.4s' }}>●</span>
								</span>
							</div>
						</Show>
					</div>
				</Show>

				{/* 图示模式 */}
				<Show when={appState.ui.viewMode === 'diagram'}>
					<DiagramView />
				</Show>
			</div>

			{/* 输入区域 */}
			<div class={styles['input-area']}>
				<div class={styles['input-wrapper']}>
					<textarea
						class={styles['input-textarea']}
						placeholder="描述任务，或输入 / 唤起指令；shift + enter 换行"
						value={inputText()}
						oninput={(e) => setInputText(e.currentTarget.value)}
						onkeydown={handleKeyDown}
						rows={1}
					/>

					<div class={styles['input-toolbar']}>
						{/* 运行文件夹 */}
						<button
							class={styles['ctx-chip']}
							title="运行文件夹（决定 Agent 的工作目录）"
							disabled={isGenerating()}
							onclick={(e) => openChipMenu(folderMenu(), onFolderChange, e.currentTarget)}
						>
							<FolderChipIcon />
							<span class={styles['ctx-chip-text']}>{currentFolderDisplay()}</span>
						</button>

						{/* 运行模式 */}
						<button
							class={styles['ctx-chip']}
							title="运行模式"
							disabled={isGenerating()}
							onclick={(e) => openChipMenu(modeMenu(), applyMode, e.currentTarget)}
						>
							<span class={styles['ctx-chip-text']}>{currentModeLabel()}</span>
						</button>

						{/* 模型 */}
						<button
							class={styles['ctx-chip']}
							title="选择模型"
							disabled={isGenerating()}
							onclick={(e) => openChipMenu(modelMenu(), applyModel, e.currentTarget)}
						>
							<span class={styles['state-dot']} />
							<span class={styles['ctx-chip-text']}>{currentModelDisplay()}</span>
						</button>

						{/* 内置 mock（开发用） */}
						<button
							class={`${styles['ctx-chip']} ${styles['mock-chip']}`}
							classList={{ [styles['is-on']]: appState.mock.enabled }}
							title="内置 mock：LLM 走假模型，工具仍真实执行"
							disabled={isGenerating()}
							onclick={(e) => openMockMenu(e.currentTarget)}
						>
							<span class={styles['ctx-chip-text']}>
								{appState.mock.enabled ? `mock · ${currentScenarioLabel()}` : 'mock 关'}
							</span>
						</button>

						<span class={styles['input-toolbar-spacer']} />

						<Show when={!isGenerating()}>
							<button
								class={styles['input-send-btn']}
								title="发送"
								onclick={() => void handleSend()}
								disabled={!inputText().trim()}
							>
								<SendIcon />
							</button>
						</Show>
						<Show when={isGenerating()}>
							<button
								class={styles['input-stop-btn']}
								title="停止生成"
								onclick={() => void handleStop()}
							>
								<StopIcon />
							</button>
						</Show>
					</div>
				</div>

				<div class={styles['input-hint']}>enter 发送 · shift + enter 换行 · esc 中断运行</div>
			</div>
		</div>
	);
}

// #endregion
