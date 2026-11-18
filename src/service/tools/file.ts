/**
 * 内置工具 —— 文件操作
 * 路径解析 / 文件探测 / 编码 / 行尾 / 写闸门只服务这一组工具，留在本文件内。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, openSync, readSync, closeSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { deleteFileSafely } from '../safety';
import { utf8LooksValid } from '../textEncoding';
import { registerTool } from './registry';

// #region 路径安全

function resolvePath(inputPath: string, runningDir: string): string {
	// 相对路径 → 基于 runningDir（用户工作目录，没指定时是会话的临时工作空间）
	const base = isAbsolute(inputPath) ? inputPath : join(runningDir, inputPath);
	// 沙箱已禁用：不做穿越检查（Harness 无沙箱 / 无权限 / 无还原机制，风险靠提示词约束）
	return resolve(base);
}

const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.hutch', 'artifacts', '.cottontail-tmp', '.workbuddy']);
const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const SEARCH_MAX_RESULTS = 50;

// #endregion

// #region 文件探测（file_read 用）

/**
 * 为什么需要探测：
 * - UTF-8 解码器**从不报错**，非法字节一律变 U+FFFD。用文本模式读二进制不会失败，只会返回一整片替换字符（1MB 图片 ≈ 100 万字符）。
 */

const SNIFF_BYTES = 8 * 1000;	// 探测用采样长度（只读文件头，不整份加载）
const TEXT_MAX_FILE_BYTES = 8 * 1000 * 1000;	// 文本单次读取的总字节上限：超过就直接拒绝（读 200 行不值得为 1GB 文件分配内存）
const TEXT_DEFAULT_LIMIT = 200;	// 文本单次读取的默认行数上限
const TEXT_MAX_LIMIT = 2000;	// 文本单次读取的最大行数上限
const TEXT_MAX_LINE_CHARS = 500;	// 单行字符上限：minified js / 一行 2MB 的 json，只限行数是挡不住的
const TEXT_MAX_RETURN_CHARS = 100 * 1000;	// 单次返回的总字符上限（防止 2000 行 × 500 字符）
const BIN_DEFAULT_LIMIT = 256;
const BIN_MAX_LIMIT = 4096;
const BIN_PROBE_BYTES = 64;	// 二进制文件探测时头尾各探多少字节
const BIN_SMALL_FILE = 512;	// 二进制文件小于这个大小就直接整份 dump（头尾会重叠）

type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1';

type SniffResult =
	| { kind: 'binary'; type: string; detected: string }
	| { kind: 'text'; encoding: TextEncoding; detected: string; bom: boolean };

/** 定位读一段字节（二进制模式绝不整份 readFileSync：读 200MB 图片的第 0x1000 字节不该载入整个文件） */
function readRange(path: string, offset: number, length: number, fileSize: number): Buffer {
	if (length <= 0) return Buffer.alloc(0);
	try {
		const fd = openSync(path, 'r');
		try {
			const buf = Buffer.alloc(length);
			let done = 0;
			while (done < length) {
				const n = readSync(fd, buf, done, length - done, offset + done);
				if (n <= 0) break;
				done += n;
			}
			return done === length ? buf : buf.subarray(0, done);
		} finally {
			closeSync(fd);
		}
	} catch (err) {
		// 运行时不支持 fd 定位读时的兜底：小文件整份读再切
		if (fileSize > TEXT_MAX_FILE_BYTES) throw err;
		return readFileSync(path).subarray(offset, offset + length);
	}
}

/**
 * 写回前的语法体检。
 *
 * 行替换（`file_edit`）最容易出的错是「改完少了半个括号/引号」——文件一坏，整个项目的测试全挂，而模型要花好几轮才意识到是自己刚刚那次编辑造成的。
 * 这里在落盘之前先体检一遍，语法坏了就**不写**并返回错误，磁盘上的文件保持原样。一次 `node --check` 远比一轮 LLM 便宜。
 */
function syntaxCheck(path: string, content: string): { ok: true } | { ok: false; message: string } {
	const ext = extname(path).toLowerCase();
	if (ext === '.json') {
		try {
			JSON.parse(content);
			return { ok: true };
		} catch (e) {
			return { ok: false, message: `JSON 解析失败：${(e as Error).message}` };
		}
	}
	// 只拦 node 自己能静态检查的扩展名；TS/TSX 不是 JS 的子集，跳过
	if (!['.js', '.mjs', '.cjs'].includes(ext)) return { ok: true };

	const tmp = join(tmpdir(), `mtg-syntax-${randomUUID()}${ext}`);
	try {
		writeFileSync(tmp, content, 'utf-8');
		const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf-8', timeout: 10_000, windowsHide: true });
		if (res.status === 0) return { ok: true };
		const raw = String(res.stderr || '');
		const lines = raw.split('\n').filter(Boolean);
		// node --check 的报错是「文件名:行号 / 源码行 / 脱字符 / SyntaxError: … / 堆栈」。
		// 只取前面那半截——堆栈全是 node 内部帧，占了行数会把真正有用的源码行挤出去。
		const errAt = lines.findIndex((l) => /^\s*(Syntax)?Error\b/.test(l));
		const frame = (errAt >= 0 ? lines.slice(Math.max(0, errAt - 3), errAt + 1) : lines.slice(0, 4)).join('\n');
		const line = raw.match(/:(\d+)\s*$/m)?.[1] ?? raw.match(/:(\d+)\n/)?.[1];
		// 把出事那几行的内容一起给回去：否则模型为了看清自己刚刚写了什么，会先浪费一轮重新读文件。
		const around = line ? content.split('\n').slice(Math.max(0, Number(line) - 3), Number(line) + 1).map((l, i) => ` ${Math.max(1, Number(line) - 2) + i}| ${l}`).join('\n') : '';
		return {
			ok: false,
			message: `会让 ${path} 语法错误${line ? `（第 ${line} 行附近）` : ''}：\n${frame}${around ? `\n写入后那段长这样：\n${around}` : ''}`,
		};
	} catch {
		return { ok: true }; // 体检本身失败时不阻塞写入
	} finally {
		try {
			rmSync(tmp, { force: true });
		} catch {}
	}
}

/**
 * 判定顺序：魔数 > BOM > NUL（含无 BOM 的 UTF-16 启发式）> 严格 UTF-8 > 控制字符比例 > latin1 兜底。
 * latin1 兜底是给 GBK 这类「非 UTF-8 但仍是文本」的文件留的路，不然中文用户会看到「二进制」。
 */
function sniffBuffer(head: Buffer, size: number): SniffResult {

	// 通过文件头的魔数判断文件类型
	function matchMagic(head: Buffer): string | null {
		/** 魔数表：命中即判定二进制并给出类型名。短的放后面（"BM"/"MZ" 只有 2 字节，容易误判） */
		const MAGIC_NUMBERS: Array<{ type: string; bytes: number[] }> = [
			{ type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
			{ type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
			{ type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
			{ type: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] },
			{ type: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
			{ type: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
			{ type: 'gzip', bytes: [0x1f, 0x8b] },
			{ type: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
			{ type: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
			{ type: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },
			{ type: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
			{ type: 'glb', bytes: [0x67, 0x6c, 0x54, 0x46] },
			{ type: 'bmp', bytes: [0x42, 0x4d] },
			{ type: 'pe', bytes: [0x4d, 0x5a] },
		];
		for (const m of MAGIC_NUMBERS) {
			if (head.length < m.bytes.length) continue;
			if (m.bytes.every((b, i) => head[i] === b)) return m.type;
		}
		return null;
	}

	/** 无 BOM 的 UTF-16：ASCII 字符的高位字节是 0，据此判断零字节集中在奇位还是偶位 */
	function guessUtf16WithoutBom(buf: Buffer): 'utf-16le' | 'utf-16be' | null {
		const n = Math.min(buf.length, 512) & ~1;
		if (n < 8) return null;
		let evenZeros = 0;
		let oddZeros = 0;
		for (let i = 0; i < n; i += 2) {
			if (buf[i] === 0) evenZeros++;
			if (buf[i + 1] === 0) oddZeros++;
		}
		const pairs = n / 2;
		if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.1) return 'utf-16le';
		if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.1) return 'utf-16be';
		return null;
	}

	/** 计算控制字符（排除 \t \n \r \x1b、DEL）的占比：高就判断为二进制 */
	function controlRatio(buf: Buffer): number {
		if (!buf.length) return 0;
		let n = 0;
		for (let i = 0; i < buf.length; i++) {
			const b = buf[i];
			if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x1b) n++;
			else if (b === 0x7f) n++;
		}
		return n / buf.length;
	}

	if (size === 0) return { kind: 'text', encoding: 'utf-8', detected: 'empty', bom: false };

	const magic = matchMagic(head);
	if (magic) return { kind: 'binary', type: magic, detected: `magic:${magic}` };

	if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
		return { kind: 'text', encoding: 'utf-8', detected: 'bom:utf-8', bom: true };
	}
	if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
		return { kind: 'text', encoding: 'utf-16le', detected: 'bom:utf-16le', bom: true };
	}
	if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) {
		return { kind: 'text', encoding: 'utf-16be', detected: 'bom:utf-16be', bom: true };
	}

	let hasNul = false;
	for (let i = 0; i < head.length; i++) if (head[i] === 0) { hasNul = true; break; }
	if (hasNul) {
		const u16 = guessUtf16WithoutBom(head);
		if (u16) return { kind: 'text', encoding: u16, detected: `${u16}:no-bom`, bom: false };
		return { kind: 'binary', type: 'unknown', detected: 'nul-bytes' };
	}

	if (utf8LooksValid(head)) return { kind: 'text', encoding: 'utf-8', detected: 'utf8', bom: false };

	if (controlRatio(head) > 0.1) return { kind: 'binary', type: 'unknown', detected: 'control-chars' };

	return { kind: 'text', encoding: 'latin1', detected: 'non-utf8', bom: false };
}

/** 文本 → 字节。写回一律用文件原本的编码与 BOM，别把 UTF-16 / 带 BOM 的文件悄悄改写成 UTF-8 */
function encodeBuffer(text: string, encoding: TextEncoding, bom: boolean): Buffer {
	if (encoding === 'utf-8') return Buffer.from(bom ? `\uFEFF${text}` : text, 'utf8');
	if (encoding === 'latin1') {
		const bytes = Buffer.alloc(text.length);
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code > 0xff) {
				const err = new Error(
					`目标文件按 latin1（非 UTF-8/UTF-16，可能是 GBK）读写，写回内容里第 ${i + 1} 个字符「${text[i]}」无法表示。请改用脚本按目标编码写入`,
				) as Error & { code?: string };
				err.code = 'ENCODING_UNSUPPORTED';
				throw err;
			}
			bytes[i] = code;
		}
		return bytes;
	}
	// utf-16le / utf-16be：逐码元写（代理对是两个码元，保持相邻即正确）
	const units: number[] = bom ? [0xfeff] : [];
	for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
	const bytes = Buffer.alloc(units.length * 2);
	for (let i = 0; i < units.length; i++) {
		const u = units[i];
		if (encoding === 'utf-16le') {
			bytes[i * 2] = u & 0xff;
			bytes[i * 2 + 1] = (u >> 8) & 0xff;
		} else {
			bytes[i * 2] = (u >> 8) & 0xff;
			bytes[i * 2 + 1] = u & 0xff;
		}
	}
	return bytes;
}

type Eol = '\n' | '\r\n';

/**
 * 按 `\n` 切行，但**保留每行自己的行尾**（`'\r\n'` / `'\n'` / `''`）。
 * 这样编辑时未改动的行写回后字节完全不变（混合行尾也不会被整份改写），
 * 同时也去掉了 `split('\n')` 在「文件以 \n 结尾」时凭空多出来的那个空行。
 */
function splitLines(text: string): Array<{ body: string; eol: string }> {
	const out: Array<{ body: string; eol: string }> = [];
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '\n') continue;
		if (i > start && text[i - 1] === '\r') out.push({ body: text.slice(start, i - 1), eol: '\r\n' });
		else out.push({ body: text.slice(start, i), eol: '\n' });
		start = i + 1;
	}
	if (start < text.length) out.push({ body: text.slice(start), eol: '' });
	return out;
}

/** 判断主行尾：CRLF 不少于 LF 且至少一个 CRLF → CRLF，否则 LF（无行尾的单行文件按 LF） */
function dominantEol(parts: Array<{ eol: string }>): Eol {
	let crlf = 0;
	let lf = 0;
	for (const p of parts) {
		if (p.eol === '\r\n') crlf++;
		else if (p.eol === '\n') lf++;
	}
	return crlf > 0 && crlf >= lf ? '\r\n' : '\n';
}

/** 把任意行尾统一成目标行尾（整份覆盖写时用，避免把 CRLF 文件整体改成 LF） */
function applyEol(text: string, eol: Eol): string {
	const normalized = text.replace(/\r\n/g, '\n');
	return eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

type WriteGuard =
	| { ok: true; exists: boolean; encoding: TextEncoding; bom: boolean; eol: Eol }
	| { ok: false; kind: 'directory' | 'binary'; message: string };

/**
 * 写操作前的闸门：**二进制文件一律拒写**。
 * 文本写入把一张图毁掉是静默的（解码成 latin1 再编码回去，字节全变），而这种损坏既不可逆也看不出原因，所以宁可让工具直接失败。
 * 新文件（不存在）放行。`file_write` 的 `force: true` 可越过二进制这一条（会先备份）。
 */
function guardWritableFile(path: string): WriteGuard {
	if (!existsSync(path)) return { ok: true, exists: false, encoding: 'utf-8', bom: false, eol: '\n' };
	const st = statSync(path);
	if (st.isDirectory()) return { ok: false, kind: 'directory', message: `"${path}" 是目录，不是文件` };
	const size = st.size;
	const head = readRange(path, 0, Math.min(SNIFF_BYTES, size), size);
	const sniff = sniffBuffer(head, size);
	if (sniff.kind === 'binary') {
		return {
			ok: false,
			kind: 'binary',
			message:
				`"${path}" 是二进制文件（${sniff.type}，${formatBytes(size)}，detected=${sniff.detected}），不应用文本方式写入。` +
				'确实要拿文本盖掉它，用 file_write 并传 force=true（会把原文件备份成 .bak）。若需特殊操作请自行写脚本执行。',
		};
	}
	// 行尾按文件头采样判断（头部 8KB 足够代表整个文件；真要判错也只影响整份覆盖写）
	const eol = dominantEol(splitLines(decodeBuffer(head, sniff.encoding)));
	return { ok: true, exists: true, encoding: sniff.encoding, bom: sniff.bom, eol };
}

/** 按探测结果解码。UTF-8 交给运行时的 TextDecoder；UTF-16/GBK 手工拼码元（不依赖编码器支持） */
function decodeBuffer(raw: Buffer, encoding: TextEncoding): string {
	if (encoding === 'utf-8') {
		const text = new TextDecoder('utf-8').decode(raw);
		return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	}
	if (encoding === 'latin1') {
		const parts: string[] = [];
		for (let i = 0; i < raw.length; i += 4096) {
			const slice: number[] = [];
			for (let k = i; k < Math.min(i + 4096, raw.length); k++) slice.push(raw[k]);
			parts.push(String.fromCharCode.apply(null, slice));
		}
		return parts.join('');
	}
	// utf-16le / utf-16be：先按小端取出码元，big-endian 交换高低字节
	const start = raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) ? 2 : 0;
	const units: number[] = [];
	for (let i = start; i + 1 < raw.length; i += 2) {
		units.push(encoding === 'utf-16le' ? raw[i] | (raw[i + 1] << 8) : (raw[i] << 8) | raw[i + 1]);
	}
	const parts: string[] = [];
	for (let i = 0; i < units.length; i += 4096) parts.push(String.fromCharCode.apply(null, units.slice(i, i + 4096)));
	return parts.join('');
}

function formatBytes(n: number): string {
	if (n < 1000) return `${n} B`;
	if (n < 1000 * 1000) return `${(n / 1000).toFixed(1)} KB`;
	return `${(n / 1000 / 1000).toFixed(1)} MB`;
}

// #endregion

// #region 内置工具 —— 文件操作

// --- 只读 ---

registerTool({
	name: 'file_read',
	access: 'read',
	description:
		'读取文件内容，自动识别文本/二进制与编码。',
		// `文本模式：按行返回，**恒带行号与总行数**，默认 ${TEXT_DEFAULT_LIMIT} 行（上限 ${TEXT_MAX_LIMIT}），超长行会截断，末尾提示下一段 offset；二进制模式：不输出内容，只给类型/大小/hexdump（默认头尾各 ${BIN_PROBE_BYTES} 字节，用 offset+limit 可指定字节区间，单次上限 ${BIN_MAX_LIMIT} 字节）。` +
		// '二进制分析（修图片、提取嵌入数据、逆向格式）请自己写脚本用 shell 执行，不要逐段硬读字节。' +
		// '不确定内容在哪个文件时先用 file_search 或 file_list 定位。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			offset: {
				type: 'integer',
				description: '文本模式：起始行号（从 1 开始）；二进制模式：起始字节偏移（从 0 开始）。省略则从头读',
			},
			limit: {
				type: 'integer',
				description: `文本模式：行数；二进制模式：字节数`,
			},
			mode: {
				type: 'string',
				enum: ['auto', 'text', 'binary'],
				description: '推荐不填以自动判断。仅当自动判断明显不对时手动指定',
			},
		},
		required: ['path'],
	},
	async execute(args, ctx) {

	/** 16 字节一行的 hexdump，带 ASCII 旁列（旁列是把「可读字符串 / 结构标记」从字节里认出来的唯一线索） */
	function hexdump(buf: Buffer, baseOffset: number): string {
		const lines: string[] = [];
		for (let i = 0; i < buf.length; i += 16) {
			const chunk = buf.subarray(i, i + 16);
			const hex: string[] = [];
			const ascii: string[] = [];
			for (let k = 0; k < chunk.length; k++) {
				const b = chunk[k];
				hex.push((b < 16 ? '0' : '') + b.toString(16));
				ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');
			}
			const addr = (baseOffset + i).toString(16).padStart(8, '0');
			lines.push(`${addr}  ${hex.join(' ').padEnd(47)}  |${ascii.join('')}|`);
		}
		return lines.join('\n');
	}

	function clampInt(value: unknown, fallback: number, min: number, max: number): number {
		const n = Math.floor(Number(value));
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	}

		const path = resolvePath(args.path as string, ctx.runningDir);

		let size: number;
		try {
			const st = statSync(path);
			if (st.isDirectory()) {
				return { success: false, content: `"${path}" 是目录，不是文件，请用 file_list 列出其内容`, error: 'IS_DIRECTORY' };
			}
			size = st.size;
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code === 'ENOENT') return { success: false, content: `文件不存在：${path}`, error: 'NOT_FOUND' };
			if (code === 'EACCES' || code === 'EPERM') return { success: false, content: `没有权限读取：${path}`, error: 'NO_PERMISSION' };
			return { success: false, content: `无法访问 ${path}：${(err as Error).message}`, error: code ?? 'STAT_FAILED' };
		}

		// 探测（只看文件头，不整份加载）
		const head = readRange(path, 0, Math.min(SNIFF_BYTES, size), size);
		const sniff = sniffBuffer(head, size);
		const forcedMode = args.mode === 'text' || args.mode === 'binary' ? args.mode : null;
		const mode = forcedMode ?? sniff.kind;
		// const modeLabel = forcedMode && forcedMode !== sniff.kind ? `${mode}（forced）` : mode;
		const modeLabel = mode;

		// ---------- 二进制 ----------
		if (mode === 'binary') {
			const probeOnly = args.offset === undefined && args.limit === undefined;
			const parts: string[] = [];
			let rangeNote: string;

			if (probeOnly && size > BIN_SMALL_FILE) {
				const headN = Math.min(BIN_PROBE_BYTES, size);
				const tailStart = Math.max(headN, size - BIN_PROBE_BYTES);
				parts.push(hexdump(readRange(path, 0, headN, size), 0));
				parts.push('...');
				parts.push(hexdump(readRange(path, tailStart, size - tailStart, size), tailStart));
				rangeNote = `head 0x0-0x${headN.toString(16)} + tail 0x${tailStart.toString(16)}-0x${size.toString(16)}`;
			} else if (probeOnly) {
				parts.push(hexdump(readRange(path, 0, size, size), 0));
				rangeNote = `whole 0x0-0x${size.toString(16)}`;
			} else {
				const off = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
				if (off >= size) {
					return {
						success: false,
						content: `offset=${off} 超出范围：文件共 ${size} 字节（0x${size.toString(16)}）。`,
						error: 'OFFSET_OUT_OF_RANGE',
					};
				}
				const want = clampInt(args.limit, BIN_DEFAULT_LIMIT, 1, BIN_MAX_LIMIT);
				const len = Math.min(want, size - off);
				parts.push(hexdump(readRange(path, off, len, size), off));
				rangeNote = `0x${off.toString(16)}-0x${(off + len).toString(16)}（${len} / ${size} 字节）`;
			}

			const header = `<file path="${path}" mode="${modeLabel}" type="${sniff.kind}" detected="${sniff.detected}" size=${size} offset_unit="byte(0-based)">`;
			const footer = `[字节区间：${rangeNote}]`;

			return {
				success: true,
				content: `${header}\n${parts.join('\n')}\n${footer}`,
				structured: {
					mode: 'binary',
					type: sniff.kind === 'binary' ? sniff.type : 'by-request',
					detected: sniff.detected,
					forced: forcedMode !== null && forcedMode !== sniff.kind,
					totalBytes: size,
					probeOnly,
				},
			};
		}

		// ---------- 文本 ----------
		const notes: string[] = [];
		if (size > TEXT_MAX_FILE_BYTES) {
			return {
				success: false,
				content: `文件 ${formatBytes(size)} 超过单次文本读取上限（${formatBytes(TEXT_MAX_FILE_BYTES)}）。请用 file_search 定位关键行，或用 shell 抽取片段（如 findstr / Select-String），或显式传 mode="binary" 只看指定字节区间。`,
				error: 'FILE_TOO_LARGE',
			};
		}
		if (sniff.kind === 'binary') {
			notes.push(`[注意：该文件自动判定为二进制（${sniff.detected}），已按 mode="text" 强制解码，内容可能是乱码]`);
		}
		if (sniff.kind === 'text' && sniff.encoding === 'latin1') {
			notes.push('[注意：文件不是合法 UTF-8（可能是 GBK/GB18030），已用 latin1 兜底解码，中文会乱码]');
		}

		const raw = readFileSync(path);
		const content = decodeBuffer(raw, sniff.kind === 'text' ? sniff.encoding : 'latin1');
		const encoding = sniff.kind === 'text' ? sniff.encoding : 'latin1';

		if (size === 0) {
			return {
				success: true,
				content: `<file path="${path}" mode="${modeLabel}" encoding="${encoding}" detected="empty" lines=0 size=0>\n（空文件）`,
				structured: {
					mode: 'text', encoding, detected: 'empty', forced: false,
					totalLines: 0, totalBytes: 0, startLine: 0, endLine: 0, readLines: 0, truncated: false,
				},
			};
		}

		const lines = splitLines(content);

		const offsetLine = Math.max(1, Math.floor(Number(args.offset ?? 1)) || 1);
		const limit = clampInt(args.limit, TEXT_DEFAULT_LIMIT, 1, TEXT_MAX_LIMIT);
		if (offsetLine > lines.length) {
			return {
				success: false,
				content: `offset=${offsetLine} 超出范围：文件共 ${lines.length} 行`,
				error: 'OFFSET_OUT_OF_RANGE',
			};
		}

		const width = String(lines.length).length;
		const body: string[] = [];
		let chars = 0;
		let cutByChars = false;
		let endLine = offsetLine - 1;
		for (let i = offsetLine - 1; i < lines.length && i < offsetLine - 1 + limit; i++) {
			const textLine = lines[i].body;
			const shown = textLine.length > TEXT_MAX_LINE_CHARS
				? `${textLine.slice(0, TEXT_MAX_LINE_CHARS)} …(+${textLine.length - TEXT_MAX_LINE_CHARS} chars)`
				: textLine;
			const rendered = `${String(i + 1).padStart(width)}→${shown}`;
			if (body.length > 0 && chars + rendered.length > TEXT_MAX_RETURN_CHARS) {
				cutByChars = true;
				break;
			}
			body.push(rendered);
			chars += rendered.length + 1;
			endLine = i + 1;
		}

		const header = `<file path="${path}" mode="${modeLabel}" encoding="${encoding}" detected="${sniff.detected}" lines=${lines.length} size=${size}>`;
		const footer = endLine < lines.length
			? `[已读 ${offsetLine}-${endLine} / 共 ${lines.length} 行${cutByChars ? '（已达单次返回上限，提前截断）' : ''}]`
			: `[已读 ${offsetLine}-${endLine} / 共 ${lines.length} 行（已到文件末尾）]`;

		return {
			success: true,
			content: [header, ...notes, body.join('\n'), footer].filter((s) => s !== '').join('\n'),
			structured: {
				mode: 'text',
				encoding,
				detected: sniff.detected,
				forced: forcedMode !== null && forcedMode !== sniff.kind,
				totalLines: lines.length,
				totalBytes: size,
				startLine: offsetLine,
				endLine,
				readLines: body.length,
				truncated: endLine < lines.length,
				nextOffset: endLine < lines.length ? endLine + 1 : undefined,
			},
		};
	},
});

registerTool({
	name: 'file_list',
	access: 'read',
	description: '列出指定目录下的文件和子目录。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '目录路径，默认为运行目录' },
			recursive: { type: 'boolean', description: '是否递归列出' },
		},
		required: [],
	},
	async execute(args, ctx) {
		const targetPath = args.path
			? resolvePath(args.path as string, ctx.runningDir)
			: ctx.runningDir;
		try {
			const recursive = (args.recursive as boolean) ?? false;
			const maxDepth = recursive ? 3 : 1;

			// Windows 上没有 ls/find，用 node:fs 遍历（跨平台）
			const lines: string[] = [];
			const walk = (dir: string, depth: number) => {
				const entries = readdirSync(dir, { withFileTypes: true });
				for (const e of entries) {
					if (SEARCH_SKIP_DIRS.has(e.name)) continue;
					const full = join(dir, e.name);
					lines.push(e.isDirectory() ? `${full}/` : full);
					if (e.isDirectory() && depth < maxDepth) walk(full, depth + 1);
				}
			};
			walk(targetPath, 1);

			return {
				success: true,
				content: lines.join('\n') || '(empty directory)',
				structured: { path: targetPath, recursive },
			};
		} catch (err) {
			return { success: false, content: `Failed to list directory: ${(err as Error).message}` };
		}
	},
});

registerTool({
	name: 'file_search',
	access: 'read',
	description:
		'按关键词或正则搜索文件内容（不依赖 ripgrep，纯 node:fs 遍历）。' +
		'自动跳过 node_modules/.git/dist/build 等目录与二进制文件，单文件上限 1MB，最多返回 50 条。',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: '关键词，或 isRegex=true 时的正则表达式' },
			path: { type: 'string', description: '搜索根目录，默认为运行目录' },
			isRegex: { type: 'boolean', description: '是否把 query 当作正则' },
			ext: { type: 'string', description: '只看这些扩展名，逗号分隔，如 ".ts,.tsx"' },
			caseSensitive: { type: 'boolean', description: '是否区分大小写（默认 false）' },
		},
		required: ['query'],
	},
	async execute(args, ctx) {

	/**
	 * 给 file_search 用的廉价判定：文件已经被整份读成 UTF-8 字符串了，就不必再单独探测文件头。
	 * NUL，或采样区里 U+FFFD 占比高（非法字节被解码器替换）⇒ 二进制。
	 */
	function looksBinaryText(text: string): boolean {
		const sample = text.length > 8192 ? text.slice(0, 8192) : text;
		if (sample.indexOf('\u0000') >= 0) return true;
		let bad = 0;
		for (let i = 0; i < sample.length; i++) if (sample.charCodeAt(i) === 0xfffd) bad++;
		return bad > 0 && bad / sample.length > 0.1;
	}

		const root = args.path ? resolvePath(args.path as string, ctx.runningDir) : ctx.runningDir;
		const query = String(args.query ?? '');
		if (!query) return { success: false, content: 'query 不能为空' };

		const caseSensitive = args.caseSensitive === true;
		const exts = String(args.ext ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);

		let pattern: RegExp;
		try {
			pattern = args.isRegex
				? new RegExp(query, caseSensitive ? 'g' : 'gi')
				: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
		} catch (e) {
			return { success: false, content: `正则无效: ${(e as Error).message}` };
		}

		const hits: string[] = [];
		let truncated = false;
		let skippedBinary = 0;

		const walk = (dir: string, depth: number) => {
			if (truncated || depth > 12) return;
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (truncated) return;
				if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full, depth + 1);
					continue;
				}
				if (!entry.isFile()) continue;
				if (exts.length > 0 && !exts.includes(extname(entry.name).toLowerCase())) continue;
				try {
					if (statSync(full).size > SEARCH_MAX_FILE_BYTES) continue;
					const text = readFileSync(full, 'utf-8');
					// 跳过二进制：这里已经有解码后的字符串，判 NUL / 替换字符比例即可，不必再单独探测一遍文件头
					if (looksBinaryText(text)) {
						skippedBinary++;
						continue;
					}
					const lines = text.split('\n');
					for (let i = 0; i < lines.length; i++) {
						pattern.lastIndex = 0;
						if (!pattern.test(lines[i])) continue;
						hits.push(`${relative(root, full) || full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
						if (hits.length >= SEARCH_MAX_RESULTS) {
							truncated = true;
							return;
						}
					}
				} catch {
					// 二进制 / 无权限 / 编码问题：跳过
				}
			}
		};

		walk(root, 1);
		const note = skippedBinary > 0 ? `\n（已跳过 ${skippedBinary} 个二进制文件）` : '';
		return {
			success: true,
			content: (hits.length > 0 ? hits.join('\n') : '(没有匹配)') + note,
			structured: { count: hits.length, truncated, skippedBinary },
		};
	},
});

// --- 写入 ---

registerTool({
	name: 'file_write',
	access: 'write',
	description:
		'将文本写入指定文件（覆盖），沿用文件原有编码（UTF-8 / UTF-16 / BOM）。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			content: { type: 'string', description: '要写入的完整内容' },
			force: { type: 'boolean', description: '默认 false。如需覆盖已有文件则传 true' },
		},
		required: ['path', 'content'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		const force = args.force === true;
		const content = args.content as string;
		try {
			const guard = guardWritableFile(path);
			if (!guard.ok && guard.kind === 'directory') return { success: false, content: guard.message, error: 'IS_DIRECTORY' };

			// 二进制：只有 force 才放行，且先把原文件留一份 .bak（文本写进去是不可逆的，恢复全靠它）
			if (!guard.ok) {
				if (!force) return { success: false, content: guard.message, error: 'BINARY_FILE' };
				copyFileSync(path, `${path}.bak`);
				const bad = syntaxCheck(path, content);
				if (!bad.ok) return { success: false, content: `放弃写入：${bad.message}`, error: 'SYNTAX_ERROR' };
				writeFileSync(path, Buffer.from(content, 'utf-8'));
				return { success: true, content: `File overwritten: ${path}（二进制文件，原内容已备份到 ${path}.bak）` };
			}
			if (guard.exists && !force) {
				return {
					success: false,
					content: `${path} 已存在，未覆盖。`,
					error: 'ALREADY_EXISTS',
				};
			}
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			// 已存在的文件沿用其行尾（整份覆盖不该把 CRLF 文件改成 LF）；新文件用给定的内容
			const text = guard.exists ? applyEol(content, guard.eol) : content;
			const bad = syntaxCheck(path, text);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n文件 ${path} 未改动，请修复内容后重试。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(text, guard.encoding, guard.bom));
			const tail = guard.encoding === 'utf-8' ? '' : `（沿用原编码 ${guard.encoding}）`;
			return { success: true, content: `${guard.exists ? 'File overwritten' : 'File created'}: ${path}${tail}` };
		} catch (err) {
			return { success: false, content: `Failed to write file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'WRITE_FAILED' };
		}
	},
});

registerTool({
	name: 'file_append',
	access: 'write',
	description:
		'把一段文本追加到文件末尾（新调试用例、新条目这类「加在最后」的场景专用）。',
		// '跟 file_edit 的区别：不需要先 file_read 数行号，一次调用就完事——省一轮，也省下那份文件内容常驻上下文。' +
		// '插入中间某一行时不要用这个，用 file_edit。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			content: { type: 'string', description: '要追加的内容' },
		},
		required: ['path', 'content'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			const tail = (args.content as string).replace(/\r?\n$/, '');
			// 原文件非空且没换行结尾时补一个，否则会把新内容粘到最后一行的屁股上
			const prev = guard.exists ? readFileSync(path, guard.encoding === 'utf-8' ? 'utf-8' : guard.encoding as BufferEncoding) : '';
			const lead = prev && !/\r?\n$/.test(prev) ? guard.eol : '';
			const text = applyEol(prev + lead + tail + guard.eol, guard.eol);
			const bad = syntaxCheck(path, text);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n文件 ${path} 未改动，请修复内容后重试。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(text, guard.encoding, guard.bom));
			return { success: true, content: `Appended ${tail.split('\n').length} lines to ${path}（现 ${text.split('\n').length - 1} 行）` };
		} catch (err) {
			return { success: false, content: `Failed to append file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'APPEND_FAILED' };
		}
	},
});

registerTool({
	name: 'file_edit',
	access: 'write',
	description: '编辑文本文件的指定行范围（startLine 到 endLine，含两端），替换为 newContent。行号与 file_read 输出的一致；写回沿用原编码。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '相对或绝对路径' },
			startLine: { type: 'integer', description: '起始行号（从 1 开始）' },
			endLine: { type: 'integer', description: '结束行号（含）' },
			newContent: { type: 'string', description: '替换后的新内容（可多行）（完全覆盖，因此需带上原有的缩进（tab 或空格））' },
		},
		required: ['path', 'startLine', 'endLine', 'newContent'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		try {
			const guard = guardWritableFile(path);
			if (!guard.ok) return { success: false, content: guard.message, error: 'BINARY_FILE' };
			if (!guard.exists) return { success: false, content: `文件不存在：${path}，请先新建。`, error: 'NOT_FOUND' };

			const content = decodeBuffer(readFileSync(path), guard.encoding);
			const lines = splitLines(content);
			const start = ((args.startLine as number) ?? 1) - 1;
			const end = args.endLine as number;

			if (start < 0 || end > lines.length || start >= end) {
				return {
					success: false,
					content: `Invalid line range: ${start + 1}-${end}. File has ${lines.length} lines.`,
				};
			}

			// 新行沿用「被替换区间第一行」的行尾；区间末行原本没有行尾（文件结尾无换行）时，新末行也不加
			const replacedEol = lines[start].eol || dominantEol(lines);
			const tailHasEol = lines[end - 1].eol !== '';
			const newLines = (args.newContent as string)
				.split('\n')
				.map((s) => (s.endsWith('\r') ? s.slice(0, -1) : s));
			const replacement = newLines.map((body, i) => ({
				body,
				eol: i === newLines.length - 1 && !tailHasEol ? '' : replacedEol,
			}));
			const result = [...lines.slice(0, start), ...replacement, ...lines.slice(end)]
				.map((l) => l.body + l.eol)
				.join('');
			const bad = syntaxCheck(path, result);
			if (!bad.ok) {
				return {
					success: false,
					content: `放弃写入：${bad.message}\n磁盘上的 ${path} 没动，请缩小要替换的行范围重来（通常是多删了个括号/引号，或 newContent 少了一行）。`,
					error: 'SYNTAX_ERROR',
				};
			}
			writeFileSync(path, encodeBuffer(result, guard.encoding, guard.bom));

			const written = result.length === 0 ? [] : splitLines(result).slice(start, start + newLines.length);
			const preview = written.map((l, i) => ` ${start + 1 + i}→${l.body}`).join('\n');
			return {
				success: true,
				content:
					`Edited lines ${start + 1}-${end} in ${path}. Old: ${end - start} lines, New: ${newLines.length} lines.\n` +
					`现在这一段的实际内容：\n${preview}`,
				structured: { path, startLine: start + 1, endLine: end, lines: newLines.length },
			};
		} catch (err) {
			return { success: false, content: `Failed to edit file: ${(err as Error).message}`, error: (err as { code?: string }).code ?? 'EDIT_FAILED' };
		}
	},
});

registerTool({
	name: 'file_delete',
	access: 'write',
	description: '删除指定文件。落点由「工具安全性」档位决定：普通 / 智能档移入系统回收站（没有回收站则移到会话 backups/），无防护档才是真删。',
	parameters: {
		type: 'object',
		properties: {
			path: { type: 'string', description: '文件路径' },
		},
		required: ['path'],
	},
	async execute(args, ctx) {
		const path = resolvePath(args.path as string, ctx.runningDir);
		// 档位决定落点：off 真删；普通 / 智能进回收站（无回收站则落到会话 backups/）
		return deleteFileSafely(path, ctx);
	},
});

registerTool({
	name: 'file_rename',
	access: 'write',
	description:
		'重命名或移动文件（也用于「重命名迁移」备份：把要改的原文件移到 backups/<时间戳>-<原名>，再写新内容，避免直接覆盖造成不可逆丢失）。',
	parameters: {
		type: 'object',
		properties: {
			from: { type: 'string', description: '源路径' },
			to: { type: 'string', description: '目标路径' },
		},
		required: ['from', 'to'],
	},
	async execute(args, ctx) {
		const from = resolvePath(args.from as string, ctx.runningDir);
		const to = resolvePath(args.to as string, ctx.runningDir);
		try {
			const dir = dirname(to);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			renameSync(from, to);
			return { success: true, content: `Renamed: ${from} → ${to}` };
		} catch (err) {
			return { success: false, content: `Failed to rename: ${(err as Error).message}` };
		}
	},
});

// #endregion
