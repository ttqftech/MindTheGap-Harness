/* ==========================================================================
   统一抓取 — MindTheGap-Harness（web 工具层）

   一个 URL 进来，输出「模型能直接读的正文」。两条路：

   1. **轻量 HTTP**（默认先走）：几十毫秒，够应付静态页、API、JSON、纯文本。
   2. **无头浏览器渲染**（兜底）：页面是空壳（SPA / 懒加载 / 反爬）或 HTTP 直接失败时
      交给 scripts/web-render.mjs，能拿到 JS 渲染后的 DOM。

   为什么要「先 HTTP 后浏览器」而不是一律渲染：
   起一次浏览器 1~3 秒，而大多数页面 HTTP 就能读全。一律渲染等于给每次抓取
   加 2 秒税，搜索结果展开 3 篇就是 10 秒——用户等不起。

   为什么必须保留浏览器这条路：
   「HTTP 拿到 HTML」不等于「拿到了正文」。现代站点普遍是 CSR 空壳，
   只看 HTTP 的抓取工具在这种页面上会返回一堆 script 标签，然后模型开始瞎编。
   ========================================================================== */

import {
	extractTitle,
	htmlToMarkdown,
	htmlToText,
	isHtmlContentType,
	isPlainContentType,
	looksLikeCsrShell,
	looksLikeHtml,
	normalizeText,
	textWeight,
} from './html';
import { renderUrlsViaBrowser, type RenderFormat } from './render';

// #region 类型

export type FetchFormat = 'auto' | 'markdown' | 'text' | 'html' | 'raw';
export type RenderPolicy = 'auto' | 'always' | 'never';

export interface FetchOptions {
	/** 期望的返回形态。auto（默认）= 能转 Markdown 就转，本来就是纯文本就原样给 */
	format?: FetchFormat;
	/** 是否允许动用浏览器。auto（默认）= HTTP 拿不到正文时才渲染 */
	render?: RenderPolicy;
	/** 截断上限（字符），默认 20000 */
	maxChars?: number;
	/** 渲染时：网络空闲后额外等待（ms） */
	waitMs?: number;
	/** 渲染时：等待该 CSS 选择器出现 */
	selector?: string;
	/** 单页超时（ms），默认 HTTP 20s / 渲染 25s */
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface FetchOutcome {
	ok: boolean;
	/** 请求的 URL */
	url: string;
	/** 实际落地 URL（跟随重定向后） */
	finalUrl: string;
	status?: number;
	/** 正文是从哪条路拿到的 */
	via: 'http' | 'browser';
	/** 实际返回的格式：markdown / text / html / raw */
	format: string;
	content: string;
	/** 截断前的正文长度 */
	chars: number;
	truncated: boolean;
	title?: string;
	/** 渲染失败等降级说明（ok 也可能带 notes） */
	note?: string;
	error?: string;
}

// #endregion

// #region 常量

const DEFAULT_MAX_CHARS = 20000;
const HTTP_TIMEOUT_MS = 20000;
const RENDER_TIMEOUT_MS = 25000;

/**
 * 「正文太薄」的判定：HTML 拿回来一大堆，实义文字却没几个 → 空壳，交给浏览器。
 *
 * 三条规则的取舍（都是踩过的坑）：
 * 1. 明确的 SPA 挂载容器是空的 → 直接渲染，不看字数。
 * 2. HTML 本身就不大 → 那它就是个短页面（比如 wttr.in 的返回值被 Accept 协商
 *    包了一层 html 外壳，12KB 里就一行天气），渲染只会白等几秒。
 * 3. 大而无实义文字（去掉链接后没剩几个字）→ 渲染。
 */
const BIG_HTML_BYTES = 20000;
const MIN_TEXT_WEIGHT = 300;

function needsBrowser(html: string, converted: string): boolean {
	if (looksLikeCsrShell(html)) return true;
	if (html.length < BIG_HTML_BYTES) return false;
	return textWeight(converted) < MIN_TEXT_WEIGHT;
}

/** 渲染误差只需要第一行，Playwright 的调用栈会把错误信息撑成几十行 */
function shortError(message: string | undefined): string {
	if (!message) return '未知错误';
	const line = message.split('\n').find((l) => l.trim()) ?? message;
	return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// #endregion

// #region 内部工具

function truncate(text: string, maxChars: number): { content: string; truncated: boolean } {
	if (text.length <= maxChars) return { content: text, truncated: false };
	return { content: `${text.slice(0, maxChars)}\n\n...(已截断：全文 ${text.length} 字符，这里只给了前 ${maxChars} 字符)`, truncated: true };
}

/** 按期望格式把 HTML 转成正文 */
function convertHtml(html: string, format: FetchFormat): string {
	if (format === 'html') return html;
	if (format === 'text') return htmlToText(html);
	return htmlToMarkdown(html);
}

/** 这个 HTML 是不是「空壳」——需要浏览器渲染 */

function headerGet(resp: Response, name: string): string | null {
	try {
		return resp.headers?.get?.(name) ?? null;
	} catch {
		return null;
	}
}

// #endregion

// #region 主流程

/**
 * 抓一个 URL 的正文。**永不抛异常**，一切失败都变成 ok:false + error。
 */
export async function fetchUrl(inputUrl: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
	const url = String(inputUrl ?? '').trim();
	const format: FetchFormat = opts.format ?? 'auto';
	const render: RenderPolicy = opts.render ?? 'auto';
	const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS;

	if (!/^https?:\/\//i.test(url)) {
		return {
			ok: false, url, finalUrl: url, via: 'http', format: 'text',
			content: '', chars: 0, truncated: false,
			error: 'url 必须以 http(s):// 开头',
		};
	}

	// ---- 明确要求渲染：直接走浏览器 ----
	if (render === 'always') {
		const rendered = renderOne(url, { ...opts, format: format === 'raw' ? 'text' : format, maxChars });
		return rendered;
	}

	// ---- 先走轻量 HTTP ----
	const httpResult = await fetchViaHttp(url, { format, maxChars, timeoutMs: opts.timeoutMs, signal: opts.signal });

	if (httpResult.ok) {
		if (!httpResult.needRender) return httpResult;
		if (render === 'never') {
			return {
				...httpResult,
				needRender: undefined,
				note: '页面正文很少、疑似需要 JS 渲染，但本次禁用了渲染（render=never）。',
			} as FetchOutcome & { needRender?: boolean };
		}
	} else if (render === 'never') {
		return httpResult;
	}

	// ---- 兜底：无头浏览器 ----
	const viaBrowser = renderOne(url, {
		...opts,
		format: format === 'raw' ? 'text' : format,
		maxChars,
	});

	// 浏览器渲染出来仍是错误页（404 / 403，比如 example.com 对任意路径都回 404）：
	// 这不是「拿到了正文」，不能当成功返回，否则模型会把错误页当内容用。
	const browserFailed4xx = viaBrowser.ok && (viaBrowser.status ?? 200) >= 400 && !httpResult.ok;
	if (viaBrowser.ok && !browserFailed4xx) {
		return httpResult.ok
			? { ...viaBrowser, note: `HTTP 直取只得到 ${httpResult.chars} 字符（疑似 JS 空壳），已改用浏览器渲染。` }
			: viaBrowser;
	}
	if (browserFailed4xx) {
		viaBrowser.ok = false;
		viaBrowser.error = `HTTP ${viaBrowser.status}（浏览器渲染后仍然是错误页，没有正文可取）`;
	}

	// 浏览器也失败：如果 HTTP 至少拿到了点东西，就把它交出去
	if (httpResult.ok) {
		return { ...httpResult, needRender: undefined, note: `浏览器渲染失败（${shortError(viaBrowser.error)}），退回 HTTP 直取结果。` } as FetchOutcome;
	}
	return {
		...httpResult,
		error: `${httpResult.error}；浏览器渲染也失败：${shortError(viaBrowser.error)}`,
	};
}

/** 走 HTTP：返回结果里 needRender=true 表示「拿到了 HTML 但正文太薄，建议渲染」 */
async function fetchViaHttp(
	url: string,
	opts: { format: FetchFormat; maxChars: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<FetchOutcome & { needRender?: boolean }> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? HTTP_TIMEOUT_MS);
	const onAbort = () => ctrl.abort();
	opts.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		const resp = await fetch(url, {
			signal: ctrl.signal,
			redirect: 'follow',
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
		});

		const finalUrl = resp.url || url;
		const contentType = headerGet(resp, 'content-type');
		const raw = await resp.text();

		if (!resp.ok) {
			return {
				ok: false, url, finalUrl, status: resp.status, via: 'http', format: 'text',
				content: '', chars: 0, truncated: false,
				error: `HTTP ${resp.status}${contentType ? ` (${contentType})` : ''}`,
			};
		}

		const treatAsPlain = isPlainContentType(contentType) || (!isHtmlContentType(contentType) && !looksLikeHtml(raw));
		if (treatAsPlain) {
			// API / JSON / 纯文本：不做任何转换，按原文给（Markdown 转换对 JSON 只会帮倒忙）
			const text = normalizeText(raw);
			const { content, truncated } = truncate(text, opts.maxChars);
			return {
				ok: true, url, finalUrl, status: resp.status, via: 'http', format: 'raw',
				content, chars: text.length, truncated,
			};
		}

		const converted = normalizeText(convertHtml(raw, opts.format));
		const needRender = opts.format !== 'html' && needsBrowser(raw, converted);
		const { content, truncated } = truncate(converted, opts.maxChars);
		return {
			ok: true, url, finalUrl, status: resp.status, via: 'http',
			format: opts.format === 'auto' ? 'markdown' : opts.format,
			content, chars: converted.length, truncated,
			title: extractTitle(raw),
			needRender,
		};
	} catch (err) {
		const e = err as Error;
		const msg = e?.name === 'AbortError' ? `请求超时或被中断（${opts.timeoutMs ?? HTTP_TIMEOUT_MS}ms）` : e?.message ?? String(err);
		return {
			ok: false, url, finalUrl: url, via: 'http', format: 'text',
			content: '', chars: 0, truncated: false,
			error: `HTTP 请求失败：${msg}`,
		};
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

/** 走浏览器渲染（单 URL 包装） */
function renderOne(url: string, opts: FetchOptions): FetchOutcome & { needRender?: boolean } {
	const format: RenderFormat = (opts.format === 'auto' || opts.format === 'raw' || !opts.format ? 'markdown' : opts.format) as RenderFormat;
	const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
	const [page] = renderUrlsViaBrowser([url], {
		format,
		waitMs: opts.waitMs,
		selector: opts.selector,
		timeoutMs: opts.timeoutMs ?? RENDER_TIMEOUT_MS,
		concurrency: 1,
	});

	if (!page || !page.ok) {
		return {
			ok: false, url, finalUrl: url, via: 'browser', format,
			content: '', chars: 0, truncated: false,
			error: page?.error ?? '渲染失败',
		};
	}

	const text = normalizeText(page.content ?? '');
	const { content, truncated } = truncate(text, maxChars);
	return {
		ok: true,
		url,
		finalUrl: page.finalUrl || url,
		status: page.status,
		via: 'browser',
		format,
		content,
		chars: text.length,
		truncated,
		title: page.title,
	};
}

// #endregion

// #region 批量

export interface BatchFetchResult {
	url: string;
	outcome: FetchOutcome;
}

/**
 * 并发抓多个 URL。
 * 已带「正文」的结果不会重复渲染；薄页面会**合并成一次浏览器调用**，
 * 这样「展开 3 篇正文」最多只起一次浏览器。
 */
export async function fetchMany(urls: string[], opts: FetchOptions = {}): Promise<BatchFetchResult[]> {
	const list = urls.map((u) => String(u ?? '').trim()).filter(Boolean);
	if (list.length === 0) return [];

	const format: FetchFormat = opts.format ?? 'auto';
	const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
	const render: RenderPolicy = opts.render ?? 'auto';

	const httpPass = await Promise.all(
		list.map(async (url) => {
			if (render === 'always') {
				return { url, outcome: null as FetchOutcome | null, needRender: true };
			}
			const outcome = await fetchViaHttp(url, { format, maxChars, timeoutMs: opts.timeoutMs, signal: opts.signal });
			const needRender = outcome.ok ? outcome.needRender === true : render !== 'never';
			return { url, outcome, needRender };
		}),
	);

	// 需要浏览器的，一次调用解决
	const renderTargets = httpPass.filter((r) => r.needRender).map((r) => r.url);
	let rendered: Awaited<ReturnType<typeof renderUrlsViaBrowser>> = [];
	if (renderTargets.length > 0) {
		const browserFormat: RenderFormat = (format === 'auto' || format === 'raw' ? 'markdown' : format) as RenderFormat;
		rendered = renderUrlsViaBrowser(renderTargets, {
			format: browserFormat,
			waitMs: opts.waitMs,
			selector: opts.selector,
			timeoutMs: opts.timeoutMs ?? RENDER_TIMEOUT_MS,
			concurrency: Math.min(3, renderTargets.length),
		});
	}

	return httpPass.map((entry) => {
		const page = rendered.find((p) => p.url === entry.url);
		const pageUsable = !!page?.ok && !((page.status ?? 200) >= 400 && !entry.outcome?.ok);
		if (page && pageUsable) {
			const text = normalizeText(page.content ?? '');
			const { content, truncated } = truncate(text, maxChars);
			const outcome: FetchOutcome = {
				ok: true,
				url: entry.url,
				finalUrl: page.finalUrl || entry.url,
				status: page.status,
				via: 'browser',
				format: (format === 'auto' || format === 'raw' ? 'markdown' : format),
				content,
				chars: text.length,
				truncated,
				title: page.title,
			};
			return { url: entry.url, outcome };
		}
		if (page && !pageUsable && entry.outcome?.ok) {
			return { url: entry.url, outcome: { ...entry.outcome, note: `浏览器渲染失败（${shortError(page.error)}），退回 HTTP 结果。` } };
		}
		if (page && !pageUsable) {
			const reason = page.ok ? `HTTP ${page.status}（错误页）` : shortError(page.error);
			return {
				url: entry.url,
				outcome: { ...(entry.outcome as FetchOutcome), error: `${entry.outcome?.error ?? '抓取失败'}；浏览器渲染也失败：${reason}` },
			};
		}
		if (entry.outcome) return { url: entry.url, outcome: entry.outcome };
		return {
			url: entry.url,
			outcome: {
				ok: false, url: entry.url, finalUrl: entry.url, via: 'browser', format: 'text',
				content: '', chars: 0, truncated: false, error: '抓取失败',
			},
		};
	});
}

// #endregion
