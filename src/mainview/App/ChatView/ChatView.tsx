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

import { createEffect, createMemo, createSignal, Show, onCleanup } from 'solid-js';
import type { MenuItem } from 'ffbox-ui';
import type { Folder, ModelConfig } from '@shared/agent';
import { state as appState, actions, getActiveConversation, getProviderById, loadConversationCtx, refreshConversationMeta, getOverlay, getRunError, getStreamTick } from '@mainview/stores';
import { diffRenderTree, foldCtxToRenderTree, mergeOverlayCtx } from '@mainview/logic/projection';
import type { RenderAgentNode } from '@mainview/logic/projection';
import * as agentBridge from '@mainview/bridges/agentBridge';
import { requestFolderPath } from '@mainview/bridges/localBridge';
import { startRun, stopRun } from '@mainview/logic/runController';
import { folderLabel, getTimeString, sameFolderPath } from '@shared/utils';
import { alertMsgbox, showMenu } from '@mainview/bridges/ffboxBridge';
import DiagramView from './DiagramView/DiagramView';
import MTGlogo from './MTG-logo-transparent.svg';
import { FolderChipIcon, SendIcon, StopIcon, MOCK_PLACEHOLDER_MODEL, clockNow } from '@mainview/App/ChatView/RenderTree/shared';
import RenderTreeView from './RenderTree/RenderTree';
import styles from './ChatView.module.css';

// #region 主组件

export default function ChatView() {

	const [inputText, setInputText] = createSignal('');
	/**
	 * 「当前查看的会话是不是正在跑」—— 直接从后端下发的三态 runStatus 派生，不再有本地镜像。
	 *
	 * ⚠️ 为什么不需要 effect 对齐：runStatus 是 per-conversation 的，SSE 订阅跟着**会话**走
	 *   （runController.ts）而不是跟着视图走，切走再回来时 SSE 已经把新鲜值刷进 store，
	 *   直接读即可 —— 不再需要「切了才回刷、不切不刷」那套补丁。
	 *   - 'running'  → 正在产出（输入区禁用、显示「运行中」）
	 *   - 'waiting' → 等 ask_user（输入区可用、显示「等待输入」）
	 *   - 其它       → 空闲
	 */
	const isGenerating = createMemo(() => getActiveConversation()?.runStatus === 'running');
	/** 本轮 run 的即时错误（按会话隔离在全局 store，重拉 ctx 后由实例的 interruptReason 接管显示） */
	const runError = createMemo(() => getRunError(getActiveConversation()?.id ?? ''));
	/** 当前查看的会话的运行状态原始值（三态），供会话头部按状态显示不同文案 */
	const runStatus = () => getActiveConversation()?.runStatus;
	/** run 是否还活着（running 或 waiting）—— 侧边栏点亮 / 停止入口共用这个判据 */
	const isAlive = createMemo(() => {
		const s = runStatus();
		return s === 'running' || s === 'waiting';
	});

	/** 界面内容：已提交的 ctx + 在飞的 overlay，共用同一个投影函数 */
	/**
	 * 投影 diff 开关：让内容没变的块保持旧引用，`<For>` 逐项比引用时就能复用 DOM。
	 * ⚠️ 它生效的前提是「`<For>` 实例跨帧常驻」—— 见 `RenderTree/RenderTree.tsx` 里 `RenderTreeView` 的入口注释（accessor 读 props.tree + 非 keyed 的 `<Show>`）。
	 */
	const ENABLE_RENDER_TREE_DIFF = true;
	let prevTree: RenderAgentNode | null = null;
	const renderTree = createMemo(() => {
		const conversation = getActiveConversation();
		// 在飞内容的「版本号」：overlay 是 store，但这里只取到 proxy 引用、访问不到具体属性，
		// 建立不了依赖 ⇒ 得靠这个按会话隔离的计数器把重算推起来（见 store 的 streamTickState）。
		getStreamTick(appState.activeConversationId ?? '');
		// overlay 现在是**按会话隔离的全局 store**（store 的 overlayState[convId]），
		// 只取当前查看的会话那份 —— 其它会话的在飞内容不会串进来，
		// 也不会被「给别的会话开一轮 run」清空。
		const overlayForActive = getOverlay(appState.activeConversationId ?? '');
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

	/**
	 * 当前的工作目录（= 会话所属的文件夹），**空白会话也有**。
	 *
	 * ⚠️ 空白会话（还没发出第一句）的目录只存在前端 `state.draftFolder` —— 它还没进 `state.folders`，
	 *   所以这里不能只在 folders 里找，否则「没会话 ⇒ 显示不出来 / 选不了目录」（就是那个症状）。
	 */
	const activeFolder = (): Folder | null => {
		const conv = getActiveConversation();
		if (conv) return appState.folders.find((f) => f.id === conv.folderId) ?? null;
		return appState.draftFolder ?? appState.folders.find((f) => f.id === 'local') ?? null;
	};

	const currentFolderDisplay = () => folderLabel(activeFolder() ?? { id: 'local', isLocal: true });

	const conversationTitle = () => getActiveConversation()?.title || '新会话';

	/**
	 * 会话头部面包屑的第二段：当前工作目录的「额外信息」。
	 * ⚠️ 这是**字符串**（ConversationMeta.extraInfo），由后端经列表接口给，
	 *   前端不直接读目标目录 —— 当前实现是 `branch @ shortCommit`，
	 *   没内容时是 undefined，那一段面包屑直接不显示。
	 */
	const extraInfo = () => getActiveConversation()?.extraInfo;

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
		const active = activeFolder();
		const items: MenuItem[] = appState.folders.map((f) => ({
			type: 'radio' as const,
			value: f.id,
			label: folderLabel(f),
			checked: active?.id === f.id,
		}));
		// 空白会话里刚选的新目录还不在 `state.folders` 里，得在这儿补一项，否则菜单里看不出选中了谁
		if (active && !appState.folders.some((f) => f.id === active.id)) {
			items.push({ type: 'radio' as const, value: active.id, label: folderLabel(active), checked: true });
		}
		items.push({ type: 'separator' as const });
		items.push({ type: 'normal' as const, value: '__new__', label: '+ 添加文件夹…' });
		return items;
	});
	/**
	 * 选中一个运行文件夹。
	 *
	 * ⚠️ 分两条路：会话已经存在 ⇒ 回写后端（`setConversationFolder`）；
	 *   还在空白态 ⇒ 只记在前端 `draftFolder`，等首句发出时才和会话一起落地。
	 *   哨兵值 `__new__` = 去开目录对话框，选完直接切过去。
	 */
	const applyFolder = (folder: Folder) => {
		const conv = getActiveConversation();
		if (conv) {
			void actions.setConversationFolder(conv.id, folder.id);
			return;
		}
		// 在列表里就直接记它；不在（刚选的新目录）就整份记住 —— 都还不进 `state.folders`、不通知后端
		actions.setDraftFolder(appState.folders.find((f) => f.id === folder.id) ?? { id: folder.id, path: folder.path });
	};
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
					const existing = appState.folders.find((f) => sameFolderPath(f.id, path));
					if (existing) {
						applyFolder(existing);
						return;
					}
					const draft: Folder = { id: path, path };
					const conv = getActiveConversation();
					// 有会话 ⇒ 这个目录得真的进列表（侧边栏分组 + 后端 settings）；空白态 ⇒ 先只记在前端
					applyFolder(conv ? (actions.addFolder(path) ?? draft) : draft);
				} catch (err) {
					console.error('[ChatView] 选择文件夹出错', err);
					void alertMsgbox('选择文件夹出错', String((err as Error)?.message ?? err));
				}
			})();
			return;
		}
		const folder = appState.folders.find((f) => f.id === value);
		if (folder) applyFolder(folder);
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
			getStreamTick(appState.activeConversationId ?? '');
			const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			queueMicrotask(() => {
				if (distanceFromBottom <= SCROLL_TO_BOTTOM_THRESHOLD) {
					el.scrollTop = el.scrollHeight;
				}
			});
		});
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
			// ⚠️ 会话**到这一刻才真的存在**：空白态期间选的目录（`state.draftFolder`）也是在这里
			//   才加进列表 / 写回后端 —— 点了「新建会话」但一个字没发，后端和侧边栏都不会有痕迹。
			const draft = appState.draftFolder;
			let folderId = 'local';
			if (draft) {
				const folder = appState.folders.find((f) => sameFolderPath(f.id, draft.id)) ?? actions.addFolder(draft.id);
				folderId = folder?.id ?? draft.id;
			}
			conv = await actions.createConversation(folderId, text.slice(0, 20) || '新会话');
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
		// 每轮开始清掉上一轮的折叠记录：根实例是永续的，不清会串到新轮次的同名块上（见块渲染区的说明）
		openOverrides.clear();
		prevTree = null;
		// 「发起 / 停止 / 回答」全在 runController 里，这里只负责把 UI 上的东西（输入文本、模型配置、工作目录）交给它
		void startRun({
			conversationId: convId,
			userMessage: text,
			modeId: appState.currentModeId,
			runningDir,
			model: modelConfig,
		});
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	// #endregion

	/**
	 * 用户手动折叠/展开过的块。
	 *
	 * 投影每次重算都会**重建块对象**（流式期间每来一个增量就重算一次），DOM 上的 `<details>` 会被换掉，不把用户的意愿记在这里就会被弹回去。key 用块的稳定标识（工具用 callId、子 Agent 用实例 id）
	 * ⚠️ 每轮 run 开始时清空：根实例是永续的，不清的话上一条轮次的展开状态会串到新轮次的同名块上。
	 */
	const openOverrides = new Map<string, boolean>();

	return (
		<div class={styles.mainContent}>
			{/* 会话头部：标题 + 面包屑 + 状态 / 操作 */}
			<div class={styles.header}>
				<div class={styles['session-title-block']}>
					<div class={styles['session-title']}>{conversationTitle()}</div>
					<div class={styles['session-breadcrumb']}>
						<span class={styles['breadcrumb-item']}>{currentFolderDisplay()}</span>
						<Show when={extraInfo()}>
							<span class={styles['breadcrumb-sep']}>/</span>
							<span class={styles['breadcrumb-item']}>{extraInfo()}</span>
						</Show>
					</div>
				</div>

				<div class={styles['session-actions']}>
					<Show
						when={runStatus() === 'running'}
						fallback={
							<Show when={runStatus() === 'waiting'}>
								{/* 等客户端响应（ask_user 等）：跟侧边栏的闪烁同一个语义 —— 需要你动手，所以是绿的 */}
								<span class={`${styles['session-status']} ${styles['is-waiting']}`}>等待输入</span>
							</Show>
						}
					>
						<span class={`${styles['session-status']} ${styles['is-running']}`}>
							<span class={styles['session-status-dot']} />
							运行中
						</span>
					</Show>

					<Show when={isAlive()}>
						<button class={styles['session-btn']} onclick={() => void stopRun()}>
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
			<div class={styles.progressTrack}>
				<Show when={isGenerating()}>
					<div class={styles['progress-bar']} />
				</Show>
			</div>

			{/* 聊天区域 */}
			<div class={styles.chatArea} ref={chatAreaRef}>
				<Show when={!renderTree()}>
					<div class={styles.emptyState}>
						<h2>{getTimeString(new Date(clockNow()), false)}</h2>
						<MTGlogo class={styles.logo} />
						<p>请小心间隙！Please Mind The Gap！嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟嘟📢</p>
					</div>
				</Show>

				<Show when={appState.ui.viewMode === 'chat' && renderTree()}>
					<div
						class={styles.messageList}
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
						{/* 任务清单已移到右侧栏（RightSidebar），这里不再渲染面板 —— 2026-09-17
						    用户反馈「找不到任务清单」，根因之一是它埋在聊天消息列表顶部、默认还折叠着。 */}
						{/* 转写：根实例直接内联渲染，让 <For> 持久化以支持 reconciliation
						    （AGENT 头插在用户发言之后，运行摘要贴在最下面） */}
						<RenderTreeView
							// 外层 <Show when={... && renderTree()}> 已保证非空
							tree={renderTree()!}
							openOverrides={openOverrides}
							convId={appState.activeConversationId ?? ''}
						/>

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
									<span class={styles.typingDot} style={{ animation: `${styles.typing} 1.4s infinite` }}>●</span>
									<span class={styles.typingDot} style={{ animation: `${styles.typing} 1.4s infinite 0.2s` }}>●</span>
									<span class={styles.typingDot} style={{ animation: `${styles.typing} 1.4s infinite 0.4s` }}>●</span>
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
			<div class={styles.inputArea}>
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
								onclick={() => void stopRun()}
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
