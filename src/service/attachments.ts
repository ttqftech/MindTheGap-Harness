/* ==========================================================================
   会话附件（目前只有图片）

   设计取舍：
   - 前端把用户选的图片**上传**给 Service（浏览器 / 远程连接都适用），由 Service 写进 `conversations/<id>/attachments/`，
     ctx 里只存 `{ name, mime, file, size }`（见 shared/agent.ts 的 LlmImageRef）；
   - 真正请求 LLM 时由 runner 现读成 base64（OpenAI / Anthropic 都支持 data URL / base64 block），不把 base64 写进 ctx.json。
   ========================================================================== */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { LlmImageRef } from '../shared/agent';
import { conversationDir } from './storage';

const IMAGE_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

const MIME_EXT: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
};

/** 单张图片上限（超过直接拒收，避免一次上传把会话目录撑爆） */
export const MAX_IMAGE_BYTES = 20 * 1000 * 1000;

/** 会话附件目录 */
export function attachmentsDir(conversationId: string): string {
	return join(conversationDir(conversationId), 'attachments');
}

/**
 * 把一张**已上传的图片字节**写进会话附件目录。
 * mime 不在允许列表 / 超过上限时返回 null（由调用方回 400）。
 */
export function saveImageBuffer(conversationId: string, name: string, mime: string, data: Buffer): LlmImageRef | null {
	const ext = MIME_EXT[mime];
	if (!ext) return null;
	if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return null;
	const dir = attachmentsDir(conversationId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const stamp = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	const file = `${stamp}-${rand}${ext}`;
	writeFileSync(join(dir, file), data);
	const displayName = basename(name || `image${ext}`);
	return { name: displayName, mime, file, size: data.byteLength };
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
	return IMAGE_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
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
