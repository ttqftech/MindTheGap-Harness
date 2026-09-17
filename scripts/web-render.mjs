/* ==========================================================================
   web-render.mjs — 批量无头浏览器渲染器（供 Agent Service 的 web_fetch / web_search 调用）

   为什么要独立进程：
   Agent Service 跑在 Cottontail（JSC）里，没有 DOM / 无法直接跑 Playwright。
   所以「需要执行 JS 才能拿到正文」的页面交给这个 Node 脚本处理。

   为什么要支持多个 URL：
   启动一次浏览器约 1~3 秒，占整体耗时的绝大部分。搜索一次要展开好几篇正文，
   逐个 URL 起一个进程会把 5 秒拖成 30 秒。这里一次启动、多页复用、输出 JSON。

   用法：
     node scripts/web-render.mjs [选项] <url> [url...]
   选项：
     --format markdown|text|html   正文 extraction 方式（默认 markdown）
     --wait <ms>                   网络空闲后额外等待（默认 0）
     --selector <css>              等待该选择器出现后再取正文
     --timeout <ms>                单页超时（默认 25000）
     --browser <name|path>         chromium（默认，内置）/ msedge / chrome
     --concurrency <n>             并发页数（默认 3）

   输出（stdout，单行 JSON）：
     {"results":[{"url":"...","ok":true,"title":"...","finalUrl":"...","content":"...","chars":123}]}
   失败项：{"url":"...","ok":false,"error":"..."}
   ========================================================================== */

import { chromium } from 'playwright';

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
	process.stdout.write(
		[
			'Usage: node scripts/web-render.mjs [options] <url> [url...]',
			'  --format markdown|text|html   (default markdown)',
			'  --wait <ms>                   extra wait after load (default 0)',
			'  --selector <css>              wait for selector before extracting',
			'  --timeout <ms>                per-page timeout (default 25000)',
			'  --browser <name>              chromium|msedge|chrome (default chromium)',
			'  --concurrency <n>             parallel pages (default 3)',
		].join('\n') + '\n',
	);
	process.exit(0);
}

function takeFlag(name, fallback) {
	const i = argv.indexOf(name);
	if (i === -1 || i + 1 >= argv.length) return fallback;
	const v = argv[i + 1];
	argv.splice(i, 2);
	return v;
}

const format = takeFlag('--format', 'markdown');
const extraWait = parseInt(takeFlag('--wait', '0'), 10) || 0;
const selector = takeFlag('--selector', null);
const timeout = parseInt(takeFlag('--timeout', '25000'), 10) || 25000;
const browserName = takeFlag('--browser', 'chromium');
const concurrency = Math.max(1, parseInt(takeFlag('--concurrency', '3'), 10) || 3);

const urls = argv.filter((a) => !a.startsWith('--'));
if (urls.length === 0) {
	process.stdout.write(JSON.stringify({ results: [], error: '没有传入 URL' }) + '\n');
	process.exit(1);
}

/* ---------- HTML → Markdown（零依赖，够用即可；真正的正文由浏览器渲染后拿到） ---------- */

function decodeEntities(s) {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&ensp;/g, ' ')
		.replace(/&emsp;/g, ' ')
		.replace(/&#(\d+);/g, (_m, d) => {
			const n = parseInt(d, 10);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
		})
		.replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
			const n = parseInt(h, 16);
			return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
		})
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

function htmlToMarkdown(html) {
	let md = html;
	md = md.replace(/<!--[\s\S]*?-->/g, '');
	md = md.replace(/<(script|style|noscript|svg|iframe|head)[\s\S]*?<\/\1>/gi, '');
	md = md.replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, '');
	md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lv, t) => `\n\n${'#'.repeat(Number(lv))} ${t}\n\n`);
	md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${t}`);
	md = md.replace(/<\/(p|div|section|article|tr|ul|ol|blockquote|table|h[1-6])>/gi, '\n\n');
	md = md.replace(/<br\s*\/?>/gi, '\n');
	md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
		const clean = String(t).replace(/<[^>]+>/g, '').trim();
		if (!clean) return '';
		if (!href || href.startsWith('javascript:')) return clean;
		return `[${clean}](${href})`;
	});
	md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
	md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
	md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
	md = md.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '$1 | ');
	md = md.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, '$1 | ');
	md = md.replace(/<[^>]+>/g, '');
	md = decodeEntities(md);
	md = md.replace(/[ \t\u00a0]+/g, ' ');
	md = md.replace(/ *\n */g, '\n');
	md = md.replace(/\n{3,}/g, '\n\n');
	return md.trim();
}

/* ---------- 渲染 ---------- */

/** 图片 / 媒体 / 字体对「正文」毫无贡献，却占掉大部分加载时间，直接拦掉 */
const BLOCKED_RESOURCE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|mp4|webm|ogg|mp3|wav|woff2?|ttf|otf|eot)(\?|$)/i;

async function renderOne(context, url, index) {
	const page = await context.newPage();
	try {
		await page.route('**/*', (route) => {
			const type = route.request().resourceType();
			const href = route.request().url();
			if (type === 'image' || type === 'media' || type === 'font') return route.abort().catch(() => {});
			if (BLOCKED_RESOURCE.test(href)) return route.abort().catch(() => {});
			return route.continue().catch(() => {});
		});

		const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
		if (selector) {
			try {
				await page.waitForSelector(selector, { timeout });
			} catch {
				/* 选择器等不到不致命，继续取当前 DOM */
			}
		}
		// 再等一次「基本安静」，SPA 的正文通常在这时挂上去
		try {
			await page.waitForLoadState('networkidle', { timeout: Math.min(6000, timeout) });
		} catch {
			/* 有些页面永远不 idle，忽略 */
		}
		if (extraWait > 0) await page.waitForTimeout(extraWait);

		const title = await page.title().catch(() => '');
		let content;
		if (format === 'text') {
			content = await page.evaluate(() => document.body?.innerText ?? '');
		} else if (format === 'html') {
			content = await page.content();
		} else {
			const html = await page.content();
			content = htmlToMarkdown(html);
		}

		return {
			url,
			ok: true,
			status: resp?.status?.() ?? 200,
			finalUrl: page.url(),
			title,
			chars: content.length,
			content,
		};
	} catch (err) {
		return { url, ok: false, error: err?.message ?? String(err) };
	} finally {
		await page.close().catch(() => {});
	}
}

async function main() {
	let browser;
	try {
		browser = await chromium.launch({ headless: true, channel: browserName === 'chromium' ? undefined : browserName });
	} catch (err) {
		// channel 指定失败（比如没装 Edge）时退回内置 chromium，别让整个工具挂掉
		browser = await chromium.launch({ headless: true });
	}

	const context = await browser.newContext({
		viewport: { width: 1366, height: 900 },
		locale: 'zh-CN',
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
	});

	const results = new Array(urls.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async (_, w) => {
		while (true) {
			const i = cursor++;
			if (i >= urls.length) return;
			results[i] = await renderOne(context, urls[i], i);
			void w;
		}
	});
	await Promise.all(workers);
	await browser.close().catch(() => {});

	process.stdout.write(JSON.stringify({ results }) + '\n');
}

main().catch((err) => {
	process.stdout.write(JSON.stringify({ results: [], error: err?.message ?? String(err) }) + '\n');
	process.exit(1);
});
