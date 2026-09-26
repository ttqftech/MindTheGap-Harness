/* ==========================================================================
   全局状态管理（Solid.js store）

   重构后：
   - 后端设置（providers, basePrompt, folders, conversations）→ Agent Service HTTP
   - 前端设置（themeMode, currentModeId, ui state, usage）→ localStorage
   - 会话列表从后端获取，切换时从后端拉完整数据
   - SSE patch 更新保持前后端尽量同步
   - 模式配置不再进 store：它就是插件目录里的 mode.json，设置页直接编辑该文件
   ========================================================================== */

import { createStore, produce } from 'solid-js/store';
import { localSettings, isElectrobunEnv } from '@mainview/localBridge';
import * as agentBridge from '@mainview/agentBridge';
import type { AgentCtx, ConversationMeta, ModelProvider, ModeSummary, Folder, McpServerConfig, McpServerStatus } from '@shared/agent';
import type { ServiceHealth } from '@shared/buildInfo';
import type { Density, Accent } from '@mainview/theme/theme';

// 转发共享类型（UI 侧统一从 store 引入，避免到处写相对路径）
export type { ModelProvider, ModelProviderModel, ModeSummary, AgentStreamEvent } from '@shared/agent';

// #region 前端扩展类型

export interface UsageStats {
	timeRange: '4h' | '1d' | 'today' | '7d' | '30d';
	showApiRequests: boolean;
	showToolCalls: boolean;
	showTokensInput: boolean;
	showTokensInputCached: boolean;
	showTokensOutput: boolean;
}

/**
 * UI 侧会话 = 元信息 + ctx（内存快照）。
 *
 * ⚠️ **没有 messages**：界面上的内容一律由 ctx 现算（`foldCtxToRenderTree()`），
 * 不再持久化一份「UI 投影」。流式期间「在飞」的那部分放在组件自己的 overlay 里（§5.3）。
 */
export type UIConversation = ConversationMeta & {
	agentCtx?: AgentCtx;
};

export type ViewMode = 'chat' | 'diagram';

/** 侧边栏任务列表的排序方式 */
export type ConversationSort = 'updated' | 'created' | 'title';

export type UIState = {
	sidebarWidth: number;
	sidebarCollapsed: boolean;
	density: Density;
	accent: Accent;
	conversationSort: ConversationSort;
	settingsOpen: boolean;
	activeSettingsTab: '通用' | '模型' | '提示词' | '用量' | '插件 / 模式' | 'MCP';
	viewMode: ViewMode;
};

export type AppState = {
	themeMode: 'light' | 'dark' | 'system';
	folders: Folder[];
	conversations: UIConversation[];
	activeConversationId: string | null;
	ui: UIState;
	providers: ModelProvider[];
	currentStandardModel: { providerId: string; modelId: string } | null;
	currentEconomyModel: { providerId: string; modelId: string } | null;
	currentModeId: string;
	modes: ModeSummary[];	// 插件提供的全部模式（聚合自 GET /api/modes）
	/** 基座提示词（由各 Agent 的 prompt.md 用 {{ basePrompt }} 决定是否内嵌），后端 settings.basePrompt 的镜像。没有默认值，没填就是空串 */
	basePrompt: string;
	/** Agent Service 自报的构建 / 运行信息（GET /api/health）；服务不可达时为 null */
	serviceHealth: ServiceHealth | null;
	// 插件加载错误 / 被覆盖标记（设置页展示用）
	pluginErrors: { level: 'error' | 'warn'; pluginId?: string; modeId?: string; agentId?: string; message: string }[];
	overriddenModes: string[];
	usage: UsageStats;	// 设置页用量统计（TODO 收归到设置页本身，不直接存储在 AppState 中）
	mcpServers: McpServerConfig[];	// MCP 服务器配置（持久化在后端 settings.json）
	mcpStatus: McpServerStatus[];	// MCP 运行态（后端内存维护，不持久化）
	/** 内置 mock 开关（后端 settings.debug.mock）。开发用：LLM 走假模型，**工具仍真实执行** */
	mock: { enabled: boolean; scenario: string; scenarios: { id: string; label: string }[] };
};

// #endregion

// #region 初始状态、store

const uid = () => Math.random().toString(36).slice(2, 10);

const initialUI: UIState = {
	sidebarWidth: 260,
	sidebarCollapsed: false,
	density: 'standard',
	accent: 'amber',
	conversationSort: 'updated',
	settingsOpen: false,
	activeSettingsTab: '通用',
	viewMode: 'chat',
};

export const defaultState: AppState = {
	themeMode: 'system',
	folders: [{ id: 'local', isLocal: true }],
	conversations: [],
	activeConversationId: null,
	ui: initialUI,
	providers: [],
	currentStandardModel: null,
	currentEconomyModel: null,
	currentModeId: 'code',
	modes: [],
	basePrompt: '',
	serviceHealth: null,
	pluginErrors: [],
	overriddenModes: [],
	usage: {
		timeRange: '7d',
		showApiRequests: true,
		showToolCalls: true,
		showTokensInput: true,
		showTokensInputCached: true,
		showTokensOutput: true,
	},
	mcpServers: [],
	mcpStatus: [],
	mock: { enabled: false, scenario: 'web', scenarios: [] },
};

export const [state, setState] = createStore<AppState>(defaultState);

// #endregion

// #region 前端设置持久化（localStorage）

// TODO 我认为只有 themeMode 是需要持久化的，其他设置项（如 sidebarWidth、sidebarCollapsed、viewMode 等）都不用落盘
function saveLocalSettings() {
	localSettings.set('ui', {
		sidebarWidth: state.ui.sidebarWidth,
		sidebarCollapsed: state.ui.sidebarCollapsed,
		density: state.ui.density,
		accent: state.ui.accent,
		conversationSort: state.ui.conversationSort,
		viewMode: state.ui.viewMode,
	});
	localSettings.set('themeMode', state.themeMode);
	localSettings.set('currentModeId', state.currentModeId);
	localSettings.set('usage', state.usage);	// TODO 收归
}

function loadLocalSettings() {
	const theme = localSettings.get<'light' | 'dark' | 'system'>('themeMode', defaultState.themeMode);
	setState('themeMode', theme);

	// 当前模式是纯前端状态：这里恢复上次的选择，「插件是否真的提供了这个模式」由 loadBackendState 校验
	setState('currentModeId', localSettings.get<string>('currentModeId', defaultState.currentModeId));

	// TODO 不用本地持久化 ui 设置项
	const ui = localSettings.get<Partial<UIState>>('ui', {});
	setState('ui', {
		...defaultState.ui,
		...ui,
		settingsOpen: false,
	});

	// TODO 收归
	const usage = localSettings.get<Partial<UsageStats>>('usage', {});
	setState('usage', { ...defaultState.usage, ...usage });
}

// #endregion

// #region 后端数据同步

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveBackend() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		void saveBackendSettings();
	}, SAVE_DEBOUNCE_MS);
}

async function saveBackendSettings() {
	console.log('[Store] Harness 设置正在保存到 Agent Service ');
	await agentBridge.setProviders(state.providers);
	await agentBridge.setCurrentModel({
		standard: state.currentStandardModel,
		economy: state.currentEconomyModel,
	});
	await agentBridge.setBasePrompt(state.basePrompt);
	await agentBridge.setFolders(state.folders);
	await agentBridge.setMcpServers(state.mcpServers);
}

async function loadBackendState(): Promise<void> {
	console.log('[Store] Harness 设置正在从 Agent Service 读取');

	const [providers, currentModel, modes, folders, conversations, mcpServers, basePrompt, serviceHealth, mock] = await Promise.all([
		agentBridge.getProviders(),
		agentBridge.getCurrentModel(),
		agentBridge.getModes(),
		agentBridge.getFolders(),
		agentBridge.getConversations(),
		agentBridge.getMcpServers(),
		agentBridge.getBasePrompt(),
		agentBridge.health(),
		agentBridge.getMock(),
	]);

	if (providers.length > 0) setState('providers', providers);
	if (currentModel) {
		if (currentModel.standard) setState('currentStandardModel', currentModel.standard);
		if (currentModel.economy) setState('currentEconomyModel', currentModel.economy);
	}
	setState('modes', modes);
	// 空串是合法状态（用户可以把基座清空），所以无条件同步
	setState('basePrompt', basePrompt.basePrompt);
	setState('serviceHealth', serviceHealth);
	// 当前模式是纯前端状态（由本地偏好恢复），这里只校验「插件真的提供了这个模式」，否则退回第一个可用模式
	if (modes.length > 0 && !modes.some((m) => m.id === state.currentModeId)) {
		setState('currentModeId', modes[0].id);
	}
	if (folders.length > 0) setState('folders', folders);
	setState('mcpServers', mcpServers);
	setState('mock', mock);

	if (conversations.length > 0) {
		// UI 侧会话 = 元信息（ctx 按需拉，见 loadConversationCtx）
		const uiConvs: UIConversation[] = conversations.map((meta) => ({ ...meta }));
		setState('conversations', uiConvs);
	}
}

/**
 * 拉取（或刷新）某会话的 ctx —— **这就是界面的数据源**（没有 UI 消息可拉）。
 * @param force 一轮 run 结束后无条件重拉；默认只在本地还没有 ctx 时拉（切会话时按需加载）
 */
export async function loadConversationCtx(conversationId: string, force = false): Promise<void> {
	const conv = state.conversations.find((c) => c.id === conversationId);
	if (!conv || (!force && conv.agentCtx)) return;

	const ctx = await agentBridge.getCtx(conversationId);
	if (!ctx) return;
	actions.setConversationCtx(conversationId, ctx);
	// force = 一轮 run 刚结束：顺带从后端刷新一次 meta，让刚更新的会话在列表里上浮。
	// ⚠️ 这里必须走后端 —— 前端自己 `Date.now()` 会把「只是点开看看」也算成一次更新。
	if (force) void refreshConversationMeta(conversationId);
}

/**
 * 从后端刷新单个会话的元信息（title / updatedAt / folderId 都以后端为权威）。
 *
 * ⚠️ 会话的 `updatedAt` 是**后端字段**（Runner 每步 `persist()` 时刷新）。
 * 前端不要用 `Date.now()` 自己算：那样「点开一个会话」会把它顶到列表最前面，看起来像它刚被更新过。
 */
export async function refreshConversationMeta(conversationId: string): Promise<void> {
	const list = await agentBridge.getConversations();
	const meta = list.find((c) => c.id === conversationId);
	if (!meta) return;
	setState(
		'conversations',
		produce((convs) => {
			const conv = convs.find((c) => c.id === conversationId);
			// 只覆盖 meta 字段：`agentCtx` 不在 ConversationMeta 里，不会被这次刷新冲掉
			if (conv) Object.assign(conv, meta);
		}),
	);
}

// #endregion

// #region Actions

export const actions = {
	setThemeMode(mode: 'light' | 'dark' | 'system') {
		setState('themeMode', mode);
		saveLocalSettings();
	},

	/** 界面密度（紧凑 / 标准 / 宽松）—— 生效靠 App.tsx 的 createEffect 落到 <html> 类名 */
	setDensity(density: Density) {
		setState('ui', 'density', density);
		saveLocalSettings();
	},

	/** 强调色 —— 同上 */
	setAccent(accent: Accent) {
		setState('ui', 'accent', accent);
		saveLocalSettings();
	},

	/** 任务列表排序方式（侧边栏「列表选项」菜单） */
	setConversationSort(sort: ConversationSort) {
		setState('ui', 'conversationSort', sort);
		saveLocalSettings();
	},

	/**
	 * 添加一个文件夹（= 一个工作目录，比如「打开某个项目」）。
	 * 文件夹没有可自定义的名字：id 就是路径，显示名由 `folderLabel()` 现算。
	 * 同一路径不重复添加；返回 null 表示没加（空路径 / 已经有了），调用方据此决定要不要展开它。
	 */
	addFolder(path: string): Folder | null {
		const target = path.trim();
		if (!target || state.folders.some((f) => f.id === target)) return null;
		const folder: Folder = { id: target, path: target };
		setState('folders', (prev) => [...prev, folder]);
		scheduleSaveBackend();
		return folder;
	},
	removeFolder(id: string) {
		if (id === 'local') return;
		const affectedConversationIds = state.conversations
			.filter((c) => c.folderId === id)
			.map((c) => c.id);
		setState('folders', (prev) => prev.filter((f) => f.id !== id));
		setState(
			'conversations',
			(prev) => prev.map((conversation) =>
				conversation.folderId === id
					? { ...conversation, folderId: 'local', updatedAt: Date.now() }
					: conversation,
			),
		);
		scheduleSaveBackend();
		// ⚠️ 会话的 folderId 必须回写后端：只改前端的话，重启后这些会话挂在一个不存在的文件夹上，
		// 而侧边栏只按 state.folders 渲染 → 任务会「凭空消失」。
		for (const conversationId of affectedConversationIds) {
			void agentBridge.updateConversation(conversationId, { folderId: 'local' });
		}
	},

	async createConversation(folderId: string, title = '新任务') {
		const conv = await agentBridge.createConversation({ folderId, title });
		if (conv) {
			// 只取元信息：ctx 由界面按需拉（loadConversationCtx）
			const uiConv: UIConversation = {
				id: conv.id,
				folderId: conv.folderId,
				title: conv.title,
				modeId: conv.modeId,
				createdAt: conv.createdAt,
				updatedAt: conv.updatedAt,
			};
			setState('conversations', (prev) => [uiConv, ...prev]);
			setState('activeConversationId', conv.id);
			return uiConv;
		}
		return null;
	},
	async deleteConversation(id: string) {
		setState('conversations', (prev) => prev.filter((c) => c.id !== id));
		if (state.activeConversationId === id) {
			setState('activeConversationId', null);
		}
		await agentBridge.deleteConversation(id);
	},
	async renameConversation(id: string, title: string) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === id);
				if (conversation) {
					conversation.title = title;
					conversation.updatedAt = Date.now();
				}
			}),
		);
		await agentBridge.updateConversation(id, { title });
	},
	setConversationFolder(id: string, folderId: string) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === id);
				if (conversation) {
					conversation.folderId = folderId;
					conversation.updatedAt = Date.now();
				}
			}),
		);
		void agentBridge.updateConversation(id, { folderId });
	},
	/**
	 * 写入某会话的 ctx 快照（唯一的 ctx 写入口）。
	 * 界面内容全部由它现算，所以这里删掉了旧的一整套 message 操作
	 * （addMessage / appendMessageBlock / patchMessageBlock / addMessageTokens / …）——
	 * 那些是「前端自己拼一份 UI 转写再回写后端」时代的遗留，见 docs/设计-ctx唯一真相与动态投影.md。
	 */
	/**
	 * 把 ctx 挂到 store 里（界面唯一数据源）。
	 *
	 * ⚠️ **绝不能顺手改 `updatedAt`**：侧边栏按 `updatedAt` 倒序排（`Sidebar.tsx` 的 `sorted`），
	 * 而这个 action 每次「按需加载 ctx」都会被调用 —— 一旦在这里写 `Date.now()`，
	 * 「点开一个会话」就等于把它标成刚更新、立刻跳到列表最前面（2026-09-14 修的 bug）。
	 * 会话的更新时间是**后端字段**，要刷新 meta 请用 `refreshConversationMeta()`。
	 */
	setConversationCtx(conversationId: string, ctx: AgentCtx) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (conversation) conversation.agentCtx = ctx;
			}),
		);
	},

	setActiveConversation(id: string | null) {
		setState('activeConversationId', id);
		// 按需加载 ctx（界面唯一的数据源）
		if (id) void loadConversationCtx(id);
		saveLocalSettings();
	},

	setSidebarWidth(width: number) {
		setState('ui', 'sidebarWidth', Math.max(180, Math.min(400, width)));
	},
	toggleSidebar() {
		setState('ui', 'sidebarCollapsed', (v) => !v);
		saveLocalSettings();
	},
	openSettings(tab?: AppState['ui']['activeSettingsTab']) {
		setState('ui', 'settingsOpen', true);
		if (tab) setState('ui', 'activeSettingsTab', tab);
	},
	closeSettings() {
		setState('ui', 'settingsOpen', false);
		saveLocalSettings();
	},
	setSettingsTab(tab: AppState['ui']['activeSettingsTab']) {
		setState('ui', 'activeSettingsTab', tab);
	},
	setViewMode(mode: ViewMode) {
		setState('ui', 'viewMode', mode);
		saveLocalSettings();
	},

	addProvider(provider: Omit<ModelProvider, 'id'>) {
		const p: ModelProvider = { ...provider, id: uid() };
		setState('providers', (prev) => [...prev, p]);
        // 自动选择第一个模型为标准模型
		if (p.models.length > 0 && !state.currentStandardModel) {
			setState('currentStandardModel', {
				providerId: p.id,
				modelId: p.models[0].id,
			});
		}
		scheduleSaveBackend();
	},
	updateProvider(id: string, patch: Partial<ModelProvider>) {
		setState(
			'providers',
			produce((list) => {
				const p = list.find((p) => p.id === id);
				if (p) Object.assign(p, patch);
			}),
		);
		scheduleSaveBackend();
	},
	removeProvider(id: string) {
		setState(
			'providers',
			produce((list) => list.filter((p) => p.id !== id)),
		);
		if (state.currentStandardModel?.providerId === id) {
			setState('currentStandardModel', null);
		}
		if (state.currentEconomyModel?.providerId === id) {
			setState('currentEconomyModel', null);
		}
		scheduleSaveBackend();
	},
	setCurrentStandardModel(ref: { providerId: string; modelId: string } | null) {
		setState('currentStandardModel', ref);
		scheduleSaveBackend();
	},
	setCurrentEconomyModel(ref: { providerId: string; modelId: string } | null) {
		setState('currentEconomyModel', ref);
		scheduleSaveBackend();
	},

	/** 切换当前模式（第一层的 chip）。纯前端状态，只落本地偏好，不惊动后端设置 */
	setCurrentModeId(modeId: string) {
		setState('currentModeId', modeId);
		saveLocalSettings();
	},
	/**
	 * 基座提示词（设置页「提示词」面板）。
	 * 立刻落盘，不走 500ms 防抖——用户点完保存可能马上关面板；失败时由调用方弹窗提示。
	 */
	async saveBasePrompt(text: string) {
		setState('basePrompt', text);
		return agentBridge.setBasePrompt(text);
	},
	/** 重新加载插件并刷新模式列表 */
	async reloadPlugins() {
		const result = await agentBridge.reloadPlugins();
		const [modes, plugins] = await Promise.all([agentBridge.getModes(), agentBridge.getPlugins()]);
		setState('modes', modes);
		setState('pluginErrors', plugins.errors);
		setState('overriddenModes', plugins.overridden);
		return result;
	},
	/** 从后端拉一次模式列表（启动 / 插件变更后） */
	async refreshModes() {
		const [modes, plugins] = await Promise.all([agentBridge.getModes(), agentBridge.getPlugins()]);
		setState('modes', modes);
		setState('pluginErrors', plugins.errors);
		setState('overriddenModes', plugins.overridden);
		return modes;
	},
	/** 从后端重新取一次构建 / 运行信息（设置页「通用」面板手动刷新用） */
	async refreshServiceHealth() {
		const info = await agentBridge.health();
		setState('serviceHealth', info);
		return info;
	},
	/** 回答 ask_user 提问卡片 */
	async answerToolCall(conversationId: string, toolCallId: string, result: string) {
		return agentBridge.answerToolCall({ conversationId, toolCallId, result });
	},

	/**
	 * 切换内置 mock（开发用）。
	 * ⚠️ 运行期间后端会拒绝（409）→ 只有后端接受了才更新本地状态，失败原样返回给调用方提示。
	 */
	async setMock(params: { enabled?: boolean; scenario?: string }) {
		const result = await agentBridge.setMock(params);
		if (result.ok) {
			setState('mock', (prev) => ({
				...prev,
				enabled: params.enabled ?? prev.enabled,
				scenario: params.scenario ?? prev.scenario,
			}));
		}
		return result;
	},

	/* ---------- MCP 服务器 ---------- */

	addMcpServer(server: Omit<McpServerConfig, 'id'>) {
		const s: McpServerConfig = { ...server, id: uid() };
		setState('mcpServers', (prev) => [...prev, s]);
		scheduleSaveBackend();
		return s;
	},
	updateMcpServer(id: string, patch: Partial<McpServerConfig>) {
		setState(
			'mcpServers',
			produce((list) => {
				const s = list.find((s) => s.id === id);
				if (s) Object.assign(s, patch);
			}),
		);
		scheduleSaveBackend();
	},
	removeMcpServer(id: string) {
		setState(
			'mcpServers',
			produce((list) => list.filter((s) => s.id !== id)),
		);
		scheduleSaveBackend();
	},
	/** 单独改 enabled 时立刻保存（后端收到 PUT 就会同步连接） */
	setMcpServerEnabled(id: string, enabled: boolean) {
		setState(
			'mcpServers',
			produce((list) => {
				const s = list.find((s) => s.id === id);
				if (s) s.enabled = enabled;
			}),
		);
		scheduleSaveBackend();
	},
	/** 保存后立即触发一次后端重连（新增服务器时用，否则要等 debounce 500ms） */
	async flushMcpServers() {
		await agentBridge.setMcpServers(state.mcpServers);
		await actions.refreshMcpStatus();
	},
	async refreshMcpStatus() {
		// 后端是异步连接的，稍等一下再取状态，避免刚点完「连接」就读到旧值
		await new Promise((r) => setTimeout(r, 300));
		const status = await agentBridge.getMcpStatus();
		setState('mcpStatus', status);
		return status;
	},
	async connectMcpServer(id: string) {
		const result = await agentBridge.connectMcpServer(id);
		await actions.refreshMcpStatus();
		return result;
	},
	async disconnectMcpServer(id: string) {
		await agentBridge.disconnectMcpServer(id);
		await actions.refreshMcpStatus();
	},

	setUsage<K extends keyof UsageStats>(key: K, value: UsageStats[K]) {
		setState('usage', key, value as any);
		saveLocalSettings();
	},
};

// #endregion

// #region Selectors

export function getActiveConversation(): UIConversation | null {
	if (!state.activeConversationId) return null;
	return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
}

export function getProviderById(id: string): ModelProvider | undefined {
	return state.providers.find((p) => p.id === id);
}

export function getModeSummary(modeId: string): ModeSummary | undefined {
	return state.modes.find((m) => m.id === modeId);
}

/** 当前模式的展示名 */
export function currentModeName(): string {
	return state.modes.find((m) => m.id === state.currentModeId)?.name ?? state.currentModeId;
}

// #endregion

// #region Actions

export async function initApp() {
	loadLocalSettings();
	await loadBackendState();
	// 后端在 HTTP 服务启动时就自动连了 MCP，这里拉一次运行态用于展示
	void actions.refreshMcpStatus();

	console.log(`[App] 运行环境: ${isElectrobunEnv() ? 'electrobun' : '浏览器'}`);
}

// #endregion
