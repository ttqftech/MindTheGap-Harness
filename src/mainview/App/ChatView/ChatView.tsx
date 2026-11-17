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

import { createEffect, createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import type { MenuItem } from 'ffbox-ui';
import type { Folder, LlmImageRef, ModelConfig, ModeParamControl, ParamValue } from '@shared/agent';
import { findOption, resolveModeParams, sameParamValue } from '@shared/modeParams';
import { state as appState, actions, getActiveConversation, getProviderById, loadConversationCtx, refreshConversationMeta, getOverlay, getRunError, getStreamTick } from '@mainview/stores';
import { diffRenderTree, foldCtxToRenderTree, mergeOverlayCtx } from '@mainview/logic/projection';
import type { RenderAgentNode } from '@mainview/logic/projection';
import { collectContextUsage } from '@mainview/logic/contextUsage';
import * as agentBridge from '@mainview/bridges/agentBridge';
import { requestFolderPath } from '@mainview/bridges/localBridge';
import { startRun, stopRun } from '@mainview/logic/runController';
import { attachBottomFollow, type BottomFollow } from '@mainview/logic/bottomFollow';
import { folderLabel, getTimeString, sameFolderPath } from '@shared/utils';
import { alertMsgbox, showMenu } from '@mainview/bridges/ffboxBridge';
import DiagramView from './DiagramView/DiagramView';
import MTGlogo from './MTG-logo-transparent.svg';
import { FolderChipIcon, ImageChipIcon, SendIcon, StopIcon, MOCK_PLACEHOLDER_MODEL, clockNow, fmtTokens } from '@mainview/App/ChatView/RenderTree/shared';
import RenderTreeView from './RenderTree/RenderTree';
import { createOpenState } from './RenderTree/openState';
import styles from './ChatView.module.css';

// #region 主组件

export default function ChatView() {

	const [inputText, setInputText] = createSignal('');
	/**
	 * 本轮待发送的图片（存 **File 本身 + 本地预览 URL**）。
	 * 发送时先把字节 POST 到会话附件目录（连的可能是另一台机器上的 Service），
	 * 再把后端返回的 `LlmImageRef` 交给 run —— 不把本地路径当附件用。
	 */
	const [pendingImages, setPendingImages] = createSignal<{ file: File; name: string; previewUrl: string }[]>([]);
	/** 正在上传图片（这期间禁用发送，避免只发出半套附件） */
	const [uploading, setUploading] = createSignal(false);
	/** 隐藏的文件选择框：走浏览器原生 `accept` 过滤，不依赖主进程对话框 */
	let imageInputRef: HTMLInputElement | undefined;
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
	/** 已提交 ctx + 在飞 overlay（渲染树与上下文用量共用这一份合并结果） */
	const mergedCtx = createMemo(() => {
		const conversation = getActiveConversation();
		// 在飞内容的「版本号」：overlay 是 store，但这里只取到 proxy 引用、访问不到具体属性，
		// 建立不了依赖 ⇒ 得靠这个按会话隔离的计数器把重算推起来（见 store 的 streamTickState）。
		getStreamTick(appState.activeConversationId ?? '');
		// overlay 现在是**按会话隔离的全局 store**（store 的 overlayState[convId]），
		// 只取当前查看的会话那份 —— 其它会话的在飞内容不会串进来，
		// 也不会被「给别的会话开一轮 run」清空。
		const overlayForActive = getOverlay(appState.activeConversationId ?? '');
		return mergeOverlayCtx(conversation?.agentCtx, overlayForActive);
	});
	const renderTree = createMemo(() => {
		const newTree = foldCtxToRenderTree(mergedCtx());
		const result = ENABLE_RENDER_TREE_DIFF ? diffRenderTree(prevTree, newTree) : newTree;
		prevTree = result;
		return result;
	});

	/**
	 * 模型 id → 上下文窗口（input）。
	 * 优先用该实例**最近一次请求的模型**（历史会话可能已经换过模型）；找不到再退回当前选中的模型。
	 */
	const contextLimitOfModel = (modelId: string | undefined): number | undefined => {
		const lookup = (id: string | undefined) => {
			if (!id) return undefined;
			for (const provider of appState.providers) {
				const model = provider.models.find((m) => m.id === id);
				if (model?.contextWindow?.input) return model.contextWindow.input;
			}
			return undefined;
		};
		const fromLastUsage = lookup(modelId);
		if (fromLastUsage) return fromLastUsage;
		const current = appState.currentStandardModel;
		return lookup(current?.modelId);
	};

	/**
	 * 根 Agent + 各子 Agent 的上下文用量。
	 *
	 * 优先取该实例**最近一次请求的 prompt_tokens + completion_tokens**（`UsageEntry.input` / `output`），
	 * 再加上那次调用之后新追加的消息；从没跑过请求的实例才退回字符估算（见 `logic/contextUsage.ts`，界面用 ≈ 区分）。
	 */
	const contextUsage = createMemo(() =>
		collectContextUsage(mergedCtx(), (modelId) => contextLimitOfModel(modelId)),
	);
	/** 发送按钮左侧那颗小 chip 只显示根 Agent 的占比，明细放在悬停面板里 */
	const rootContextUsage = createMemo(() => contextUsage()[0]);

	// #region 显示文本

	/** 当前选中的 provider + model（找不到 = null） */
	const currentModelEntry = () => {
		const ref = appState.currentStandardModel;
		if (!ref) return null;
		const provider = getProviderById(ref.providerId);
		const model = provider?.models.find((m) => m.id === ref.modelId);
		return provider && model ? { provider, model } : null;
	};

	const currentModelDisplay = () => {
		const entry = currentModelEntry();
		if (!entry) return '未选择模型';
		const level = thinkingLevelOf(entry.provider.id, entry.model.id);
		return `${entry.provider.name} / ${entry.model.displayName}${level ? ` · ${level}` : ''}`;
	};

	/** 当前模型能不能收图（设置页 model.supportsVision）；没选模型一律当不支持 */
	const currentModelSupportsVision = () => !!currentModelEntry()?.model.supportsVision;

	/** 百分比文案：没有上下文窗口配置就显示 — */
	const percentText = (percent: number | undefined): string =>
		percent === undefined ? '—' : `${percent >= 100 ? Math.round(percent) : percent.toFixed(1)}%`;

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

	/** 当前模型配置的思考强度档位（缺省 = 默认 / 不传参数） */
	const thinkingLevelOf = (providerId: string, modelId: string): string =>
		appState.ui.thinkingLevels[`${providerId}/${modelId}`] ?? '';

	const modelMenu = createMemo<MenuItem[]>(() => {
		const current = appState.currentStandardModel;
		if (appState.providers.length === 0) {
			return [{ type: 'normal', value: '__none__', label: '还没有配置模型，去设置里添加吧', disabled: true }];
		}
		// 三级结构：提供商 → 模型 → 思考强度。没有配强度档位的模型直接是第二级叶子。
		return appState.providers.map((provider) => ({
			type: 'submenu' as const,
			label: provider.name,
			subMenu: provider.models.map((model) => {
				const key = `${provider.id}/${model.id}`;
				const isCurrent = current?.providerId === provider.id && current?.modelId === model.id;
				const values = model.thinking?.param ? (model.thinking.values ?? []) : [];
				if (!values.length) {
					return {
						type: 'radio' as const,
						value: key,
						label: model.displayName,
						tooltip: model.id,
						checked: isCurrent,
					};
				}
				const level = thinkingLevelOf(provider.id, model.id);
				return {
					type: 'submenu' as const,
					label: `${model.displayName}${level ? ` · ${level}` : ''}`,
					subMenu: [
						{
							type: 'radio' as const,
							value: `${key}|`,
							label: '默认（不传强度）',
							checked: isCurrent && !level,
						},
						...values.map((v) => ({
							type: 'radio' as const,
							value: `${key}|${v}`,
							label: v,
							checked: isCurrent && level === v,
						})),
					],
				};
			}),
		}));
	});
	const applyModel = (value: string) => {
		if (isGenerating()) return;	// 运行期间禁止改运行语义（同「回复过程中不能点发送」）
		if (typeof value !== 'string') return;
		// 第三级菜单的 value 形如 `provider/model|档位`；没有 `|` = 该模型没有强度档位
		const bar = value.indexOf('|');
		const level = bar >= 0 ? value.slice(bar + 1) : undefined;
		const refPart = bar >= 0 ? value.slice(0, bar) : value;
		const sep = refPart.indexOf('/');
		if (sep <= 0) return;
		const providerId = refPart.slice(0, sep);
		const modelId = refPart.slice(sep + 1);
		actions.setCurrentStandardModel({ providerId, modelId });
		if (level !== undefined) actions.setThinkingLevel(providerId, modelId, level || null);
	};

	// #endregion

	// #region 模式参数（mode.json 的 form → 输入框下方的动态控件）

	/** 当前模式的表单定义（`form`）与默认变量表（`params`），都来自 mode.json */
	const currentMode = () => appState.modes.find((m) => m.id === appState.currentModeId);
	/** 真要渲染的控件：`hidden` 的只当变量用，不出现在界面上 */
	const paramControls = createMemo(() => (currentMode()?.form ?? []).filter((c) => !c.hidden && c.options.length > 0));
	/**
	 * 本次生效的变量表 + 每个控件的落点。
	 *
	 * 口径与后端完全一致（同一个 `resolveModeParams`）：控件取自己存的值（没有就 `default` /
	 * `params` / 第一个选项），按 `form` 顺序写进变量表；存的值可以**不在选项里**（来自另一档的联动）。
	 * 选中那档承诺的变量如果和最终表对不上，`overridden` 为真，界面上打 `*`（只影响显示）。
	 */
	const paramState = createMemo(() => resolveModeParams(currentMode() ?? {}, appState.ui.modeParams[appState.currentModeId] ?? {}));
	const paramVars = () => paramState().vars;

	/** 控件当前值的显示文本：能对上选项就用它的 label（值可能来自别的参数，不一定是用户点过的那项） */
	const paramLabel = (control: ModeParamControl): string => {
		const option = findOption(control, paramVars()[control.key]);
		if (option) return option.label;
		const raw = paramVars()[control.key];
		if (raw === undefined) return '—';
		return typeof raw === 'string' ? raw : JSON.stringify(raw);
	};

	/** 这一项选中的那档被后面的参数改过没 */
	const isOverridden = (control: ModeParamControl): boolean => paramState().byKey[control.key]?.overridden ?? false;

	const openParamMenu = (control: ModeParamControl, el: HTMLElement) => {
		const current = paramVars()[control.key];
		const menu: MenuItem[] = control.options.map((opt, index) => ({
			type: 'radio' as const,
			value: String(index),
			label: opt.label,
			tooltip: opt.description,
			checked: sameParamValue(opt.value, current),
		}));
		openChipMenu(menu, (picked) => {
			const opt = control.options[Number(picked)];
			if (opt) actions.setModeParam(appState.currentModeId, control.key, opt.value);
		}, el);
	};

	/** 本轮 run 带给后端的参数：只发**用户显式选过**的，其余由后端按 mode.json 的默认值算 */
	const runParams = (): Record<string, ParamValue> => appState.ui.modeParams[appState.currentModeId] ?? {};

	// #endregion

	// #region 工具安全性（全局开关，不属于任何模式）

	/** 当前档位的显示名 */
	const safetyLabel = () => agentBridge.SAFETY_OPTIONS.find((o) => o.value === appState.safety)?.label ?? appState.safety;

	/** 档位菜单：全局一份，与模式无关；改完对**之后**的 run 生效 */
	const safetyMenu = createMemo<MenuItem[]>(() =>
		agentBridge.SAFETY_OPTIONS.map((o) => ({
			type: 'radio' as const,
			value: o.value,
			label: o.label,
			tooltip: o.description,
			checked: appState.safety === o.value,
		})),
	);

	const applySafety = async (value: string) => {
		if (value === appState.safety) return;
		const result = await actions.setSafety(value as agentBridge.ToolSafety);
		if (!result.ok) void alertMsgbox('切换工具安全性失败', result.error ?? '未知错误');
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

	/**
	 * 贴底跟随（实现见 `logic/bottomFollow.ts`）。
	 *
	 * ⚠️ 触发点是**内容高度变化**（ResizeObserver），不是 SSE tick：折叠块开合动画、iframe 提交、图片加载、
	 *    run 结束换 ctx …… 都会让内容长高，而且都没有 tick —— 旧实现只在 tick 里滚一次，
	 *    所以「有时候能贴住有时候不能」。
	 */
	let bottomFollow: BottomFollow | undefined;
	const chatAreaRef = (el: HTMLDivElement) => {
		// 聊天 / 图示视图切换会重建这个元素：先把旧容器的监听拆掉，否则两个 effect 会互相打架
		bottomFollow?.dispose();
		bottomFollow = attachBottomFollow(el);
	};
	onCleanup(() => bottomFollow?.dispose());

	/** 切会话 = 换了一整段内容：直接落到最新那条，之后靠跟随保持 */
	let lastFollowedConversationId: string | null = null;
	createEffect(() => {
		const id = appState.activeConversationId ?? '';
		if (id === lastFollowedConversationId) return;
		lastFollowedConversationId = id;
		bottomFollow?.jump();
	});

	// #endregion

	// #region 发送 / 停止 / 回答提问

	/**
	 * 把图片文件收进待发送区（选图 / 粘贴共用）。
	 * 预览用本地 object URL；真正发出去前才上传，不在选择时上传。
	 */
	const addImageFiles = (files: File[]) => {
		const accepted = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
		if (!accepted.length) return;
		setPendingImages((prev) => [
			...prev,
			...accepted.map((file) => ({
				file,
				name: file.name || `image-${Date.now()}`,
				previewUrl: URL.createObjectURL(file),
			})),
		]);
	};

	/** 点「图片」按钮：走隐藏的 `<input type=file accept=image/*>`（WebView2 / 远程浏览器都可用） */
	const pickImages = () => {
		if (isGenerating()) return;
		if (!currentModelSupportsVision()) {
			void alertMsgbox('当前模型不支持图片输入', '请到「设置 → 模型」为该模型打开「支持图片输入」，或切换到支持视觉的模型。');
			return;
		}
		imageInputRef?.click();
	};

	const onImageInputChange = (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		addImageFiles([...(input.files ?? [])]);
		input.value = '';	// 清空才能再次选同一张
	};

	/** Ctrl+V 粘贴截图：与选图走同一条待发送队列（纯文本粘贴仍交给 textarea 默认行为） */
	const handlePaste = (e: ClipboardEvent) => {
		const files = [...(e.clipboardData?.items ?? [])]
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((f): f is File => !!f);
		if (!files.length || isGenerating()) return;
		e.preventDefault();
		if (!currentModelSupportsVision()) {
			void alertMsgbox('当前模型不支持图片输入', '请到「设置 → 模型」为该模型打开「支持图片输入」，或切换到支持视觉的模型。');
			return;
		}
		addImageFiles(files);
	};

	const removePendingImage = (index: number) => {
		setPendingImages((prev) => {
			const removed = prev[index];
			if (removed) URL.revokeObjectURL(removed.previewUrl);
			return prev.filter((_, i) => i !== index);
		});
	};

	/** 清空待发送图片并回收本地预览 URL */
	const clearPendingImages = () => {
		setPendingImages((prev) => {
			for (const img of prev) URL.revokeObjectURL(img.previewUrl);
			return [];
		});
	};

	onCleanup(() => {
		for (const img of pendingImages()) URL.revokeObjectURL(img.previewUrl);
	});

	const handleSend = async () => {
		const text = inputText().trim();
		const images = pendingImages();
		if ((!text && !images.length) || isGenerating() || uploading()) return;

		/** 从 store 组装完整的 ModelConfig（给 AgentRunRequest 用） */
		function buildModelConfig(): ModelConfig | null {
			const entry = currentModelEntry();
			if (!entry) return null;
			const { provider, model } = entry;
			const level = thinkingLevelOf(provider.id, model.id);
			return {
				providerId: provider.id,
				modelId: model.id,
				apiFormat: provider.apiFormat,
				baseUrl: provider.baseUrl,
				apiKey: provider.apiKey,
				customParams: { ...provider.customParams, ...model.customParams },
				supportsVision: !!model.supportsVision,
				// 只有用户显式选过档位才写参数；「默认」= 不传
				thinking: level && model.thinking?.param ? { param: model.thinking.param, value: level } : undefined,
			};
		}

		// mock 开着时就算没配 provider 也能跑（后端会把请求转给内置 mock）
		const modelConfig = buildModelConfig() ?? (appState.mock.enabled ? MOCK_PLACEHOLDER_MODEL : null);
		if (!modelConfig) {
			void alertMsgbox('未配置模型', '请先在「设置 → 模型」里配置模型提供商与模型，然后再发起任务。');
			return;
		}
		if (images.length && !modelConfig.supportsVision) {
			void alertMsgbox('当前模型不支持图片输入', '请到「设置 → 模型」为该模型打开「支持图片输入」，或切换到支持视觉的模型。');
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
			conv = await actions.createConversation(folderId, text.slice(0, 20) || (images.length ? '图片任务' : '新会话'));
			if (!conv) return;
		} else if (!conv.agentCtx) {
			// 会话还没有跑过 → 用首句当标题（旧逻辑用 messages 为空判断，现在等价于「没有 ctx」）
			await actions.renameConversation(conv.id, text.slice(0, 30) || (images.length ? '图片任务' : '新会话'));
		}
		const convId = conv.id;

		// 会话所属的文件夹就是它的工作目录：「本地」没有 path，等于不传，
		// 由后端回退到 process.cwd()。文件夹改过之后，下一轮 run 自动用新目录。
		const runningDir = appState.folders.find((f) => f.id === conv.folderId)?.path;

		/**
		 * 先把图片**上传**进会话附件目录，再带着 `LlmImageRef` 发起 run。
		 * ⚠️ 不能传本地路径：前端连的可能是另一台机器上的 Service（保留远程连接能力）。
		 */
		const imageRefs: LlmImageRef[] = [];
		if (images.length) {
			setUploading(true);
			try {
				for (const img of images) {
					const result = await agentBridge.uploadAttachment(convId, img.file);
					if (!result.ok || !result.image) {
						void alertMsgbox('图片上传失败', `${img.name}：${result.error ?? '未知错误'}`);
						return;	// 输入文本与待发送图片都保留，让用户重试
					}
					imageRefs.push(result.image);
				}
			} finally {
				setUploading(false);
			}
		}

		setInputText('');
		clearPendingImages();
		// 用户自己发的消息必须让他看见：哪怕刚才滚上去读历史，也重新贴住底部（之后靠跟随保持）
		bottomFollow?.jump();
		// 每轮开始清掉上一轮的折叠记录：根实例是永续的，不清会串到新轮次的同名块上（见块渲染区的说明）
		// openState.reset();
		prevTree = null;
		// 「发起 / 停止 / 回答」全在 runController 里，这里只负责把 UI 上的东西（输入文本、模型配置、工作目录）交给它
		void startRun({
			conversationId: convId,
			userMessage: text,
			modeId: appState.currentModeId,
			runningDir,
			model: modelConfig,
			images: imageRefs,
			params: runParams(),
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
	 * 折叠块的开关状态（思考 / 工具卡 / 反思 / 子 Agent 共用一套）。
	 *
	 * 投影每次重算都会**重建块对象**（流式期间每来一个增量就重算一次），DOM 上的块会被换掉，不把用户的意愿记在这里就会被弹回去。
	 * ⚠️ 只记「用户点过」的：默认该不该展开由 RenderTree 现算（只有最后一组展开），写进记录就等于把它钉死，见 `RenderTree/openState.ts`。
	 */
	const openState = createOpenState();

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
							openState={openState}
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
						placeholder="描述任务，或输入 / 唤起指令；shift + enter 换行；Ctrl+V 可粘贴截图"
						value={inputText()}
						oninput={(e) => setInputText(e.currentTarget.value)}
						onkeydown={handleKeyDown}
						onpaste={handlePaste}
						rows={1}
					/>

					{/* 隐藏的文件选择框：`accept` 在系统文件对话框里就过滤成图片，不会退化成「选文件夹」 */}
					<input
						ref={imageInputRef}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						multiple
						style={{ display: 'none' }}
						onchange={onImageInputChange}
					/>

					{/* 待发送的图片：本地 object URL 直接出缩略图；发送时才上传 */}
					<Show when={pendingImages().length > 0}>
						<div class={styles['input-attachments']}>
							<For each={pendingImages()}>{(img, index) => (
								<span class={styles['attachment-chip']} title={img.name}>
									<img class={styles['attachment-thumb']} src={img.previewUrl} alt={img.name} />
									<span class={styles['attachment-name']}>{img.name}</span>
									<button
										class={styles['attachment-remove']}
										title="移除这张图片"
										onclick={() => removePendingImage(index())}
									>
										×
									</button>
								</span>
							)}</For>
						</div>
					</Show>

					<div class={styles['input-toolbar']}>
						{/* 图片附件：模型不支持视觉时禁用，点按给出明确提示 */}
						<button
							class={styles['ctx-chip']}
							title={currentModelSupportsVision() ? '添加图片（发送时随请求一起交给模型）' : '当前模型未开启「支持图片输入」，去「设置 → 模型」里打开'}
							disabled={isGenerating() || uploading()}
							onclick={pickImages}
						>
							<ImageChipIcon />
							<span class={styles['ctx-chip-text']}>图片</span>
						</button>

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

						{/* 工具安全性（全局开关：与模式无关，所有插件共用） */}
						<button
							class={`${styles['ctx-chip']} ${styles['safety-chip']}`}
							classList={{
								[styles['is-on']]: appState.safety === 'off',
								[styles['is-warn']]: appState.safety === 'readonly-strict' || appState.safety === 'readonly-smart',
							}}
							title="工具安全性：全局开关，换模式不影响它；改完对之后的运行生效"
							onclick={(e) => openChipMenu(safetyMenu(), applySafety, e.currentTarget)}
						>
							<span class={styles['ctx-chip-text']}>安全性 · {safetyLabel()}</span>
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

						{/* 上下文用量：发送按钮左边。chip 显示根 Agent 的「长度 · 占比」，悬停弹出根 + 各子 Agent 明细 */}
						<Show when={contextUsage().length > 0}>
							<div class={styles['ctx-usage']}>
								<div class={styles['ctx-usage-pop']}>
									<div class={styles['ctx-usage-title']}>上下文用量（上次请求的输入 + 输出 + 之后新增消息）</div>
									<For each={contextUsage()}>{(row) => (
										<div
											class={styles['ctx-usage-row']}
											style={{ 'padding-left': `${Math.min(row.depth, 4) * 12}px` }}
										>
											<span class={styles['ctx-usage-name']} title={row.agentName}>
												{row.depth === 0 ? '根 Agent' : row.agentName}
											</span>
											<span class={styles['ctx-usage-count']}>
												{row.estimated ? '≈' : ''}{fmtTokens(row.tokens)}{row.limit ? ` / ${fmtTokens(row.limit)}` : ''}
											</span>
											<span
												class={styles['ctx-usage-percent']}
												classList={{ [styles['is-warn']]: !!row.percent && row.percent >= 90 }}
											>
												{percentText(row.percent)}
											</span>
										</div>
									)}</For>
								</div>
								<button class={styles['ctx-usage-chip']} title="根 Agent 的上下文占用；悬停可看每个子 Agent">
									<span class={styles['ctx-chip-text']}>
										ctx {rootContextUsage()!.estimated ? '≈' : ''}{fmtTokens(rootContextUsage()!.tokens)} · {percentText(rootContextUsage()!.percent)}
									</span>
								</button>
							</div>
						</Show>

						<Show when={!isGenerating()}>
							<button
								class={styles['input-send-btn']}
								title="发送"
								onclick={() => void handleSend()}
								disabled={uploading() || (!inputText().trim() && !pendingImages().length)}
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

					{/* 模式参数：由当前 mode.json 的 form 动态生成，选项通过变量覆盖 Agent 配置与提示词 */}
					<Show when={paramControls().length > 0}>
						<div class={styles['input-params']}>
							<For each={paramControls()}>
								{(control) => (
									<button
										class={styles['param-chip']}
										title={control.description ?? `${control.label}（覆盖变量 ${control.key}）`}
										disabled={isGenerating()}
										onclick={(e) => openParamMenu(control, e.currentTarget)}
									>
										<span class={styles['param-chip-label']}>{control.label}</span>
										<span class={styles['param-chip-value']}>{paramLabel(control)}</span>
										<Show when={isOverridden(control)}>
											<span
												class={styles['param-chip-star']}
												title="这一档承诺的配置被后面的参数改过（表单里越靠后优先级越高）"
											>
												*
											</span>
										</Show>
									</button>
								)}
							</For>
						</div>
					</Show>
				</div>

				<div class={styles['input-hint']}>enter 发送 · shift + enter 换行 · esc 中断运行</div>
			</div>
		</div>
	);
}

// #endregion
