/* ==========================================================================
   模式参数（mode.json 的 params + form）—— MindTheGap-Harness

   mode.json 同时声明两样东西：
     - `params`：变量默认值表（`{ "r": 0, "writeTools": ["file_read"] }`）
     - `form`  ：Composer 输入框下方的动态表单，用户的选择覆盖默认值

   用户选完之后得到一份**变量表**（`vars`），它有三条消费通道：
     1. mode.json / agent.json 里的字符串值：`"reflectionCount": "[mode.r]"`（整段取原值，类型保留）
     2. 内嵌拼接：`"description": "强度 {{...}} 见提示词"` → `"[intensity] 档"`（转成字符串）
     3. 提示词模板：`{{ r }}` / `{{ mode.r }}` / `{{ params.r }}`（见 prompt.ts 的 buildPromptScope）

   ⚠️ 本文件是唯一实现（前后端共用）：后端用它产出「本次 run 真正生效的模式定义」，
      前端用它算「控件当前显示什么 + 值随别的参数变了没」。别在别处再写一份。

   规则（有意为之，改之前先看 docs/架构-插件与模式.md）：
     - 只有 `[name]` 这种引用，没有表达式、没有运算；`mode.` / `params.` / `vars.` 前缀等价。
     - 引用解析不到时**原样保留**（`"[nope]"` 留在字段里），加载期另给 warn ——
       不要静默变空串，否则配置写错永远看不见。
     - `selected` 存的是「每个控件**当前的值**」，不是「点过哪项」：值可以不在选项里（另一档联动来的）。
       选一档 = 把它的 `value` 连同它 `vars` 里有控件的 key 一起写回去（`actions.setModeParam`），
       所以「改强度 → 反思次数跟着变」是**重写的结果**，不是优先级规则的结果。
     - 求值只有一遍：按 `form` 顺序，每个控件取自己的值（`selected` → `default` → `vars[key]`
       → 第一个选项）再写 key 与选项 `vars`。没有反向校验、没有不动点、没有「手选优先」。
     - 求值完只读复核一遍：某控件那档承诺的变量跟最终表对不上 ⇒ `overridden`（界面打 `*`），
       不回写任何值。
   ========================================================================== */

import type { ModeDefinition, ModeParamControl, ModeParamOption, ParamValue } from './agent';

// #region 类型

/** 控件当前值的表：`{ [controlKey]: 值 }`（值可以不在选项里 —— 另一档联动写进来的） */
export type ModeParamSelections = Record<string, ParamValue>;

/** 只取需要的字段，前后端的 ModeDefinition / ModeSummary 都能直接传进来 */
export interface ModeParamShape {
	params?: Record<string, ParamValue>;
	form?: ModeParamControl[];
}

// #endregion

// #region 基础工具

/** 整段引用：`"[x]"`（前后不允许有别的字符） */
const WHOLE_REF = /^\[([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\]$/;
/** 内嵌引用：`"含 [x] 的文本"` */
const INLINE_REF = /\[([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\]/g;

/**
 * 插值时**不碰**的键。
 *
 * - `modeJson*` / `plugin*`：模式自身的元信息，改了没有意义还会把源码编辑器弄乱；
 * - `prompt` / `statePrompt` / `reflectionPrompt` / `effortPrompt`：这几份是模板文件，变量走 `{{ }}`，
 *   不参与 `[x]` 插值（否则提示词里想写方括号示例就会被吃掉）；
 * - `params` / `form` / `vars`：变量的来源本身。
 */
const SKIP_KEYS = new Set([
	'id', 'pluginId', 'pluginName', 'pluginDir',
	'modeJsonText', 'modeJsonPath',
	'prompt', 'statePrompt', 'reflectionPrompt', 'reflectionPromptPath', 'effortPrompt',
	'params', 'form', 'vars',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 深比较两个参数值（数组 / 对象按内容比） */
export function sameParamValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
	if (a === b) return true;
	if (a === null || b === null || a === undefined || b === undefined) return false;
	if (typeof a !== typeof b) return false;
	if (typeof a !== 'object') return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

/** 该控件是否选中了某个值（找不到匹配项 = 值不在选项里，返回 undefined） */
export function findOption(control: ModeParamControl, value: ParamValue | undefined): ModeParamOption | undefined {
	if (value === undefined) return undefined;
	return control.options.find((o) => sameParamValue(o.value, value));
}

/** 字符串 → 数组（`"[writeTools]"` 只有一个 var 时会被插值成一个字符串，这里兜住） */
function asStringArray(v: unknown): string[] {
	if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
	return [];
}

function stringifyParam(v: ParamValue): string {
	if (v === null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		return '';
	}
}

// #endregion

// #region 变量表

/**
 * 声明了哪些变量名 —— 只用于加载期校验 `[x]` 引用是否拼错。
 * 包含：`params` 的键、每个控件的 key、以及所有选项 `vars` 里出现的键
 * （选项 vars 允许造出 `params` 里原本没有的变量）。
 */
export function knownParamNames(mode: ModeParamShape): string[] {
	const names = new Set(Object.keys(mode.params ?? {}));
	for (const control of mode.form ?? []) {
		if (control?.key) names.add(control.key);
		for (const option of control?.options ?? []) {
			for (const key of Object.keys(option?.vars ?? {})) names.add(key);
		}
	}
	return Array.from(names);
}

/** 一个控件这一轮落到了什么，以及它的「承诺」有没有被后面的参数改掉 */
export interface ModeParamChoice {
	control: ModeParamControl;
	/** 落到的选项；手选了选项表外的值时为空（此时 `effective` 就是那个裸值） */
	option?: ModeParamOption;
	/** 最终变量表里 `control.key` 的值 */
	effective?: ParamValue;
	/** 该选项承诺的变量（自己的 key + `option.vars`，按实际写入顺序），只用于复核 */
	promised: Record<string, ParamValue>;
	/** 承诺里至少一项被**后面的**参数改掉了 → 界面给这个控件打 `*` */
	overridden: boolean;
}

export interface ModeParamResolution {
	vars: Record<string, ParamValue>;
	/** 与 `form` 同序（含 `hidden` 的控件） */
	choices: ModeParamChoice[];
	/** 按控件 key 索引 */
	byKey: Record<string, ModeParamChoice>;
}

/**
 * 变量表 + 每个控件的落点。
 *
 * **一遍求值、一遍只读复核**：按 `form` 顺序，每个控件取自己的值（`selected` → `default`
 * → `vars[key]` → 第一个选项），写 key 再写选项 `vars`；遍历完比一遍承诺与最终表算 `overridden`。
 * 不做反向调整 —— 「改上游带动下游」靠的是写回时把上游负责的那片值一起改掉（见 `actions.setModeParam`）。
 */
export function resolveModeParams(mode: ModeParamShape, selected: ModeParamSelections = {}): ModeParamResolution {
	const vars: Record<string, ParamValue> = { ...(mode.params ?? {}) };
	const choices: ModeParamChoice[] = [];
	const byKey: Record<string, ModeParamChoice> = {};

	for (const control of mode.form ?? []) {
		const explicit = selected[control.key];
		let option: ModeParamOption | undefined;
		let value: ParamValue | undefined;

		if (explicit !== undefined) {
			// 存下来的值必须原样落地（哪怕不在选项表里 —— 那是另一档联动写进来的）
			option = findOption(control, explicit);
			value = option ? option.value : explicit;
		} else {
			const wanted = control.default !== undefined ? control.default : vars[control.key];
			if (wanted === undefined) {
				option = control.options[0];
				value = option?.value;
			} else {
				option = findOption(control, wanted);
				// ⚠️ 落在选项表外（前面的控件给的）就**原样保留**，绝不能退回 options[0]：
				//   否则「强度=ultracode 把 r 顶成 4」会被「反思次数」的第一个选项吃掉。
				value = option ? option.value : wanted;
			}
		}

		if (value !== undefined) vars[control.key] = value;
		const promised: Record<string, ParamValue> = {};
		if (value !== undefined) promised[control.key] = value;
		for (const [key, v] of Object.entries(option?.vars ?? {})) {
			vars[key] = v;
			promised[key] = v;
		}

		const choice: ModeParamChoice = { control, option, promised, effective: undefined, overridden: false };
		choices.push(choice);
		byKey[control.key] = choice;
	}

	// 只读复核：承诺的每一项和最终表对不对得上（对不上 = 被后面的参数改过）
	for (const choice of choices) {
		choice.effective = vars[choice.control.key];
		choice.overridden = Object.entries(choice.promised).some(([key, v]) => !sameParamValue(vars[key], v));
	}

	return { vars, choices, byKey };
}

/** 只要变量表时的简写（后端插值用） */
export function resolveModeVars(mode: ModeParamShape, selected: ModeParamSelections = {}): Record<string, ParamValue> {
	return resolveModeParams(mode, selected).vars;
}

// #endregion

// #region 插值

function lookupParam(vars: Record<string, ParamValue>, name: string): { found: boolean; value?: ParamValue } {
	const parts = name.split('.');
	// `mode.x` / `params.x` / `vars.x` 只是指明「从变量表取」，当前只有一层，前缀直接剥掉
	if (parts.length > 1 && (parts[0] === 'mode' || parts[0] === 'params' || parts[0] === 'vars')) parts.shift();
	let cur: unknown = vars;
	for (const part of parts) {
		if (!isPlainObject(cur) || !(part in cur)) return { found: false };
		cur = cur[part];
	}
	return cur === undefined ? { found: false } : { found: true, value: cur as ParamValue };
}

function interpolateString(text: string, vars: Record<string, ParamValue>): ParamValue {
	const whole = WHOLE_REF.exec(text);
	if (whole) {
		const hit = lookupParam(vars, whole[1]);
		return hit.found ? (hit.value as ParamValue) : text;	// 整段引用保留类型（数字 / 数组 / 对象）
	}
	if (!text.includes('[')) return text;
	return text.replace(INLINE_REF, (raw, name: string) => {
		const hit = lookupParam(vars, name);
		return hit.found ? stringifyParam(hit.value as ParamValue) : raw;
	});
}

/** 递归插值（跳过 SKIP_KEYS），返回新对象，不改入参 */
function interpolateTree(node: unknown, vars: Record<string, ParamValue>): unknown {
	if (typeof node === 'string') return interpolateString(node, vars);
	if (Array.isArray(node)) return node.map((item) => interpolateTree(item, vars));
	if (!isPlainObject(node)) return node;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		out[key] = SKIP_KEYS.has(key) ? value : interpolateTree(value, vars);
	}
	return out;
}

/**
 * 把变量灌进模式定义，得到**本次 run 生效的**一份副本（入参不动 —— `getMode()` 是全局共享对象）。
 *
 * 之后 `reflectionCount` / `ability.tools.allow` / `limits` / `maxDepth` / `todoList` 读的都是插值后的值。
 */
export function applyModeVars<T extends ModeDefinition>(mode: T, vars: Record<string, ParamValue>): T {
	let cloned: T;
	try {
		cloned = JSON.parse(JSON.stringify(mode)) as T;
	} catch {
		return mode;	// 理论上不会发生（mode 里全是 JSON 数据），兜底别把 run 弄挂
	}
	const resolved = interpolateTree(cloned, vars) as T;
	resolved.vars = vars;
	coerceKnownNumbers(resolved);
	return resolved;
}

/**
 * 数字字段兜底：变量可能是个字符串（`"[r]"` 而 `r: "2"`）。
 * 只处理**明确是数字语义**的几处，别做全局猜测式转换。
 */
function coerceKnownNumbers(mode: ModeDefinition): void {
	// agents 里只有 reflectionCount 是数字；`ability.tools.allow/deny` 可能是整段替换来的单个字符串
	for (const def of Object.values(mode.agents ?? {})) {
		// `delegatable` 也可能写成 `"[mode.rootAgents]"`：引用解析不到时会原样留着，
		// 而下游是 `(def.delegatable ?? []).filter(...)` —— 字符串也能 filter（返回空），不会崩，
		// 但行为会静默变成「不能委托」。这里统一成数组，让拼错变成「空列表」而不是「半个字符串」。
		if (def.delegatable !== undefined && !Array.isArray(def.delegatable)) {
			def.delegatable = asStringArray(def.delegatable);
		}
		if (def.reflectionCount !== undefined && def.reflectionCount !== null) {
			const n = Number(def.reflectionCount);
			def.reflectionCount = Number.isFinite(n) ? n : 0;
		}
		const tools = def.ability?.tools as { allow?: unknown; deny?: unknown } | undefined;
		if (tools) {
			if (tools.allow !== undefined) tools.allow = asStringArray(tools.allow);
			if (tools.deny !== undefined) tools.deny = asStringArray(tools.deny);
		}
	}
	if (mode.maxDepth !== undefined) {
		const n = Number(mode.maxDepth);
		if (Number.isFinite(n)) mode.maxDepth = n;
	}
	const limits = mode.limits as Record<string, unknown> | undefined;
	if (limits) {
		for (const key of ['totalRounds', 'agentInstanceRounds', 'warnAtRemaining']) {
			const n = Number(limits[key]);
			if (limits[key] !== undefined && Number.isFinite(n)) limits[key] = n;
		}
	}
}

// #endregion

// #region 校验（加载期用）

/**
 * 扫出所有 `[x]` 引用名（跳过 SKIP_KEYS）。
 * 加载器拿它跟 `knownParamNames()` 对一遍，拼错的名字给 warn。
 */
export function collectParamRefs(node: unknown, out: Set<string> = new Set()): Set<string> {
	if (typeof node === 'string') {
		for (const m of node.matchAll(INLINE_REF)) {
			const parts = m[1].split('.');
			if (parts.length > 1 && (parts[0] === 'mode' || parts[0] === 'params' || parts[0] === 'vars')) parts.shift();
			out.add(parts.join('.'));
		}
		return out;
	}
	if (Array.isArray(node)) {
		for (const item of node) collectParamRefs(item, out);
		return out;
	}
	if (isPlainObject(node)) {
		for (const [key, value] of Object.entries(node)) {
			if (SKIP_KEYS.has(key)) continue;
			collectParamRefs(value, out);
		}
	}
	return out;
}

// #endregion
