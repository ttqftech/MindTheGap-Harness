/* ==========================================================================
   插件加载器 — MindTheGap-Harness

   三层模型里的第一层。全部能力外置：只读 JSON + Markdown，不做可执行插件
   （Cottontail 下 Bun.pathToFileURL 不可用、主进程已打包，运行时 import 本地 .ts 不可靠）。

   目录约定：
     plugins/<pluginId>/plugin.json           插件清单（声明它提供哪些模式）
     plugins/<pluginId>/<modeId>/mode.json    模式定义（**模式配置的唯一来源**）
     plugins/<pluginId>/<modeId>/reflection.md    模式级反思提示词（可选）
     plugins/<pluginId>/<modeId>/<agentId>/{agent.json,prompt.md,reflection.md}  Agent 定义
       └─ reflection.md 存在时，该 Agent 的反思轮**整份替换**模式级的反思提示词

   优先级：用户插件目录（~/.mindthegap-harness/plugins）> 应用内置目录（plugins/）。
   同名 mode.id 以后加载者覆盖，并在结果里标注 overridden。

   内置目录的定位复用 storage 里「从 cwd 逐级向上找」的策略：dev 时 cwd 是项目根，打包后是应用目录。
   ========================================================================== */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgentDefinition, AbilityPolicy, ModeDefinition, PluginManifest } from '@shared/agent';

/** 反思提示词的文件名（模式级 / Agent 级同名，按目录位置区分语义） */
const REFLECTION_FILE = 'reflection.md';

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

/**
 * 仓库内某个资源的绝对路径（从 cwd 逐级向上找）。
 * 给「跟着仓库走的脚本 / 数据文件」用，例如 scripts/web-render.mjs。
 * 路径用 `/` 分隔即可，Windows 下 join 也能正确拼接。
 */
export function resolveRepoFile(relPath: string): string | null {
	const base = findUp(relPath);
	return base ? join(base, relPath) : null;
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

function readText(filePath: string): string | null {
	try {
		return readFileSync(filePath, 'utf-8');
	} catch {
		return null;
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

// #region 反思提示词

/**
 * 反思提示词按位置回退查找（找到第一个「存在且非空」的文件即用）：
 *   <agentDir>/reflection.md → <modeDir>/reflection.md → null
 *
 * 语义是**整份替换**而不是叠加：Agent 级文件存在时，模式级连一个字都不参与拼接。
 */
function findReflectionPrompt(dirs: { agentDir?: string; modeDir?: string }): { text: string; path: string } | null {
	const candidates: string[] = [];
	if (dirs.agentDir) candidates.push(join(dirs.agentDir, REFLECTION_FILE));
	if (dirs.modeDir) candidates.push(join(dirs.modeDir, REFLECTION_FILE));
	for (const file of candidates) {
		const text = readText(file);
		if (text && text.trim()) return { text, path: file };
	}
	return null;
}

/**
 * 运行时（reflect()）用：这个实例的反思轮该用哪份提示词。并提供文件路径作为参考（文本在插件加载时就已读取，此处不会再读取）。
 * 优先级 agent 级 > 模式级 > 内置默认；都取加载期缓存的内容，
 * 改完 md 文件要 POST /api/plugins/reload 才生效（与其它插件数据一致）。
 */
export function resolveReflectionPrompt(mode: ModeDefinition, agentDefinition?: AgentDefinition): { text: string; path?: string } | null {
	if (agentDefinition?.reflectionPrompt?.trim()) {
		const modeDir = mode.modeJsonPath ? dirname(mode.modeJsonPath) : mode.pluginDir;
		return {
			text: agentDefinition.reflectionPrompt,
			path: join(modeDir, agentDefinition.id, agentDefinition.reflectionPromptFile ?? REFLECTION_FILE),
		};
	}
	if (mode.reflectionPrompt?.trim()) return { text: mode.reflectionPrompt, path: mode.reflectionPromptPath };
	return null;
}

// #endregion

// #region 加载

/** 当前注册表（loadAllPlugins 之后有效） */
let loadedPlugins: PluginManifest[] = [];
let loadedModes: ModeDefinition[] = [];
let lastErrors: PluginLoadError[] = [];
/** 上次 loadAllPlugins 的选项（saveModeJson 写盘后按同样口径重载） */
let lastLoadOptions: LoadOptions = {};

/** 按指定的单个插件目录地址，读取该插件清单 */
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

/** 按指定的单个插件目录地址 + 模式名，读取该插件模式定义（包含模式下的 agents） */
function loadModeDefinition(pluginDir: string, plugin: PluginManifest, modeId: string, errors: PluginLoadError[], knownToolNames: string[] | null): ModeDefinition | null {
	const modeDir = join(pluginDir, modeId);
	if (!isDir(modeDir)) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId, message: `模式目录不存在: ${modeDir}` });
		return null;
	}
	const modeJsonPath = join(modeDir, 'mode.json');
	const raw = readJson<Partial<ModeDefinition>>(modeJsonPath);
	if (!raw) {
		errors.push({ level: 'error', pluginId: plugin.id, modeId, message: `无法解析 mode.json: ${modeJsonPath}` });
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

	// 模式级反思提示词（Agent 级在各 def.reflectionPrompt 里，查到时优先）
	const modeReflection = findReflectionPrompt({ modeDir });

	return {
		id,
		name: raw.name ?? id,
		description: raw.description,
		rootAgent,
		agents,
		maxDepth: raw.maxDepth ?? 0,
		taskList: raw.taskList ?? { enabled: false, writable: false },
		mcpDisabled: raw.mcpDisabled ?? false,
		limits: raw.limits,
		ui: raw.ui,
		// 反思提示词按 agent 级 > 模式级 解析（agent 级在 def.reflectionPrompt 里）
		reflectionPrompt: modeReflection?.text,
		reflectionPromptPath: modeReflection?.path,
		modeJsonText: readText(modeJsonPath) ?? '',
		modeJsonPath,
		pluginId: plugin.id,
		pluginName: plugin.name,
		pluginDir,
	};
}

/** 按指定的单个 Agent 目录地址，读取该 Agent 的定义 */
function loadAgentDefinition(agentDir: string, errors: PluginLoadError[], ctx: { pluginId: string; modeId: string; knownToolNames: string[] | null }): AgentDefinition | null {
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
	const prompt = readText(join(agentDir, promptFile)) ?? '';

	// Agent 级反思提示词：文件存在才算数（存在即整份替换上层，不做拼接）
	const reflectionPromptFile = raw.reflectionPromptFile ?? REFLECTION_FILE;
	const reflectionPath = join(agentDir, reflectionPromptFile);
	const reflectionPrompt = existsSync(reflectionPath) ? readText(reflectionPath) ?? '' : '';

	// 动态状态提示词：默认 prompt.state.md，文件不存在时为空串（不注入动态状态）
	const statePromptFile = raw.statePromptFile ?? 'prompt.state.md';
	const statePromptPath = join(agentDir, statePromptFile);
	const statePrompt = existsSync(statePromptPath) ? readText(statePromptPath) ?? '' : '';

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
		reflectionCount: raw.reflectionCount ?? 0,
		reflectionPromptFile,
		reflectionPrompt,
		statePromptFile,
		statePrompt,
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

// #region 写回 mode.json（设置页的源码编辑器）

/**
 * 保存某个模式的 mode.json —— 设置页「插件 / 模式」面板的源码编辑器走这里。
 *
 * 两道关卡，任何一道不过都**不产生文件改动**：
 *   ① 落盘前：JSON 能解析、顶层是对象、id 与目录名一致、rootAgent 指向存在的 agent；
 *   ② 落盘后：按加载器同一套规则重载，只要该模式出现 error 级加载错误就**回滚**到旧内容
 *      （宁可保存失败，也不要留下一个把模式弄坏的文件）。
 */
export function saveModeJson(modeId: string, jsonText: string): { ok: boolean; error?: string; mode?: ModeDefinition } {
	const mode = getMode(modeId);
	if (!mode) return { ok: false, error: `模式不存在: ${modeId}` };
	if (!mode.modeJsonPath) return { ok: false, error: `模式 ${modeId} 没有关联的 mode.json` };
	const target = mode.modeJsonPath;
	const modeDir = dirname(target);

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (e) {
		return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: 'mode.json 的顶层必须是一个对象' };
	}
	const raw = parsed as Partial<ModeDefinition>;
	if (raw.id !== undefined && raw.id !== modeId) {
		// id 就是模式目录名，改了会和 plugin.json 的 modes 列表对不上，模式会消失
		return { ok: false, error: `id 必须保持为 ${modeId}（模式 id 就是目录名）` };
	}
	if (!raw.rootAgent || typeof raw.rootAgent !== 'string') {
		return { ok: false, error: '缺少 rootAgent（必须是本模式下某个 agent 的 id）' };
	}
	if (!existsSync(join(modeDir, raw.rootAgent, 'agent.json'))) {
		return { ok: false, error: `rootAgent 指向的 agent 不存在：${raw.rootAgent}/agent.json` };
	}
	if (raw.limits !== undefined && (!raw.limits || typeof raw.limits !== 'object' || Array.isArray(raw.limits))) {
		return { ok: false, error: 'limits 必须是对象，形如 {"totalRounds":45,"agentInstanceRounds":15,"warnAtRemaining":3}' };
	}
	if (raw.taskList !== undefined && (!raw.taskList || typeof raw.taskList !== 'object' || Array.isArray(raw.taskList))) {
		return { ok: false, error: 'taskList 必须是对象，形如 {"enabled":true,"writable":true}' };
	}

	const prevText = readText(target) ?? '';
	try {
		writeFileSync(target, jsonText.endsWith('\n') ? jsonText : `${jsonText}\n`, 'utf-8');
	} catch (e) {
		return { ok: false, error: `写入失败：${(e as Error).message}` };
	}

	const reloaded = loadAllPlugins(lastLoadOptions);
	const modeErrors = reloaded.errors.filter((e) => e.modeId === modeId && e.level === 'error');
	if (modeErrors.length > 0) {
		// 回滚：新内容会让模式加载失败（例如删了某个被 delegatable 依赖的 agent）
		try {
			writeFileSync(target, prevText, 'utf-8');
		} catch {
			// 回滚失败只能如实上报：磁盘上留着一份加载不通过的文件
		}
		loadAllPlugins(lastLoadOptions);
		return { ok: false, error: `校验未通过，已回滚：${modeErrors.map((e) => e.message).join('；')}` };
	}

	return { ok: true, mode: getMode(modeId) };
}

// #endregion