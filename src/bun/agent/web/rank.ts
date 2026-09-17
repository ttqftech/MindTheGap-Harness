/* ==========================================================================
   候选相关性打分 — MindTheGap-Harness（web 工具层）

   搜索引擎的「第 1 条」不等于「最相关的一条」：广告、聚合站、SEO 垃圾经常排在最前。
   位置信号不可信，但每条的「标题 + 摘要」是可信的——那就在这上面做一次判断。

   做法（用户指定的形态）：
   1. **动态构造 JSON Schema**：候选有几条就生成几个属性（link1…linkN），
      每个属性的 description 里直接写上「该条是什么」，让打分有依据；
   2. 交给一次**独立的 LLM 请求**输出每条的 0~10 分；
   3. 本地按分数排序，取前 K 条去展开正文。

   为什么要「独立请求」而不是让主 Agent 自己挑：
   主 Agent 的上下文里已经有任务、工具、历史，再把几十条候选塞进去，
   既污染它的判断，又贵。独立请求只带「检索意图 + 候选」，输入小、结论稳。

   失败绝不影响搜索：打分挂了就按引擎原始名次返回（ranked=false），
   并把这个事实写进工具结果里，让上游知道「顺序没经过相关性筛选」。
   ========================================================================== */

import { safeParseJson } from '../../utils';

// #region 类型

export interface RankInput {
	id: string;
	title: string;
	url: string;
	snippet: string;
	/** 命中它的引擎名（交叉命中 = 更多引擎认可） */
	engines: string[];
}

export interface RankedItem extends RankInput {
	/** 0~10；未打分时为 null */
	score: number | null;
	/** 保住原始名次，用于同分时稳定排序 */
	position: number;
}

export interface RankLlmRequest {
	system: string;
	user: string;
	/** 要求模型只输出 JSON（openai-chat 会带 response_format） */
	json?: boolean;
	/** 结构化输出契约（动态 schema）。支持 json_schema 的 provider 会强约束输出形状 */
	jsonSchema?: { name: string; schema: Record<string, unknown> };
	signal?: AbortSignal;
}

export interface RankLlmResult {
	ok: boolean;
	text: string;
	error?: string;
}

/** 打分用的 LLM 调用器（由 Runner 注入，避免 web 层依赖 runner） */
export type RankLlm = (req: RankLlmRequest) => Promise<RankLlmResult>;

export interface RankOutcome {
	items: RankedItem[];
	/** 是否真的拿到了 LLM 打分 */
	ranked: boolean;
	note?: string;
}

// #endregion

// #region 动态 Schema

const MAX_DESC_CHARS = 110;

function clip(text: string, max = MAX_DESC_CHARS): string {
	const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 按候选动态生成打分 schema。
 * 属性名用 link1…linkN（与用户约定的形态一致），description 里带该条的真实信息，
 * 这样模型看到的「要打分的对象」和实际候选一一对应，不会串号。
 */
export function buildRankSchema(candidates: RankInput[]): {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
} {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	candidates.forEach((c, i) => {
		const key = `link${i + 1}`;
		const parts = [clip(c.title), clip(c.url, 80)];
		if (c.snippet) parts.push(clip(c.snippet));
		if (c.engines.length > 1) parts.push(`被 ${c.engines.length} 个引擎同时命中`);
		properties[key] = {
			type: 'number',
			minimum: 0,
			maximum: 10,
			description: `请为该内容的相关性打分（0~10，10=最相关）：${parts.join(' ｜ ')}`,
		};
		required.push(key);
	});

	return {
		name: 'score_search_results',
		description: '为一组搜索结果按与检索意图的相关性逐条打分',
		parameters: {
			type: 'object',
			properties,
			required,
			additionalProperties: false,
		},
	};
}

// #endregion

// #region 打分

const RANK_SYSTEM = `你是一个搜索结果相关性评审器。用户会给你一个「检索意图」和若干候选结果（每条带编号、标题、URL、摘要）。

你的任务是**为每一条候选打 0~10 分**，衡量它「对回答这个检索意图有多大帮助」，然后**只输出一个 JSON 对象**。

打分口径：
- 9~10：正是用户要的答案所在（一手来源：官方文档 / 官方网站 / 政府或权威机构 / 原始仓库或规范）。
- 6~8：高度相关，能提供有效信息（专业媒体、技术社区的深度内容、垂直站点）。
- 3~5：部分相关，只沾边或只有零碎信息。
- 0~2：无关内容、广告、聚合/导航站、内容农场、只重复标题的空壳页。

输出要求：
- 键名与候选编号一一对应：link1 对应第 1 条，link2 对应第 2 条，依此类推，一条都不能漏。
- 值为 0~10 的数字（可以是小数）。
- 只输出 JSON，不要 Markdown 代码块，不要任何解释文字。
- 不要因为某条排在前面就给高分；位置不代表相关性。

形如：{"link1": 8, "link2": 2, "link3": 5}`;

function buildUserPrompt(query: string, candidates: RankInput[]): string {
	const lines = candidates.map((c, i) => {
		const parts = [`link${i + 1}`, clip(c.title, 90), c.url, clip(c.snippet, 140) || '(无摘要)', `来源：${c.engines.join('/') || '未知'}`];
		return `- ${parts.join(' ｜ ')}`;
	});
	return `检索意图：${query}\n\n候选结果（共 ${candidates.length} 条）：\n${lines.join('\n')}`;
}

/** 从任意形状的返回里捞出 linkN → 分数（模型可能包了一层 {scores:{...}} 或加了别的键） */
function collectScores(parsed: unknown, count: number): Map<number, number> {
	const scores = new Map<number, number>();
	const visit = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			const m = /^link_?(\d+)$/i.exec(key.trim());
			if (m) {
				const idx = Number.parseInt(m[1], 10);
				const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
				if (Number.isFinite(num) && idx >= 1 && idx <= count) scores.set(idx, Math.max(0, Math.min(10, num)));
			} else if (value && typeof value === 'object') {
				visit(value);
			}
		}
	};
	visit(parsed);
	return scores;
}

/** 模型没乖乖只输出 JSON 时，从文本里抠出第一个 JSON 对象 */
function extractJsonObject(text: string): unknown {
	const parsed = safeParseJson(text);
	if (parsed && Object.keys(parsed).length > 0) return parsed;
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start >= 0 && end > start) {
		const inner = safeParseJson(text.slice(start, end + 1));
		if (inner && Object.keys(inner).length > 0) return inner;
	}
	return null;
}

/**
 * 对候选打分并排序。
 * LLM 不可用 / 返回不可解析时**不抛错**，退回原始顺序并标注 ranked=false。
 */
export async function rankCandidates(query: string, candidates: RankInput[], llm: RankLlm, signal?: AbortSignal): Promise<RankOutcome> {
	const withPosition: RankedItem[] = candidates.map((c, i) => ({ ...c, score: null, position: i }));
	if (candidates.length === 0) return { items: [], ranked: false, note: '没有候选可打分' };

	const schema = buildRankSchema(candidates);
	let result: RankLlmResult;
	try {
		result = await llm({
			// 注意：系统提示词里**不重复**贴那份动态 schema。
			// schema 是结构化输出契约（走 response_format），贴进提示词只是把同样的信息说两遍、白烧 token。
			system: RANK_SYSTEM,
			user: buildUserPrompt(query, candidates),
			json: true,
			jsonSchema: { name: schema.name, schema: schema.parameters },
			signal,
		});
	} catch (err) {
		return { items: withPosition, ranked: false, note: `相关性打分请求失败（${(err as Error).message}），已按引擎原始名次返回` };
	}

	if (!result.ok) {
		return { items: withPosition, ranked: false, note: `相关性打分请求失败（${result.error ?? '未知错误'}），已按引擎原始名次返回` };
	}

	const parsed = extractJsonObject(result.text);
	if (!parsed) {
		return { items: withPosition, ranked: false, note: '相关性打分返回的不是可解析的 JSON，已按引擎原始名次返回' };
	}

	const scores = collectScores(parsed, candidates.length);
	if (scores.size === 0) {
		return { items: withPosition, ranked: false, note: '相关性打分没有给出任何有效分数，已按引擎原始名次返回' };
	}

	const items = withPosition.map((item, i) => ({ ...item, score: scores.get(i + 1) ?? null }));
	items.sort((a, b) => {
		const sa = a.score ?? -1;
		const sb = b.score ?? -1;
		if (sb !== sa) return sb - sa;
		return a.position - b.position;
	});

	return { items, ranked: true };
}

// #endregion
