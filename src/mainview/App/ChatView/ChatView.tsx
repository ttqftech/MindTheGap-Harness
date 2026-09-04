/* ==========================================================================
   主聊天视图 — MindTheGap-Harness
   
   对接 Agent 引擎：
   - handleSend → rpc.request.agentRun 发起 Agent
   - subscribeAgentStream 订阅流式事件实现打字机效果
   - text chunk → appendMessageContent 追加到 assistant 消息
   - done / error → 结束 generating 状态
   ========================================================================== */

import { createEffect, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import styles from './ChatView.module.css';
import { Portal } from 'solid-js/web';
import { state as appState, actions, getActiveConversation, getProviderById } from '../../store';
import type { Message, MessageBlock } from '../../store';
import type { AgentName, ModelConfig } from '../../../shared/agent';
import { runAgent, cancelAgent, subscribeStream, saveConversationData } from '../../agentBridge';
import type { AgentStreamEvent } from '../shared/agent';
import { dialog } from '../../localBridge';
import DiagramView from './DiagramView';

/** 把 dropdown 挂到 body 并定位到触发按钮下方，超出视口则向上弹 */
function FixedDropdown(props: {
	btnEl: HTMLElement | undefined;
	class?: string;
	children: any;
}) {
	let dropEl: HTMLDivElement | undefined;

	onMount(() => {
		if (!props.btnEl || !dropEl) return;
		const rect = props.btnEl.getBoundingClientRect();
		dropEl.style.position = 'fixed';
		dropEl.style.left = `${rect.left}px`;

		// 先放到按钮下方，测量高度后检测是否超出视口
		dropEl.style.top = `${rect.bottom}px`;
		const h = dropEl.offsetHeight;
		const viewportBottom = window.innerHeight;

		if (rect.bottom + h > viewportBottom) {
			// 向上弹，距离按钮底部 4px gap
			dropEl.style.top = `${Math.max(8, rect.top - h - 4)}px`;
			dropEl.classList.add(styles['chip-dropdown-flip-up']);
		}
	});

	return (
		<Portal>
			<div
				ref={dropEl}
				class={props.class}
				style={{ zIndex: 9999, overflow: 'visible' }}
				onclick={(e) => e.stopPropagation()}
			>
				{props.children}
			</div>
		</Portal>
	);
}

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

export default function ChatView() {
	const [inputText, setInputText] = createSignal('');
	const [isGenerating, setIsGenerating] = createSignal(false);
	/** 当前流式写入的 assistant 消息 ID */
	const [streamMsgId, setStreamMsgId] = createSignal<string | null>(null);
	/** 取消订阅函数 */
	let unsubscribeFn: (() => void) | null = null;

	/* === Agent 层级追踪（一次 run 内有效） === */
	/** workId → 层级深度（根=0） */
	let workDepths = new Map<string, number>();
	/** 当前收到事件的 Agent 深度（text/tool 事件不带 workId，按事件流顺序归属） */
	let currentDepth = 0;

	const resetRunState = () => {
		workDepths = new Map();
		currentDepth = 0;
	};

	/* === 下拉菜单状态 === */
	const [showFolderMenu, setShowFolderMenu] = createSignal(false);
	const [showModeMenu, setShowModeMenu] = createSignal(false);
	const [showModelMenu, setShowModelMenu] = createSignal(false);

	// 三个触发按钮的 ref（给 FixedDropdown 定位用）
	let folderBtn: HTMLElement | undefined;
	let modeBtn: HTMLElement | undefined;
	let modelBtn: HTMLElement | undefined;
	const closeAllMenus = () => {
		setShowFolderMenu(false);
		setShowModeMenu(false);
		setShowModelMenu(false);
	};

	// 点击页面其他区域关闭所有下拉菜单
	createEffect(() => {
		if (showFolderMenu() || showModeMenu() || showModelMenu()) {
			const handler = () => closeAllMenus();
			window.addEventListener('click', handler);
			onCleanup(() => window.removeEventListener('click', handler));
		}
	});

	const chatAreaRef = (el: HTMLDivElement) => {
		// 自动滚动到底部
		createEffect(() => {
			getActiveConversation(); // 触发响应式
			queueMicrotask(() => {
				el.scrollTop = el.scrollHeight;
			});
		});
	};

	/** 处理单个 AgentStreamEvent（全部写入结构化 blocks，不替换已有内容） */
	const handleStreamEvent = (convId: string, event: AgentStreamEvent) => {
		const msgId = streamMsgId();
		console.log(`[ChatView] agentStream received: type=${event.type}, msgId=${msgId}, convId=${convId}`);
		if (!msgId) return;

		switch (event.type) {
			case 'text':
				actions.appendMessageBlock(convId, msgId, {
					type: 'text',
					depth: currentDepth,
					content: event.chunk,
				});
				break;

			case 'tool_start':
				actions.appendMessageBlock(convId, msgId, {
					type: 'tool',
					key: event.callId,
					depth: currentDepth,
					name: event.toolName,
					status: 'running',
				});
				break;

			case 'tool_end':
				actions.patchMessageBlock(convId, msgId, event.callId, {
					status: event.result.success ? 'success' : 'error',
					detail: event.result.success
						? undefined
						: event.result.error || event.result.content?.slice(0, 200),
				} as Partial<MessageBlock>);
				break;

			case 'agent_start':
				// 根 Agent 深度 0；子 Agent 由 transfer 事件先记录深度
				if (!workDepths.has(event.workId)) {
					workDepths.set(event.workId, currentDepth);
				}
				currentDepth = workDepths.get(event.workId)!;
				break;

			case 'transfer': {
				// 转接：子 Agent 深度 = 父深度 + 1，后续事件归属子 Agent
				const parentDepth = workDepths.get(event.fromWorkId) ?? currentDepth;
				const childDepth = parentDepth + 1;
				workDepths.set(event.toWorkId, childDepth);
				currentDepth = childDepth;
				actions.appendMessageBlock(convId, msgId, {
					type: 'agent',
					key: event.toWorkId,
					depth: childDepth,
					name: event.targetAgentName,
					running: true,
				});
				break;
			}

			case 'agent_end': {
				// 子 Agent 结束：回填总结，当前深度回到父级
				const d = workDepths.get(event.workId);
				if (d != null) currentDepth = Math.max(0, d - 1);
				actions.patchMessageBlock(convId, msgId, event.workId, {
					running: false,
					summary: event.summary?.slice(0, 500),
				} as Partial<MessageBlock>);
				break;
			}

			case 'error':
				actions.appendMessageBlock(convId, msgId, {
					type: 'error',
					depth: currentDepth,
					message: event.message,
				});
				finishStreaming();
				break;

			case 'usage':
				actions.updateMessage(convId, msgId, { tokens: event.tokens });
				break;

			case 'done':
				// 完整保留本次运行的所有块（文本/工具/转接），只在完全没收到
				// 文本时用 finalSummary 兜底，绝不替换已有内容
				{
					const conv = appState.conversations.find((c) => c.id === convId);
					const msg = conv?.messages.find((m) => m.id === msgId);
					const hasText = msg?.blocks?.some((b) => b.type === 'text') || !!msg?.content;
					if (!hasText && event.finalSummary) {
						actions.appendMessageBlock(convId, msgId, {
							type: 'text',
							depth: 0,
							content: event.finalSummary,
						});
					}
				}
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
				void saveConversationData(convId, {
					messages: conv.messages,
					agentCtx: conv.agentCtx,
				});
			}
		}
	};

	const handleSend = async () => {
		const text = inputText().trim();
		if (!text || isGenerating()) return;

		// 检查模型配置
		const modelConfig = buildModelConfig();
		if (!modelConfig) {
			alert('请先在设置中配置模型！');
			return;
		}

		// 获取或创建会话
		let conv = getActiveConversation();
		if (!conv) {
			conv = actions.createConversation('local', text.slice(0, 20) || '新任务');
		} else if (conv.messages.length === 0) {
			actions.renameConversation(conv.id, text.slice(0, 30));
		}
		const convId = conv.id;

		// 添加用户消息
		actions.addMessage(convId, { role: 'user', content: text });

		// 添加空的 assistant 消息占位（用于流式填充）
		const assistantMsg: Omit<Message, 'id' | 'createdAt'> = {
			role: 'assistant',
			content: '',
			agentName: appState.currentAgentName,
		};
		actions.addMessage(convId, assistantMsg);
		// 拿到刚添加的消息 ID
		const convAfterAdd = appState.conversations.find((c) => c.id === convId);
		const addedMsg = convAfterAdd?.messages[convAfterAdd.messages.length - 1];
		if (!addedMsg) {
			console.error('[ChatView] 没能获取新添加的 assistant 消息');
			return;
		}

		setInputText('');
		setIsGenerating(true);
		setStreamMsgId(addedMsg.id);
		resetRunState();

		// 订阅流式事件
		unsubscribeFn = subscribeStream(convId, (event) => {
			console.log(`[ChatView] stream callback fired for ${convId}`);
			handleStreamEvent(convId, event);
		});

		try {
			console.log(`[ChatView] calling runAgent for ${convId}...`);
			const result = await runAgent({
				conversationId: convId,
				userMessage: text,
				agentName: appState.currentAgentName,
				model: modelConfig,
			});

			if (!result.ok) {
				// 启动失败：不会有 done 事件，这里收尾并显示错误
				actions.updateMessage(convId, addedMsg.id, {
					content: `❌ Agent 错误: ${result.error}`,
				});
				finishStreaming();
			}
			// result.ok：runAgent 是 fire-and-forget，agent 后台跑，
			// 流式事件从 agentStream 推送，真正的结束由 done/error 事件触发 finishStreaming。
		} catch (err: any) {
			actions.updateMessage(convId, addedMsg.id, {
				content: `❌ RPC 调用失败: ${err?.message || String(err)}`,
			});
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
		if (conv) {
			await cancelAgent(conv.id);
		}
		finishStreaming();
	};

	// 组件卸载时清理订阅
	onCleanup(() => {
		if (unsubscribeFn) unsubscribeFn();
	});

	// 获取当前选中的模型显示名
	const currentModelDisplay = () => {
		const ref = appState.currentStandardModel;
		if (!ref) return '未选择模型';
		const provider = getProviderById(ref.providerId);
		const model = provider?.models.find((m) => m.id === ref.modelId);
		if (!provider || !model) return '未选择模型';
		return `${provider.name} / ${model.displayName}`;
	};

	// 获取当前运行文件夹
	const currentFolderDisplay = () => {
		const conv = getActiveConversation();
		if (!conv) return '选择文件夹...';
		const folder = appState.folders.find((f) => f.id === conv.folderId);
		return folder?.name || '本地';
	};

	const conversationTitle = () => {
		const conv = getActiveConversation();
		return conv?.title || '新任务';
	};

	/** 渲染单个结构化块（Agent 回复）：文本/工具调用/子Agent转接/错误 */
	const renderBlock = (block: MessageBlock) => {
		const indent = { 'margin-left': `${block.depth * 18}px` };

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
							<span class={styles['agent-tool-name']}>转接 → {block.name} Agent</span>
						</div>
						<Show when={block.summary}>
							<div class={styles['agent-block-agent-summary']}>{block.summary}</div>
						</Show>
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
				{/* 空状态 */}
				<Show when={!getActiveConversation() || getActiveConversation()!.messages.length === 0}>
					<div class={styles['empty-state']}>
						<div class={styles['empty-state-logo']}>
							<SparkleIcon />
						</div>
						<h2>MindTheGap-Harness</h2>
						<p>告诉我你想做什么，我来帮你搞定 ✨</p>
					</div>
				</Show>

				{/* 消息列表（聊天模式） */}
				<Show when={appState.ui.viewMode === 'chat' && getActiveConversation()}>
					<div class={styles['message-list']}>
						<For each={getActiveConversation()!.messages}>
							{(msg) => (
								<Show
									when={msg.role === 'assistant'}
									fallback={
										/* 用户消息：右侧气泡（保留头像+气泡样式） */
										<div class={`${styles.message} ${styles[msg.role]}`}>
											<div class={styles['message-avatar']}>
												<UserIcon />
											</div>
											<div class={styles['message-content']}>{msg.content}</div>
										</div>
									}
								>
									{/* AI 回复：无头像、无气泡，结构化块全保留 + 层级缩进 */}
									<div class={styles['agent-reply']}>
										<Show
											when={msg.blocks?.length}
											fallback={<div class={styles['agent-block-text']}>{msg.content}</div>}
										>
											<For each={msg.blocks}>
												{(block) => renderBlock(block)}
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
					{/* 上方控件 */}
					<div class={styles['input-controls-top']}>
						{/* 运行文件夹 */}
						<div class={styles['chip-wrapper']}>
							<button
								ref={folderBtn}
								classList={{ [styles['chip-btn']]: true, [styles.active]: showFolderMenu() }}
								title='运行文件夹'
								onclick={(e) => {
									e.stopPropagation();
									closeAllMenus();
									setShowFolderMenu((v) => !v);
								}}
							>
								📁 <span class={styles['chip-label']}>{currentFolderDisplay()}</span>
								<ChevronDown />
							</button>
							<Show when={showFolderMenu()}>
								<FixedDropdown btnEl={folderBtn} class={styles['chip-dropdown']}>
									<For each={appState.folders}>
										{(f) => (
											<button
												class={styles['chip-dropdown-item']}
												onclick={() => {
													const conv = getActiveConversation();
													if (conv) {
														actions.setConversationFolder(conv.id, f.id);
													}
													closeAllMenus();
												}}
											>
												{f.icon} {f.name}
											</button>
										)}
									</For>
									<div class={styles['chip-dropdown-divider']} />
									<button
										class={`${styles['chip-dropdown-item']} ${styles['chip-dropdown-secondary']}`}
										onclick={async () => {
											const folderPath = await dialog.pickFolder();
											if (folderPath) {
												const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
												actions.addFolder(folderPath, folderName);
											}
											closeAllMenus();
										}}
									>
										+ 新建文件夹…
									</button>
								</FixedDropdown>
							</Show>
						</div>

						{/* Agent 模式 */}
						<div class={styles['chip-wrapper']}>
							<button
								ref={modeBtn}
								classList={{ [styles['chip-btn']]: true, [styles.active]: showModeMenu() }}
								title="运行模式"
								onclick={(e) => {
									e.stopPropagation();
									closeAllMenus();
									setShowModeMenu((v) => !v);
								}}
							>
								🤖 <span class={styles['chip-label']}>{appState.currentAgentName}</span>
								<ChevronDown />
							</button>
							<Show when={showModeMenu()}>
								<FixedDropdown btnEl={modeBtn} class={styles['chip-dropdown']}>
									<For each={(['默认', '编码', '文件夹浏览总结'] as const)}>
										{(mode) => (
											<button
												classList={{
													[styles['chip-dropdown-item']]: true,
													[styles.selected]: appState.currentAgentName === mode,
												}}
												onclick={() => {
													actions.setCurrentAgentName(mode as AgentName);
													closeAllMenus();
												}}
											>
												{appState.currentAgentName === mode ? '✓ ' : ''}{mode}
											</button>
										)}
									</For>
								</FixedDropdown>
							</Show>
						</div>
					</div>

					{/* 输入框 */}
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

					{/* 下方控件 */}
					<div class={styles['input-controls-bottom']}>
						<button class={styles['input-add-btn']} title="添加图片/文件">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="12" y1="5" x2="12" y2="19"/>
								<line x1="5" y1="12" x2="19" y2="12"/>
							</svg>
						</button>

						{/* 模型选择（带下拉菜单） */}
						<div class={styles['chip-wrapper']}>
							<button
								ref={modelBtn}
								classList={{ [styles['input-model-btn']]: true, [styles.active]: showModelMenu() }}
								title="选择模型"
								onclick={(e) => {
									e.stopPropagation();
									closeAllMenus();
									setShowModelMenu((v) => !v);
								}}
							>
								🧠 {currentModelDisplay()}
								<ChevronDown />
							</button>
							<Show when={showModelMenu()}>
								<FixedDropdown btnEl={modelBtn} class={`${styles['chip-dropdown']} ${styles['chip-dropdown-wide']}`}>
									<Show when={appState.providers.length === 0}>
										<div class={styles['chip-dropdown-empty']}>
											还没有配置模型，去设置里添加吧
										</div>
									</Show>
									<For each={appState.providers}>
										{(provider) => (
											<div class={styles['chip-dropdown-group']}>
												<div class={styles['chip-dropdown-group-label']}>{provider.name}</div>
												<For each={provider.models}>
													{(model) => {
														const selected =
															appState.currentStandardModel?.providerId === provider.id &&
															appState.currentStandardModel?.modelId === model.id;
														return (
															<button
																classList={{
																	[styles['chip-dropdown-item']]: true,
																	[styles.selected]: selected,
																}}
																onclick={() => {
																	actions.setCurrentStandardModel({
																		providerId: provider.id,
																		modelId: model.id,
																	});
																	closeAllMenus();
																}}
															>
																{selected ? '✓ ' : ''}
																{model.displayName}
																<span class={styles['chip-dropdown-item-id']}>{model.id}</span>
															</button>
														);
													}}
												</For>
											</div>
										)}
									</For>
								</FixedDropdown>
							</Show>
						</div>

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