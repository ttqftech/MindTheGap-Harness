/**
 * SVG → Solid 组件 插件。
 *
 * 用法：
 *   import MTGlong from "./MTG-long.svg";   // 默认导入
 *   <MTGlong class={styles.appMark} />
 *
 * 原理：把 `.svg` 导入解析成一个虚拟 `.tsx` 模块（里面是真实 Solid JSX），
 * 交给 vite-plugin-solid 编译 —— 与项目里其它 JSX 走同一条运行时路径
 * （classic dom 运行时：template / delegateEvents / createComponent，全部由 solid-js/web 提供）。
 * 这样产出的组件在 dev 与 build 里都和手写 `.tsx` 完全一致，不用额外依赖。
 *
 * 细节：
 * - `?raw` / `?url` / `?inline` 等带查询串的导入不接管，走 Vite 原生资产管线（分别给字符串 / URL）。
 * - 虚拟 id 用 `virtual/svg-component/<hash>.tsx`（纯 hash，不含路径）而不是 `\0` 前缀或路径型 id：
 *     * `\0` 前缀会被 vite-plugin-solid 的 createFilter 过滤掉，导致 JSX 不编译；
 *     * 路径型 id 会把 Windows 绝对路径（含 `I:`）带进 id，而 `:` 在 URL 里会被编码成 `%3A`，
 *       load 拿到的是编码后的 id、还原不回真实文件；
 *     * 路径型 id 还会因含 `.svg` 触发 Vite 6 的 svgRE 权限检查（ERR_DENIED_ID）。
 *   纯 hash id 以上问题全没有，hash → 真实路径的映射存在模块级 Map 里。
 * - 已解析过的虚拟 id 在二次解析时原样返回：浏览器请求 `/@id/...` 时 Vite 内部会再 resolveId 一次
 *   且**不带 importer**，若不特殊处理会被 `!importer` 守卫放掉。
 * - SVG 内部的 `id` 会按文件路径加一个短 hash 前缀，并同步改写 `url(#...)` / `href="#..."` 引用，
 *   避免同一份 SVG 在页面上出现多次时渐变 / 裁剪互相打架。
 * - `xlink:href` 一并转成 `href`：HTML 经 innerHTML 解析 SVG 时 `href` 更稳。
 * - dev 下把真实文件路径登记成 watchFiles，改 SVG 不刷新页面也能热更。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface SvgComponentPluginOptions {
	/** 需要当作组件导入的扩展名。默认 `['.svg']` */
	include?: string[];
}

/** FNV-1a 的 16 进制截断：足够短，又能让不同文件的内部 id 区分开。 */
function hashPath(p: string): string {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < p.length; i++) {
		h ^= p.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return (h >>> 0).toString(16).slice(0, 6);
}

/** 从文件路径得到合法的 JS 组件名：`MTG-long.svg` → `MTGlong` */
function componentNameFromPath(p: string): string {
	const base = path.basename(p, path.extname(p));
	const name = base.replace(/[^A-Za-z0-9]/g, '');
	return name || 'Svg';
}

/** 给 SVG 内部 id 加前缀，并同步改写引用；xlink:href → href。 */
function transformSvg(raw: string, prefix: string): string {
	let out = raw;
	// 给每个内部 id 加前缀，避免同一份 SVG 在页面上出现多次时 url(#id) 互相打架。
	// 注意必须保留 id 前面的空白：原 SVG 是 `<svg id="..."`，只匹配 `id=` 而不带回车/空格的话，
	// 替换完会变成 `<svgid="..."` —— 标签名和属性粘在一起，整个 SVG 解析失败、页面上什么都不渲染。
	out = out.replace(/(\s+)id="([^"]*)"/g, (_m, ws, id) => `${ws}id="${prefix}_${id}"`);
	// 同步改写所有引用，且只遍历一次：
	// url(#x) / xlink:href="#x" / href="#x" 三种形式一起处理，并把 xlink:href 直接转成 href。
	// 注意不能分两次 replace —— 先转 xlink:href→href 之后，第二个 href 正则会把成果再匹配一次，
	// 引用就被双重前缀（指向不存在的 id，渐变继承会断）。
	out = out.replace(
		/\burl\((['"]?)#([^)"']+)\1\)|(?:xlink:)?href="#([^"]*)"/g,
		(match, quote, urlRef, hrefRef) => {
			if (urlRef !== undefined) return `url(${quote}#${prefix}_${urlRef}${quote})`;
			if (hrefRef.startsWith(prefix + '_')) return match; // 已前缀过的，防御性跳过
			return `href="#${prefix}_${hrefRef}"`;
		},
	);
	return out;
}

const VIRTUAL_PREFIX = 'virtual/svg-component/';
const VIRTUAL_SUFFIX = '.tsx';

// 模块级映射：hash → 真实文件路径。插件实例 per-server，所以不同 dev/build 互不污染。
// 用 hash 而不是把路径塞进 id，是为了避免 Windows 路径里的 `:` 在 URL 里被编码成 `%3A`。
const pathByHash = new Map<string, string>();

export function svgComponentPlugin(options: SvgComponentPluginOptions = {}): Plugin {
	const exts = options.include ?? ['.svg'];
	return {
		name: 'solid-svg-component',
		// 必须 pre：vite:asset（核心）会按扩展名把 .svg 当 URL 资产发出去，
		// 排在它前面才能抢到导入权。
		enforce: 'pre',
		resolveId(source, importer) {
			// 已经解析过的虚拟 id：浏览器拿到 /@id/... 后端点请求时，Vite 会再解析一次且不带 importer。
			// 这里直接原样返回，让 load 接手 —— 否则下面 `!importer` 守卫会把它当成「未知导入」放掉，
			// 模块就退化成 index.html 兜底（dev 下 <MTGlong /> 渲染不出来，build 不受影响）。
			if (source.startsWith(VIRTUAL_PREFIX)) return source;
			if (!importer || !exts.some((e) => source.endsWith(e))) return null;
			// 带查询串的导入（?raw / ?url / ?inline）交给 Vite 原生资产管线
			if (source.includes('?')) return null;
			const real = path.resolve(path.dirname(importer), source);
			const hash = hashPath(real);
			pathByHash.set(hash, real);
			return `${VIRTUAL_PREFIX}${hash}${VIRTUAL_SUFFIX}`;
		},
		load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const hash = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
			const realPath = pathByHash.get(hash);
			if (!realPath) return null;
			const raw = readFileSync(realPath, 'utf-8');
			const name = componentNameFromPath(realPath);
			const prefix = `${name}_${hashPath(realPath)}`;
			const svg = transformSvg(raw, prefix);
			// 故意不写 TypeScript 类型注解：虚拟模块只走 esbuild 剥 TS + solid 编译 JSX，
			// 写 `import type` 反而多一层依赖。
			const code =
				`const svg = ${JSON.stringify(svg)};\n` +
				`const ${name} = (props) => <span {...props} innerHTML={svg} />;\n` +
				`export default ${name};\n`;
			return { code, map: null, watchFiles: [realPath] };
		},
	};
}