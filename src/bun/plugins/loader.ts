/* ==========================================================================
   插件加载器 — MindTheGap-Harness

   三层模型里的第一层。全部能力外置：只读 JSON + Markdown，不做可执行插件
   （Cottontail 下 Bun.pathToFileURL 不可用、主进程已打包，运行时 import 本地 .ts 不可靠）。

   目录约定：
     plugins/<pluginId>/plugin.json           插件清单（声明它提供哪些模式）
     plugins/<pluginId>/<modeId>/mode.json    模式定义
     plugins/<pluginId>/<modeId>/<agentId>/{agent.json,prompt.md}   Agent 定义

   优先级：用户插件目录（~/.mindthegap-harness/plugins）> 应用内置目录（plugins/）。
   同名 mode.id 以后加载者覆盖，并在结果里标注 overridden。

   内置目录的定位复用 storage 里「从 cwd 逐级向上找」的策略：
   dev 时 cwd 是项目根，打包后是应用目录。
   ========================================================================== */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type {
	AgentDefinition,
	AbilityPolicy,
	ModeConfigDefaults,
	ModeDefinition,
	PluginManifest,
} from '../../shared/agent';

// #region 类型

export interface PluginLoadError {
	level: 'error' | 'warn';
	pluginId?: string;
	modeId?: string;
	agentId?: string;
	message: string;
}

export interface LoadResult {
	plugins: PluginManifest[];
	modes: ModeDefinition[];
	errors: PluginLoadError[];
	/** 被后加载的同名插件覆盖掉的 mode id */
	overridden: string[];
}

/** 校验时用来判断「工具名是否在注册表里」——由调用方注入，避免 loader 依赖工具实现 */
export interface LoadOptions {
	knownToolNames?: () => string[];
}

// #endregion

// #region 路径定位

/** 从 cwd 逐级向上找第一个存在 relPath 的目录，找不到返回 null */
function findUp(relPath: string, maxLevels = 6): string | null {
	let dir = process.cwd();
	for (let i = 0; i < maxLevels; i++) {
		const candidate = join(dir, relPath);
		if (existsSync(candidate)) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** 应用内置插件根目录（含 plugins/<pluginId>/plugin.json 的那一层） */
export function resolveBuiltinPluginsDir(): string | null {
	const base = findUp(join('plugins', 'MTG-builtin', 'plugin.json'));
	return base ? join(base, 'plugins') : null;
}

/** 用户插件根目录（不存在不报错，允许用户自己创建） */
export function resolveUserPluginsDir(): string {
	return join(homedir(), '.mindthegap-harness', 'plugins');
}

/** prompts/ 目录（模板文件所在），找不到返回 null */
export function resolvePromptsDir(): string | null {
	const base = findUp(join('prompts', '_base.md'));
	return base ? join(base, 'prompts') : null;
}

// #endregion

// #region 读文件

function readJson<T>(filePath: string): T | null {
	try {
		return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return null;
	}
}

function readText(filePath: string, fallback = ''): string {
	try {
		return readFileSync(filePath, 'utf-8');
	} catch {
		return fallback;
	}
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

// #endregion

// #region 加载

/** 当前注册表（loadAllPlugins 之后有效） */
let loadedPlugins: PluginManifest[] = [];
let loadedModes: ModeDefinition[] = [];
let lastErrors: PluginLoadError[] = [];

/** 单个插件目录 → 插件清单 */
function loadPluginManifest(pluginDir: string, source: 'builtin' | 'user', errors: PluginLoadError[]): PluginManifest | null {
	const manifestPath = join(pluginDir, 'plugin.json');
	const raw = readJson<Partial<PluginManifest>>(manifestPath);
	if (!raw) {
		errors.push({ level: 'error', message: `插件缺少或无法解析 plugin.json: ${manifestPath}` });
		return null;
	}
	if (!raw.id) {
		errors.push({ level: 'error', message: `plugin.json 缺 id: ${manifestPath}` });
		return null;
	}
	if (!Array.isArray(raw.modes)) {
		errors.push({ level: 'error', pluginId: raw.id, message: `plugin.json 的 modes 必须是数组: ${manifestPath}` });
		return null;
	}
	return {
		id: raw.id,
		name: raw.name ?? raw.id,
		version: raw.version ?? '0.0.0',
		description: raw.description,
		modes: raw.modes,
		source,
		dir: pluginDir,
	};
}

/** 单个 Agent 目录 → Agent 定义 */
function loadAgentDefinition(
	agentDir: string,
	errors: PluginLoadError[],
	ctx: { pluginId: string; modeId: string; knownToolNames: string[] | null },
): AgentDefinition | null {
	const agentJsonPath = join(agentDir, 'agent.json');
	const raw = readJson<Partial<AgentDefinition>>(agentJsonPath);
	if (!raw) {
		errors.push({ level: 'error', pluginId: ctx.pluginId, modeId: ctx.modeId, message: `无法解析 agent.json: ${agentJsonPath}` });
		return null;
	}
	if (!raw.id) {
		errors.push({ level: 'error', pluginId: ctx.pluginId, modeId: ctx.modeId, message: `agent.json 缺 id: ${agentJsonPath}` });
		return null;
	}

	const promptFile = raw.promptFile ?? 'prompt.md';
	const prompt = readText(join(agentDir, promptFile));

	const ability: AbilityPolicy = raw.ability ?? {};
	// 工具名校验：只 warn（可能是留给其他插件的动态工具 / MCP）
	if (ctx.knownToolNames) {
		const allow = ability.tools?.allow ?? [];
		for (const name of allow) {
			if (!ctx.knownToolNames.includes(name)) {
				errors.push({
					level: 'warn',
					pluginId: ctx.pluginId,
					modeId: ctx.modeId,
					agentId: raw.id,
					message: `工具名不在注册表: ${name}`,
				});
			}
		}
	}

	return {
		id: raw.id,
		name: raw.name ?? raw.id,
		promptFile,
		prompt,
		ability,
		delegatable: raw.delegatable,
		model: raw.model,
		taskListInject: raw.taskListInject ?? false,
		reflectionCount: raw.reflectionCount ?? 0,
		reflectionPromptAppend: raw.reflectionPromptAppend,
	};
}

/** 单个模式目录 → 模式定义 */
function loadModeDefinition(
	pluginDir: string,
	plugin: PluginManifest,
	modeId: string,
	errors: PluginLoadError[],
	knownToolNames: string[] | null,
): ModeDefinition | null {
	const modeDir = join(pluginDir, modeId);
	if (!isDir(modeDir)) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId, message: `模式目录不存在: ${modeDir}` });
		return null;
	}
	const raw = readJson<Partial<ModeDefinition>>(join(modeDir, 'mode.json'));
	if (!raw) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId, message: `无法解析 mode.json: ${join(modeDir, 'mode.json')}` });
		return null;
	}

	// 扫描含 agent.json 的子目录作为 Agent 定义（mode.json 是文件，不会被误认）
	const agents: Record<string, AgentDefinition> = {};
	for (const entry of readdirSync(modeDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const agentDir = join(modeDir, entry.name);
		if (!existsSync(join(agentDir, 'agent.json'))) continue;
		const def = loadAgentDefinition(agentDir, errors, { pluginId: plugin.id, modeId, knownToolNames });
		if (def) agents[def.id] = def;
	}

	const id = raw.id ?? modeId;
	const rootAgent = raw.rootAgent ?? '';
	if (!rootAgent) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId: id, message: 'mode.json 缺 rootAgent' });
		return null;
	}
	if (!agents[rootAgent]) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId: id, message: `rootAgent 不存在: ${rootAgent}` });
		return null;
	}

	// delegatable 引用校验
	for (const def of Object.values(agents)) {
		for (const target of def.delegatable ?? []) {
			if (!agents[target]) {
				errors.push({
					level: 'warn',
					pluginId: plugin.id,
					modeId: id,
					agentId: def.id,
					message: `delegatable 指向不存在的 agent: ${target}`,
				});
			}
		}
	}

	return {
		id,
		name: raw.name ?? id,
		description: raw.description,
		rootAgent,
		agents,
		maxDepth: raw.maxDepth ?? 0,
		injectBasePrompt: raw.injectBasePrompt ?? true,
		taskList: raw.taskList ?? { enabled: false, writable: false },
		mcp: raw.mcp ?? 'none',
		defaultSettings: raw.defaultSettings ?? {},
		settingsSchema: raw.settingsSchema,
		ui: raw.ui,
		pluginId: plugin.id,
		pluginName: plugin.name,
		pluginDir,
	};
}

/** 扫描一个插件根目录下的全部插件 */
function scanPlugins(rootDir: string, source: 'builtin' | 'user', errors: PluginLoadError[], knownToolNames: string[] | null): { plugin: PluginManifest; modes: ModeDefinition[] }[] {
	if (!isDir(rootDir)) return [];
	const out: { plugin: PluginManifest; modes: ModeDefinition[] }[] = [];
	for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const pluginDir = join(rootDir, entry.name);
		const plugin = loadPluginManifest(pluginDir, source, errors);
		if (!plugin) continue;
		const modes: ModeDefinition[] = [];
		for (const modeId of plugin.modes) {
			const mode = loadModeDefinition(pluginDir, plugin, modeId, errors, knownToolNames);
			if (mode) modes.push(mode);
		}
		out.push({ plugin, modes });
	}
	return out;
}

/**
 * 重新扫描并加载全部插件。
 * 先内置后用户，同名 mode.id 后加载者覆盖（用户插件覆盖内置），并标记 overridden。
 */
export function loadAllPlugins(options: LoadOptions = {}): LoadResult {
	const errors: PluginLoadError[] = [];
	const knownToolNames = options.knownToolNames ? options.knownToolNames() : null;

	const scanned: { plugin: PluginManifest; modes: ModeDefinition[]; source: 'builtin' | 'user' }[] = [];

	const builtinDir = resolveBuiltinPluginsDir();
	if (builtinDir) {
		for (const item of scanPlugins(builtinDir, 'builtin', errors, knownToolNames)) {
			scanned.push({ ...item, source: 'builtin' });
		}
	} else {
		errors.push({ level: 'error', message: '未找到内置插件目录（plugins/），请检查部署产物是否包含 plugins 目录' });
	}

	const userDir = resolveUserPluginsDir();
	for (const item of scanPlugins(userDir, 'user', errors, knownToolNames)) {
		scanned.push({ ...item, source: 'user' });
	}

	// 按加载顺序合并，后者覆盖前者
	const modeMap = new Map<string, ModeDefinition>();
	const overridden = new Set<string>();
	for (const item of scanned) {
		for (const mode of item.modes) {
			if (modeMap.has(mode.id)) overridden.add(mode.id);
			modeMap.set(mode.id, mode);
		}
	}

	loadedPlugins = scanned.map((s) => s.plugin);
	loadedModes = Array.from(modeMap.values());
	lastErrors = errors;

	return { plugins: loadedPlugins, modes: loadedModes, errors, overridden: Array.from(overridden) };
}

/** 上次加载的错误 / 警告 */
export function getLoadErrors(): PluginLoadError[] {
	return lastErrors;
}

export function listPlugins(): PluginManifest[] {
	return loadedPlugins;
}

export function listModes(): ModeDefinition[] {
	return loadedModes;
}

export function getMode(modeId: string): ModeDefinition | undefined {
	return loadedModes.find((m) => m.id === modeId);
}

/** 加载器是否已经跑过至少一次 */
export function isLoaded(): boolean {
	return loadedModes.length > 0 || loadedPlugins.length > 0;
}

// #endregion

// #region 配置合并

/** 只合并纯对象，数组 / 标量整体覆盖 */
export function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
	if (!override) return base;
	if (base === null || typeof base !== 'object' || Array.isArray(base)) {
		return (override as T) ?? base;
	}
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
		if (value === undefined) continue;
		const prev = out[key];
		out[key] = prev !== null && typeof prev === 'object' && !Array.isArray(prev) && value !== null && typeof value === 'object' && !Array.isArray(value)
			? deepMerge(prev, value as Record<string, unknown>)
			: value;
	}
	return out as T;
}

/** 某模式当前生效的配置 = defaultSettings ⊕ settings.modeConfigs[modeId] */
export function resolveModeConfig(mode: ModeDefinition, overrides?: Partial<ModeConfigDefaults>): ModeConfigDefaults {
	return deepMerge(mode.defaultSettings, overrides);
}

// #endregion
