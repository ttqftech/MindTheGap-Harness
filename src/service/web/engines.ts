/* ==========================================================================
   多引擎搜索 — MindTheGap-Harness（web 工具层）

   为什么不用「现成的搜索 API」：
   需要 key、要钱、而且要配；这里要的是「开箱可用」。所以直接抓主流搜索引擎的
   结果页 HTML，抽 标题 + 链接 + 简述。

   为什么是「多引擎合并」而不是只用一个：
   单个引擎的结果页结构随时会变、也随时会限流；多引擎并行既提高召回，
   也天然构成冗余——某个引擎挂了只是少一份候选，不是整次搜索失败。

   为什么不在这里做相关性判断：
   抽取层不做判断，全量候选交给一次独立的 LLM 打分（见 rank.ts）。
   引擎返回的「第 1 条」经常是广告或聚合站，位置并不代表相关性。

   注意：各引擎可达性随网络环境变化（中国大陆网络下 google / duckduckgo 不通，
   baidu 在部分机房被拦）。不可达的引擎会被标记 ok:false 并跳过，不影响其余结果。
   ========================================================================== */

import { decodeEntities, normalizeText } from './html';

// #region 工具

/** 去标签 + 解码 + 压缩空白，并截到指定长度 */
function textOf(html: string, maxChars = 240): string {
	const t = normalizeText(decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')));
	return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
}

function firstMatch(block: string, patterns: RegExp[]): string {
	for (const re of patterns) {
		const m = re.exec(block);
		if (m) {
			const v = (m[1] ?? '').trim();
			if (v) return v;
		}
	}
	return '';
}

/** base64url → UTF-8 文本（不依赖 Buffer，cottontail 里 atob 是有的） */
function decodeBase64Url(input: string): string {
	try {
		const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
		const bin = atob(padded);
		let percent = '';
		for (let i = 0; i < bin.length; i++) {
			percent += `%${bin.charCodeAt(i).toString(16).padStart(2, '0')}`;
		}
		return decodeURIComponent(percent);
	} catch {
		return '';
	}
}

/**
 * 把引擎的跳转链接还原成真实链接。
 * 还原不了的（需要发一次请求才知道 302 去哪）留原样，
 * 由后续抓取时的 finalUrl 兜底修正。
 */
export function unwrapEngineUrl(raw: string, engineId: string): string {
	let url = decodeEntities(String(raw ?? '').trim());
	if (!url) return '';

	// bing: https://www.bing.com/ck/a?...&u=a1<base64url>
	if (/bing\.com\/ck\/a/i.test(url)) {
		const m = /[?&]u=a1([^&]+)/.exec(url);
		if (m) {
			const decoded = decodeBase64Url(m[1]);
			if (/^https?:\/\//i.test(decoded)) url = decoded;
		}
	}

	// google: /url?q=<encoded>&sa=...
	if (engineId === 'google' || /google\.[a-z.]+\/url\?/i.test(url)) {
		const m = /[?&](?:q|url)=([^&]+)/.exec(url);
		if (m) {
			const decoded = decodeURIComponent(m[1]);
			if (/^https?:\/\//i.test(decoded)) url = decoded;
		}
	}

	// 协议相对
	if (url.startsWith('//')) url = `https:${url}`;

	return url;
}

/** 用于去重的归一化 key：忽略协议、www、锚点、末尾斜杠与常见跟踪参数 */
export function canonicalUrlKey(url: string): string {
	let u = String(url ?? '').trim().toLowerCase();
	const hash = u.indexOf('#');
	if (hash >= 0) u = u.slice(0, hash);
	const q = u.indexOf('?');
	let query = '';
	if (q >= 0) {
		query = u
			.slice(q + 1)
			.split('&')
			.filter((kv) => !/^(utm_|from|spm|ref|refer|share|fr|sa|ved|usg|wd|eqid|rsv_)/.test(kv.split('=')[0]))
			.join('&');
		u = u.slice(0, q);
	}
	u = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
	return query ? `${u}?${query}` : u;
}

// #endregion

// #region 引擎定义

export interface EngineHit {
	title: string;
	url: string;
	snippet: string;
}

export interface EngineSpec {
	id: string;
	name: string;
	/** 结果页 URL */
	buildUrl: (query: string) => string;
	/** 从结果页 HTML 抽候选（引擎自己的一次性抽取，去重 / 打分在后面统一做） */
	extract: (html: string) => EngineHit[];
	headers?: Record<string, string>;
}

/** 按 `标记` 把 HTML 切成结果块 */
function splitBlocks(html: string, marker: RegExp, limit: number): string[] {
	const blocks: string[] = [];
	let match: RegExpExecArray | null;
	const re = new RegExp(marker.source, marker.flags.includes('g') ? marker.flags : `${marker.flags}g`);
	let lastEnd = -1;
	while ((match = re.exec(html)) !== null) {
		if (lastEnd >= 0) blocks.push(html.slice(lastEnd, match.index));
		lastEnd = match.index;
		if (blocks.length >= limit) break;
	}
	if (lastEnd >= 0 && blocks.length < limit) blocks.push(html.slice(lastEnd));
	return blocks;
}

const BING: EngineSpec = {
	id: 'bing',
	name: '必应',
	buildUrl: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN&ensearch=0`,
	extract(html) {
		const blocks = splitBlocks(html, /<li class="b_algo"/g, 14);
		const out: EngineHit[] = [];
		for (const raw of blocks) {
			const block = raw.replace(/<link[^>]*>/gi, '');
			const titleHtml = firstMatch(block, [/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/]);
			// firstMatch 只取第 1 组，这里单独取标题文本
			const titleMatch = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
			const href = titleHtml || titleMatch?.[1] || '';
			const title = textOf(titleMatch?.[2] ?? '', 140);
			if (!href || !title) continue;
			const snippet = textOf(
				firstMatch(block, [
					/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/,
					/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/,
					/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/,
				]),
			);
			out.push({ title, url: unwrapEngineUrl(href, 'bing'), snippet });
		}
		return out;
	},
};

const BAIDU: EngineSpec = {
	id: 'baidu',
	name: '百度',
	buildUrl: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&ie=utf-8&rn=20`,
	headers: { Referer: 'https://www.baidu.com/' },
	extract(html) {
		const blocks = splitBlocks(html, /<div[^>]+class="result[^"]*"/g, 14);
		const out: EngineHit[] = [];
		for (const block of blocks) {
			const m = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
			const title = textOf(m?.[2] ?? '', 140);
			const href = m?.[1] ?? '';
			if (!href || !title) continue;
			const snippet = textOf(
				firstMatch(block, [
					/<div[^>]+class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/,
					/<span[^>]+class="content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/,
					/<div[^>]+class="c-span-last"[^>]*>([\s\S]*?)<\/div>/,
				]),
			);
			out.push({ title, url: unwrapEngineUrl(href, 'baidu'), snippet });
		}
		return out;
	},
};

const SOGOU: EngineSpec = {
	id: 'sogou',
	name: '搜狗',
	buildUrl: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}&ie=utf8`,
	extract(html) {
		const blocks = splitBlocks(html, /<div class="vrwrap"/g, 14);
		const out: EngineHit[] = [];
		for (const block of blocks) {
			const m = /<h3[^>]*class="[^"]*vr-title[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
			const title = textOf(m?.[2] ?? '', 140);
			const href = m?.[1] ?? '';
			if (!href || !title) continue;
			const snippet = textOf(
				firstMatch(block, [
					/<div[^>]+class="(?:text-layout|str_info|space-txt|fz-mid space-txt)[^"]*"[^>]*>([\s\S]*?)<\/div>/,
					/<div[^>]+class="(?:fz-mid|star-wiki)[^"]*"[^>]*>([\s\S]*?)<\/div>/,
				]),
			);
			out.push({ title, url: unwrapEngineUrl(href, 'sogou'), snippet });
		}
		return out;
	},
};

const SO360: EngineSpec = {
	id: 'so',
	name: '360 搜索',
	buildUrl: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}&ie=utf-8`,
	extract(html) {
		const blocks = splitBlocks(html, /<li class="res-list"/g, 14);
		const out: EngineHit[] = [];
		for (const raw of blocks) {
			const block = raw.replace(/<style[\s\S]*?<\/style>/gi, '');
			const m = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
			const title = textOf(m?.[2] ?? '', 140);
			const href = m?.[1] ?? '';
			if (!href || !title) continue;
			const snippet = textOf(
				firstMatch(block, [
					/<p[^>]+class="res-desc"[^>]*>([\s\S]*?)<\/p>/,
					/<div[^>]+class="res-desc"[^>]*>([\s\S]*?)<\/div>/,
					/<p[^>]+class="res-rich"[^>]*>([\s\S]*?)<\/p>/,
				]),
			);
			out.push({ title, url: unwrapEngineUrl(href, 'so'), snippet });
		}
		return out;
	},
};

const GOOGLE: EngineSpec = {
	id: 'google',
	name: '谷歌',
	buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&hl=zh-CN`,
	extract(html) {
		const re = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]{0,1200}?)(?:<\/div>)/g;
		const out: EngineHit[] = [];
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null && out.length < 14) {
			const title = textOf(m[2], 140);
			const url = unwrapEngineUrl(decodeURIComponent(m[1]), 'google');
			if (!title || !url) continue;
			const snippet = textOf(
				firstMatch(m[3], [
					/<div[^>]+class="VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/,
					/<span[^>]+class="aCOpRe"[^>]*>([\s\S]*?)<\/span>/,
					/<div[^>]+class="[^"]*IsZvec[^"]*"[^>]*>([\s\S]*?)<\/div>/,
				]),
			);
			out.push({ title, url, snippet });
		}
		return out;
	},
};

export const ENGINES: EngineSpec[] = [BING, BAIDU, SOGOU, SO360, GOOGLE];

/** 默认引擎集合（顺序 = 优先级，仅影响同分时的稳定排序） */
export const DEFAULT_ENGINE_IDS = ['bing', 'baidu', 'sogou', 'so', 'google'];

export function resolveEngineIds(ids?: string[]): EngineSpec[] {
	const wanted = (ids && ids.length > 0 ? ids : DEFAULT_ENGINE_IDS).map((s) => String(s).toLowerCase().trim());
	const out: EngineSpec[] = [];
	for (const id of wanted) {
		const spec = ENGINES.find((e) => e.id === id || e.name === id);
		if (spec && !out.includes(spec)) out.push(spec);
	}
	return out;
}

// #endregion

// #region 抓取 + 合并

const ENGINE_TIMEOUT_MS = 9000;

export interface EngineReport {
	id: string;
	name: string;
	ok: boolean;
	count: number;
	error?: string;
}

export interface EngineHitWithSource extends EngineHit {
	engine: string;
	engineName: string;
	/** 该引擎返回的原始名次（从 0 开始），仅用于打分失败时的兜底排序 */
	position: number;
	/** 命中它的引擎名（交叉命中 = 多个引擎都认可，是「可信度」的弱信号） */
	engines: string[];
}

export interface SearchEnginesResult {
	query: string;
	hits: EngineHitWithSource[];
	reports: EngineReport[];
}

async function runEngine(spec: EngineSpec, query: string, signal?: AbortSignal): Promise<{ spec: EngineSpec; hits: EngineHit[]; error?: string }> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ENGINE_TIMEOUT_MS);
	const onAbort = () => ctrl.abort();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const resp = await fetch(spec.buildUrl(query), {
			signal: ctrl.signal,
			redirect: 'follow',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				...(spec.headers ?? {}),
			},
		});
		if (!resp.ok) return { spec, hits: [], error: `HTTP ${resp.status}` };
		const html = await resp.text();
		const hits = spec.extract(html).filter((h) => h.title && h.url);
		if (hits.length === 0) return { spec, hits: [], error: '结果页结构未匹配（可能改版或被风控）' };
		return { spec, hits };
	} catch (err) {
		const e = err as Error;
		return { spec, hits: [], error: e?.name === 'AbortError' ? `超时（${ENGINE_TIMEOUT_MS}ms）` : e?.message ?? String(err) };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * 并行抓多个引擎并合并候选。
 * 某个引擎失败不影响其他引擎；同一条结果（按 URL 归一化）只保留首次出现的引擎来源，
 * 但会记录「也被其他引擎命中」以增强可信度。
 */
export async function searchEngines(
	query: string,
	opts: { engines?: string[]; signal?: AbortSignal; maxCandidates?: number } = {},
): Promise<SearchEnginesResult> {
	const specs = resolveEngineIds(opts.engines);
	const maxCandidates = opts.maxCandidates ?? 32;

	const settled = await Promise.all(specs.map((spec) => runEngine(spec, query, opts.signal)));

	const byKey = new Map<string, EngineHitWithSource>();
	const reports: EngineReport[] = [];

	for (const r of settled) {
		if (r.error || r.hits.length === 0) {
			reports.push({ id: r.spec.id, name: r.spec.name, ok: false, count: 0, error: r.error ?? '无结果' });
			continue;
		}
		let kept = 0;
		r.hits.forEach((hit, index) => {
			const key = canonicalUrlKey(hit.url);
			if (!key || !/^https?:\/\//i.test(hit.url)) return;
			const existing = byKey.get(key);
			if (existing) {
				existing.engines.push(r.spec.name);
				if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet;
				return;
			}
			byKey.set(key, { ...hit, engine: r.spec.id, engineName: r.spec.name, position: index, engines: [r.spec.name] });
			kept++;
		});
		reports.push({ id: r.spec.id, name: r.spec.name, ok: true, count: kept });
	}

	// 交叉命中（多个引擎都出现）的排前面，其次按引擎优先级 / 名次
	const engineOrder = new Map(specs.map((s, i) => [s.id, i]));
	const hits = Array.from(byKey.values())
		.sort((a, b) => {
			if (b.engines.length !== a.engines.length) return b.engines.length - a.engines.length;
			const ea = engineOrder.get(a.engine) ?? 99;
			const eb = engineOrder.get(b.engine) ?? 99;
			if (ea !== eb) return ea - eb;
			return a.position - b.position;
		})
		.slice(0, maxCandidates);

	return { query, hits, reports };
}

// #endregion
