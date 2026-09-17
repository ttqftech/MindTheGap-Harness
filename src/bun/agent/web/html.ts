/* ==========================================================================
   HTML → 文本 / Markdown — MindTheGap-Harness（web 工具层）

   为什么手写而不是引依赖：
   主进程跑在 Cottontail（JSC）里，能不能 import 第三方包取决于打包方式；
   而这套转换只需要「够用、可预测、零依赖」——真正的复杂页面由
   scripts/web-render.mjs 里的浏览器渲染 + 同一套规则收尾（那边是一份等价实现）。

   刻意不做的事：正文抽取（readability）不做，因为判不准时宁可多留一点，
   让模型自己挑；截断由调用方按 maxChars 控制。
   ========================================================================== */

// #region 实体解码

export function decodeEntities(input: string): string {
	return input
		.replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/g, ' ')
		.replace(/&#(\d{1,7});/g, (_m, d: string) => {
			const n = Number.parseInt(d, 10);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
		})
		.replace(/&#x([0-9a-f]{1,6});/gi, (_m, h: string) => {
			const n = Number.parseInt(h, 16);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
		})
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

// #endregion

// #region 判定

/** Content-Type 是否是 HTML 文档 */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
	if (!contentType) return false;
	const ct = contentType.toLowerCase();
	return ct.includes('text/html') || ct.includes('application/xhtml');
}

/** Content-Type 是否是「本来就是给人/程序看的纯文本」（JSON/XML/纯文本），无需转换 */
export function isPlainContentType(contentType: string | null | undefined): boolean {
	if (!contentType) return false;
	const ct = contentType.toLowerCase();
	if (isHtmlContentType(ct)) return false;
	return (
		ct.includes('json') ||
		ct.includes('xml') ||
		ct.includes('text/plain') ||
		ct.includes('text/csv') ||
		ct.includes('yaml') ||
		ct.includes('javascript') ||
		ct.includes('markdown')
	);
}

/** 粗略判断一段字符串像不像 HTML（有些站点 Content-Type 是 text/plain 却回 HTML） */
export function looksLikeHtml(body: string): boolean {
	const head = body.slice(0, 2000).toLowerCase();
	return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<div[\s>]|<script[\s>]/.test(head);
}

/**
 * 是否是「明确的 SPA 空壳」：框架的挂载容器是空的。
 * Vue/React/Nuxt/Next 的入口 HTML 里 `<div id="app"></div>` 就是个占位符，
 * 正文要等 JS 挂上去。这种页面直接渲染，不必再看字数。
 */
export function looksLikeCsrShell(html: string): boolean {
	return /<(div|main|section)[^>]+id=["'](root|app|__next|__nuxt|app-root|appRoot)["'][^>]*>\s*<\/(div|main|section)>/i.test(
		html,
	);
}

/**
 * 「实义文字量」：去掉 Markdown 链接之后还剩多少非空白、非标记字符。
 *
 * 为什么要减去链接：纯导航页 / 聚合页的 HTML 里有一大堆 <a>，剥完标签看着「有几千字」，
 * 但那些全是「首页 / 登录 / 下载 App」这类导航文字，对回答用户的问题一文不值。
 * 链接一去掉，这类空壳就现原形了。
 */
export function textWeight(markdown: string): number {
	return markdown
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, '')	// 整个链接（含文字）
		.replace(/```[\s\S]*?```/g, '')
		.replace(/[#*`>|\-\s\u00a0]/g, '')
		.length;
}

// #endregion

// #region 转换

const DROP_BLOCK = /<(script|style|noscript|svg|canvas|iframe|head|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi;

/**
 * HTML → Markdown。
 * 保留标题 / 列表 / 链接 / 加粗 / 代码块这些「模型读起来有用」的结构，
 * 其余标签一律抹平。
 */
export function htmlToMarkdown(html: string): string {
	let md = html;
	md = md.replace(/<!--[\s\S]*?-->/g, '');
	md = md.replace(DROP_BLOCK, '');
	md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lv: string, t: string) => `\n\n${'#'.repeat(Number(lv))} ${t}\n\n`);
	md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => `\n- ${t}`);
	md = md.replace(/<\/(p|div|section|article|tr|ul|ol|blockquote|table|h[1-6]|pre)>/gi, '\n\n');
	md = md.replace(/<br\s*\/?>/gi, '\n');
	md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
		const clean = t.replace(/<[^>]+>/g, '').trim();
		if (!clean) return '';
		if (!href || /^javascript:/i.test(href)) return clean;
		return `[${clean}](${href})`;
	});
	md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
	md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
	md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
	md = md.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, '$1 | ');
	md = md.replace(/<[^>]+>/g, '');
	return normalizeText(decodeEntities(md));
}

/** HTML → 纯文本（保留换行，不保留任何标记） */
export function htmlToText(html: string): string {
	let text = html;
	text = text.replace(/<!--[\s\S]*?-->/g, '');
	text = text.replace(DROP_BLOCK, '');
	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n');
	text = text.replace(/<[^>]+>/g, '');
	return normalizeText(decodeEntities(text));
}

/** 统一空白：去掉行内多余空格、压缩空行、行首尾 trim */
export function normalizeText(input: string): string {
	return input
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t\u00a0\u3000]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** 从 HTML 里抠出 <title> */
export function extractTitle(html: string): string {
	const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return m ? normalizeText(decodeEntities(m[1])).slice(0, 200) : '';
}

// #endregion
