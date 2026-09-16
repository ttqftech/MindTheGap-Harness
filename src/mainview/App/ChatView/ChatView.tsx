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
import { state as appState, actions, getActiveConversation, getProviderById, currentModeName } from '../../store';
import type { Message, MessageBlock } from '../../store';
import type { ModelConfig } from '../../../shared/agent';
import { runAgent, cancelAgent, subscribeStream, saveConversationData, getTaskList, getCtx } from '../../agentBridge';
import type { AgentStreamEvent } from '../../../shared/agent';
import { requestFolderPath } from '../../localBridge';
import { showMenu, alertMsgbox } from '../../ffboxBridge';
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

/* ---------- ask_user 提问卡片 ----------
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
	   v2 的事件自带 agentInstanceId，因此只需要一张 id → depth 的映射，不再靠事件顺序猜深度 === */
	let instanceDepths = new Map<string, number>();
	const depthOf = (agentInstanceId?: string) => (agentInstanceId ? instanceDepths.get(agentInstanceId) ?? 0 : 0);
	const resetRunState = () => {
		instanceDepths = new Map();
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
				if (conv) void import('../../agentBridge').then((b) => b.updateConversation(conv.id, { modeId: value }));
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
					content: event.chunk,
				});
				break;

			case 'tool_start':
				actions.appendMessageBlock(convId, msgId, {
					type: 'tool',
					key: event.callId,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
					name: event.toolName,
					status: 'running',
					reason: event.reason,
				});
				break;

			case 'tool_end':
				actions.patchMessageBlock(convId, msgId, event.callId, {
					status: event.result.success ? 'success' : 'error',
					detail: event.result.success
						? undefined
						: event.result.error || event.result.content?.slice(0, 200),
				} as Partial<MessageBlock>);
				if (event.toolName === 'task_list_write' || event.toolName === 'task_list_read') {
					void refreshTaskList(convId);
				}
				break;

			case 'agent_start':
				instanceDepths.set(event.agentInstanceId, event.depth);
				if (event.depth > 0) {
					actions.appendMessageBlock(convId, msgId, {
						type: 'agent',
						key: event.agentInstanceId,
						depth: event.depth,
						agentInstanceId: event.agentInstanceId,
						name: event.agentName,
						running: true,
					});
				}
				break;

			case 'agent_end':
				if (depthOf(event.agentInstanceId) > 0) {
					actions.patchMessageBlock(convId, msgId, event.agentInstanceId, {
						running: false,
						summary: event.summary?.slice(0, 500) || `（${event.status}）`,
					} as Partial<MessageBlock>);
				}
				break;

			case 'reflection':
				actions.appendMessageBlock(convId, msgId, {
					type: 'reflection',
					key: `refl-${event.agentInstanceId}-${Date.now()}`,
					depth: depthOf(event.agentInstanceId),
					agentInstanceId: event.agentInstanceId,
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

			case 'usage':
				actions.updateMessage(convId, msgId, { tokens: event.tokens });
				break;

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
				return <div class={styles['agent-block-text']} style={indent}>{block.content}</div>;

			case 'tool':
				return (
					<div class={styles['agent-block-tool']} style={indent} classList={{ [styles['is-error']]: block.status === 'error' }}>
						<span class={styles['agent-tool-icon']}>
							{block.status === 'running' ? '⏳' : block.status === 'success' ? '✓' : '✗'}
						</span>
						<span class={styles['agent-tool-name']}>{block.name}</span>
						<Show when={block.reason}>
							<span class={styles['agent-tool-reason']}>原因：{block.reason}</span>
						</Show>
						<Show when={block.status === 'error' && block.detail}>
							<span class={styles['agent-tool-detail']}>{block.detail}</span>
						</Show>
					</div>
				);

			case 'agent':
				return (
					<div class={styles['agent-block-agent']} style={indent} classList={{ [styles['is-running']]: block.running }}>
						<div class={styles['agent-block-agent-header']}>
							<span class={styles['agent-tool-icon']}>{block.running ? '⏳' : '🤖'}</span>
							<span class={styles['agent-tool-name']}>委托 → {block.name}</span>
						</div>
						<Show when={block.summary}>
							<div class={styles['agent-block-agent-summary']}>{block.summary}</div>
						</Show>
					</div>
				);

			case 'reflection':
				return (
					<details class={styles['agent-block-reflection']} style={indent}>
						<summary>🪞 反思轮（剩 {block.remaining} 次）</summary>
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
