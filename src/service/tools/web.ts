import { fetchMany, fetchUrl, type FetchFormat, type RenderPolicy } from './web/fetch';
import { searchEngines } from './web/engines';
import { rankCandidates, type RankInput } from './web/rank';
import { registerTool } from './registry';

// #region 内置工具 —— 网络

/**
 * 网络工具的实现体在 ./web/ 下：
 * - web/fetch.ts   统一抓取（先 HTTP，必要时无头浏览器渲染）
 * - web/engines.ts 多引擎搜索结果页抓取与合并
 * - web/rank.ts    候选相关性打分（动态 Schema + 一次独立 LLM 请求）
 * - web/render.ts  桥接到 runtime/web-render.mjs（Node 子进程，负责真正的浏览器渲染）
 * 这里只负责「工具长什么样、参数怎么校验、结果怎么拼成给模型看的文本」。
 */

const WEB_MAX_CHARS = 20000;
const SEARCH_DEFAULT_PAGES = 3;
const SEARCH_MAX_PAGES = 10;
const SEARCH_PAGE_CHARS = 4000;
const SEARCH_TOTAL_CHARS = 24000;

/**
 * 抓取一个 URL 的正文，转成 Markdown（自动剥掉导航 / 脚本 / 样式等噪声，超长会截断）。
 * 默认先用轻量 HTTP 请求；如果页面是靠 JS 渲染的空壳（SPA / 懒加载），或 HTTP 直接失败，
 * 会自动改用无头浏览器渲染 —— 你不用自己判断该用哪种。
 * 如果 URL 本来就是 API / JSON / 纯文本，会原样返回，不做转换。
 */
registerTool({
	name: 'web_fetch',
	access: 'read',
	description:
		'抓取一个 URL 的正文，支持转成 Markdown（自动剥掉导航、脚本、样式等噪声）或原样返回。',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: '要抓取的完整 URL（http/https）' },
			format: {
				type: 'string',
				enum: ['auto', 'markdown', 'text', 'html', 'raw'],
				description: '返回格式。auto（默认）= 若为 HTML 则转 Markdown，否则原样返回；raw = 不转换',
			},
			render: {
				type: 'string',
				enum: ['auto', 'always', 'never'],
				description: '是否用无头浏览器渲染。auto（默认）= HTTP 无有效正文时使用；never = 只用 HTTP（更快）',
			},
			maxChars: { type: 'integer', description: `最多返回多少字符，默认 ${WEB_MAX_CHARS}` },
			waitMs: { type: 'integer', description: '渲染时：页面加载完再等多久（毫秒），慢站点用，默认 0' },
			selector: { type: 'string', description: '渲染时：等待该 CSS 选择器出现后再取正文（如 "#root"）' },
		},
		required: ['url'],
	},
	async execute(args, ctx) {
		const outcome = await fetchUrl(String(args.url ?? ''), {
			format: (args.format as FetchFormat) ?? 'auto',
			render: (args.render as RenderPolicy) ?? 'auto',
			maxChars: (args.maxChars as number) ?? WEB_MAX_CHARS,
			waitMs: args.waitMs as number | undefined,
			selector: args.selector as string | undefined,
			signal: ctx.signal,
		});

		if (!outcome.ok) {
			return {
				success: false,
				content: `抓取失败：${outcome.error}\nURL: ${outcome.url}`,
				error: outcome.error,
				structured: { url: outcome.url, via: outcome.via, status: outcome.status },
			};
		}

		const footer = [
			`（${outcome.url}${outcome.finalUrl !== outcome.url ? ` → ${outcome.finalUrl}` : ''}`,
			outcome.status ? `HTTP ${outcome.status}` : '',
			outcome.via === 'browser' ? '浏览器渲染' : 'HTTP 直取',
			`${outcome.format}`,
			`${outcome.chars} 字符${outcome.truncated ? '（已截断）' : ''}）`,
		]
			.filter(Boolean)
			.join(' ｜ ');

		const head = outcome.title ? `# ${outcome.title}\n\n` : '';
		const note = outcome.note ? `\n\n> 说明：${outcome.note}` : '';

		return {
			success: true,
			content: `${head}${outcome.content}\n\n---\n${footer}${note}`,
			structured: {
				url: outcome.url,
				finalUrl: outcome.finalUrl,
				status: outcome.status,
				via: outcome.via,
				format: outcome.format,
				chars: outcome.chars,
				truncated: outcome.truncated,
			},
		};
	},
});

/**
 * 多引擎网络搜索，并且**直接把最相关页面的正文抓回来**。
 * 流程：同一个关键词并发查多个搜索引擎（必应 / 百度 / 搜狗 / 360 / 谷歌，某个引擎在当前网络下不可达时会如实标注、不影响其余结果）
 * → 合并去重得到「标题 + 链接 + 摘要」候选 → 用一次独立模型调用按相关性给每条候选打分
 * → 取分数最高的若干条展开正文。所以返回的是**经过相关性筛选、带正文的调研材料**，不是链接列表。
 */
registerTool({
	name: 'web_search',
	access: 'read',
	description:
		'多引擎网络搜索，返回最相关页面的**正文**。' +
		'该工具将并发调用多个搜索引擎，合并去重后进行 AI 打分，并返回**经过相关性筛选、的正文材料**，不是链接列表。' +
		'需要外部世界事实时优先用它；只有一个明确 URL 时建议用 web_fetch 而非本工具。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '检索词' },
			limit: {
				type: 'integer',
				description: `展开正文的条数，默认 ${SEARCH_DEFAULT_PAGES}（最多 ${SEARCH_MAX_PAGES}）。2~3 条适合只要一个事实，4~6 条适合需要对照多个来源`,
			},
			engines: {
				type: 'array',
				items: { type: 'string', enum: ['bing', 'baidu', 'sogou', 'so', 'google'] },
				description: '引擎白名单（默认全部）。建议不填',
			},
			maxCharsPerPage: { type: 'integer', description: `每篇正文最多返回多少字符，默认 ${SEARCH_PAGE_CHARS}` },
		},
		required: ['query'],
	},
	async execute(args, ctx) {
		const query = String(args.query ?? '').trim();
		if (!query) return { success: false, content: 'query 不能为空' };

		const limitResults = Math.max(1, Math.min((args.limit as number) ?? SEARCH_DEFAULT_PAGES, SEARCH_MAX_PAGES));
		const limitPerPage = Math.max(500, (args.maxCharsPerPage as number) ?? SEARCH_PAGE_CHARS);

		// ---- 1. 多引擎检索 ----
		const searched = await searchEngines(query, {
			engines: args.engines as string[] | undefined,
			signal: ctx.signal,
		});
		if (searched.hits.length === 0) {
			const detail = searched.reports.map((r) => `${r.name}：${r.error ?? '无结果'}`).join('；');
			return {
				success: false,
				content: `所有搜索引擎都没有返回可解析的结果（${detail}）。可以换关键词重试，或用 web_fetch 直接打开已知 URL。`,
				error: 'NO_SEARCH_RESULTS',
				structured: { query, engines: searched.reports },
			};
		}

		// ---- 2. 相关性打分（独立 LLM 请求，失败则退回引擎原始名次）----
		const rankInput: RankInput[] = searched.hits.map((h, i) => ({
			id: `c${i + 1}`,
			title: h.title,
			url: h.url,
			snippet: h.snippet,
			engines: h.engines,
		}));
		const ranked = await rankCandidates(query, rankInput, (req) => ctx.runLlm(req), ctx.signal);
		const picked = ranked.items.slice(0, limitResults);

		// ---- 3. 展开正文（一次浏览器调用覆盖所有需要渲染的页面）----
		const fetched = await fetchMany(picked.map((p) => p.url), {
			format: 'markdown',
			maxChars: limitPerPage,
			signal: ctx.signal,
		});

		// ---- 4. 拼装 ----
		const engineLine = searched.reports
			.map((r) => (r.ok ? `${r.name} ${r.count} 条` : `${r.name} 不可用(${r.error})`))
			.join(' · ');

		const header = [
			`# 搜索：${query}`,
			'',
			`引擎：${engineLine}`,
			`去重后候选：${searched.hits.length} 条；相关性打分：${ranked.ranked ? '已完成' : `未完成（${ranked.note ?? '未知原因'}）`}；已展开正文 ${picked.length} 篇。`,
		].join('\n');

		const sections: string[] = [];
		picked.forEach((item, i) => {
			const got = fetched[i]?.outcome;
			const score = item.score === null ? '未打分' : `相关性 ${item.score.toFixed(1)}`;
			const lines = [`## ${i + 1}. ${item.title}`, '', `链接：${got?.finalUrl ?? item.url}（${item.engines.join('/')} ｜ ${score}）`, ''];
			if (got?.ok) {
				lines.push(got.content || '(正文为空)');
				if (got.note) lines.push('', `> 说明：${got.note}`);
			} else {
				lines.push(`（正文抓取失败：${got?.error ?? '未知原因'}。摘要：${item.snippet || '无'}）`);
			}
			sections.push(lines.join('\n'));
		});

		// 没被展开的候选也列出来——它们是「已经过筛选」的备选，比让模型重新搜一遍便宜
		const rest = ranked.items.slice(limitResults);
		if (rest.length > 0) {
			const restLines = rest
				.slice(0, 12)
				.map((r) => `- ${r.score === null ? '(未打分)' : r.score.toFixed(1)}  ${r.title} — ${r.url}  ← ${r.engines.join('/')}`);
			sections.push(`## 未展开的候选（按相关性排序）\n\n${restLines.join('\n')}`);
		}

		let content = `${header}\n\n---\n\n${sections.join('\n\n---\n\n')}`;
		let truncated = false;
		if (content.length > SEARCH_TOTAL_CHARS) {
			content = `${content.slice(0, SEARCH_TOTAL_CHARS)}\n\n...(搜索结果过长，已截断。需要更多内容时请用 web_fetch 直接打开链接)`;
			truncated = true;
		}

		return {
			success: true,
			content,
			structured: {
				query,
				engines: searched.reports,
				candidates: searched.hits.length,
				ranked: ranked.ranked,
				picked: picked.map((p, i) => ({
					title: p.title,
					url: fetched[i]?.outcome.finalUrl ?? p.url,
					score: p.score,
					ok: fetched[i]?.outcome.ok ?? false,
				})),
				truncated,
			},
		};
	},
});

// #endregion
