/*
 * 子进程输出的编码解码 — MindTheGap-Harness
 *
 * 为什么需要这一层：Windows 下 `shell` 走的是 cmd.exe（`%ComSpec%`），而 cmd 的输出**不是 UTF-8**。更麻烦的是它混着来：
 *
 * - cmd 内建命令（`dir` / `type` / 系统错误提示）按 **OEM 代码页**写，简体中文机器上是 936（GBK）；
 * - 外部程序（node / python / git 等）多半自己就写 UTF-8，跟控制台代码页无关。
 *
 * 所以「整段用一种编码解」一定会错一半。这里按**行**判定：先做严格 UTF-8 校验，过了就当 UTF-8（纯 ASCII 也走这条，多数情况），过不了才按 GBK 解。
 *
 * 为什么不 `chcp 65001` 了事：实测（2026-11-04）它对 `dir` 输出的中文名有效，但对 `echo 中文` 这类**命令行参数**无效，而且改了代码页会连带影响长驻进程的控制台状态。
 * 在解码侧兜底更干净，也不改变命令的语义。
 *
 * 为什么不在 `spawn`/`execSync` 上直接设 `encoding: 'gbk'`：两个原因都致命 ——
 * ① Node 的 encoding 只认 Buffer 支持的编码（utf8 / latin1 / ascii / base64 …），`encoding: 'gbk'` 直接抛 `ERR_UNKNOWN_ENCODING`；
 * ② 即便能设，它也会把**整段**当 GBK 解，而外部程序（node / git / python）写的是 UTF-8，中文会变成「涓枃」。所以只能拿到字节后按行判。
 */

/** 严格 UTF-8 校验（不依赖 TextDecoder 的 fatal 选项，JSC 不保证有） */
export function utf8LooksValid(buf: Uint8Array): boolean {
	let i = 0;
	while (i < buf.length) {
		const b = buf[i];
		if (b < 0x80) {
			i++;
			continue;
		}
		let extra = 0;
		let cp = 0;
		if ((b & 0xe0) === 0xc0) {
			extra = 1;
			cp = b & 0x1f;
		} else if ((b & 0xf0) === 0xe0) {
			extra = 2;
			cp = b & 0x0f;
		} else if ((b & 0xf8) === 0xf0) {
			extra = 3;
			cp = b & 0x07;
		} else return false;
		// 采样在多字节字符中间被截断 → 不算非法
		if (i + extra >= buf.length) return true;
		for (let k = 1; k <= extra; k++) {
			const c = buf[i + k];
			if ((c & 0xc0) !== 0x80) return false;
			cp = (cp << 6) | (c & 0x3f);
		}
		if (extra === 1 && cp < 0x80) return false;
		if (extra === 2 && cp < 0x800) return false;
		if (extra === 3 && cp < 0x10000) return false;
		if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
		i += extra + 1;
	}
	return true;
}

let gbkDecoder: TextDecoder | null | undefined;

/**
 * 按 GBK 解码。Cottontail 与 Node 都带 ICU（实测 `TextDecoder('gbk')` 可用），
 * 万一哪天运行时被裁成 small-icu，退回 latin1（至少不抛错，乱码但不中断工具）。
 */
function decodeGbk(bytes: Uint8Array): string {
	if (gbkDecoder === undefined) {
		try {
			// lib 的 TextDecoder 类型只列了 utf-8/utf-16 等，GBK 是运行时（ICU）支持的编码
			gbkDecoder = new TextDecoder('gbk' as unknown as 'utf-8');
		} catch {
			gbkDecoder = null;
		}
	}
	if (gbkDecoder) return gbkDecoder.decode(bytes);
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return out;
}

/** 单个完整行（或行内片段）的解码：先严格 UTF-8，不行再 GBK */
function decodeLine(bytes: Uint8Array): string {
	if (!bytes.length) return '';
	if (utf8LooksValid(bytes)) return Buffer.from(bytes).toString('utf8');
	return decodeGbk(bytes);
}

/** 按行切分后逐行解码（整段都合法 UTF-8 时走快路径，只解一次） */
function decodeLines(bytes: Uint8Array): string {
	if (!bytes.length) return '';
	if (utf8LooksValid(bytes)) return Buffer.from(bytes).toString('utf8');
	let out = '';
	let start = 0;
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		if (b !== 0x0a && b !== 0x0d) continue;
		let end = i + 1;
		if (b === 0x0d && bytes[end] === 0x0a) end++;	// \r\n 算一行
		out += decodeLine(bytes.subarray(start, end));
		start = end;
		i = end - 1;
	}
	if (start < bytes.length) out += decodeLine(bytes.subarray(start));
	return out;
}

/** 一次性拿到的大段输出（`shell` 的 spawnSync 结果、错误里的 stderr） */
export function decodeShellOutput(bytes: Uint8Array | undefined | null): string {
	return bytes && bytes.length ? decodeLines(bytes) : '';
}

/** 一直有数据但半天没有换行时，最多攒这么多字节就先吐出去（进度条、`\r` 刷新型输出） */
const MAX_PENDING_BYTES = 8 * 1024;

export interface ShellStreamDecoder {
	/** 喂一段字节，返回能确定编码的完整行（可能为空串） */
	push(chunk: Uint8Array): string;
	/** 进程结束时把残留的不完整行吐出来 */
	flush(): string;
}

/**
 * 流式解码：只在**换行处**解码，避免一个多字节字符被 chunk 切断导致误判编码。
 * 必须一个流一个实例（stdout / stderr 各自维护自己的残留）。
 */
export function createShellStreamDecoder(): ShellStreamDecoder {
	let pending: Uint8Array = Buffer.alloc(0);

	const take = (upTo: number): string => {
		const text = decodeLines(pending.subarray(0, upTo));
		// 必须拷贝：subarray 会一直持有整块内存，长跑任务会越攒越大
		pending = Buffer.from(pending.subarray(upTo));
		return text;
	};

	return {
		push(chunk) {
			if (!chunk.length) return '';
			pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk);

			let cut = 0;
			for (let i = pending.length - 1; i >= 0; i--) {
				if (pending[i] === 0x0a || pending[i] === 0x0d) {
					cut = i + 1;
					break;
				}
			}
			if (cut === 0) {
				// 一整段里没有换行：攒太多就先解（否则进度条类输出会一直不显示）
				if (pending.length > MAX_PENDING_BYTES) return take(pending.length);
				return '';
			}
			return take(cut);
		},
		flush() {
			return pending.length ? take(pending.length) : '';
		},
	};
}
