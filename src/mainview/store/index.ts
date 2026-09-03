/* ==========================================================================
   全局状态管理（Solid.js store）

   重构后：
   - 后端设置（providers, agentConfigs, usage, folders, conversations）→ Agent Service HTTP
   - 前端设置（themeMode, ui state）→ localStorage
   - 会话列表从后端获取，切换时从后端拉完整数据
   - SSE patch 更新保持前后端尽量同步
   - AppMode → AgentName, ModeConfig → AgentConfig, modeConfigs → agentConfigs
   ========================================================================== */

import { createStore, produce } from 'solid-js/store';
import { localSettings, isElectrobunEnv } from '../localBridge';
import * as agentBridge from '../agentBridge';
import type {
	AgentCtx,
	AgentName,
	AgentConfig,
	ConversationMeta,
	ServiceConversation,
	Message,
	MessageBlock,
	MessageRole,
	ModelProvider,
	ModelProviderModel,
	UsageStats,
	Folder,
} from '../../shared/agent';

/* ---------- 前端扩展类型（UITask 模式） ---------- */

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
	activeSettingsTab: '通用' | '模型' | '用量' | '模式配置';
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
	currentAgentName: AgentName;
	agentConfigs: AgentConfig[];
	usage: UsageStats;
};

/* ---------- 初始状态 ---------- */

const uid = () => Math.random().toString(36).slice(2, 10);

const initialUI: UIState = {
	sidebarWidth: 260,
	sidebarCollapsed: false,
	settingsOpen: false,
	activeSettingsTab: '通用',
	viewMode: 'chat',
};

const initialAgentConfigs: AgentConfig[] = [
	{ name: '默认', transferableAgents: ['编码', '文件夹浏览总结'] },
	{ name: '编码', transferableAgents: ['默认'] },
	{ name: '文件夹浏览总结', transferableAgents: ['默认', '编码'] },
];

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
	currentAgentName: '默认',
	agentConfigs: initialAgentConfigs,
	usage: {
		timeRange: '7d',
		showApiRequests: true,
		showToolCalls: true,
		showTokensInput: true,
		showTokensInputCached: true,
		showTokensOutput: true,
	},
};

/* ---------- Store ---------- */

export const [state, setState] = createStore<AppState>(defaultState);

/* ---------- 前端设置持久化（localStorage） ---------- */

function saveLocalSettings() {
	localSettings.set('ui', {
		sidebarWidth: state.ui.sidebarWidth,
		sidebarCollapsed: state.ui.sidebarCollapsed,
		viewMode: state.ui.viewMode,
	});
	localSettings.set('themeMode', state.themeMode);
}

function loadLocalSettings() {
	const theme = localSettings.get<'light' | 'dark' | 'system'>('themeMode', defaultState.themeMode);
	setState('themeMode', theme);

	const ui = localSettings.get<Partial<UIState>>('ui', {});
	setState('ui', {
		...defaultState.ui,
		...ui,
		settingsOpen: false,
	});
}

/* ---------- 后端数据同步 ---------- */

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveBackend() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		void saveBackendSettings();
	}, SAVE_DEBOUNCE_MS);
}

async function saveBackendSettings() {
	await agentBridge.setProviders(state.providers);
	await agentBridge.setCurrentModel({
		standard: state.currentStandardModel,
		economy: state.currentEconomyModel,
	});
	await agentBridge.setAgentConfigs(state.agentConfigs);
	await agentBridge.setUsage(state.usage);
	await agentBridge.setFolders(state.folders);
}

async function loadBackendState(): Promise<void> {
	console.log('[Store] 从 Agent Service 加载后端状态...');

	const [providers, currentModel, agentConfigs, usage, folders, conversations] = await Promise.all([
		agentBridge.getProviders(),
		agentBridge.getCurrentModel(),
		agentBridge.getAgentConfigs(),
		agentBridge.getUsage(),
		agentBridge.getFolders(),
		agentBridge.getConversations(),
	]);

	if (providers.length > 0) setState('providers', providers);
	if (currentModel) {
		if (currentModel.standard) setState('currentStandardModel', currentModel.standard);
		if ((currentModel as any).economy) setState('currentEconomyModel', (currentModel as any).economy);
	}
	if (agentConfigs.length > 0) setState('agentConfigs', agentConfigs);
	if (usage) setState('usage', usage);
	if (folders.length > 0) setState('folders', folders);

	if (conversations.length > 0) {
		const uiConvs: UIConversation[] = conversations.map((m) => ({
			...m,
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
				const c = list.find((c) => c.id === conversationId);
				if (c) {
					c.messages = full.messages;
					c.agentCtx = full.agentCtx;
				}
			}),
		);
	}
}

/* ---------- Actions ---------- */

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
			(prev) => prev.map((c) =>
				c.folderId === id
					? { ...c, folderId: 'local', updatedAt: Date.now() }
					: c,
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
				const c = list.find((c) => c.id === id);
				if (c) {
					c.title = title;
					c.updatedAt = Date.now();
				}
			}),
		);
		await agentBridge.updateConversation(id, { title });
	},
	setConversationFolder(id: string, folderId: string) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === id);
				if (c) {
					c.folderId = folderId;
					c.updatedAt = Date.now();
				}
			}),
		);
		void agentBridge.updateConversation(id, { folderId });
	},
	addMessage(conversationId: string, message: Omit<Message, 'id' | 'createdAt'>) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (c) {
					c.messages.push({
						...message,
						id: uid(),
						createdAt: Date.now(),
					});
					c.updatedAt = Date.now();
				}
			}),
		);
	},
	appendMessageContent(conversationId: string, messageId: string, chunk: string) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (!c) return;
				const msg = c.messages.find((m) => m.id === messageId);
				if (msg) {
					msg.content += chunk;
					c.updatedAt = Date.now();
				}
			}),
		);
	},
	updateMessage(conversationId: string, messageId: string, patch: Partial<Message>) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (!c) return;
				const msg = c.messages.find((m) => m.id === messageId);
				if (msg) {
					Object.assign(msg, patch);
					c.updatedAt = Date.now();
				}
			}),
		);
	},
	appendMessageBlock(conversationId: string, messageId: string, block: MessageBlock) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (!c) return;
				const msg = c.messages.find((m) => m.id === messageId);
				if (!msg) return;
				if (!msg.blocks) msg.blocks = [];
				if (block.type === 'text' && msg.blocks.length > 0) {
					const last = msg.blocks[msg.blocks.length - 1];
					if (last.type === 'text' && last.depth === block.depth) {
						last.content += block.content;
						msg.content += block.content;
						c.updatedAt = Date.now();
						return;
					}
				}
				msg.blocks.push(block);
				if (block.type === 'text') {
					msg.content += block.content;
				}
				c.updatedAt = Date.now();
			}),
		);
	},
	patchMessageBlock(conversationId: string, messageId: string, key: string, patch: Partial<MessageBlock>) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (!c) return;
				const msg = c.messages.find((m) => m.id === messageId);
				if (!msg?.blocks) return;
				for (const b of msg.blocks) {
					if (b.key === key) Object.assign(b, patch);
				}
				c.updatedAt = Date.now();
			}),
		);
	},
	setConversationCtx(conversationId: string, ctx: AgentCtx) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (c) {
					c.agentCtx = ctx;
					c.updatedAt = Date.now();
				}
			}),
		);
	},
	setConversationStreaming(conversationId: string, isStreaming: boolean) {
		setState(
			'conversations',
			produce((list) => {
				const c = list.find((c) => c.id === conversationId);
				if (c) c.isStreaming = isStreaming;
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

	setCurrentAgentName(name: AgentName) {
		setState('currentAgentName', name);
		scheduleSaveBackend();
	},
	updateAgentConfig(name: AgentName, transferableAgents: AgentName[]) {
		setState(
			'agentConfigs',
			produce((list) => {
				const cfg = list.find((c) => c.name === name);
				if (cfg) cfg.transferableAgents = transferableAgents;
			}),
		);
		scheduleSaveBackend();
	},

	setUsage<K extends keyof UsageStats>(key: K, value: UsageStats[K]) {
		setState('usage', key, value as any);
		scheduleSaveBackend();
	},
};

/* ---------- Selectors ---------- */

export function getActiveConversation(): UIConversation | null {
	if (!state.activeConversationId) return null;
	return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
}

export function getProviderById(id: string): ModelProvider | undefined {
	return state.providers.find((p) => p.id === id);
}

export function getAgentConfig(name: AgentName): AgentConfig | undefined {
	return state.agentConfigs.find((c) => c.name === name);
}

/* ---------- 应用启动入口 ---------- */

export async function initApp() {
	loadLocalSettings();
	await loadBackendState();

	console.log(`[App] 运行环境: ${isElectrobunEnv() ? 'electrobun' : '浏览器'}`);
}
