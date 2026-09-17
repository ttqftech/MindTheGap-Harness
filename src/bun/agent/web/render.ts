/* ==========================================================================
   浏览器渲染桥 — MindTheGap-Harness（web 工具层）

   Agent Service 跑在 Cottontail（JSC）里：没有 DOM，也起不了 Playwright。
   「必须执行 JS 才有正文」的页面（SPA / 懒加载 / 反爬壳）只能交给
   Node 子进程里的 scripts/web-render.mjs 去渲染。

   设计要点：
   - **一次调用渲染多个 URL**：启动浏览器是主要开销（约 1~3s），逐 URL 起进程
     会把「展开 3 篇正文」从 5 秒拖到 20 秒。这里一次 fork、进程内并发多页。
   - **不假设 node 在 PATH 的哪个位置**：按 候选列表 逐个试，把「找不到可执行文件」
     这种环境问题变成一条可读的错误，而不是一个 ENOENT 栈。
   - **失败不抛异常**：返回 per-URL 的 {ok:false,error}，让上层（web_fetch / web_search）
     自己决定降级策略 —— 搜索时某一篇打不开不该让整次搜索失败。
   ========================================================================== */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { resolveRepoFile } from '../../plugins/loader';

// #region 位置解析

/** 渲染脚本相对仓库根的位置（先找到存在的那个） */
const RENDER_SCRIPT_RELPATHS = ['scripts/web-render.mjs'];

let cachedScript: string | null | undefined;

/** scripts/web-render.mjs 的绝对路径；找不到返回 null */
export function resolveRenderScript(): string | null {
	if (cachedScript !== undefined) return cachedScript;
	const fromEnv = process.env.MTG_WEB_RENDER_SCRIPT;
	if (fromEnv && existsSync(fromEnv)) {
		cachedScript = fromEnv;
		return cachedScript;
	}
	for (const rel of RENDER_SCRIPT_RELPATHS) {
		const found = resolveRepoFile(rel);
		if (found) {
			cachedScript = found;
			return cachedScript;
		}
	}
	cachedScript = null;
	return cachedScript;
}

/** 清缓存（测试 / 换了工作目录时用） */
export function clearRenderPathCache(): void {
	cachedScript = undefined;
	cachedNodeBin = undefined;
}

function basename(p: string): string {
	const parts = p.split(/[\\/]/);
	return parts[parts.length - 1] ?? p;
}

/** 候选 node 可执行文件（按优先级） */
function nodeBinCandidates(): string[] {
	const out: string[] = [];
	const fromEnv = process.env.MTG_NODE_BIN;
	if (fromEnv) out.push(fromEnv);

	// Cottontail 自己的 execPath 是 cottontail.exe，不是 node —— 必须排除
	const execPath = typeof process.execPath === 'string' ? process.execPath : '';
	if (/^node(\.exe)?$/i.test(basename(execPath))) out.push(execPath);

	out.push('node');
	out.push('node.exe');

	// Windows 上再补几个常见安装位置，PATH 不干净时仍能跑起来
	if (process.platform === 'win32') {
		const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
		const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
		out.push(join(programFiles, 'nodejs', 'node.exe'));
		out.push(join(programFilesX86, 'nodejs', 'node.exe'));
		const localAppData = process.env['LOCALAPPDATA'];
		if (localAppData) out.push(join(localAppData, 'Programs', 'nodejs', 'node.exe'));
	}

	return Array.from(new Set(out.filter(Boolean)));
}

let cachedNodeBin: string | undefined;

/** 第一个「真的能执行」的 node；全部失败返回 null */
export function resolveNodeBin(): string | null {
	if (cachedNodeBin) return cachedNodeBin;
	for (const cand of nodeBinCandidates()) {
		try {
			// 探活：能打印版本即视为可用（比 existsSync 可靠：PATH 里的名字没有绝对路径）
			execFileSync(cand, ['-v'], { encoding: 'utf-8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
			cachedNodeBin = cand;
			return cand;
		} catch {
			/* 试下一个 */
		}
	}
	return null;
}

/** 给错误信息用的环境摘要（诊断「渲染为什么起不来」） */
export function renderEnvironmentHint(): string {
	const script = resolveRenderScript();
	const node = resolveNodeBin();
	if (!script) return `找不到渲染脚本 scripts/web-render.mjs（cwd=${process.cwd()}）。`;
	if (!node) return `找不到可执行的 node（PATH=${(process.env.PATH ?? '').split(delimiter).slice(0, 4).join(';')}…）。`;
	return 'ok';
}

// #endregion

// #region 调用

export type RenderFormat = 'markdown' | 'text' | 'html';

export interface RenderOptions {
	format?: RenderFormat;
	/** 网络空闲后额外等待（ms），慢渲染页面用 */
	waitMs?: number;
	/** 等待该 CSS 选择器出现后再取正文 */
	selector?: string;
	/** 单页超时（ms），默认 25000 */
	timeoutMs?: number;
	/** 并发页数，默认 3 */
	concurrency?: number;
	/** 浏览器：chromium（默认，内置）/ msedge / chrome */
	browser?: string;
}

export interface RenderedPage {
	url: string;
	ok: boolean;
	status?: number;
	finalUrl?: string;
	title?: string;
	content?: string;
	chars?: number;
	error?: string;
}

/**
 * 用无头浏览器渲染一批 URL。
 * 永不抛异常：脚本缺失 / node 缺失 / 超时都变成 per-URL 的 error。
 */
export function renderUrlsViaBrowser(urls: string[], opts: RenderOptions = {}): RenderedPage[] {
	const list = urls.filter(Boolean);
	if (list.length === 0) return [];

	const script = resolveRenderScript();
	if (!script) {
		return list.map((url) => ({ url, ok: false, error: '环境不具备浏览器渲染能力：找不到 scripts/web-render.mjs' }));
	}
	const node = resolveNodeBin();
	if (!node) {
		return list.map((url) => ({ url, ok: false, error: '环境不具备浏览器渲染能力：找不到 node 可执行文件' }));
	}

	const format: RenderFormat = opts.format ?? 'markdown';
	const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, list.length));
	const perPage = opts.timeoutMs ?? 25000;
	const args = [
		script,
		'--format', format,
		'--concurrency', String(concurrency),
		'--timeout', String(perPage),
	];
	if (opts.waitMs && opts.waitMs > 0) args.push('--wait', String(opts.waitMs));
	if (opts.selector) args.push('--selector', opts.selector);
	if (opts.browser) args.push('--browser', opts.browser);
	args.push(...list);

	// 总超时 = 每页超时 × 轮次 + 启动浏览器余量
	const totalTimeout = perPage * Math.ceil(list.length / concurrency) + 20000;

	try {
		const out = execFileSync(node, args, {
			encoding: 'utf-8',
			timeout: totalTimeout,
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
		const parsed = JSON.parse(line) as { results?: RenderedPage[]; error?: string };
		if (!parsed.results || parsed.results.length === 0) {
			return list.map((url) => ({ url, ok: false, error: parsed.error ?? '渲染进程没有返回结果' }));
		}
		// 顺序对齐（脚本按入参顺序回填，这里再兜一层）
		return list.map((url) => parsed.results!.find((r) => r.url === url) ?? { url, ok: false, error: '渲染进程未返回该 URL' });
	} catch (err) {
		const e = err as Error & { stderr?: Buffer | string; killed?: boolean };
		const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString?.() ?? '';
		const reason = e.killed
			? `渲染超时（${totalTimeout}ms）`
			: stderr.trim().split('\n').slice(-3).join(' | ') || e.message;
		return list.map((url) => ({ url, ok: false, error: `浏览器渲染失败：${reason}` }));
	}
}

// #endregion
