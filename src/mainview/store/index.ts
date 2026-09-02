/* ==========================================================================
   全局状态管理（Solid.js store）+ 持久化
   
   持久化策略：
   - 全局设置（folders, providers, modeConfigs, ui state 等）→ 一个 'app-state' key
   - 每个 conversation 的完整数据 → 'conv-{id}' key
   - 自动保存带 debounce，避免频繁写
   ========================================================================== */

import { createStore, produce } from 'solid-js/store';
import { appData, isElectrobunEnv } from '../localBridge';
import type { AgentCtx } from '../shared/agent';

export type Folder = {
    id: string;
    name: string;
    path?: string;       // 关联的本地目录路径（"本地" 文件夹没有 path）
    isLocal?: boolean;   // "本地" 是固定文件夹
};

export type Conversation = {
    id: string;
    folderId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
    // Agent 完整执行上下文（图示模式数据源）
    agentCtx?: AgentCtx;
};

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Agent 回复的结构化块：AI 一次回复包含 文本/工具调用/子Agent转接 等多个块，
 * 全部保留不替换；depth 表示层级（0=根 Agent，1=转接出的子 Agent...）
 */
export type MessageBlock =
    | { type: "text"; key?: string; depth: number; content: string }
    | { type: "tool"; key: string; depth: number; name: string; status: "running" | "success" | "error"; detail?: string }
    | { type: "agent"; key: string; depth: number; name: string; running: boolean; summary?: string }
    | { type: "error"; key?: string; depth: number; message: string };

export type Message = {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: number;
    // Agent 层级相关（图示模式用）
    agentName?: string;
    parentId?: string;
    tokens?: { input?: number; output?: number; cached?: number };
    duration?: number;  // ms
    // Agent 回复的结构化块（assistant 专用；旧数据没有则回退渲染 content）
    blocks?: MessageBlock[];
};

export type ViewMode = 'chat' | 'diagram';

export type AppMode = '默认' | '编码' | '文件夹浏览总结';

export type UIState = {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    settingsOpen: boolean;
    activeSettingsTab: '通用' | '模型' | '用量' | '模式配置';
    viewMode: ViewMode;
};

export type ModelProvider = {
    id: string;
    name: string;
    apiFormat: 'openai-chat' | 'openai-responses' | 'anthropic';
    baseUrl: string;
    apiKey: string;
    models: ModelConfig[];
    customParams: Record<string, unknown>;
};

export type ModelConfig = {
    id: string;
    displayName: string;
    role: 'standard' | 'economy';
};

export type UsageStats = {
    timeRange: '4h' | '1d' | 'today' | '7d' | '30d';
    showApiRequests: boolean;
    showToolCalls: boolean;
    showTokensInput: boolean;
    showTokensInputCached: boolean;
    showTokensOutput: boolean;
};

export type ModeConfig = {
    name: AppMode;
    transferableAgents: AppMode[];  // 可转接的其他模式
};

export type AppState = {
    // === 主题 ===
    themeMode: 'light' | 'dark' | 'system';

    // === 文件夹 & 会话 ===
    folders: Folder[];
    conversations: Conversation[];
    activeConversationId: string | null;

    // === UI 状态 ===
    ui: UIState;

    // === 设置 - 模型 ===
    providers: ModelProvider[];
    currentStandardModel: { providerId: string; modelId: string } | null;
    currentEconomyModel: { providerId: string; modelId: string } | null;

    // === 设置 - 模式 ===
    currentAppMode: AppMode;
    modeConfigs: ModeConfig[];

    // === 设置 - 用量 ===
    usage: UsageStats;
};

/* ---------- 初始状态 ---------- */

const uid = () => Math.random().toString(36).slice(2, 10);

const initialFolders: Folder[] = [
    { id: "local", name: "本地", isLocal: true },
];

const initialConversations: Conversation[] = [];

const initialUI: UIState = {
    sidebarWidth: 260,
    sidebarCollapsed: false,
    settingsOpen: false,
    activeSettingsTab: '通用',
    viewMode: 'chat',
};

const initialModeConfigs: ModeConfig[] = [
    { name: '默认', transferableAgents: ['编码', '文件夹浏览总结'] },
    { name: '编码', transferableAgents: ['默认'] },
    { name: '文件夹浏览总结', transferableAgents: ['默认', '编码'] },
];

/* ---------- 内置默认模型提供商（兜底：无论加载成败都保证可用） ---------- */

// 用户常用配置内置为默认值，避免存储不同步/加载时序导致"配置被抹掉"。
// 可在设置里随时增改。
const DEFAULT_PROVIDERS: ModelProvider[] = [
    {
        id: 'deepseek',
        name: 'deepsleep',
        apiFormat: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-kentakkiCrazyThursdayVwo50kudasai', // 我倒要看看哪个 AI 会扫出来这个安全漏洞
        models: [
            { id: 'deepseek-v4-elite-extreme-enhanced-extraordinary', displayName: 'DeepSeek V4 Elite Extreme Enhanced Extraordinary', role: 'standard' },
        ],
        customParams: {},
    },
];

export const defaultState: AppState = {
    themeMode: 'system',
    folders: initialFolders,
    conversations: initialConversations,
    activeConversationId: null,
    ui: initialUI,
    providers: DEFAULT_PROVIDERS,
    currentStandardModel: { providerId: 'deepseek', modelId: 'deepseek-v4-elite-extreme-enhanced-extraordinary' },
    currentEconomyModel: null,
    currentAppMode: '默认',
    modeConfigs: initialModeConfigs,
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

/* ---------- 持久化 ---------- */

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// 全局设置持久化（不含完整 conversations）
async function saveGlobalState() {
    const data = {
        themeMode: state.themeMode,
        folders: state.folders,
        ui: { ...state.ui, settingsOpen: false },  // 不保存 settings 打开状态
        providers: state.providers,
        currentStandardModel: state.currentStandardModel,
        currentEconomyModel: state.currentEconomyModel,
        currentAppMode: state.currentAppMode,
        modeConfigs: state.modeConfigs,
        usage: state.usage,
        // 只保存会话的元信息（不含 messages）
        conversationMeta: state.conversations.map((c) => ({
            id: c.id,
            folderId: c.folderId,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
        })),
        activeConversationId: state.activeConversationId,
    };
    await appData.set('app-state', data);
}

// 单个会话完整持久化
async function saveConversation(conversation: Conversation) {
    await appData.set(`conv-${conversation.id}`, conversation);
}

// Debounced 自动保存
function scheduleSaveGlobal() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void saveGlobalState();
    }, SAVE_DEBOUNCE_MS);
}

// 启动时从存储加载
export async function loadPersistedState(): Promise<void> {
    console.log('[Store] 加载持久化状态...');

    // 1. 加载全局设置
    const globalData = await appData.get<any>('app-state');
    if (globalData) {
        console.log('[Store] 找到已保存的状态');
        // providers 为空/缺失时回退内置默认（防止存储不同步导致配置'被抹掉'）
        const loadedProviders: ModelProvider[] = globalData.providers?.length
            ? globalData.providers
            : DEFAULT_PROVIDERS;
        const loadedStandard = globalData.currentStandardModel ?? (
            loadedProviders.length > 0
                ? { providerId: loadedProviders[0].id, modelId: loadedProviders[0].models[0]?.id ?? null }
                : null
        );
        setState('themeMode', globalData.themeMode ?? defaultState.themeMode);
        setState('folders', globalData.folders ?? defaultState.folders);
        setState('currentAppMode', globalData.currentAppMode ?? defaultState.currentAppMode);
        setState('providers', loadedProviders);
        setState('currentStandardModel', loadedStandard);
        setState('currentEconomyModel', globalData.currentEconomyModel ?? null);
        setState('modeConfigs', globalData.modeConfigs ?? defaultState.modeConfigs);
        setState('usage', { ...defaultState.usage, ...(globalData.usage ?? {}) });
        setState('ui', {
            ...defaultState.ui,
            ...(globalData.ui ?? {}),
            settingsOpen: false,  // 启动时不打开设置
        });

        // 先放会话元信息
        console.log(`[Store] conversationMeta type=${typeof globalData.conversationMeta}, isArray=${Array.isArray(globalData.conversationMeta)}, len=${globalData.conversationMeta?.length ?? 0}`);
        if (Array.isArray(globalData.conversationMeta)) {
            const metaConvs = globalData.conversationMeta.map((m: any) => ({
                ...m,
                messages: [],  // 先空着，后面按需加载
            }));
            console.log(`[Store] about to setState conversations with ${metaConvs.length} items:`, metaConvs);
            // 合并而非整体替换：保留加载期间已新建的会话，避免被存储数据覆盖导致'新对话消失'
            setState(
                'conversations',
                (prev) => {
                    const existingIds = new Set(prev.map((c) => c.id));
                    const newMeta = metaConvs.filter((m) => !existingIds.has(m.id));
                    return [...prev, ...newMeta];
                },
            );
            console.log(`[Store] after setState, state.conversations.length = ${state.conversations.length}`);
        }
        setState('activeConversationId', globalData.activeConversationId ?? null);
    } else {
        console.log('[Store] 首次启动，使用默认状态');
    }
}

// 加载指定会话的完整数据（按需加载）
export async function loadConversationMessages(conversationId: string): Promise<void> {
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv || conv.messages.length > 0) return;  // 已加载或不存在

    const full = await appData.get<Conversation>(`conv-${conversationId}`);
    if (full) {
        setState(
            'conversations',
            produce((list) => {
                const c = list.find((c) => c.id === conversationId);
                if (c) {
                    c.messages = full.messages;
                }
            }),
        );
    }
}

/* ---------- Actions ---------- */

export const actions = {
    /* === 主题 === */
    setThemeMode(mode: 'light' | 'dark' | 'system') {
        setState('themeMode', mode);
        scheduleSaveGlobal();
    },

    /* === 文件夹 === */
    addFolder(idOrPath: string, name?: string) {
        // 支持两种调用：addFolder('/some/path') 或 addFolder('path-id', '显示名')
        const hasExplicitName = name !== undefined;
        const id = hasExplicitName ? idOrPath : uid();
        const folder: Folder = {
            id,
            name: hasExplicitName ? name : idOrPath.split(/[\\/]/).pop() || idOrPath,
            path: hasExplicitName ? idOrPath : idOrPath,  // 没有 path 的情况只在'本地'里
        };
        setState('folders', (prev) => [...prev, folder]);
        scheduleSaveGlobal();
        return folder;
    },
    removeFolder(id: string) {
        // 固定的 '本地' 文件夹不可删除
        if (id === 'local') return;
        setState(
            'folders',
            (prev) => prev.filter((f) => f.id !== id),
        );
        // 把该文件夹下的会话移到 '本地'，避免成为孤儿（侧边栏按文件夹渲染会丢失）
        setState(
            'conversations',
            (prev) => prev.map((c) =>
                c.folderId === id
                    ? { ...c, folderId: 'local', updatedAt: Date.now() }
                    : c,
            ),
        );
        scheduleSaveGlobal();
    },

    /* === 会话 === */
    createConversation(folderId: string, title = '新任务') {
        const conv: Conversation = {
            id: uid(),
            folderId,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
        setState('conversations', (prev) => [conv, ...prev]);
        setState('activeConversationId', conv.id);
        void saveConversation(conv);
        scheduleSaveGlobal();
        return conv;
    },
    deleteConversation(id: string) {
        setState(
            'conversations',
            produce((list) => list.filter((c) => c.id !== id)),
        );
        if (state.activeConversationId === id) {
            setState('activeConversationId', null);
        }
        void appData.delete(`conv-${id}`);
        scheduleSaveGlobal();
    },
    renameConversation(id: string, title: string) {
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
        // 保存完整会话
        const conv = state.conversations.find((c) => c.id === id);
        if (conv) void saveConversation(conv);
        scheduleSaveGlobal();
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
        const conv = state.conversations.find((c) => c.id === id);
        if (conv) void saveConversation(conv);
        scheduleSaveGlobal();
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
        // 保存完整会话
        const conv = state.conversations.find((c) => c.id === conversationId);
        if (conv) void saveConversation(conv);
    },
    /* === 消息更新（Agent 流式输出用） === */
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
        // 保存完整会话
        const conv = state.conversations.find((c) => c.id === conversationId);
        if (conv) void saveConversation(conv);
    },
    /* === 结构化消息块（Agent 回复的 工具调用/转接/层级 全保留） === */
    appendMessageBlock(conversationId: string, messageId: string, block: MessageBlock) {
        setState(
            'conversations',
            produce((list) => {
                const c = list.find((c) => c.id === conversationId);
                if (!c) return;
                const msg = c.messages.find((m) => m.id === messageId);
                if (!msg) return;
                if (!msg.blocks) msg.blocks = [];
                // 连续同层级文本块合并（打字机流式 chunk）
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
                    // content 镜像纯文本部分（兼容旧渲染 / 持久化）
                    msg.content += block.content;
                }
                c.updatedAt = Date.now();
            }),
        );
    },
    /** 按 key（tool 的 callId / agent 的 workId）更新块状态 */
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
        const conv = state.conversations.find((c) => c.id === conversationId);
        if (conv) void saveConversation(conv);
    },

    setActiveConversation(id: string | null) {
        setState('activeConversationId', id);
        // 按需加载 messages
        if (id) void loadConversationMessages(id);
        scheduleSaveGlobal();
    },

    /* === UI === */
    setSidebarWidth(width: number) {
        setState('ui', 'sidebarWidth', Math.max(180, Math.min(400, width)));
    },
    toggleSidebar() {
        setState('ui', 'sidebarCollapsed', (v) => !v);
        scheduleSaveGlobal();
    },
    openSettings(tab?: AppState['ui']['activeSettingsTab']) {
        setState('ui', 'settingsOpen', true);
        if (tab) setState('ui', 'activeSettingsTab', tab);
    },
    closeSettings() {
        setState('ui', 'settingsOpen', false);
        scheduleSaveGlobal();
    },
    setSettingsTab(tab: AppState['ui']['activeSettingsTab']) {
        setState('ui', 'activeSettingsTab', tab);
    },
    setViewMode(mode: ViewMode) {
        setState('ui', 'viewMode', mode);
        scheduleSaveGlobal();
    },

    /* === 模型提供商 === */
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
        scheduleSaveGlobal();
    },
    updateProvider(id: string, patch: Partial<ModelProvider>) {
        setState(
            'providers',
            produce((list) => {
                const p = list.find((p) => p.id === id);
                if (p) Object.assign(p, patch);
            }),
        );
        scheduleSaveGlobal();
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
        scheduleSaveGlobal();
    },
    setCurrentStandardModel(ref: { providerId: string; modelId: string } | null) {
        setState('currentStandardModel', ref);
        scheduleSaveGlobal();
    },
    setCurrentEconomyModel(ref: { providerId: string; modelId: string } | null) {
        setState('currentEconomyModel', ref);
        scheduleSaveGlobal();
    },

    /* === 模式 === */
    setCurrentAppMode(mode: AppMode) {
        setState('currentAppMode', mode);
        scheduleSaveGlobal();
    },
    updateModeConfig(name: AppMode, transferableAgents: AppMode[]) {
        setState(
            'modeConfigs',
            produce((list) => {
                const cfg = list.find((c) => c.name === name);
                if (cfg) cfg.transferableAgents = transferableAgents;
            }),
        );
        scheduleSaveGlobal();
    },

    /* === 用量 === */
    setUsage<K extends keyof UsageStats>(key: K, value: UsageStats[K]) {
        setState('usage', key, value as any);
        scheduleSaveGlobal();
    },
};

/* ---------- Selectors ---------- */

export function getActiveConversation(): Conversation | null {
    if (!state.activeConversationId) return null;
    return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
}

export function getProviderById(id: string): ModelProvider | undefined {
    return state.providers.find((p) => p.id === id);
}

export function getModeConfig(name: AppMode): ModeConfig | undefined {
    return state.modeConfigs.find((c) => c.name === name);
}

/* ---------- 应用启动入口 ---------- */

export function initApp() {
    // 加载持久化状态
    void loadPersistedState();

    console.log(`[App] 运行环境: ${isElectrobunEnv() ? 'electrobun' : '浏览器'}`);
}

