/* ==========================================================================
   Agent Service Storage — MindTheGap-Harness

   Agent Service 的持久化层。管理会话、设置等数据的存储和读取。
   数据存到用户目录下的 ~/.mindthegap-harness/ 文件夹。
   后期可替换为 SQLite / Redis 等更高效的存储。
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentCtx, ConversationMeta, ServiceConversation, ServiceSettings, ModelProvider, AgentConfig, UsageStats, Folder, AgentName } from '../shared/agent';

const DATA_DIR = join(homedir(), '.mindthegap-harness');

function ensureDir() {
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (!existsSync(filePath)) return fallback;
		return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return fallback;
	}
}

function writeJsonFile(filePath: string, data: unknown) {
	ensureDir();
	writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const CONVERSATIONS_DIR = join(DATA_DIR, 'conversations');

function ensureConversationsDir() {
	if (!existsSync(CONVERSATIONS_DIR)) mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

const defaultSettings: ServiceSettings = {
	providers: [],
	currentStandardModel: null,
	currentEconomyModel: null,
	currentAgentName: '默认',
	agentConfigs: [
		{ name: '默认', transferableAgents: ['编码', '文件夹浏览总结'] },
		{ name: '编码', transferableAgents: ['默认'] },
		{ name: '文件夹浏览总结', transferableAgents: ['默认', '编码'] },
	],
	usage: {
		timeRange: '7d',
		showApiRequests: true,
		showToolCalls: true,
		showTokensInput: true,
		showTokensInputCached: true,
		showTokensOutput: true,
	},
	folders: [{ id: 'local', name: '本地', isLocal: true }],
};

export const storage = {
	async getSettings(): Promise<ServiceSettings> {
		return readJsonFile(SETTINGS_FILE, defaultSettings);
	},

	async setSettings(settings: ServiceSettings): Promise<void> {
		writeJsonFile(SETTINGS_FILE, settings);
	},

	async getProviders(): Promise<ModelProvider[]> {
		const settings = await this.getSettings();
		return settings.providers;
	},

	async setProviders(providers: ModelProvider[]): Promise<void> {
		const settings = await this.getSettings();
		settings.providers = providers;
		await this.setSettings(settings);
	},

	async getCurrentModel(): Promise<{ standard: ServiceSettings['currentStandardModel']; economy: ServiceSettings['currentEconomyModel'] }> {
		const settings = await this.getSettings();
		return { standard: settings.currentStandardModel, economy: settings.currentEconomyModel };
	},

	async setCurrentModel(params: { standard?: ServiceSettings['currentStandardModel']; economy?: ServiceSettings['currentEconomyModel'] }): Promise<void> {
		const settings = await this.getSettings();
		if (params.standard !== undefined) settings.currentStandardModel = params.standard;
		if (params.economy !== undefined) settings.currentEconomyModel = params.economy;
		await this.setSettings(settings);
	},

	async getAgentConfigs(): Promise<AgentConfig[]> {
		const settings = await this.getSettings();
		return settings.agentConfigs;
	},

	async setAgentConfigs(configs: AgentConfig[]): Promise<void> {
		const settings = await this.getSettings();
		settings.agentConfigs = configs;
		await this.setSettings(settings);
	},

	async getUsage(): Promise<UsageStats> {
		const settings = await this.getSettings();
		return settings.usage;
	},

	async setUsage(usage: UsageStats): Promise<void> {
		const settings = await this.getSettings();
		settings.usage = usage;
		await this.setSettings(settings);
	},

	async getFolders(): Promise<Folder[]> {
		const settings = await this.getSettings();
		return settings.folders;
	},

	async setFolders(folders: Folder[]): Promise<void> {
		const settings = await this.getSettings();
		settings.folders = folders;
		await this.setSettings(settings);
	},

	async getConversationMetaList(): Promise<ConversationMeta[]> {
		ensureConversationsDir();
		const files = readdirSync(CONVERSATIONS_DIR).filter((f) => f.endsWith('.json'));
		const metas: ConversationMeta[] = [];
		for (const file of files) {
			const conv = readJsonFile<ServiceConversation | null>(
				join(CONVERSATIONS_DIR, file),
				null,
			);
			if (conv) {
				metas.push({
					id: conv.id,
					folderId: conv.folderId,
					title: conv.title,
					createdAt: conv.createdAt,
					updatedAt: conv.updatedAt,
				});
			}
		}
		return metas.sort((a, b) => b.updatedAt - a.updatedAt);
	},

	async getConversation(id: string): Promise<ServiceConversation | null> {
		const filePath = join(CONVERSATIONS_DIR, `${id}.json`);
		return readJsonFile<ServiceConversation | null>(filePath, null);
	},

	async createConversation(params: { folderId?: string; title?: string }): Promise<ServiceConversation> {
		ensureConversationsDir();
		const id = Math.random().toString(36).slice(2, 10);
		const now = Date.now();
		const conv: ServiceConversation = {
			id,
			folderId: params.folderId ?? 'local',
			title: params.title ?? '新任务',
			createdAt: now,
			updatedAt: now,
			messages: [],
		};
		writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), conv);
		return conv;
	},

	async deleteConversation(id: string): Promise<void> {
		const filePath = join(CONVERSATIONS_DIR, `${id}.json`);
		if (existsSync(filePath)) unlinkSync(filePath);
	},

	async updateConversation(id: string, patch: Partial<ConversationMeta>): Promise<ServiceConversation | null> {
		const conv = await this.getConversation(id);
		if (!conv) return null;
		Object.assign(conv, patch, { updatedAt: Date.now() });
		writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), conv);
		return conv;
	},

	async saveConversationData(id: string, data: { messages: ServiceConversation['messages']; agentCtx?: ServiceConversation['agentCtx'] }): Promise<ServiceConversation | null> {
		const conv = await this.getConversation(id);
		if (!conv) return null;
		conv.messages = data.messages;
		if (data.agentCtx !== undefined) conv.agentCtx = data.agentCtx;
		conv.updatedAt = Date.now();
		writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), conv);
		return conv;
	},

	async getConversationCtx(conversationId: string): Promise<AgentCtx | null> {
		const conv = await this.getConversation(conversationId);
		return conv?.agentCtx ?? null;
	},
};