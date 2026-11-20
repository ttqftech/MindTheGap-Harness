/*
 * 媒体内容 hash（前端）
 *
 * 用途：发送前算出一个**稳定的内容指纹**交给后端当文件名 / 判重键。
 * 为什么不用 SHA-256：views:// 不是安全上下文，crypto.subtle 不可用；
 * node:crypto 在 WebView 里也没有。所以自带一份零依赖的 xxHash32：
 * - 按 4 字节一轮、全用 Math.imul（32 位整数乘法不丢精度），是纯 JS 里最快的档；
 * - 用两个不同 seed 各算一遍拼成 64 位，再带上文件大小，碰撞概率对单会话足够低；
 * - 走 file.stream() 分块增量算，几百 MB 的视频也不会把整份字节读进内存。
 *
 * ⚠️ 这是**非加密** hash，只做去重 / 命名，绝不用于任何安全判断。
 */

const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;

function rotl32(value: number, shift: number): number {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function round(acc: number, input: number): number {
	const sum = (acc + Math.imul(input, P2)) | 0;
	return Math.imul(rotl32(sum, 13), P1) | 0;
}

/** 流式 xxHash32：可以分任意多次 update，最后 digest */
class Xxh32 {
	private v1: number;
	private v2: number;
	private v3: number;
	private v4: number;
	private readonly memo = new Uint8Array(16);
	private memoSize = 0;
	private total = 0;

	constructor(seed: number) {
		this.v1 = (seed + P1 + P2) | 0;
		this.v2 = (seed + P2) | 0;
		this.v3 = seed | 0;
		this.v4 = (seed - P1) | 0;
	}

	private consumeBlock(view: DataView, offset: number): void {
		this.v1 = round(this.v1, view.getUint32(offset, true));
		this.v2 = round(this.v2, view.getUint32(offset + 4, true));
		this.v3 = round(this.v3, view.getUint32(offset + 8, true));
		this.v4 = round(this.v4, view.getUint32(offset + 12, true));
	}

	update(data: Uint8Array): void {
		this.total += data.length;
		let offset = 0;

		if (this.memoSize + data.length < 16) {
			this.memo.set(data, this.memoSize);
			this.memoSize += data.length;
			return;
		}
		if (this.memoSize > 0) {
			const need = 16 - this.memoSize;
			this.memo.set(data.subarray(0, need), this.memoSize);
			this.consumeBlock(new DataView(this.memo.buffer, this.memo.byteOffset, 16), 0);
			offset = need;
			this.memoSize = 0;
		}

		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		while (offset + 16 <= data.length) {
			this.consumeBlock(view, offset);
			offset += 16;
		}
		if (offset < data.length) {
			this.memo.set(data.subarray(offset), 0);
			this.memoSize = data.length - offset;
		}
	}

	digest(): number {
		let hash: number;
		if (this.total >= 16) {
			hash = (rotl32(this.v1, 1) + rotl32(this.v2, 7) + rotl32(this.v3, 12) + rotl32(this.v4, 18)) | 0;
		} else {
			hash = (this.v3 + P5) | 0;
		}
		hash = (hash + this.total) | 0;

		const tail = new DataView(this.memo.buffer, this.memo.byteOffset, this.memoSize);
		let offset = 0;
		while (offset + 4 <= this.memoSize) {
			hash = (hash + Math.imul(tail.getUint32(offset, true), P3)) | 0;
			hash = Math.imul(rotl32(hash, 17), P4) | 0;
			offset += 4;
		}
		while (offset < this.memoSize) {
			hash = (hash + Math.imul(this.memo[offset], P5)) | 0;
			hash = Math.imul(rotl32(hash, 11), P1) | 0;
			offset += 1;
		}

		hash ^= hash >>> 15;
		hash = Math.imul(hash, P2) | 0;
		hash ^= hash >>> 13;
		hash = Math.imul(hash, P3) | 0;
		hash ^= hash >>> 16;
		return hash >>> 0;
	}
}

function hex8(value: number): string {
	return value.toString(16).padStart(8, '0');
}

/** 算出 `16 位十六进制 hash + 文件大小`，后端拿它当文件名；失败时抛错由调用方提示 */
export async function hashMediaFile(file: File): Promise<string> {
	const first = new Xxh32(0);
	const second = new Xxh32(0x9e3779b9);

	const feed = (value: Uint8Array) => {
		first.update(value);
		second.update(value);
	};

	if (typeof file.stream === 'function') {
		const reader = file.stream().getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			feed(value instanceof Uint8Array ? value : new Uint8Array(value));
		}
	} else {
		feed(new Uint8Array(await file.arrayBuffer()));
	}

	return `${hex8(first.digest())}${hex8(second.digest())}${file.size.toString(16)}`;
}

/** 从 MIME / 文件名粗判媒体类型（只用于前端 UI，后端还会再校验一次） */
export function mediaKindOf(mime: string, name: string): 'image' | 'video' | null {
	if (/^image\//.test(mime)) return 'image';
	if (/^video\//.test(mime)) return 'video';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
	if (['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
	return null;
}
