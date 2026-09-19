/* ==========================================================================
   主聊天视图 — MindTheGap-Harness

   对接 v2 Agent：
   - handleSend → agentBridge.runAgent（body 用 modeId）
   - subscribeStream 订阅流式事件实现打字机效果
   - 事件自带 agentInstanceId → 直接映射深度，并行子 Agent 也不会串层
   - ask_user 走 client_tool_call：渲染提问卡片，回答后 POST /api/agent/answer
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import type { FFBoxDropdownInput, MenuItem } from 'ffbox-ui';
import styles from './ChatView.module.css';
import { state as appState, actions, getActiveConversation, getProviderById, currentModeName } from '@mainview/store';
import type { Message, MessageBlock } from '@mainview/store';
import type { ModelConfig } from '@shared/agent';
import { runAgent, cancelAgent, subscribeStream, saveConversationData, getTaskList, getCtx } from '@mainview/agentBridge';
import type { AgentStreamEvent, ToolResult } from '@shared/agent';
import { requestFolderPath } from '@mainview/localBridge';
import { showMenu, alertMsgbox } from '@mainview/ffboxBridge';
import DiagramView from './DiagramView';

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

function ChevronDown() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="6 9 12 15 18 9"/>
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
		displayName: model.displayName,
		apiFormat: provider.apiFormat,
		baseUrl: provider.baseUrl,
		apiKey: provider.apiKey,
		customParams: { ...provider.customParams, ...model.customParams },
	};
}

/* ---------- 工具入参 / 输出的展示上限 ----------
   「透明」不等于「无上限」：一条 web_search 的结果动辄几万字符，
   全量塞进 message.blocks 会把会话文件撑爆、也会让 UI 卡死。
   这里截断到 8K 并注明总长度，完整内容仍在后端 ctx.json 里（图示模式可见）。 */
const TOOL_ARGS_LIMIT = 1500;
const TOOL_OUTPUT_LIMIT = 8000;

function truncateWithNote(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = text.slice(0, Math.floor(limit * 0.8));
	const tail = text.slice(-Math.floor(limit * 0.2));
	return `${head}\n\n…（已省略 ${text.length - head.length - tail.length} 字符，完整内容见后端 ctx）\n\n${tail}`;
}

/** 工具入参 → 可读字符串 */
function formatToolArgs(args: unknown): string {
	if (args === undefined || args === null) return '';
	const text = typeof args === 'string' ? args : (() => {
		try { return JSON.stringify(args, null, 2); } catch { return String(args); }
	})();
	return truncateWithNote(text, TOOL_ARGS_LIMIT);
}

/** 工具结果 → 可读字符串（失败时把错误信息也带上） */
function formatToolOutput(result: ToolResult): string {
	const body = result.content ?? '';
	if (!result.success) {
		return `[失败] ${result.error ? `${result.error}\n${body}` : body}`.trim();
	}
	return truncateWithNote(body, TOOL_OUTPUT_LIMIT);
}

/** 1234 → "1.2k"：账本里数字位数差别很大，统一压成短形式才不会把一行撑爆 */
function fmtTokens(n?: number): string {
	if (n === undefined || n === null) return '?';
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
}

function fmtDuration(ms?: number): string {
	if (!ms && ms !== 0) return '';
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** LLM 用途 → 中文标签。账本里的 purpose 是内部枚举，直接显示用户看不懂 */
const PURPOSE_LABEL: Record<string, string> = {
	agent_loop: '主循环',
	reflection: '反思',
	ask_child: '询问子 Agent',
	web_rank: '搜索结果打分',
	other: '其他',
};

/** agentLoop 中断原因 → 中文标签 */
const LOOP_REASON_LABEL: Record<string, string> = {
	ask_user: '等待用户回答',
	finish: '本段结束',
	interrupted: '被中断',
	error: '出错中止',
	await_child: '等待子 Agent',
};

/** ask_user 提问卡片 ----------
   单选选项（每个可带描述）+ 自动附加的「其他」自由输入 +「还有什么要补充的吗？」+ 提交 / 跳过 */

function AskUserCard(props: {
	block: Extract<MessageBlock, { type: 'ask_user' }>;
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
										name={`ask-${props.block.key}`}
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
							<input type="radio" name={`ask-${props.block.key}`} checked={choice() === '__other__'} onchange={() => setChoice('__other__')} />
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

export default function ChatView() {
	const [inputText, setInputText] = createSignal('');
	const [isGenerating, setIsGenerating] = createSignal(false);
	/** 当前流式写入的 assistant 消息 ID */
	const [streamMsgId, setStreamMsgId] = createSignal<string | null>(null);
	/** 任务清单面板 */
	const [taskList, setTaskList] = createSignal('');
	const [taskListOpen, setTaskListOpen] = createSignal(false);
	/** 取消订阅函数 */
	let unsubscribeFn: (() => void) | null = null;

	/* === Agent 层级追踪（一次 run 内有效）：
	   v2 的事件自带 agentInstanceId，因此只需要一张 id → depth 的映射，不再靠事件顺序猜深度。
	   另外记一张 id → 名称，用于在块上标注「这条是谁产生的」（子 Agent 的产出不再单独成块，
	   没有名字就看不出是根 Agent 还是哪个子 Agent 在说话）。 */
	let instanceDepths = new Map<string, number>();
	let instanceNames = new Map<string, string>();
	const depthOf = (agentInstanceId?: string) => (agentInstanceId ? instanceDepths.get(agentInstanceId) ?? 0 : 0);
	/** 只给 depth > 0（子 Agent）标注名字，根 Agent 不必重复显示 */
	const nameOf = (agentInstanceId?: string) => {
		if (!agentInstanceId) return undefined;
		return depthOf(agentInstanceId) > 0 ? instanceNames.get(agentInstanceId) : undefined;
	};
	const resetRunState = () => {
		instanceDepths = new Map();
		instanceNames = new Map();
	};

	/* === 下拉菜单 === */
	const [openMenu, setOpenMenu] = createSignal<'folder' | 'mode' | null>(null);

	let folderBtn: HTMLButtonElement | undefined;
	let modeBtn: HTMLButtonElement | undefined;
	let modelInput: FFBoxDropdownInput | undefined;

	const popupMenu = (id: 'folder' | 'mode', options: Parameters<typeof showMenu>[0]) => {
		setOpenMenu(id);
		showMenu({
			...options,
			onClose: () => {
				options.onClose?.();
				setOpenMenu(null);
			},
		});
	};

	/** 运行文件夹菜单 */
	const openFolderMenu = () => {
		const activeFolderId = getActiveConversation()?.folderId;
		const menu: MenuItem[] = [
			...appState.folders.map((f) => ({
				type: 'radio' as const,
				value: f.id,
				label: f.name,
				checked: activeFolderId === f.id,
			})),
			{ type: 'separator' as const },
			{ type: 'normal' as const, value: '__new__', label: '+ 新建文件夹…' },
		];
		popupMenu('folder', {
			triggerElem: folderBtn,
			type: 'select',
			menu,
			onSelect: (_e, value) => {
				if (value === '__new__') {
					void (async () => {
						const folderPath = await requestFolderPath();
						if (folderPath) {
							const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
							actions.addFolder(folderPath, folderName);
						}
					})();
					return;
				}
				const conv = getActiveConversation();
				if (conv) actions.setConversationFolder(conv.id, value);
			},
		});
	};

	/** 模式菜单（第一层的 chip 从「子 Agent」改成「模式」，数据来自 GET /api/modes） */
	const openModeMenu = () => {
		if (appState.modes.length === 0) {
			void alertMsgbox('没有可用模式', '插件里没有加载到任何模式，请到「设置 → 插件 / 模式」检查插件目录。');
			return;
		}
		popupMenu('mode', {
			triggerElem: modeBtn,
			type: 'select',
			menu: appState.modes.map((m) => ({
				type: 'radio' as const,
				value: m.id,
				label: `${m.ui?.icon ?? ''} ${m.name}`.trim(),
				checked: appState.currentModeId === m.id,
			})),
			onSelect: (_e, value) => {
				actions.setCurrentModeId(value);
				const conv = getActiveConversation();
				if (conv) void import('@mainview/agentBridge').then((b) => b.updateConversation(conv.id, { modeId: value }));
			},
		});
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
		const value = e.detail;
		if (typeof value !== 'string') return;
		const sep = value.indexOf('/');
		if (sep <= 0) return;
		actions.setCurrentStandardModel({ providerId: value.slice(0, sep), modelId: value.slice(sep + 1) });
		if (modelInput) modelInput.text = currentModelDisplay();
	};

	const chatAreaRef = (el: HTMLDivElement) => {
		createEffect(() => {
			getActiveConversation();
			taskList();
			queueMicrotask(() => {
				el.scrollTop = el.scrollHeight;
			});
		});
	};

	/** 刷新任务清单面板 */
	const refreshTaskList = async (convId: string) => {
		const list = await getTaskList(convId);
		setTaskList(list);
	};

	/** 拉一次最新 ctx 给结构图用（ctx 归后端所有，前端只持有快照，跑完必须重新拉） */
	const refreshCtx = async (convId: string) => {
		const ctx = await getCtx(convId);
		if (ctx) actions.setConversationCtx(convId, ctx);
	};

	/** 处理单个 AgentStreamEvent（全部写入结构化 blocks） */
	const handleStreamEvent = (convId: string, event: AgentStreamEvent) => {
		const msgId = streamMsgId();
		if (!msgId) return;

		switch (event.type) {
			case 'text':
				actions.appendMessageBlock(convId, msgId, {
					type: 'text',
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					agentName: nameOf(event.agentInstanceId),
					content: event.chunk,
				});
				break;

			case 'tool_start':
				actions.appendMessageBlock(convId, msgId, {
					type: 'tool',
					key: event.callId,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					agentName: nameOf(event.agentInstanceId),
					name: event.toolName,
					status: 'running',
					reason: event.reason,
					args: formatToolArgs(event.args),
				});
				break;

			case 'tool_end':
				// 工具输出原样展示：成功是结果正文，失败是错误信息。
				// delegate / resume_* 这类异步工具会先发一次「未完成」占位，
				// 子 Agent 终态时再发一次终态结果，同一个 key 直接覆盖即可。
				actions.patchMessageBlock(convId, msgId, event.callId, {
					status: event.result.success ? 'success' : 'error',
					output: formatToolOutput(event.result),
				} as Partial<MessageBlock>, 'tool');
				if (event.toolName === 'task_list_write' || event.toolName === 'task_list_read') {
					void refreshTaskList(convId);
				}
				break;

			case 'agent_start':
				// 只记层级与名字，不再生成「委托卡片」——委托本身就是一次工具调用，
				// 它的入参与结果（子 Agent 总结）都在 tool 块里，额外 UI 是重复的。
				instanceDepths.set(event.agentInstanceId, event.depth);
				instanceNames.set(event.agentInstanceId, event.agentName);
				break;

			case 'agent_end':
				break;

			case 'reasoning':
				// 思考模型的推理增量：实时显示，但折叠起来不抢正文的位置
				actions.appendMessageBlock(convId, msgId, {
					type: 'reasoning',
					key: `think-${event.agentInstanceId}-${Date.now()}`,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					content: event.chunk,
				});
				break;

			case 'reflection':
				actions.appendMessageBlock(convId, msgId, {
					type: 'reflection',
					key: `refl-${event.agentInstanceId}-${Date.now()}`,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					agentName: nameOf(event.agentInstanceId),
					remaining: event.remaining,
					text: event.prompt,
				});
				break;

			case 'client_tool_call':
				actions.appendMessageBlock(convId, msgId, {
					type: 'ask_user',
					key: event.callId,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					question: String((event.args as Record<string, unknown>)?.question ?? '需要你的确认'),
					options: ((event.args as Record<string, unknown>)?.options as { label: string; description?: string }[]) ?? [],
					status: 'waiting',
				});
				// 挂起：结束本轮「生成中」状态，让用户可以回答或直接发新消息（后者会把提问标记为跳过）
				finishStreaming();
				break;

			case 'error':
				actions.appendMessageBlock(convId, msgId, {
					type: 'error',
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					message: event.message,
				});
				finishStreaming();
				break;

			case 'usage': {
				const t = event.tokens ?? {};
				// scope='loop' 是「本段小计」，它只是对已播报过的单次调用再汇总一次，
				// 不能重复计入总量；只有 scope='call' 才代表真正多花了一次请求的钱。
				if (event.scope !== 'loop') {
					actions.addMessageTokens(convId, msgId, t);
				}
				actions.appendMessageBlock(convId, msgId, {
					type: 'usage',
					key: `usage-${event.logId ?? Date.now()}-${event.scope ?? 'call'}`,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					agentName: event.agentName ?? nameOf(event.agentInstanceId),
					scope: event.scope ?? 'call',
					input: t.input,
					output: t.output,
					cached: t.inputCached,
					total: t.total,
					seq: event.seq,
					round: event.round,
					purpose: event.purpose,
					durationMs: event.durationMs,
					model: event.model,
					deltaInput: event.loopDelta?.input,
					deltaOutput: event.loopDelta?.output,
					deltaTotal: event.loopDelta?.total,
					loopCalls: event.loopCalls,
					reason: event.reason,
				});
				break;
			}

			case 'done':
				{
					const conv = appState.conversations.find((c) => c.id === convId);
					const msg = conv?.messages.find((m) => m.id === msgId);
					const hasText = msg?.blocks?.some((b) => b.type === 'text') || !!msg?.content;
					if (!hasText && event.summary) {
						actions.appendMessageBlock(convId, msgId, { type: 'text', depth: 0, content: event.summary });
					}
				}
				void refreshTaskList(convId);
				void refreshCtx(convId);
				finishStreaming();
				break;
		}
	};

	/** 结束流式状态 */
	const finishStreaming = () => {
		const convId = appState.activeConversationId;
		setIsGenerating(false);
		setStreamMsgId(null);
		if (unsubscribeFn) {
			unsubscribeFn();
			unsubscribeFn = null;
		}
		if (convId) {
			const conv = appState.conversations.find((c) => c.id === convId);
			if (conv && conv.messages.length > 0) {
				// 只写 messages：UI 消息归前端所有，agentCtx 归后端所有（ctx.json 是 agent 层的唯一真相）。
				// 这里手上的 conv.agentCtx 只是「打开会话时的快照」，一并回写会把 Runner 刚更新过的
				// 实例树 / 轮次 / 预算回滚成旧值。
				void saveConversationData(convId, { messages: conv.messages });
			}
		}
	};

	/** 把一条 assistant 占位消息加到会话里，返回它的 id */
	const addAssistantPlaceholder = (convId: string): string | null => {
		actions.addMessage(convId, { role: 'assistant', content: '', modeId: appState.currentModeId });
		const conv = appState.conversations.find((c) => c.id === convId);
		return conv?.messages[conv.messages.length - 1]?.id ?? null;
	};

	/** 回答 ask_user 卡片：把答案续接回该实例，并开一条新的 assistant 消息承接后续输出 */
	const handleAskUserAnswer = async (convId: string, msgId: string, callId: string, text: string) => {
		actions.patchMessageBlock(convId, msgId, callId, {
			status: text === '用户已跳过此提问' ? 'skipped' : 'answered',
			answer: text,
		} as Partial<MessageBlock>);

		if (text === '用户已跳过此提问') return;

		const newMsgId = addAssistantPlaceholder(convId);
		if (!newMsgId) return;
		setIsGenerating(true);
		setStreamMsgId(newMsgId);
		unsubscribeFn = subscribeStream(convId, (event) => handleStreamEvent(convId, event));

		const result = await actions.answerToolCall(convId, callId, text);
		if (!result.ok) {
			actions.appendMessageBlock(convId, newMsgId, { type: 'error', depth: 0, message: `回答提交失败: ${result.error}` });
			finishStreaming();
		}
	};

	const handleSend = async () => {
		const text = inputText().trim();
		if (!text || isGenerating()) return;

		const modelConfig = buildModelConfig();
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
		} else if (conv.messages.length === 0) {
			await actions.renameConversation(conv.id, text.slice(0, 30));
		}
		const convId = conv.id;

		// 用户直接发新消息：把仍等待回答的卡片标记为已跳过
		for (const msg of conv.messages) {
			for (const block of msg.blocks ?? []) {
				if (block.type === 'ask_user' && block.status === 'waiting') {
					actions.patchMessageBlock(convId, msg.id, block.key, { status: 'skipped', answer: '用户已跳过此提问' } as Partial<MessageBlock>);
				}
			}
		}

		actions.addMessage(convId, { role: 'user', content: text });
		const assistantMsgId = addAssistantPlaceholder(convId);
		if (!assistantMsgId) {
			console.error('[ChatView] 没能获取新添加的 assistant 消息');
			return;
		}

		setInputText('');
		setIsGenerating(true);
		setStreamMsgId(assistantMsgId);
		resetRunState();

		unsubscribeFn = subscribeStream(convId, (event) => handleStreamEvent(convId, event));

		try {
			const result = await runAgent({
				conversationId: convId,
				userMessage: text,
				modeId: appState.currentModeId,
				model: modelConfig,
			});

			if (!result.ok) {
				actions.updateMessage(convId, assistantMsgId, { content: `❌ Agent 错误: ${result.error}` });
				finishStreaming();
			}
		} catch (err: any) {
			actions.updateMessage(convId, assistantMsgId, { content: `❌ 调用失败: ${err?.message || String(err)}` });
			finishStreaming();
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
		if (conv) await cancelAgent(conv.id);
		finishStreaming();
	};

	onCleanup(() => {
		if (unsubscribeFn) unsubscribeFn();
	});

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
		return folder?.name || '本地';
	};

	const conversationTitle = () => getActiveConversation()?.title || '新任务';

	const parseTaskListLines = (text: string) =>
		text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['));

	/** 渲染单个结构化块：文本 / 工具调用 / 子 Agent / 反思轮 / 提问卡片 / 错误 */
	const renderBlock = (block: MessageBlock, msgId: string) => {
		const indent = { 'margin-left': `${block.depth * 18}px` };
		const convId = appState.activeConversationId ?? '';

		switch (block.type) {
			case 'text':
				return (
					<div style={indent}>
						<Show when={block.agentName}>
							<div class={styles['agent-block-owner']}>🤖 {block.agentName}</div>
						</Show>
						<div class={styles['agent-block-text']}>{block.content}</div>
					</div>
				);

			case 'tool': {
				// 工具调用 = 一行摘要（谁调用 / 调什么 / 为什么 / 状态 / 输出预览）+ 可展开的入参与完整输出。
				// 委托、总结返回（finish）、ask_user 在后端都是工具调用，因此一律走这里，不另设 UI。
				return (
					<details
						class={styles['agent-block-tool']}
						style={indent}
						classList={{ [styles['is-error']]: block.status === 'error' }}
						/* 直接在属性里写表达式（而不是先算好存常量），Solid 才会把它编译成响应式更新：
						   工具结果到达时，短输出 / 出错的块会自动展开，长的仍保持折叠。 */
						open={block.status === 'error' || (!!block.output && block.output.length <= 240) ? true : undefined}
					>
						<summary class={styles['agent-tool-summary']}>
							<span class={styles['agent-tool-icon']}>
								{block.status === 'running' ? '⏳' : block.status === 'success' ? '✓' : '✗'}
							</span>
							<span class={styles['agent-tool-name']}>{block.name}</span>
							<Show when={block.agentName}>
								<span class={styles['agent-tool-owner']}>{block.agentName}</span>
							</Show>
							<Show when={block.reason}>
								<span class={styles['agent-tool-reason']}>{block.reason}</span>
							</Show>
							<Show
								when={block.output}
								fallback={
									<Show when={block.status === 'running'}>
										<span class={styles['agent-tool-preview']}>执行中…</span>
									</Show>
								}
							>
								<span class={styles['agent-tool-preview']}>
									{block.output!.replace(/\s+/g, ' ').trim().slice(0, 120)}
								</span>
							</Show>
						</summary>
						<div class={styles['agent-tool-body']}>
							<Show when={block.args}>
								<div class={styles['agent-tool-section']}>入参</div>
								<pre class={styles['agent-tool-pre']}>{block.args}</pre>
							</Show>
							<Show when={block.output}>
								<div class={styles['agent-tool-section']}>输出</div>
								<pre class={styles['agent-tool-pre']}>{block.output}</pre>
							</Show>
							<Show when={!block.args && !block.output}>
								<div class={styles['agent-tool-hint']}>
									{block.status === 'running' ? '等待工具返回…' : '（该工具没有输出）'}
								</div>
							</Show>
						</div>
					</details>
				);
			}

			case 'agent':
				// 旧会话数据兼容：委托早已不再单独成块，这里退化成一行（不再显示 summary）
				return (
					<div class={styles['agent-block-agent']} style={indent}>
						<span class={styles['agent-tool-icon']}>🤖</span>
						<span class={styles['agent-tool-name']}>{block.name}</span>
					</div>
				);

			case 'reasoning':
				// 思考过程默认折叠，但 summary 里实时滚出末尾几个字，
				// 这样即使折叠着也能看出「模型还在动」，而不是界面一片死寂。
				return (
					<details class={styles['agent-block-reasoning']} style={indent}>
						<summary>
							<span class={styles['agent-reasoning-label']}>💭 思考中</span>
							<span class={styles['agent-reasoning-peek']}>{block.content.slice(-72)}</span>
						</summary>
						<div class={styles['agent-block-reasoning-body']}>{block.content}</div>
					</details>
				);

			case 'usage': {
				// 单次调用一行「流水」；agentLoop 中断时一行「小计」（加粗，因为它才是用户要看的那个数）
				const isLoop = block.scope === 'loop';
				const parts: string[] = [];
				if (isLoop) {
					parts.push(`本段 ${block.loopCalls ?? 0} 次调用`);
					parts.push(`↑${fmtTokens(block.deltaInput)} ↓${fmtTokens(block.deltaOutput)}`);
					parts.push(`本段共 ${fmtTokens(block.deltaTotal)}`);
					parts.push(`累计 ${fmtTokens(block.total)}`);
					if (block.reason) parts.push(LOOP_REASON_LABEL[block.reason] ?? block.reason);
				} else {
					parts.push(`#${block.seq ?? '?'}`);
					if (block.round) parts.push(`第 ${block.round} 轮`);
					parts.push(`↑${fmtTokens(block.input)} ↓${fmtTokens(block.output)}`);
					parts.push(`共 ${fmtTokens(block.total)}`);
					if (block.cached) parts.push(`缓存 ${fmtTokens(block.cached)}`);
					const dur = fmtDuration(block.durationMs);
					if (dur) parts.push(dur);
					if (block.purpose && block.purpose !== 'agent_loop') {
						parts.push(PURPOSE_LABEL[block.purpose] ?? block.purpose);
					}
				}
				return (
					<div
						class={styles['agent-block-usage']}
						style={indent}
						classList={{ [styles['is-loop']]: isLoop }}
					>
						<span class={styles['agent-usage-icon']}>{isLoop ? '∑' : '🧮'}</span>
						<Show when={block.agentName}>
							<span class={styles['agent-usage-owner']}>{block.agentName}</span>
						</Show>
						<span class={styles['agent-usage-text']}>{parts.join(' · ')}</span>
					</div>
				);
			}

			case 'reflection':
				return (
					<details class={styles['agent-block-reflection']} style={indent}>
						<summary>
							🪞 反思轮（剩 {block.remaining} 次）
							<Show when={block.agentName}>
								<span class={styles['agent-tool-owner']}>{block.agentName}</span>
							</Show>
						</summary>
						<div class={styles['agent-block-reflection-body']}>{block.text}</div>
					</details>
				);

			case 'ask_user':
				return (
					<div style={indent}>
						<AskUserCard
							block={block}
							onSubmit={(text) => void handleAskUserAnswer(convId, msgId, block.key, text)}
						/>
					</div>
				);

			case 'error':
				return <div class={styles['agent-block-error']} style={indent}>❌ {block.message}</div>;
		}
	};

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
				<Show when={!getActiveConversation() || getActiveConversation()!.messages.length === 0}>
					<div class={styles['empty-state']}>
						<div class={styles['empty-state-logo']}>
							<SparkleIcon />
						</div>
						<h2>MindTheGap-Harness</h2>
						<p>告诉我你想做什么，我来帮你搞定 ✨</p>
					</div>
				</Show>

				<Show when={appState.ui.viewMode === 'chat' && getActiveConversation()}>
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

						<For each={getActiveConversation()!.messages}>
							{(msg) => (
								<Show
									when={msg.role === 'assistant'}
									fallback={
										<div class={`${styles.message} ${styles[msg.role]}`}>
											<div class={styles['message-avatar']}>
												<UserIcon />
											</div>
											<div class={styles['message-content']}>{msg.content}</div>
										</div>
									}
								>
									<div class={styles['agent-reply']}>
										<Show
											when={msg.blocks?.length}
											fallback={<div class={styles['agent-block-text']}>{msg.content}</div>}
										>
											<For each={msg.blocks}>
												{(block) => renderBlock(block, msg.id)}
											</For>
										</Show>
										{/* 用量脚注：ctx 里记的账本，前端能看到才算透明 */}
										<Show when={msg.tokens}>
											<div class={styles['agent-msg-usage']}>
												共 {msg.llmCalls ?? 0} 次 LLM 调用 · tokens ↑{fmtTokens(msg.tokens!.input)} ↓{fmtTokens(msg.tokens!.output)}
												<Show when={msg.tokens!.cached}>
													{' '}· 缓存 {fmtTokens(msg.tokens!.cached)}
												</Show>
												<Show when={msg.duration}>
													{' '}· {(msg.duration! / 1000).toFixed(1)}s
												</Show>
											</div>
										</Show>
									</div>
								</Show>
							)}
						</For>
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
						<button
							ref={folderBtn}
							classList={{ [styles['chip-btn']]: true, [styles.active]: openMenu() === 'folder' }}
							title='运行文件夹'
							onclick={openFolderMenu}
						>
							📁 <span class={styles['chip-label']}>{currentFolderDisplay()}</span>
							<ChevronDown />
						</button>

						{/* 模式 chip（v1 的「子 Agent」chip） */}
						<button
							ref={modeBtn}
							classList={{ [styles['chip-btn']]: true, [styles.active]: openMenu() === 'mode' }}
							title="运行模式"
							onclick={openModeMenu}
						>
							{appState.modes.find((m) => m.id === appState.currentModeId)?.ui?.icon ?? '🤖'}{' '}
							<span class={styles['chip-label']}>{currentModeName()}</span>
							<ChevronDown />
						</button>
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
