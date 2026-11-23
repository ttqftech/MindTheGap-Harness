/*
 * 媒体转码 — 图片压缩 / 视频重编码（音频不转码）
 *
 * 设计取舍：
 * - 前端发来的**原始字节**按内容 hash 落进会话附件目录（raw-<hash>.<ext>），
 *   之后换档位 / 换编码都由后端拿这份 raw 重新转码，前端一次都不用重传。
 * - 「原图」档不调 ffmpeg，直接把 raw 当产物引用（复制都不做，谈不上重编码）。
 * - 视频按 1fps 重编码成 mp4，产物本体直接发给模型；不抽帧、不降级成图片。
 * - 音频**不进 ffmpeg**：token 只跟时长走（≈10 token/s），压缩省不了钱，原样字节直接发；这里只补一个 ffprobe 时长。
 * - ffmpeg / ffprobe 走系统二进制（PATH 或 MTG_FFMPEG / MTG_FFPROBE 覆盖）。
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ImageQuality, VideoCodec, VideoQuality } from '../shared/agent';

// #region 档位表

export interface ImageProfile {
	scale: number;	// 宽高等比缩放因子；1 = 不额外缩放
	maxEdge: number;	// 长边上限（等比缩进这个框里）；0 = 不限制
	estimateTokens: number;	// 预估 token，只用于设置页 / Msgbox 的说明文案
	label: string;
	desc: string;
}

export interface VideoProfile {
	scale: number;
	maxEdge: number;
	label: string;
	desc: string;
}

export const IMAGE_PROFILES: Record<ImageQuality, ImageProfile> = {
	low: { scale: 0.25, maxEdge: 512, estimateTokens: 300, label: '低清', desc: '四分之一宽高 · 长边 ≤ 512 · 约 300 token' },
	normal: { scale: 0.5, maxEdge: 1536, estimateTokens: 2000, label: '普通', desc: '二分之一宽高 · 长边 ≤ 1536 · 约 2000 token' },
	original: { scale: 1, maxEdge: 0, estimateTokens: 0, label: '原图', desc: '不重编码，按原始字节发送' },
};

export const VIDEO_PROFILES: Record<VideoQuality, VideoProfile> = {
	low: { scale: 0.25, maxEdge: 480, label: '低清', desc: '四分之一宽高 · 长边 ≤ 480 · 1fps' },
	normal: { scale: 0.5, maxEdge: 1280, label: '普通', desc: '二分之一宽高 · 长边 ≤ 1280 · 1fps' },
	high: { scale: 1, maxEdge: 1920, label: '高清', desc: '长边 ≤ 1920 · 1fps' },
};

export const VIDEO_CODECS: Record<VideoCodec, { label: string; args: string[] }>  = {
	h264: { label: 'H.264 / AVC', args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '24'] },
	h265: { label: 'H.265 / HEVC', args: ['-c:v', 'libx265', '-preset', 'faster', '-crf', '24'] },
	av1: { label: 'AV1', args: ['-c:v', 'libsvtav1', '-preset', '10', '-crf', '36'] },
	h266: { label: 'libvvenc', args: ['-c:v', 'libvvenc', '-preset', 'faster', '-crf', '26'] },
};

// #endregion

// #region 二进制定位

let ffmpegCache: string | null | undefined;
let ffprobeCache: string | null | undefined;

/** 按 PATH / 环境变量找一个能跑的 ffmpeg；找不到返回 null（由调用方转成明确报错） */
export function resolveFfmpeg(): string | null {
	if (ffmpegCache !== undefined) return ffmpegCache;
	const candidates = [process.env.MTG_FFMPEG, 'ffmpeg'].filter((v): v is string => !!v);
	for (const candidate of candidates) {
		try {
			const result = spawnSync(candidate, ['-version'], { timeout: 1500, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
			if (result.status === 0) {
				ffmpegCache = candidate;
				return candidate;
			}
		} catch {
			// 继续试下一个
		}
	}
	ffmpegCache = null;
	return null;
}

/** ffprobe 只是拿元信息，找不到也能转码（尺寸 / 时长留空即可） */
function resolveFfprobe(): string | null {
	if (ffprobeCache !== undefined) return ffprobeCache;
	const fromFfmpeg = resolveFfmpeg()?.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
	const candidates = [process.env.MTG_FFPROBE, fromFfmpeg, 'ffprobe'].filter((v): v is string => !!v);
	for (const candidate of candidates) {
		try {
			const result = spawnSync(candidate, ['-version'], { timeout: 6000, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
			if (result.status === 0) {
				ffprobeCache = candidate;
				return candidate;
			}
		} catch {
			// 继续试下一个
		}
	}
	ffprobeCache = null;
	return null;
}

export type CommandResult = { ok: boolean; error?: string; stdout?: string };

/** 异步跑外部命令：不阻塞 Service 的事件循环，stderr 只留最后一段便于排错 */
function runBinary(bin: string, args: string[], captureStdout = false): Promise<CommandResult> {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] });
		} catch (e) {
			resolve({ ok: false, error: (e as Error)?.message ?? String(e) });
			return;
		}
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
		child.stderr?.on('data', (chunk) => {
			stderr += String(chunk);
			if (stderr.length > 8000) stderr = stderr.slice(-8000);
		});
		child.on('error', (e) => resolve({ ok: false, error: e.message }));
		child.on('close', (code) => {
			if (code === 0) resolve({ ok: true, stdout });
			else resolve({ ok: false, error: stderr.trim().slice(-600) || `退出码 ${code}` });
		});
	});
}

async function runFfmpeg(args: string[]): Promise<CommandResult> {
	const bin = resolveFfmpeg();
	if (!bin) return { ok: false, error: '找不到 ffmpeg：请把它加进 PATH，或用环境变量 MTG_FFMPEG 指定可执行文件' };
	return runBinary(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

// #endregion

// #region filter / 编码

/**
 * 生成缩放 filter 链：先按比例压，再把长边限制住（等比、只缩不放）。
 *
 * ⚠️ 目标框必须取「当前尺寸与长边上限的较小值」：`scale=512:512:force_original_aspect_ratio=decrease`
 *    会把已经缩好的 480x270 **放大**回 512x288（1920x1080 的 1/2 更会被拉成 1536x864）。
 *    逗号在 filter 语法里是分隔符，所以 min() 内部的逗号要写成 `\,` 转义。
 * force_divisible_by=2 保证 H.264 / yuv420p 拿到偶数宽高。
 */
function scaleFilter(profile: { scale: number; maxEdge: number }): string {
	const parts: string[] = [];
	if (profile.scale < 1) parts.push(`scale=iw*${profile.scale}:ih*${profile.scale}:force_divisible_by=2`);
	if (profile.maxEdge > 0) {
		const edge = profile.maxEdge;
		parts.push(`scale=w='min(iw\\,${edge})':h='min(ih\\,${edge})':force_original_aspect_ratio=decrease:force_divisible_by=2`);
	}
	return parts.join(',');
}

/** 图片压缩：低清 / 普通统一输出 jpeg；原图由调用方直接引用 raw，不进这里 */
export async function encodeImage(rawPath: string, outPath: string, quality: Exclude<ImageQuality, 'original'>): Promise<CommandResult> {
	const vf = scaleFilter(IMAGE_PROFILES[quality]);
	// -frames:v 1：gif / apng 之类多帧图只取第一帧，避免 image2 输出一串文件
	return runFfmpeg(['-i', rawPath, '-vf', vf, '-frames:v', '1', '-q:v', '4', '-f', 'image2', outPath]);
}

/** 视频重编码：按档位缩放 + 统一 1fps，产物是 mp4（这份 mp4 本体直接发给模型） */
export async function encodeVideo(rawPath: string, outPath: string, quality: VideoQuality, codec: VideoCodec): Promise<CommandResult> {
	const vf = `${scaleFilter(VIDEO_PROFILES[quality])},fps=1`;
	return runFfmpeg([
		'-hide_banner',
		'-hwaccel', 'auto',
		'-i', rawPath,
		'-vf', vf,
		...VIDEO_CODECS[codec].args,
		'-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-b:a', '128k',
		'-movflags', '+faststart',
		outPath,
	]);
}

/** 产物宽高（图片 / 视频通用）；ffprobe 不可用时返回空对象，不阻断转码 */
export async function probeSize(mediaPath: string): Promise<{ width?: number; height?: number }> {
	const bin = resolveFfprobe();
	if (!bin) return {};
	const size = await runBinary(bin, [
		'-v', 'error', '-select_streams', 'v:0',
		'-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', mediaPath,
	], true);
	const match = /^(\d+)x(\d+)/.exec(size.stdout?.trim() ?? '');
	return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

/** 视频产物的宽高 / 时长 */
export async function probeVideo(videoPath: string): Promise<{ width?: number; height?: number; duration?: number }> {
	const bin = resolveFfprobe();
	const size = await probeSize(videoPath);
	if (!bin) return size;
	const duration = await runBinary(bin, [
		'-v', 'error', '-show_entries', 'format=duration',
		'-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
	], true);
	const seconds = Number(duration.stdout?.trim() ?? '');
	return { ...size, duration: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined };
}

/** 音频产物的时长（原样传输，不转码）；ffprobe 不可用或读不到就留空，不阻断发送 */
export async function probeAudio(audioPath: string): Promise<{ duration?: number }> {
	const bin = resolveFfprobe();
	if (!bin) return {};
	const result = await runBinary(bin, [
		'-v', 'error', '-show_entries', 'format=duration',
		'-of', 'default=noprint_wrappers=1:nokey=1', audioPath,
	], true);
	const seconds = Number(result.stdout?.trim() ?? '');
	return Number.isFinite(seconds) && seconds > 0 ? { duration: seconds } : {};
}

// #endregion
