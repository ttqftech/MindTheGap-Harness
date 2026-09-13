/* ==========================================================================
   主聊天视图 — MindTheGap-Harness
   
   对接 Agent 引擎：
   - handleSend → rpc.request.agentRun 发起 Agent
   - subscribeAgentStream 订阅流式事件实现打字机效果
   - text chunk → appendMessageContent 追加到 assistant 消息
   - done / error → 结束 generating 状态
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import type { FFBoxDropdownInput, MenuItem } from 'ffbox-ui';
import styles from './ChatView.module.css';
import { state as appState, actions, getActiveConversation, getProviderById } from '../../store';
import type { Message, MessageBlock } from '../../store';
import type { AgentName, ModelConfig } from '../../../shared/agent';
import { runAgent, cancelAgent, subscribeStream, saveConversationData } from '../../agentBridge';
import type { AgentStreamEvent } from '../shared/agent';
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

/** 可选的 Agent 列表 */
const AGENT_NAMES: AgentName[] = ['默认', '编码', '文件夹浏览总结'];

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

	/* === 下拉菜单 ===
	   文件夹 / Agent 两个 chip 用 FFBox-UI 的 FFBoxMenu（命令式弹出，自带定位 / 键盘导航 / 遮罩关闭），
	   这里只记录当前打开的是哪一个，用于按钮高亮。
	   模型选择用的是 ffbox-dropdown-input（见下方 modelMenu），不需要这套状态。 */
	const [openMenu, setOpenMenu] = createSignal<'folder' | 'mode' | null>(null);

	// 两个 chip 触发按钮的 ref（给 FFBoxMenu 当弹出锚点）
	let folderBtn: HTMLButtonElement | undefined;
	let modeBtn: HTMLButtonElement | undefined;
	/** 模型下拉框的 ref：选中后需要把显示文本写回组件（原因见 onModelChange） */
	let modelInput: FFBoxDropdownInput | undefined;

	/** 统一入口：弹出菜单并在关闭时清掉按钮高亮 */
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
					// requestFolderPath 内部会区分 electrobun 原生对话框与浏览器回退
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

	/** Agent 模式菜单 */
	const openModeMenu = () => {
		popupMenu('mode', {
			triggerElem: modeBtn,
			type: 'select',
			menu: AGENT_NAMES.map((name) => ({
				type: 'radio' as const,
				value: name,
				label: name,
				checked: appState.currentAgentName === name,
			})),
			onSelect: (_e, value) => actions.setCurrentAgentName(value as AgentName),
		});
	};

	/* === 模型选择：只读 DropdownInput ===
	   菜单项按供应商拆成 submenu（FFBox-UI 的 MenuItem 原生支持 submenu），
	   值统一编码成 `providerId/modelId`，选中后解码写回 store。 */
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
		actions.setCurrentStandardModel({
			providerId: value.slice(0, sep),
			modelId: value.slice(sep + 1),
		});
		// dropdown-input 内部选中后会把 text 置为 value（形如 pid/mid）。重复选同一项时
		// prop:text 的响应式值没变、Solid 不会重新赋值，所以这里手动把显示名写回。
		if (modelInput) modelInput.text = currentModelDisplay();
	};

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
			void alertMsgbox('未配置模型', '请先在「设置 → 模型」里配置模型提供商与模型，然后再发起任务。');
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
						<button
							ref={folderBtn}
							classList={{ [styles['chip-btn']]: true, [styles.active]: openMenu() === 'folder' }}
							title='运行文件夹'
							onclick={openFolderMenu}
						>
							📁 <span class={styles['chip-label']}>{currentFolderDisplay()}</span>
							<ChevronDown />
						</button>

						{/* Agent 模式 */}
						<button
							ref={modeBtn}
							classList={{ [styles['chip-btn']]: true, [styles.active]: openMenu() === 'mode' }}
							title="运行模式"
							onclick={openModeMenu}
						>
							🤖 <span class={styles['chip-label']}>{appState.currentAgentName}</span>
							<ChevronDown />
						</button>
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

						{/* 模型选择：只读下拉框（供应商为 submenu） */}
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