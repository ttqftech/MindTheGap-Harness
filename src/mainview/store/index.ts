/* ==========================================================================
   全局状态管理（Solid.js store）

   重构后：
   - 后端设置（providers, agentConfigs, folders, conversations）→ Agent Service HTTP
   - 前端设置（themeMode, ui state, usage）→ localStorage
   - 会话列表从后端获取，切换时从后端拉完整数据
   - SSE patch 更新保持前后端尽量同步
   - AppMode → AgentName, ModeConfig → AgentConfig, modeConfigs → agentConfigs
   ========================================================================== */

import { createStore, produce } from 'solid-js/store';
import { localSettings, isElectrobunEnv } from '@mainview/localBridge';
import * as agentBridge from '@mainview/agentBridge';
import type { AgentCtx, ConversationMeta, Message, MessageBlock, ModelProvider, ModeConfigDefaults, ModeSummary, Folder, McpServerConfig, McpServerStatus } from '@shared/agent';

// 转发共享类型（UI 侧统一从 store 引入，避免到处写相对路径）
export type { Message, MessageBlock, MessageRole, ModelProvider, ModelProviderModel, ModeSummary, ModeConfigDefaults, AgentStreamEvent } from '@shared/agent';

// #region 前端扩展类型

export interface UsageStats {
	timeRange: '4h' | '1d' | 'today' | '7d' | '30d';
	showApiRequests: boolean;
	showToolCalls: boolean;
	showTokensInput: boolean;
	showTokensInputCached: boolean;
	showTokensOutput: boolean;
}

export type UIConversation = ConversationMeta & {
	messages: Message[];
	agentCtx?: AgentCtx;
	isStreaming: boolean;
	scrollPosition?: number;
	localDraft?: string;
};

export type ViewMode = 'chat' | 'diagram';

export type UIState = {
	sidebarWidth: number;
	sidebarCollapsed: boolean;
	settingsOpen: boolean;
	activeSettingsTab: '通用' | '模型' | '用量' | '插件 / 模式' | 'MCP';
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
	modeConfigs: Record<string, ModeConfigDefaults>;	// 各模式的配置覆盖（生效配置 = 插件 defaultSettings ⊕ 它）
	// 插件加载错误 / 被覆盖标记（设置页展示用）
	pluginErrors: { level: 'error' | 'warn'; pluginId?: string; modeId?: string; agentId?: string; message: string }[];
	overriddenModes: string[];
	usage: UsageStats;	// 设置页用量统计（TODO 收归到设置页本身，不直接存储在 AppState 中）
	mcpServers: McpServerConfig[];	// MCP 服务器配置（持久化在后端 settings.json）
	mcpStatus: McpServerStatus[];	// MCP 运行态（后端内存维护，不持久化）
};

// #endregion

// #region 初始状态、store

const uid = () => Math.random().toString(36).slice(2, 10);

const initialUI: UIState = {
	sidebarWidth: 260,
	sidebarCollapsed: false,
	settingsOpen: false,
	activeSettingsTab: '通用',
	viewMode: 'chat',
};

const DEFAULT_PROVIDERS: ModelProvider[] = [
	{
		id: 'deepseek',
		name: 'deepsleep',
		apiFormat: 'openai-chat',
		baseUrl: 'https://api.deepseek.com',
		apiKey: 'sk-kentakkiCrazyThursdayVwo50kudasai',
		models: [
			{ id: 'deepseek-v4-elite-extreme-enhanced-extraordinary', displayName: 'DeepSeek V4 Elite Extreme Enhanced Extraordinary', role: 'standard' },
		],
		customParams: {},
	},
];

export const defaultState: AppState = {
	themeMode: 'system',
	folders: [{ id: 'local', name: '本地', isLocal: true }],
	conversations: [],
	activeConversationId: null,
	ui: initialUI,
	providers: DEFAULT_PROVIDERS,
	currentStandardModel: { providerId: 'deepseek', modelId: 'deepseek-v4-elite-extreme-enhanced-extraordinary' },
	currentEconomyModel: null,
	currentModeId: 'code',
	modes: [],
	modeConfigs: {},
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
};

export const [state, setState] = createStore<AppState>(defaultState);

// #endregion

// #region 前端设置持久化（localStorage）

// TODO 我认为只有 themeMode 是需要持久化的，其他设置项（如 sidebarWidth、sidebarCollapsed、viewMode 等）都不用落盘
function saveLocalSettings() {
	localSettings.set('ui', {
		sidebarWidth: state.ui.sidebarWidth,
		sidebarCollapsed: state.ui.sidebarCollapsed,
		viewMode: state.ui.viewMode,
	});
	localSettings.set('themeMode', state.themeMode);
	localSettings.set('usage', state.usage);	// TODO 收归
}

function loadLocalSettings() {
	const theme = localSettings.get<'light' | 'dark' | 'system'>('themeMode', defaultState.themeMode);
	setState('themeMode', theme);

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
	await agentBridge.setCurrentMode(state.currentModeId);
	await agentBridge.setModeConfigs(state.modeConfigs);
	await agentBridge.setFolders(state.folders);
	await agentBridge.setMcpServers(state.mcpServers);
}

async function loadBackendState(): Promise<void> {
	console.log('[Store] Harness 设置正在从 Agent Service 读取');

	const [providers, currentModel, modes, modeConfigs, currentMode, folders, conversations, mcpServers] = await Promise.all([
		agentBridge.getProviders(),
		agentBridge.getCurrentModel(),
		agentBridge.getModes(),
		agentBridge.getModeConfigs(),
		agentBridge.getCurrentMode(),
		agentBridge.getFolders(),
		agentBridge.getConversations(),
		agentBridge.getMcpServers(),
	]);

	if (providers.length > 0) setState('providers', providers);
	if (currentModel) {
		if (currentModel.standard) setState('currentStandardModel', currentModel.standard);
		if (currentModel.economy) setState('currentEconomyModel', currentModel.economy);
	}
	setState('modes', modes);
	setState('modeConfigs', modeConfigs);
	// 当前模式以「插件真的提供了这个模式」为准，否则退回第一个可用模式
	if (currentMode && modes.some((m) => m.id === currentMode)) {
		setState('currentModeId', currentMode);
	} else if (modes.length > 0) {
		setState('currentModeId', modes[0].id);
	}
	if (folders.length > 0) setState('folders', folders);
	setState('mcpServers', mcpServers);

	if (conversations.length > 0) {
		const uiConvs: UIConversation[] = conversations.map((meta) => ({
			...meta,
			messages: [],
			isStreaming: false,
		}));
		setState('conversations', uiConvs);
	}
}

// 加载指定会话的完整数据（按需加载）
export async function loadConversationMessages(conversationId: string): Promise<void> {
	const conv = state.conversations.find((c) => c.id === conversationId);
	if (!conv || conv.messages.length > 0) return;

	const full = await agentBridge.getConversation(conversationId);
	if (full) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (conversation) {
					conversation.messages = full.messages;
					conversation.agentCtx = full.agentCtx;
				}
			}),
		);
	}
}

// #endregion

// #region Actions

export const actions = {
	setThemeMode(mode: 'light' | 'dark' | 'system') {
		setState('themeMode', mode);
		saveLocalSettings();
	},

	addFolder(idOrPath: string, name?: string) {
		const hasExplicitName = name !== undefined;
		const id = hasExplicitName ? idOrPath : uid();
		const folder: Folder = {
			id,
			name: hasExplicitName ? name : idOrPath.split(/[\\/]/).pop() || idOrPath,
			path: hasExplicitName ? idOrPath : idOrPath,
		};
		setState('folders', (prev) => [...prev, folder]);
		scheduleSaveBackend();
		return folder;
	},
	removeFolder(id: string) {
		if (id === 'local') return;
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
	},

	async createConversation(folderId: string, title = '新任务') {
		const conv = await agentBridge.createConversation({ folderId, title });
		if (conv) {
			const uiConv: UIConversation = {
				...conv,
				isStreaming: false,
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
	addMessage(conversationId: string, message: Omit<Message, 'id' | 'createdAt'>) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (conversation) {
					conversation.messages.push({
						...message,
						id: uid(),
						createdAt: Date.now(),
					});
					conversation.updatedAt = Date.now();
				}
			}),
		);
	},
	appendMessageContent(conversationId: string, messageId: string, chunk: string) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (!conversation) return;
				const msg = conversation.messages.find((m) => m.id === messageId);
				if (msg) {
					msg.content += chunk;
					conversation.updatedAt = Date.now();
				}
			}),
		);
	},
	updateMessage(conversationId: string, messageId: string, patch: Partial<Message>) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (!conversation) return;
				const msg = conversation.messages.find((m) => m.id === messageId);
				if (msg) {
					Object.assign(msg, patch);
					conversation.updatedAt = Date.now();
				}
			}),
		);
	},
	/**
	 * 累加一条消息上的 token 用量。
	 *
	 * ⚠️ 不能直接用 updateMessage 覆盖 `tokens`：一次用户消息期间会有**很多次** LLM 请求
	 * （多轮工具调用 + 反思 + 子 Agent），覆盖的话界面上只剩最后一次的数字，
	 * 而且比真实总量小得多——这正是「总消耗看着不对」的原因。
	 */
	addMessageTokens(
		conversationId: string,
		messageId: string,
		tokens: { input?: number; output?: number; inputCached?: number; cached?: number; total?: number },
	) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (!conversation) return;
				const msg = conversation.messages.find((m) => m.id === messageId);
				if (!msg) return;
				const prev = msg.tokens ?? {};
				const cached = tokens.inputCached ?? tokens.cached ?? 0;
				msg.tokens = {
					input: (prev.input ?? 0) + (tokens.input ?? 0),
					output: (prev.output ?? 0) + (tokens.output ?? 0),
					cached: (prev.cached ?? 0) + cached,
				};
				msg.llmCalls = (msg.llmCalls ?? 0) + 1;
				conversation.updatedAt = Date.now();
			}),
		);
	},
	appendMessageBlock(conversationId: string, messageId: string, block: MessageBlock) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (!conversation) return;
				const msg = conversation.messages.find((m) => m.id === messageId);
				if (!msg) return;
				if (!msg.blocks) msg.blocks = [];
				if (block.type === 'text' && msg.blocks.length > 0) {
					const last = msg.blocks[msg.blocks.length - 1];
					if (last.type === 'text' && last.depth === block.depth) {
						last.content += block.content;
						msg.content += block.content;
						conversation.updatedAt = Date.now();
						return;
					}
				}
				// 思考增量同样按「同深度连续追加」合并，否则每个 delta 都会新起一个块
				if (block.type === 'reasoning' && msg.blocks.length > 0) {
					const last = msg.blocks[msg.blocks.length - 1];
					if (last.type === 'reasoning' && last.depth === block.depth) {
						last.content += block.content;
						conversation.updatedAt = Date.now();
						return;
					}
				}
				msg.blocks.push(block);
				if (block.type === 'text') {
					msg.content += block.content;
				}
				conversation.updatedAt = Date.now();
			}),
		);
	},
	/**
	 * 按 key 更新某个块。
	 *
	 * `onlyType`：只更新该类型的块。ask_user 的「提问卡片」和它的工具块共用同一个 callId 作为 key，
	 * 工具结果到达时如果不加类型过滤，会把卡片的状态也一起改成 success——卡片会瞬间显示成「已回答」。
	 */
	patchMessageBlock(
		conversationId: string,
		messageId: string,
		key: string,
		patch: Partial<MessageBlock>,
		onlyType?: MessageBlock['type'],
	) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (!conversation) return;
				const msg = conversation.messages.find((m) => m.id === messageId);
				if (!msg?.blocks) return;
				for (const b of msg.blocks) {
					if (b.key === key && (!onlyType || b.type === onlyType)) Object.assign(b, patch);
				}
				conversation.updatedAt = Date.now();
			}),
		);
	},
	setConversationCtx(conversationId: string, ctx: AgentCtx) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (conversation) {
					conversation.agentCtx = ctx;
					conversation.updatedAt = Date.now();
				}
			}),
		);
	},
	setConversationStreaming(conversationId: string, isStreaming: boolean) {
		setState(
			'conversations',
			produce((list) => {
				const conversation = list.find((c) => c.id === conversationId);
				if (conversation) conversation.isStreaming = isStreaming;
			}),
		);
	},

	setActiveConversation(id: string | null) {
		setState('activeConversationId', id);
        // 按需加载 messages
		if (id) void loadConversationMessages(id);
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

	/** 切换当前模式（第一层的 chip） */
	setCurrentModeId(modeId: string) {
		setState('currentModeId', modeId);
		scheduleSaveBackend();
	},
	/** 覆盖某个模式的配置（设置页 JSON 编辑器，唯一配置入口） */
	setModeConfig(modeId: string, config: ModeConfigDefaults) {
		setState('modeConfigs', (prev) => ({ ...prev, [modeId]: config }));
		scheduleSaveBackend();
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
	/** 回答 ask_user 提问卡片 */
	async answerToolCall(conversationId: string, toolCallId: string, result: string) {
		return agentBridge.answerToolCall({ conversationId, toolCallId, result });
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
