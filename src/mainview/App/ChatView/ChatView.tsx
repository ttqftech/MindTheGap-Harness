/* ==========================================================================
   主聊天视图 — MindTheGap-Harness

   渲染模型（2026-09-14 重构后）：
   - 界面内容 = `foldCtxToRenderTree(mergeOverlayCtx(ctx, overlay))`，**不再有 UI 消息**
   - ctx 是唯一真相（后端 Runner 写）；overlay 是组件内的「在飞」增量（SSE 翻译成 ctx 形状的条目）
   - **一次 LLM 调用 = 一个块**（`RenderLlmBlock`）：思考 / 正文 / 各次工具调用都是它的**子块**，
     工具结果贴在对应调用处（不单独成块），账本（usages）贴在块的下方
   - 子 Agent 不再靠 depth 缩进：委托工具的**子块**下面同级挂它的节点，一个实例 = 一个可整块折叠的块
   - ask_user 走 client_tool_call：渲染提问卡片，回答后 POST /api/agent/answer 续接

   设计稿：docs/设计-ctx唯一真相与动态投影.md（§5.3 是 SSE → 条目的翻译表）
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { FFBoxDropdownInput, MenuItem } from 'ffbox-ui';
import styles from './ChatView.module.css';
import { state as appState, actions, getActiveConversation, getProviderById, loadConversationCtx } from '@mainview/store';
import type { ModelConfig } from '@shared/agent';
import { emptyOverlay, foldCtxToRenderTree, mergeOverlayCtx } from '@shared/projection';
import type { OverlayCtx, RenderAgentNode, RenderAskInfo, RenderBlock, RenderSubBlock, RenderToolSub } from '@shared/projection';
import * as agentBridge from '@mainview/agentBridge';
import type { AgentInstanceMessage, AgentStreamEvent, ToolResult, UsageEntry } from '@shared/agent';
import { requestFolderPath } from '@mainview/localBridge';
import { folderLabel } from '@shared/utils';
import { alertMsgbox } from '@mainview/ffboxBridge';
import DiagramView from './DiagramView';

// #region 图标

function UserIcon() {
	return <span>U</span>;
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

/** 截断到 limit，并注明被省略的长度 */
function truncateWithNote(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = text.slice(0, Math.floor(limit * 0.8));
	const tail = text.slice(-Math.floor(limit * 0.2));
	return `${head}\n\n…（已省略 ${text.length - head.length - tail.length} 字符，完整内容见后端 ctx）\n\n${tail}`;
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

/** 工具结果 → 可读字符串（失败时把错误信息也带上） */
function toolOutputText(result: ToolResult): string {
	const body = result.content ?? '';
	if (!result.success) {
		return `[失败] ${result.error ? `${result.error}\n${body}` : body}`.trim();
	}
	return body;
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
	const ensure = (id: string) => {
		if (!draft.instances[id]) draft.instances[id] = { messages: [] };
		return draft.instances[id]!.messages;
	};

	/**
	 * 取「当前正在写」的 assistant 条目：
	 * - 写工具调用：复用尾部的 assistant 条目（一条 assistant 消息可以带多个工具调用）
	 * - 写正文/思考：若尾部那条已经有工具调用了，就另起一条（工具调用之后的文字属于下一轮）
	 */
	const assistantEntry = (id: string, kind: 'text' | 'toolCall'): AgentInstanceMessage => {
		const messages = ensure(id);
		const tail = messages[messages.length - 1];
		if (tail?.role === 'assistant') {
			if (kind === 'toolCall') return tail;
			if (!tail.toolCalls?.length) return tail;
		}
		messages.push({ role: 'assistant', content: '', updatedAt: Date.now() });
		return messages[messages.length - 1]!;
	};

	/** 工具结果按 callId 覆盖写（同一个 callId 会来两次：占位 + 终态） */
	const upsertToolResult = (id: string, event: Extract<AgentStreamEvent, { type: 'tool_end' }>) => {
		const messages = ensure(id);
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
	const id = 'agentInstanceId' in event ? event.agentInstanceId ?? '' : '';
	switch (event.type) {
		case 'agent_start': {
			ensure(id);
			draft.meta[id] = {
				agentInstanceId: id,
				agentId: event.agentId,
				agentName: event.agentName,
				parentAgentInstanceId: event.parentAgentInstanceId,
				depth: event.depth,
				status: 'running',
				task: event.task,
				startedAt: Date.now(),
			};
			if (!event.parentAgentInstanceId) draft.rootAgentInstanceId = id;
			// 首条 user 条目 = 该实例的任务（与 ctx 里的形态一致）
			ensure(id).push({
				role: 'user',
				content: event.parentAgentInstanceId ? `[来自父 Agent 的任务]\n${event.task ?? ''}` : (event.task ?? ''),
				updatedAt: Date.now(),
			});
			break;
		}

		case 'text': {
			const entry = assistantEntry(id, 'text');
			entry.content += event.chunk;
			entry.updatedAt = Date.now();
			break;
		}

		case 'reasoning': {
			const entry = assistantEntry(id, 'text');
			entry.reasoningContent = (entry.reasoningContent ?? '') + event.chunk;
			entry.updatedAt = Date.now();
			break;
		}

		case 'tool_start': {
			const entry = assistantEntry(id, 'toolCall');
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
			if (event.toolName !== 'ask_user') upsertToolResult(id, event);
			break;
		}

		case 'usage': {
			// 只记单次调用（scope='call'）；agentLoop 的「本段小计」是派生值，不落任何一处。
			// 账本挂到**这次调用的 assistant 条目**上（与后端的 usages 字段一致：它是那次调用自带的数据），
			// 不另起条目 —— 否则投影只能把它平铺成一条与调用脱节的流水。
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
			const entry = assistantEntry(id, 'text');
			entry.usages = [...(entry.usages ?? []), data];
			entry.updatedAt = Date.now();
			break;
		}

		case 'reflection': {
			// 反思的 usage 比反思正文先到，上面已经按「挂当前 assistant」处理了；
			// 这里把它从那条 assistant 上**取回**，改挂到反思自己的条目上（与后端形态一致）。
			const messages = ensure(id);
			const tail = messages[messages.length - 1];
			let usages: UsageEntry[] | undefined;
			if (tail?.role === 'assistant') {
				usages = tail.usages?.filter((u) => u.purpose === 'reflection');
				const rest = tail.usages?.filter((u) => u.purpose !== 'reflection');
				if (rest?.length) tail.usages = rest;
				else delete tail.usages;
			}
			messages.push({
				role: 'system',
				content: event.prompt,
				uiOnly: true,
				kind: 'reflection',
				data: { remaining: event.remaining },
				usages,
				updatedAt: Date.now(),
			});
			break;
		}

		case 'client_tool_call': {
			ensure(id).push({
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
			const meta = draft.meta[id];
			if (meta) meta.status = event.status;
			break;
		}

		default:
			break;
	}
}

/** 在 overlay 里把某次提问的状态改掉（回答 / 跳过） */
function setOverlayAskState(draft: OverlayCtx, callId: string, status: 'answered' | 'skipped', answer: string): void {
	for (const instance of Object.values(draft.instances)) {
		const entry = instance.messages.find(
			(m) => m.kind === 'ask_user_state' && (m.data as { callId?: string })?.callId === callId,
		);
		if (entry) {
			entry.data = { callId, status, answer };
			entry.updatedAt = Date.now();
			return;
		}
	}
}

// #endregion

// #region ask_user 提问卡片

/** 单选选项（每个可带描述）+ 自动附加的「其他」自由输入 +「还有什么要补充的吗？」+ 提交 / 跳过 */
function AskUserCard(props: {
	block: RenderAskInfo;
	onSubmit: (text: string) => void;
}) {
	const [choice, setChoice] = createSignal<string | null>(null);
	const [extra, setExtra] = createSignal('');
	const [freeText, setFreeText] = createSignal('');
	const answered = () => props.block.status !== 'waiting';

	const submit = () => {
		const parts: string[] = [];
		if (choice()) parts.push(`选择：${choice()}`);
		if (freeText().trim()) parts.push(freeText().trim());
		if (extra().trim()) parts.push(`补充：${extra().trim()}`);
		props.onSubmit(parts.join('\n') || '(未填写内容)');
	};

	return (
		<div class={styles['ask-card']} classList={{ [styles['is-answered']]: answered() }}>
			<div class={styles['ask-card-question']}>❓ {props.block.question}</div>
			<Show when={!answered()}>
				<Show when={props.block.options.length > 0}>
					<div class={styles['ask-card-options']}>
						<For each={props.block.options}>
							{(opt) => (
								<label class={styles['ask-card-option']}>
									<input
										type="radio"
										name={`ask-${props.block.callId}`}
										checked={choice() === opt.label}
										onchange={() => setChoice(opt.label)}
									/>
									<span class={styles['ask-card-option-label']}>{opt.label}</span>
									<Show when={opt.description}>
										<span class={styles['ask-card-option-desc']}>{opt.description}</span>
									</Show>
								</label>
							)}
						</For>
						<label class={styles['ask-card-option']}>
							<input type="radio" name={`ask-${props.block.callId}`} checked={choice() === '__other__'} onchange={() => setChoice('__other__')} />
							<span class={styles['ask-card-option-label']}>其他</span>
						</label>
					</div>
				</Show>

				<Show when={props.block.options.length === 0 || choice() === '__other__'}>
					<textarea
						class={styles['ask-card-input']}
						placeholder="直接输入你的回答..."
						rows={2}
						value={freeText()}
						oninput={(e) => setFreeText(e.currentTarget.value)}
					/>
				</Show>

				<div class={styles['ask-card-extra-label']}>还有什么要补充的吗？</div>
				<textarea
					class={styles['ask-card-input']}
					placeholder="可留空。补充说明会一起交给 Agent。"
					rows={2}
					value={extra()}
					oninput={(e) => setExtra(e.currentTarget.value)}
				/>

				<div class={styles['ask-card-actions']}>
					<button class={styles['ask-card-submit']} onclick={submit}>提交</button>
					<button class={styles['ask-card-skip']} onclick={() => props.onSubmit('用户已跳过此提问')}>跳过</button>
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
	// #region 局部状态

	const [inputText, setInputText] = createSignal('');
	const [isGenerating, setIsGenerating] = createSignal(false);
	/** 本轮 run 的即时错误（重拉 ctx 后由实例的 interruptReason 接管显示） */
	const [runError, setRunError] = createSignal<string | null>(null);
	/** 任务清单面板 */
	const [taskList, setTaskList] = createSignal('');
	const [taskListOpen, setTaskListOpen] = createSignal(false);
	/** 在飞 overlay：SSE 事件翻译成的「ctx 形状的增量」 */
	const [overlay, setOverlay] = createStore<OverlayCtx>(emptyOverlay());
	/** 流式期间的滚动触发（overlay 是 store，深度访问不好追踪，用一个计数器带一下） */
	const [streamTick, setStreamTick] = createSignal(0);
	/** 取消订阅函数 */
	let unsubscribeFn: (() => void) | null = null;

	// #endregion

	// #region 渲染树

	/** 界面内容：已提交的 ctx + 在飞的 overlay，共用同一个投影函数 */
	const renderTree = createMemo(() => {
		const conversation = getActiveConversation();
		streamTick();
		return foldCtxToRenderTree(mergeOverlayCtx(conversation?.agentCtx, overlay));
	});

	// #endregion

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

	const parseTaskListLines = (text: string) =>
		text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['));

	// #endregion

	// #region 下拉菜单（文件夹 / 模式 / 模型）

	let modelInput: FFBoxDropdownInput | undefined;

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

	const onFolderChange = (e: CustomEvent<string>) => {
		if (isGenerating()) return;	// 运行期间不让改工作目录（下一轮才生效的那类改动统一锁住）
		const value = e.detail;
		if (value === '__new__') {
			void (async () => {
				const folderPath = await requestFolderPath();
				if (!folderPath) return;
				const folder = actions.addFolder(folderPath);
				// 从这个下拉里新建文件夹，意图就是「把当前会话放进这个新目录」，顺手就切过去
				if (folder) {
					const conv = getActiveConversation();
					if (conv) actions.setConversationFolder(conv.id, folder.id);
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

	const onModeChange = (e: CustomEvent<string>) => {
		if (isGenerating()) return;	// 运行期间禁止改模式
		const value = e.detail;
		actions.setCurrentModeId(value);
		const conv = getActiveConversation();
		if (conv) void agentBridge.updateConversation(conv.id, { modeId: value });
	};

	/* === 模型选择：只读 DropdownInput === */
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

	const onModelChange = (e: CustomEvent<string>) => {
		if (isGenerating()) return;	// 运行期间禁止改运行语义（同「回复过程中不能点发送」）
		const value = e.detail;
		if (typeof value !== 'string') return;
		const sep = value.indexOf('/');
		if (sep <= 0) return;
		actions.setCurrentStandardModel({ providerId: value.slice(0, sep), modelId: value.slice(sep + 1) });
		if (modelInput) modelInput.text = currentModelDisplay();
	};

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

	const onScenarioChange = async (e: CustomEvent<string>) => {
		if (isGenerating()) return;
		const result = await actions.setMock({ scenario: e.detail });
		if (!result.ok) void alertMsgbox('切换剧本失败', result.error ?? '未知错误');
	};

	// #endregion

	// #endregion

	// #region 滚动与后端刷新

	const chatAreaRef = (el: HTMLDivElement) => {
		createEffect(() => {
			getActiveConversation();
			taskList();
			streamTick();
			queueMicrotask(() => {
				el.scrollTop = el.scrollHeight;
			});
		});
	};

	/** 刷新任务清单面板 */
	const refreshTaskList = async (convId: string) => {
		const list = await agentBridge.getTaskList(convId);
		setTaskList(list);
	};

	// #endregion

	// #region 一轮 run 的开始与结束
	//
	// 生命周期只有两个动作：
	//   beginRun —— 清空 overlay（清掉上一轮的残留）后发请求
	//   endRun   —— 重拉 ctx（拿「已提交」的内容）+ 清空 overlay
	// 中间不重拉：§6 决定了「在飞」的内容不在 ctx 里，靠 overlay 呈现即可。

	const beginRun = (convId: string) => {
		if (unsubscribeFn) {
			unsubscribeFn();
			unsubscribeFn = null;
		}
		// 每轮开始清掉上一轮的折叠记录：根实例是永续的，不清会串到新轮次的同名块上（见块渲染区的说明）
		openOverrides.clear();
		setRunError(null);
		setOverlay(emptyOverlay(convId, appState.currentModeId));
		setStreamTick((v) => v + 1);
		unsubscribeFn = agentBridge.subscribeStream(convId, (event) => handleStreamEvent(convId, event));
	};

	const endRun = async (convId: string) => {
		setIsGenerating(false);
		if (unsubscribeFn) {
			unsubscribeFn();
			unsubscribeFn = null;
		}
		await loadConversationCtx(convId, true);
		setOverlay(emptyOverlay(convId, appState.currentModeId));
	};

	// #endregion

	// #region 流式事件处理

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
		beginRun(convId);

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
	const handleAskUserAnswer = async (convId: string, callId: string, text: string) => {
		const skipped = text === '用户已跳过此提问';
		setOverlay(produce((draft) => setOverlayAskState(draft, callId, skipped ? 'skipped' : 'answered', text)));
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
	 * 投影每次重算都会**重建块对象**（流式期间每来一个增量就重算一次），DOM 上的 `<details>` 会被换掉，
	 * 不把用户的意愿记在这里就会被弹回去。key 用块的稳定标识（工具用 callId、子 Agent 用实例 id）——
	 * ⚠️ 每轮 run 开始时清空：根实例是永续的，不清的话上一条轮次的展开状态会串到新轮次的同名块上。
	 */
	const openOverrides = new Map<string, boolean>();
	const openState = (key: string, fallback: boolean) => openOverrides.get(key) ?? fallback;
	const rememberOpen = (key: string, isOpen: boolean) => {
		openOverrides.set(key, isOpen);
	};

	/** 一次 LLM 调用的账本：贴在所属块的**下方**（它是那次调用自带的一条数据，不是独立条目） */
	const renderUsage = (usage: UsageEntry) => {
		const parts: string[] = [`#${usage.seq ?? '?'}`];
		if (usage.round) parts.push(`第 ${usage.round} 轮`);
		parts.push(`↑${fmtTokens(usage.input)} ↓${fmtTokens(usage.output)}`);
		parts.push(`共 ${fmtTokens(usage.total)}`);
		if (usage.cached) parts.push(`缓存 ${fmtTokens(usage.cached)}`);
		const duration = fmtDuration(usage.durationMs);
		if (duration) parts.push(duration);
		if (usage.purpose && usage.purpose !== 'agent_loop') {
			parts.push(PURPOSE_LABEL[usage.purpose] ?? usage.purpose);
		}
		return (
			<div class={styles['agent-block-usage']}>
				<span class={styles['agent-usage-icon']}>🧮</span>
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
					<details class={styles['agent-block-reasoning']}>
						<summary>
							<span class={styles['agent-reasoning-label']}>💭 思考中</span>
							<span class={styles['agent-reasoning-peek']}>{sub.content.slice(-72)}</span>
						</summary>
						<div class={styles['agent-block-reasoning-body']}>{sub.content}</div>
					</details>
				);

			case 'text':
				return <div class={styles['agent-block-text']}>{sub.content}</div>;

			case 'reflection':
				// 反思同样是「一次 LLM 调用」，所以它也走 llm 块 —— 只是内容形态固定，折叠起来看
				return (
					<details class={styles['agent-block-reflection']}>
						<summary>🪞 反思轮{sub.remaining !== undefined ? `（剩 ${sub.remaining} 次）` : ''}</summary>
						<div class={styles['agent-block-reflection-body']}>{sub.content}</div>
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
							onSubmit={(text) => void handleAskUserAnswer(convId, tool.callId, text)}
						/>
					);
				}

				// 工具调用 = 一行摘要（状态 + 工具名 + 理由 + 输出预览）+ 可展开的入参与完整输出。
				const childCount = tool.children?.length ?? 0;
				// 普通工具：输出短就直接展开（一眼看到结果），长的折起来。
				// 子节点不再影响展开态 —— 它们已经不在这个 <details> 里了（见下面的注释）。
				const toolBlock = (
					<details
						class={styles['agent-block-tool']}
						classList={{ [styles['is-error']]: tool.status === 'error' }}
						open={openState(`tool:${tool.callId}`, tool.status === 'error' || (!!tool.output && tool.output.length <= 240))}
						ontoggle={(e) => rememberOpen(`tool:${tool.callId}`, e.currentTarget.open)}
					>
						<summary class={styles['agent-tool-summary']}>
							<span class={styles['agent-tool-icon']}>
								{tool.status === 'running' ? '⏳' : tool.status === 'success' ? '✓' : '✗'}
							</span>
							<span class={styles['agent-tool-name']}>{tool.name}</span>
							<Show when={childCount > 0}>
								{/* 子 Agent 渲染在这个块**下面**（同级），这里只提示它委托出去了几个 */}
								<span class={styles['agent-tool-owner']}>↳ {childCount} 个子 Agent</span>
							</Show>
							<Show when={tool.reason}>
								<span class={styles['agent-tool-reason']}>{tool.reason}</span>
							</Show>
							<Show
								when={tool.output}
								fallback={
									<Show when={tool.status === 'running'}>
										<span class={styles['agent-tool-preview']}>执行中…</span>
									</Show>
								}
							>
								<span class={styles['agent-tool-preview']}>
									{tool.output.replace(/\s+/g, ' ').trim().slice(0, 120)}
								</span>
							</Show>
						</summary>
						<div class={styles['agent-tool-body']}>
							<Show when={tool.args}>
								<div class={styles['agent-tool-section']}>入参</div>
								<pre class={styles['agent-tool-pre']}>{truncateWithNote(tool.args, TOOL_ARGS_LIMIT)}</pre>
							</Show>
							<Show when={tool.output}>
								<div class={styles['agent-tool-section']}>输出</div>
								<pre class={styles['agent-tool-pre']}>{truncateWithNote(tool.output, TOOL_OUTPUT_LIMIT)}</pre>
							</Show>
							<Show when={!tool.args && !tool.output}>
								<div class={styles['agent-tool-hint']}>
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

	/** 单个顶层块（`isRoot` 决定用户发言是否渲染成气泡：子 Agent 的任务已在头部显示） */
	const renderBlock = (block: RenderBlock, isRoot: boolean) => {
		switch (block.type) {
			case 'user':
				if (!isRoot) return null;
				return (
					<div class={`${styles.message} ${styles.user}`}>
						<div class={styles['message-avatar']}>
							<UserIcon />
						</div>
						<div class={styles['message-content']}>{block.content}</div>
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
				return <div class={styles['agent-block-error']}>❌ {block.message}</div>;

			case 'agent':
				return renderNode(block.node, false);
		}
	};

	/**
	 * 一个 Agent 实例 = 一个块序列（含它的子节点）。
	 * 子 Agent 用 `<details>` 整块折叠（状态 + 名字 + 任务在头部，展开才是它自己的产出）。
	 */
	const renderNode = (node: RenderAgentNode, isRoot: boolean) => {
		const blockList = () => (
			<>
				<For each={node.blocks}>{(block) => renderBlock(block, isRoot)}</For>
			</>
		);
		const usageFootnote = () => (
			<Show when={node.tokens || node.llmCalls > 0}>
				<div class={styles['agent-msg-usage']}>
					共 {node.llmCalls} 次 LLM 调用 · tokens ↑{fmtTokens(node.tokens?.input)} ↓{fmtTokens(node.tokens?.output)}
					<Show when={node.tokens?.inputCached}>
						{' '}· 缓存 {fmtTokens(node.tokens!.inputCached)}
					</Show>
					<Show when={node.rounds > 0}>
						{' '}· {node.rounds} 轮
					</Show>
				</div>
			</Show>
		);

		if (isRoot) {
			return (
				<div class={styles['agent-reply']}>
					{blockList()}
					{usageFootnote()}
				</div>
			);
		}

		return (
			<details
				class={styles['agent-node']}
				/* ⚠️ 默认展开：要的是「子 Agent 的内容都看得见，想收起来时自己收」。
				   曾经按 status 自动折（跑完就收起），结果是「子 Agent 一完成就从界面上消失」。 */
				open={openState(`node:${node.agentInstanceId}`, true)}
				ontoggle={(e) => rememberOpen(`node:${node.agentInstanceId}`, e.currentTarget.open)}
			>
				<summary class={styles['agent-node-header']}>
					<span>🤖</span>
					<span class={styles['agent-node-name']}>{node.agentName || node.agentId}</span>
					<span>{STATUS_LABEL[node.status] ?? node.status}</span>
					<Show when={node.task}>
						<span class={styles['agent-node-task']}>{node.task}</span>
					</Show>
				</summary>
				{blockList()}
				{usageFootnote()}
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
			{/* 顶部栏 */}
			<div class={styles['main-header']}>
				<div class={styles['conversation-title']}>{conversationTitle()}</div>
				<div class={styles['mode-toggle']}>
					<button
						classList={{ active: appState.ui.viewMode === 'chat' }}
						onclick={() => actions.setViewMode('chat')}
					>
						💬 聊天
					</button>
					<button
						classList={{ active: appState.ui.viewMode === 'diagram' }}
						onclick={() => actions.setViewMode('diagram')}
					>
						🔥 图示
					</button>
				</div>
			</div>

			{/* 聊天区域 */}
			<div class={styles['chat-area']} ref={chatAreaRef}>
				<Show when={!renderTree()}>
					<div class={styles['empty-state']}>
						<div class={styles['empty-state-logo']}>
							<SparkleIcon />
						</div>
						<h2>MindTheGap-Harness</h2>
						<p>告诉我你想做什么，我来帮你搞定 ✨</p>
					</div>
				</Show>

				<Show when={appState.ui.viewMode === 'chat' && renderTree()}>
					<div class={styles['message-list']}>
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

						{/* 转写：从根实例开始递归渲染 */}
						{renderNode(renderTree()!, true)}

						{/* 本轮即时错误（重拉 ctx 后由失败的实例自己带错误块） */}
						<Show when={runError()}>
							<div class={styles['agent-block-error']}>❌ {runError()}</div>
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
					<div class={styles['input-controls-top']}>
						<ffbox-dropdown-input
							class={styles['folder-dropdown']}
							title="运行文件夹"
							placeholder="选择文件夹"
							prop:readonly={true}
							prop:disabled={isGenerating()}
							prop:text={currentFolderDisplay()}
							prop:list={folderMenu()}
							onchange={onFolderChange}
						/>
						<ffbox-dropdown-input
							class={styles['mode-dropdown']}
							title="运行模式"
							placeholder="选择模式"
							prop:readonly={true}
							prop:disabled={isGenerating()}
							prop:text={currentModeLabel()}
							prop:list={modeMenu()}
							onchange={onModeChange}
						/>
						{/* 内置 mock 开关：常亮。开着时是红的 —— 假响应和真响应长得一模一样，
						    忘了关很容易误以为 Agent 真在工作（工具是真执行的） */}
						<button
							class={styles['chip-btn']}
							classList={{ [styles['is-mock']]: appState.mock.enabled }}
							disabled={isGenerating()}
							title={
								appState.mock.enabled
									? 'LLM 走内置 mock（工具仍真实执行）。运行期间不能切换'
									: '点一下打开：LLM 走内置 mock，工具仍真实执行'
							}
							onclick={() => void toggleMock()}
						>
							🎭 {appState.mock.enabled ? `mock：${appState.mock.scenario}` : 'mock 关'}
						</button>
						<Show when={appState.mock.enabled}>
							<ffbox-dropdown-input
								class={styles['mock-scenario']}
								title="mock 剧本"
								placeholder="选择剧本"
								prop:readonly={true}
								prop:disabled={isGenerating()}
								prop:text={currentScenarioLabel()}
								prop:list={scenarioMenu()}
								onchange={onScenarioChange}
							/>
						</Show>
					</div>

					<div class={styles['input-textarea-wrapper']}>
						<textarea
							class={styles['input-textarea']}
							placeholder="按 Enter 发送，Shift+Enter 换行..."
							value={inputText()}
							oninput={(e) => setInputText(e.currentTarget.value)}
							onkeydown={handleKeyDown}
							rows={1}
						/>
					</div>

					<div class={styles['input-controls-bottom']}>
						<button class={styles['input-add-btn']} title="添加图片/文件">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="12" y1="5" x2="12" y2="19"/>
								<line x1="5" y1="12" x2="19" y2="12"/>
							</svg>
						</button>

						<ffbox-dropdown-input
							ref={modelInput}
							class={styles['model-dropdown']}
							title="选择模型"
							placeholder="选择模型"
							prop:readonly={true}
							prop:disabled={isGenerating()}
							prop:text={currentModelDisplay()}
							prop:list={modelMenu()}
							onchange={onModelChange}
						/>

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
			</div>
		</div>
	);
}

// #endregion
