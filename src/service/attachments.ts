/*
 * 会话附件（图片 / 视频 / 音频）
 *
 * 设计取舍：
 * - 前端把**原始字节**上传给 Service，Service 写进 `conversations/<id>/attachments/`；
 *   ctx 里只存 `{ name, mime, file, size }` 这样的引用，真正请求 LLM 时由 runner 现读成 base64。
 * - ⭐ 文件名由前端算的**内容 hash** 决定：同一个会话里放同一份文件，prepare 直接命中 sidecar，既不重传也不重编码；
 *   换档位 / 换编码时后端拿已有的 raw 自己重编码，前端同样零传输。
 * - 产物分三类：raw-<hash>.<ext>（原始字节）、<hash>-img-<档>.jpg / <hash>-vid-<档>-<编码>.mp4（转码产物）、*.json（sidecar，存完整引用）。
 *   ⭐ 视频转码后的 mp4 本体直接发给模型，**不抽帧、不生成封面图**。
 *   ⭐ 音频不区分质量档位（token 只跟时长走，≈10 token/s），**原样传输**：产物就是 raw 本身，一次 ffmpeg 都不调。
 * - ⚠️ 转码全部 await 完成才回响应 —— 前端拿到 ref 时产物已经能直接读了。
 */

import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { basename, extname, join } from 'node:path';
import type { ImageQuality, LlmAudioRef, LlmImageRef, LlmVideoRef, MediaKind, MediaPrepareRequest, MediaPrepareResult, VideoCodec, VideoQuality } from '../shared/agent';
import { DRAFT_MEDIA_CONVERSATION_ID, IMAGE_QUALITY_VALUES, VIDEO_CODEC_VALUES, VIDEO_QUALITY_VALUES } from '../shared/agent';
import { conversationDir, mediaCacheDir } from './storage';
import { encodeImage, encodeVideo, probeAudio, probeSize, probeVideo } from './media';

// #region 类型 / 常量

const EXT_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.bmp': 'image/bmp',
	'.mp4': 'video/mp4',
	'.m4v': 'video/x-m4v',
	'.webm': 'video/webm',
	'.mov': 'video/quicktime',
	'.mkv': 'video/x-matroska',
	'.avi': 'video/x-msvideo',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.flac': 'audio/flac',
	'.ogg': 'audio/ogg',
	'.oga': 'audio/ogg',
	'.opus': 'audio/opus',
	'.weba': 'audio/webm',
	'.wma': 'audio/x-ms-wma',
	'.aiff': 'audio/aiff',
	'.aif': 'audio/aiff',
};

const MIME_EXT: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'image/bmp': '.bmp',
	'video/mp4': '.mp4',
	'video/x-m4v': '.m4v',
	'video/webm': '.webm',
	'video/quicktime': '.mov',
	'video/x-matroska': '.mkv',
	'video/x-msvideo': '.avi',
	'audio/mpeg': '.mp3',
	'audio/mp3': '.mp3',
	'audio/wav': '.wav',
	'audio/x-wav': '.wav',
	'audio/wave': '.wav',
	'audio/mp4': '.m4a',
	'audio/x-m4a': '.m4a',
	'audio/aac': '.aac',
	'audio/flac': '.flac',
	'audio/ogg': '.ogg',
	'audio/opus': '.opus',
	'audio/webm': '.weba',
	'audio/x-ms-wma': '.wma',
	'audio/aiff': '.aiff',
};

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.weba', '.wma', '.aiff', '.aif']);

export const MAX_IMAGE_BYTES = 20 * 1000 * 1000;	// 单张图片上限（超过直接拒收，避免一次上传把会话目录撑爆）
export const MAX_VIDEO_BYTES = 500 * 1000 * 1000;	// 视频上限：转码后再存，原始文件只是换档位时的素材
export const MAX_AUDIO_BYTES = 100 * 1000 * 1000;	// 音频上限：原样存，10 分钟 44.1kHz 立体声 WAV 约 100MB

interface MediaTarget {
	kind: MediaKind;
	hash: string;
	name: string;
	sourceMime: string;
	quality: ImageQuality | VideoQuality;
	codec?: VideoCodec;
	rawFile: string;
	productFile: string;
	sidecarFile: string;
}

// #endregion

// #region 目录 / 文件名 / mime

/** 空白会话的预览产物落在全局媒体缓存里，不创建任何会话记录 */
export function attachmentsDir(conversationId: string): string {
	return conversationId === DRAFT_MEDIA_CONVERSATION_ID
		? mediaCacheDir()
		: join(conversationDir(conversationId), 'attachments');
}

function ensureAttachmentsDir(conversationId: string): string {
	const dir = attachmentsDir(conversationId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

/** 由 mime（或文件名兜底）判定媒体类型与原始扩展名；不支持就返回 null */
function resolveSource(mime: string, name: string): { kind: MediaKind; ext: string; sourceMime: string } | null {
	const lower = mime.split(';')[0].trim().toLowerCase();
	let ext = MIME_EXT[lower] ?? '';
	if (!ext) {
		const byName = extname(name).toLowerCase();
		if (EXT_MIME[byName]) ext = byName;
	}
	if (!ext || !EXT_MIME[ext]) return null;
	const kind: MediaKind = VIDEO_EXTS.has(ext) ? 'video' : AUDIO_EXTS.has(ext) ? 'audio' : 'image';
	return { kind, ext, sourceMime: EXT_MIME[ext] };
}

/** 把前端的 prepare 参数解析成一组确定的文件名（顺带做合法性校验） */
function resolveMediaTarget(req: MediaPrepareRequest): { target?: MediaTarget; error?: string } {
	const hash = String(req.hash ?? '').toLowerCase();
	// hash 只进文件名，必须严格限制字符集，防目录穿越
	if (!/^[0-9a-f]{8,64}$/.test(hash)) return { error: '内容 hash 不合法' };
	const source = resolveSource(req.mime ?? '', req.name ?? '');
	if (!source) return { error: '不支持的媒体类型（图片 png / jpeg / webp / gif / bmp；视频 mp4 / m4v / webm / mov / mkv / avi；音频 mp3 / wav / m4a / aac / flac / ogg / opus / weba / wma / aiff）' };
	const kind = req.kind;
	if (kind !== source.kind) return { error: `媒体类型不匹配：声明 ${kind}，实际是 ${source.kind}` };

	const quality = String(req.quality ?? '');
	let codec: VideoCodec | undefined;
	if (kind === 'image') {
		if (!IMAGE_QUALITY_VALUES.includes(quality as ImageQuality)) return { error: '图片清晰度必须是 low / normal / original' };
	} else if (kind === 'video') {
		if (!VIDEO_QUALITY_VALUES.includes(quality as VideoQuality)) return { error: '视频清晰度必须是 low / normal / high' };
		const rawCodec = String(req.codec ?? 'h264');
		if (!VIDEO_CODEC_VALUES.includes(rawCodec as VideoCodec)) return { error: '视频编码不合法' };
		codec = rawCodec as VideoCodec;
	}

	const imageQuality = quality as ImageQuality;
	const videoQuality = quality as VideoQuality;
	const rawFile = `raw-${hash}${source.ext}`;
	const sidecarFile = kind === 'image'
		? `${hash}-img-${imageQuality}.json`
		: kind === 'video' ? `${hash}-vid-${videoQuality}-${codec}.json` : `${hash}-audio.json`;
	const productFile = kind === 'image'
		? (imageQuality === 'original' ? rawFile : `${hash}-img-${imageQuality}.jpg`)
		: kind === 'video' ? `${hash}-vid-${videoQuality}-${codec}.mp4` : rawFile;

	return {
		target: {
			kind,
			hash,
			name: basename(req.name || `media${source.ext}`),
			sourceMime: source.sourceMime,
			quality: quality as ImageQuality | VideoQuality,
			codec,
			rawFile,
			productFile,
			sidecarFile,
		},
	};
}

/** 附件是否真的还在（run 前兜底：上传后被清理 / 手删的引用不往 ctx 里写） */
export function attachmentExists(conversationId: string, file: string): boolean {
	try {
		const path = attachmentPath(conversationId, file);
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

/** 附件在会话目录里的绝对路径（只取 basename，防目录穿越） */
export function attachmentPath(conversationId: string, file: string): string {
	return join(attachmentsDir(conversationId), basename(file));
}

/** 由附件文件名推 Content-Type（未知按二进制流） */
export function guessMimeByFileName(file: string): string {
	const ext = extname(file).toLowerCase();
	if (ext === '.json') return 'application/json';	// 它不属于多媒体文件，因此不在 EXT_MIME 里。放在这里给前端读 attachment sidecar 提供能力
	return EXT_MIME[ext] ?? 'application/octet-stream';
}

/** 读成 base64（不含 `data:` 前缀）；文件丢了返回 undefined */
export function readAttachmentBase64(conversationId: string, file: string): string | undefined {
	try {
		const path = attachmentPath(conversationId, file);
		if (!existsSync(path)) return undefined;
		return readFileSync(path).toString('base64');
	} catch {
		return undefined;
	}
}

function fileSize(path: string): number {
	try { return statSync(path).size; } catch { return 0; }
}

function readSidecar(conversationId: string, file: string): MediaPrepareResult | null {
	try {
		const raw = readFileSync(attachmentPath(conversationId, file), 'utf-8');
		const parsed = JSON.parse(raw) as MediaPrepareResult;
		return parsed.attachment ? parsed : null;
	} catch {
		return null;
	}
}

function writeSidecar(conversationId: string, file: string, result: MediaPrepareResult): void {
	writeFileSync(attachmentPath(conversationId, file), JSON.stringify(result, null, 2));
}

/** sidecar 里的引用所指的产物是否还在 */
function productIntact(conversationId: string, result: MediaPrepareResult): boolean {
	const file = result.attachment?.file;
	return !!file && attachmentExists(conversationId, file);
}

// #endregion

// #region 编码编排

/** 同一个产物同时被点了好几次（快速切档）时只转一次 */
const inFlight = new Map<string, Promise<MediaPrepareResult>>();

function withEncodeLock(key: string, task: () => Promise<MediaPrepareResult>): Promise<MediaPrepareResult> {
	const running = inFlight.get(key);
	if (running) return running;
	const promise = task().then(
		(value) => { inFlight.delete(key); return value; },
		(error) => { inFlight.delete(key); throw error; },
	);
	inFlight.set(key, promise);
	return promise;
}

/** 拿已有的 raw 重新编码：接口在编码 + 探针全部完成后才返回 */
async function encodeFromRaw(conversationId: string, target: MediaTarget, rawSize: number): Promise<MediaPrepareResult> {
	const dir = ensureAttachmentsDir(conversationId);
	const rawPath = join(dir, target.rawFile);
	const productPath = join(dir, target.productFile);

	if (target.kind === 'image') {
		const quality = target.quality as ImageQuality;
		if (quality === 'original') {
			// 原图不重编码：产物就是 raw 本身
			const size = await probeSize(rawPath);
			const image: LlmImageRef = {
				kind: 'image',
				name: target.name,
				mime: target.sourceMime,
				file: target.rawFile,
				size: rawSize || fileSize(rawPath),
				quality,
				...size,
			};
			const result: MediaPrepareResult = { ok: true, attachment: image };
			writeSidecar(conversationId, target.sidecarFile, result);
			return result;
		}
		const encoded = await encodeImage(rawPath, productPath, quality);
		if (!encoded.ok) return { ok: false, error: `图片压缩失败：${encoded.error}` };
		const size = await probeSize(productPath);
		const image: LlmImageRef = {
			kind: 'image',
			name: target.name,
			mime: 'image/jpeg',
			file: target.productFile,
			size: fileSize(productPath),
			quality,
			...size,
		};
		const result: MediaPrepareResult = { ok: true, attachment: image };
		writeSidecar(conversationId, target.sidecarFile, result);
		return result;
	}

	if (target.kind === 'audio') {
		// ⭐ 原样传输：产物就是 raw 本身，不调 ffmpeg 重编码；只补一个 ffprobe 时长（拿不到也不影响发送）
		const probe = await probeAudio(rawPath);
		const audio: LlmAudioRef = {
			kind: 'audio',
			name: target.name,
			mime: target.sourceMime,
			file: target.rawFile,
			size: rawSize || fileSize(rawPath),
			format: extname(target.rawFile).slice(1).toLowerCase(),
			...probe,
		};
		const result: MediaPrepareResult = { ok: true, attachment: audio };
		writeSidecar(conversationId, target.sidecarFile, result);
		return result;
	}

	const quality = target.quality as VideoQuality;
	const codec = target.codec!;
	const encoded = await encodeVideo(rawPath, productPath, quality, codec);
	if (!encoded.ok) return { ok: false, error: `视频转码失败：${encoded.error}` };

	const probe = await probeVideo(productPath);
	const video: LlmVideoRef = {
		kind: 'video',
		name: target.name,
		mime: 'video/mp4',
		file: target.productFile,
		size: fileSize(productPath),
		quality,
		codec,
		...probe,
	};
	const result: MediaPrepareResult = { ok: true, attachment: video };
	writeSidecar(conversationId, target.sidecarFile, result);
	return result;
}

/**
 * 空白会话阶段点预览时产物落在全局媒体缓存里；首句发出、真会话建好后从这里回填。
 * 产物文件齐全 = 连转码都省了；只有 raw = 后端拿它重编码，前端依旧零传输。
 */
function hydrateFromCache(conversationId: string, target: MediaTarget): MediaPrepareResult | null {
	if (conversationId === DRAFT_MEDIA_CONVERSATION_ID) return null;
	const cacheDir = mediaCacheDir();
	const sidecarPath = join(cacheDir, target.sidecarFile);
	if (existsSync(sidecarPath)) {
		let cached: MediaPrepareResult | null = null;
		try { cached = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as MediaPrepareResult; } catch { /* 缓存坏了就当没有 */ }
		const ref = cached?.attachment;
		if (cached && ref) {
			const files = [target.sidecarFile, ref.file];
			if (files.every((file) => existsSync(join(cacheDir, file)))) {
				const dir = ensureAttachmentsDir(conversationId);
				for (const file of files) {
					const dest = join(dir, file);
					if (!existsSync(dest)) copyFileSync(join(cacheDir, file), dest);
				}
				return cached;
			}
		}
	}
	const dir = ensureAttachmentsDir(conversationId);
	const rawDest = join(dir, target.rawFile);
	const rawSrc = join(cacheDir, target.rawFile);
	if (!existsSync(rawDest) && existsSync(rawSrc) && statSync(rawSrc).size > 0) copyFileSync(rawSrc, rawDest);
	return null;
}

/**
 * 判重 / 准备产物：
 * ① 产物 sidecar 已存在且文件齐全 → 直接返回（同会话同图零传输零转码）
 * ② 空白会话预览留下的缓存 → 回填进真会话（同上）
 * ③ raw 已存在但没这个档位 → 后端拿 raw 重编码（前端仍零传输）
 * ④ 都没有 → needUpload，让前端把原始字节 POST 上来
 */
export function prepareMedia(conversationId: string, req: MediaPrepareRequest): Promise<MediaPrepareResult> {
	const { target, error } = resolveMediaTarget(req);
	if (!target) return Promise.resolve({ ok: false, error: error ?? '媒体参数不合法' });
	const key = `${conversationId}/${target.sidecarFile}`;
	return withEncodeLock(key, async () => {
		const cached = readSidecar(conversationId, target.sidecarFile);
		if (cached && productIntact(conversationId, cached)) return { ...cached, cached: true, needUpload: false };
		const hydrated = hydrateFromCache(conversationId, target);
		if (hydrated) return { ...hydrated, cached: true, needUpload: false };
		const dir = ensureAttachmentsDir(conversationId);
		const rawPath = join(dir, target.rawFile);
		if (existsSync(rawPath) && statSync(rawPath).size > 0) {
			return encodeFromRaw(conversationId, target, statSync(rawPath).size);
		}
		return { ok: true, needUpload: true };
	});
}

/**
 * 流式接收原始字节（**背压**：文件写慢了就暂停请求流，drain 后再恢复），
 * 收完立刻编码（音频只补元信息，不转码），全部完成才返回 —— 这就是「接口成功 = 产物可用」的保证。
 *
 * ⚠️ 没有做「边收边转」：ffmpeg 从 stdin 读 MP4 需要 moov 前置，很多相机 / 录屏文件是 moov 后置，直接 pipe 会随机失败。先流式落盘再转码更稳，接收侧仍全程背压，不把整个文件堆进内存。
 */
export async function uploadAndEncode(
	conversationId: string,
	req: MediaPrepareRequest,
	stream: IncomingMessage,
): Promise<MediaPrepareResult> {
	const { target, error } = resolveMediaTarget(req);
	if (!target) return { ok: false, error: error ?? '媒体参数不合法' };
	const key = `${conversationId}/${target.sidecarFile}`;
	return withEncodeLock(key, async () => {
		const cached = readSidecar(conversationId, target.sidecarFile);
		if (cached && productIntact(conversationId, cached)) return { ...cached, cached: true, needUpload: false };

		const dir = ensureAttachmentsDir(conversationId);
		const rawPath = join(dir, target.rawFile);
		// 上一次上传半途失败的残留先清掉
		try { if (existsSync(rawPath)) unlinkSync(rawPath); } catch { /* 清不掉就覆盖写 */ }
		const maxBytes = target.kind === 'video' ? MAX_VIDEO_BYTES : target.kind === 'audio' ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
		const received = await receiveRawBody(stream, rawPath, maxBytes);
		if (!received.ok) {
			try { if (existsSync(rawPath)) unlinkSync(rawPath); } catch { /* 忽略 */ }
			return { ok: false, error: received.error ?? '接收失败' };
		}
		return encodeFromRaw(conversationId, target, received.size ?? 0);
	});
}

/** 把请求体写进文件，写盘速度决定接收速度（不整段驻留内存） */
function receiveRawBody(req: IncomingMessage, filePath: string, maxBytes: number): Promise<{ ok: boolean; size?: number; error?: string }> {
	return new Promise((resolve) => {
		const output = createWriteStream(filePath);
		let total = 0;
		let overflow = false;
		let settled = false;
		const done = (result: { ok: boolean; size?: number; error?: string }) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		output.on('error', (e) => done({ ok: false, error: `写盘失败：${e.message}` }));
		req.on('error', (e) => { output.destroy(); done({ ok: false, error: `接收失败：${e.message}` }); });
		req.on('data', (chunk: Buffer) => {
			if (settled) return;
			total += chunk.length;
			if (total > maxBytes) {
				overflow = true;
				output.destroy();
				// 不 destroy 请求：让它把剩余字节流掉，这样还能给前端回一个正经的 JSON 错误
				req.resume();
				return;
			}
			if (!output.write(chunk)) {
				req.pause();
				output.once('drain', () => req.resume());
			}
		});
		req.on('end', () => {
			if (overflow) {
				done({ ok: false, error: `文件超过 ${Math.round(maxBytes / 1000 / 1000)} MB 上限` });
				return;
			}
			output.end(() => done({ ok: true, size: total }));
		});
	});
}

// #endregion
