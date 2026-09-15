/* ==========================================================================
   Agent Service Storage — MindTheGap-Harness

   持久化层。数据位置、字段、文件名沿用旧版（~/.mindthegap-harness/settings.json 与 ~/.mindthegap-harness/conversations/<id>.json），
   变的只是访问方式：全部改成 Proxy，读写像操作普通 js object。

   - settings：进程启动时通过 loadSettings() **异步读盘一次**（在 HTTP 服务监听前完成），
     之后读全走内存缓存；
     任意层级的写（settings.providers = [...] / settings.usage.timeRange = '1d'; settings.mcpServers.push(...)）都会自动 700ms 防抖落盘。
   - conversations：按 id 索引的集合代理。
     读 conversations[id] = 懒加载（首次读盘，之后走缓存）；
     写任意字段 = 自动刷新 updatedAt + 700ms 防抖落盘；
     delete conversations[id] = 删文件；id in conversations / Object.keys() 也可用。

   前提：后端是单例，「内存即真相」，不存在多进程同时写同一份文件的情况。
   后期可替换为 SQLite / Redis 等更高效的存储（只需换掉本文件的读写实现）。
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgentCtx, ConversationMeta, ServiceConversation, ServiceSettings, McpServerConfig } from '../shared/agent';

// #region 路径 & 文件读写

const DATA_DIR = join(homedir(), '.mindthegap-harness');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const CONVERSATIONS_DIR = join(DATA_DIR, 'conversations');

/** 落盘防抖时长（ms） */
const SAVE_DEBOUNCE_MS = 700;

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (!existsSync(filePath)) return fallback;
		return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return fallback;
	}
}

function writeJsonFile(filePath: string, data: unknown) {
	const dir = dirname(filePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// #endregion

// #region 深层 Proxy（读透传 / 写通知）

/** 任一层级发生 set / delete 时的回调 */
type ChangeNotifier = () => void;

/** proxy → 原始对象，用于把别处传进来的代理还原成裸数据再存 */
const rawOfProxy = new WeakMap<object, object>();

/**
 * 只有普通对象和数组需要继续往下代理。
 * 持久化的数据模型全是 JSON 可序列化结构，不含 Date / Map / class 实例。
 */
function isContainer(value: unknown): value is object {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return true;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** 若传进来的是本模块产出的代理，取回它包裹的原始对象（避免把代理存进数据树造成别名混乱） */
function unwrap<T>(value: T): T {
	if (value !== null && typeof value === 'object') {
		const raw = rawOfProxy.get(value as unknown as object);
		if (raw) return raw as unknown as T;
	}
	return value;
}

/**
 * 递归代理一棵数据树：
 * - get：容器类型继续包代理（同一原始对象复用同一代理，靠 cache 保证引用稳定）
 * - set / deleteProperty：改到原始对象上，然后 notify()
 *
 * 注意 Reflect.set / Reflect.get 都不传 receiver，避免把写操作再转回代理自身。
 */
function deepProxy<T extends object>(target: T, notify: ChangeNotifier, cache: WeakMap<object, object>): T {
	const cached = cache.get(target);	// 递归 deepProxy 时，避免重复创建代理
	if (cached) return cached as T;

	const proxy = new Proxy(target, {
		get(obj, prop) {
			const value = Reflect.get(obj, prop);
			return isContainer(value) ? deepProxy(value, notify, cache) : value;
		},
		set(obj, prop, value) {
			const next = unwrap(value);
			// 值没变就不算修改（数组 push 会顺带写 length，这里能挡掉一部分空写）
			if (Reflect.get(obj, prop) === next && prop in obj) return true;
			const ok = Reflect.set(obj, prop, next);
			if (ok) notify();
			return ok;
		},
		deleteProperty(obj, prop) {
			if (!(prop in obj)) return true;
			const ok = Reflect.deleteProperty(obj, prop);
			if (ok) notify();
			return ok;
		},
	});

	cache.set(target, proxy);
	rawOfProxy.set(proxy, target);
	return proxy as T;
}

/**
 * 深拷贝出一份裸数据。
 * 把设置里的数据交给其它子系统长期持有时必须用它，
 * 否则对方拿到的是活代理，settings 之后的修改会「悄悄」改掉对方手里的旧值
 * （例如 mcpManager 靠新旧 config 比对判断是否需要重连）。
 */
export function snapshot<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

// #endregion

// #region 设置（settings.json）

/**
 * 定位内置示例 MCP 服务器（求正弦）的入口文件。
 *
 * 为什么需要运行时解析而不是写死相对路径：
 * 主进程的 cwd 在 dev（项目根）和打包后（应用目录）下并不一致，
 * 而 MCP 服务器是 spawn 出来的独立子进程，必须拿到绝对路径才可靠。
 * 做法是从 cwd 逐级向上找含有 mcp-servers/sine/index.js 的目录。
 */
function resolveBuiltinSineServerPath(): string | null {
	const rel = join('mcp-servers', 'sine', 'index.js');
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, rel);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * 内置示例服务器：求正弦。
 * 名字以英文 sine 开头，是为了让工具前缀（mcp__sine__xxx）不含中文，
 * 因为多数 LLM 供应商限制工具名只能由字母数字和下划线组成。
 */
function builtinSineServer(): McpServerConfig {
	const path = resolveBuiltinSineServerPath();
	return {
		id: 'builtin-sine',
		name: 'sine 正弦函数（内置示例）',
		enabled: path !== null,
		transport: 'stdio',
		command: 'node',
		args: path ? [path] : [],
		env: {},
	};
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
	// TODO usage 不需要落盘。这个面板是纯前端展示，不需要后端管理并持久化。前端默认给值就行
	usage: {
		timeRange: '7d',
		showApiRequests: true,
		showToolCalls: true,
		showTokensInput: true,
		showTokensInputCached: true,
		showTokensOutput: true,
	},
	folders: [{ id: 'local', name: '本地', isLocal: true }],
	mcpServers: [builtinSineServer()],
};

/**
 * 异步从磁盘加载设置进内存镜像。
 * 幂等（重复调用只读一次盘），必须在使用 settings 前完成 ——
 * index.ts 在启动 HTTP 服务与 MCP 同步前会先 await 它。
 * 加载完成前 settings 读到的是默认值；读盘失败（文件不存在 / JSON 损坏）也保持默认值。
 */
let settingsLoaded = false;
let settingsLoadPromise: Promise<void> | null = null;

export function loadSettings(): Promise<void> {
	if (settingsLoaded) return Promise.resolve();
	if (!settingsLoadPromise) settingsLoadPromise = doLoadSettings();
	return settingsLoadPromise;
}

async function doLoadSettings(): Promise<void> {
	let raw: Partial<ServiceSettings> = {};
	try {
		raw = JSON.parse(await readFile(SETTINGS_FILE, 'utf-8')) as Partial<ServiceSettings>;
	} catch {
		// 文件不存在或损坏 → 保持默认值
	}
	// 老版本的 settings.json 不含后加的字段（如 mcpServers），逐项用默认值补齐。
	// 注意不能直接 {...defaultSettings, ...raw}：raw 里显式存在的 undefined 会覆盖默认值。
	for (const key of Object.keys(defaultSettings) as (keyof ServiceSettings)[]) {
		const value = (raw as Record<string, unknown>)[key];
		if (value !== undefined) (settingsRaw as unknown as Record<string, unknown>)[key] = value;
	}
	settingsLoaded = true;
}

/** 磁盘数据的内存镜像。落盘写它，settings 只是它的代理外壳（启动时先装默认值，loadSettings 后被磁盘数据覆盖） */
const settingsRaw: ServiceSettings = { ...defaultSettings };

let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let settingsDirty = false;

function scheduleSettingsSave() {
	settingsDirty = true;
	if (settingsTimer !== null) clearTimeout(settingsTimer);
	settingsTimer = setTimeout(() => {
		settingsTimer = null;
		flushSettings();
	}, SAVE_DEBOUNCE_MS);
}

/** 立刻把待写的设置落盘（无改动则什么都不做） */
export function flushSettings() {
	if (settingsTimer !== null) {
		clearTimeout(settingsTimer);
		settingsTimer = null;
	}
	if (!settingsDirty) return;
	settingsDirty = false;
	try {
		writeJsonFile(SETTINGS_FILE, settingsRaw);
	} catch (e) {
		settingsDirty = true;
		console.error(`[Storage] 写入 settings.json 失败: ${(e as Error).message}`);
	}
}

/**
 * 全局设置。像普通对象一样读写即可（先 await loadSettings() 再用）：
 *   settings.providers                    // 读（内存缓存，无 IO）
 *   settings.providers = [...]            // 写（700ms 防抖落盘）
 *   settings.usage.timeRange = '1d'       // 深层写也会触发落盘
 *   settings.mcpServers.push(cfg)         // 数组变更同样会触发
 */
export const settings: ServiceSettings = deepProxy(settingsRaw, scheduleSettingsSave, new WeakMap());

// #endregion

// #region 会话（conversations/<id>.json）

interface ConversationSlot {
	raw: ServiceConversation;
	proxy: ServiceConversation;
	timer: ReturnType<typeof setTimeout> | null;
	dirty: boolean;
}

/** id → 已加载的会话（内存缓存） */
const slots = new Map<string, ConversationSlot>();

/** 为原始会话数据创建一个 slot */
function openSlot(raw: ServiceConversation): ConversationSlot {
	const slot: ConversationSlot = { raw, proxy: raw, timer: null, dirty: false };
	slot.proxy = deepProxy(raw, () => touchConversation(slot), new WeakMap());
	slots.set(raw.id, slot);
	return slot;
}

/** 会话被改动：刷新 updatedAt（写 raw，不会再次触发通知）并安排防抖落盘 */
function touchConversation(slot: ConversationSlot) {
	slot.raw.updatedAt = Date.now();
	slot.dirty = true;
	if (slot.timer !== null) clearTimeout(slot.timer);
	slot.timer = setTimeout(() => {
		slot.timer = null;
		flushConversation(slot.raw.id);
	}, SAVE_DEBOUNCE_MS);
}

/** 立刻把某个会话落盘（无改动则什么都不做） */
export function flushConversation(id: string) {
	const slot = slots.get(id);
	if (!slot) return;
	if (slot.timer !== null) {
		clearTimeout(slot.timer);
		slot.timer = null;
	}
	if (!slot.dirty) return;
	slot.dirty = false;
	try {
		writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), slot.raw);
	} catch (e) {
		slot.dirty = true;
		console.error(`[Storage] 写入会话 ${id} 失败: ${(e as Error).message}`);
	}
}

/** 从缓存中取一个会话（如果不存在则从磁盘读取并缓存）（如果不存在则返回 undefined）并创建 slot */
function loadConversation(id: string): ServiceConversation | undefined {
	const slot = slots.get(id);
	if (slot) return slot.proxy;
	const raw = readJsonFile<ServiceConversation | null>(join(CONVERSATIONS_DIR, `${id}.json`), null);
	if (!raw) return undefined;
	// 兼容手工改过文件名的情况：以文件名为准，避免缓存 key 与磁盘对不上
	raw.id = id;
	return openSlot(raw).proxy;
}

function removeConversation(id: string) {
	const slot = slots.get(id);
	if (slot?.timer) clearTimeout(slot.timer);
	slots.delete(id);
	const filePath = join(CONVERSATIONS_DIR, `${id}.json`);
	if (existsSync(filePath)) unlinkSync(filePath);
}

/** 覆盖式写入一整个会话（用于 conversations[id] = conv，立即落盘） */
function putConversation(id: string, conv: ServiceConversation) {
	const slot = slots.get(id);
	if (slot?.timer) clearTimeout(slot.timer);
	slots.delete(id);
	const raw: ServiceConversation = { ...conv, id, updatedAt: Date.now() };
	writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), raw);
	openSlot(raw);
}

/**
 * 会话集合。索引读写等价于文件读写：
 *   conversations['abc123']                       // 读（懒加载 + 缓存），不存在返回 undefined
 *   conversations['abc123'].title = '新标题'       // 写（自动刷新 updatedAt，700ms 防抖落盘）
 *   conversations['abc123'].messages.push(msg)    // 深层写同样有效
 *   delete conversations['abc123']                // 删除文件
 *   'abc123' in conversations                     // 是否存在
 *   Object.keys(conversations)                    // 全部 id（按 updatedAt 倒序）
 */
export interface ConversationStore {
	[id: string]: ServiceConversation | undefined;
}

export const conversations: ConversationStore = new Proxy({} as ConversationStore, {
	get(_target, prop) {
		if (typeof prop !== 'string') return undefined;
		return loadConversation(prop);
	},
	set(_target, prop, value) {
		if (typeof prop !== 'string') return false;
		const conv = unwrap(value) as ServiceConversation | undefined;
		if (!conv) {
			removeConversation(prop);
			return true;
		}
		putConversation(prop, conv);
		return true;
	},
	deleteProperty(_target, prop) {
		if (typeof prop === 'string') removeConversation(prop);
		return true;
	},
	has(_target, prop) {
		if (typeof prop !== 'string') return false;
		return slots.has(prop) || existsSync(join(CONVERSATIONS_DIR, `${prop}.json`));
	},
	ownKeys() {
		return conversationMetas().map((m) => m.id);
	},
	getOwnPropertyDescriptor(_target, prop) {
		if (typeof prop !== 'string') return undefined;
		const conv = loadConversation(prop);
		if (!conv) return undefined;
		// 必须 configurable + enumerable，否则 Object.keys / values 会把它过滤掉或直接抛错
		return { value: conv, writable: true, enumerable: true, configurable: true };
	},
});

/**
 * 全部会话的元信息（不含 messages / agentCtx），按 updatedAt 倒序。
 * 已加载进内存的会话优先用缓存，保证还在防抖窗口里的改动也能立刻反映到列表上。
 */
export function conversationMetas(): ConversationMeta[] {
	if (!existsSync(CONVERSATIONS_DIR)) mkdirSync(CONVERSATIONS_DIR, { recursive: true });
	const metas: ConversationMeta[] = [];
	for (const file of readdirSync(CONVERSATIONS_DIR)) {
		if (!file.endsWith('.json')) continue;
		const id = file.slice(0, -'.json'.length);
		const conv = slots.get(id)?.raw ?? readJsonFile<ServiceConversation | null>(join(CONVERSATIONS_DIR, file), null);
		if (!conv) continue;
		metas.push({
			id: conv.id,
			folderId: conv.folderId,
			title: conv.title,
			createdAt: conv.createdAt,
			updatedAt: conv.updatedAt,
		});
	}
	return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新建会话（需要生成 id 和默认字段，因此保留为函数），返回的就是可直接改的代理 */
export function createConversation(params: { folderId?: string; title?: string } = {}): ServiceConversation {
	let id = Math.random().toString(36).slice(2, 10);
	while (slots.has(id) || existsSync(join(CONVERSATIONS_DIR, `${id}.json`))) {
		id = Math.random().toString(36).slice(2, 10);
	}
	const now = Date.now();
	const raw: ServiceConversation = {
		id,
		folderId: params.folderId ?? 'local',
		title: params.title ?? '新任务',
		createdAt: now,
		updatedAt: now,
		messages: [],
	};
	writeJsonFile(join(CONVERSATIONS_DIR, `${id}.json`), raw);
	return openSlot(raw).proxy;
}

/** 会话的 Agent 上下文（等价于 conversations[id]?.agentCtx ?? null，只是调用点更短） */
export function getConversationCtxById(id: string): AgentCtx | null {
	return conversations[id]?.agentCtx ?? null;
}

// #endregion

// #region 退出前落盘

/** 把所有待写数据立即落盘 */
export function flushAll() {
	flushSettings();
	for (const id of Array.from(slots.keys())) flushConversation(id);
}

// 防抖窗口内进程退出会丢最后一次改动，尽量在退出钩子里补一次同步写。
// Cottontail(JSC) 对 process 事件的支持不保证，所以整体 try 包裹，失败也不影响主流程。
try {
	if (typeof process !== 'undefined' && typeof process.on === 'function') {
		process.on('exit', () => {
			try {
				flushAll();
			} catch {
				// 退出阶段无法再补救，忽略
			}
		});
	}
} catch {
	// 运行时不支持 process 事件，跳过
}

// #endregion