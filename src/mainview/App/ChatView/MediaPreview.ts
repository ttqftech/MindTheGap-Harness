/*
 * 输入框里点媒体 chip → 弹出的预览 / 清晰度 Msgbox
 *
 * ⚠️ 预览的是**后端真实产物**，不是前端用 canvas 模拟的：
 * 切档时先 prepare 判重，缺原始字节才上传；后端已有 raw 时它自己重编码，
 * 前端连字节都不用再发一次。所以「看到的 = 模型会收到的」。
 * 音频没有档位，Msgbox 只负责播放原样字节并说明 token 估算。
 *
 * 内容用 lit-html 写在 `content: () => TemplateResult` 里（msgbox 每次重渲染都会
 * 重新调用这个函数），状态变更后调 `box.requestUpdate()` 刷新。
 */

import { html, type TemplateResult } from 'ffbox-ui';
import { ensureMedia, getAttachmentUrl, type MediaParams } from '@mainview/bridges/agentBridge';
import { showMsgbox } from '@mainview/bridges/ffboxBridge';
import {
	IMAGE_QUALITY_OPTIONS, VIDEO_CODEC_OPTIONS, VIDEO_QUALITY_OPTIONS,
	type ImageQuality, type LlmAudioRef, type LlmImageRef, type LlmVideoRef, type VideoCodec, type VideoQuality,
} from '@shared/agent';

export interface MediaPreviewOptions {
	/** 真会话 id；空白会话传 DRAFT_MEDIA_CONVERSATION_ID（产物落在全局媒体缓存里） */
	conversationId: string;
	file: File;
	name: string;
	kind: 'image' | 'video' | 'audio';
	hash: string;
	quality: ImageQuality | VideoQuality;
	codec: VideoCodec;
	onApply: (quality: ImageQuality | VideoQuality) => void;
}

interface PreviewState {
	phase: 'loading' | 'ready' | 'error';
	quality: ImageQuality | VideoQuality;
	url: string;
	info: string;
	message: string;
}

function fmtSize(bytes?: number): string {
	if (!bytes) return '';
	return bytes >= 1000 * 1000 ? `${(bytes / 1000 / 1000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

/** 压缩效果说明：尺寸 / 体积 / 时长 / 编码 / 预估 token / 是否命中缓存 */
function describeResult(
	kind: 'image' | 'video' | 'audio',
	image: LlmImageRef | undefined,
	video: LlmVideoRef | undefined,
	audio: LlmAudioRef | undefined,
	cached: boolean | undefined,
): string {
	const target = image ?? video ?? audio;
	if (!target) return '';
	const parts: string[] = [];
	if (image?.width && image.height) parts.push(`${image.width} × ${image.height}`);
	if (video?.width && video.height) parts.push(`${video.width} × ${video.height}`);
	const size = fmtSize(target.size);
	if (size) parts.push(size);
	if (kind === 'image' && image) {
		const option = IMAGE_QUALITY_OPTIONS.find((o) => o.value === image.quality);
		if (option && image.quality !== 'original') parts.push(`预估 ${image.quality === 'low' ? 300 : 2000} token`);
	} else if (video) {
		parts.push('1fps');
		if (video.duration) parts.push(`${video.duration.toFixed(1)} 秒`);
		parts.push(VIDEO_CODEC_OPTIONS.find((o) => o.value === video.codec)?.label ?? video.codec);
	} else if (audio) {
		parts.push(`${audio.format.toUpperCase()} · 原样传输`);
		if (audio.duration) parts.push(`${audio.duration.toFixed(1)} 秒 · 约 ${Math.round(audio.duration * 10)} token`);
	}
	parts.push(cached ? '已命中缓存（未重新传输）' : kind === 'audio' ? '本次已完成接收' : '本次已完成转码');
	return parts.join(' · ');
}

export function showMediaPreviewMsgbox(options: MediaPreviewOptions): void {
	const isAudio = options.kind === 'audio';
	const state: PreviewState = {
		phase: 'loading',
		quality: options.quality,
		url: '',
		info: '',
		message: '正在准备预览…',
	};
	let box: ReturnType<typeof showMsgbox> | undefined;
	const refresh = () => box?.requestUpdate();

	const qualityOptions = options.kind === 'image' ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS;
	const radioItems = qualityOptions.map((option) => ({ value: option.value, caption: option.label }));

	const withCacheBuster = (url: string) => `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;

	/** 向后端要当前档位的真实产物：prepare 判重 → 需要才上传 → 完成才拿到 URL */
	const load = async (quality: ImageQuality | VideoQuality) => {
		state.quality = quality;
		state.phase = 'loading';
		state.url = '';
		state.info = '';
		const label = qualityOptions.find((option) => option.value === quality)?.label ?? String(quality);
		state.message = isAudio ? '正在接收音频…' : `正在按「${label}」接收并转码…`;
		refresh();

		const params: MediaParams = {
			kind: options.kind,
			hash: options.hash,
			name: options.name,
			mime: options.file.type || 'application/octet-stream',
			quality: isAudio ? 'original' : quality,	// 音频没档位，后端会忽略这个字段
			codec: options.kind === 'video' ? options.codec : undefined,
		};
		const result = await ensureMedia(options.conversationId, params, options.file);
		if (!result.ok) {
			state.phase = 'error';
			state.message = result.error ?? '后端没有返回预览产物';
			refresh();
			return;
		}
		const target = result.image ?? result.video ?? result.audio;
		if (!target) {
			state.phase = 'error';
			state.message = '后端没有返回预览产物';
			refresh();
			return;
		}
		state.phase = 'ready';
		state.url = withCacheBuster(getAttachmentUrl(options.conversationId, target.file));
		state.info = describeResult(options.kind, result.image, result.video, result.audio, result.cached);
		refresh();
	};

	const onQualityChange = (e: CustomEvent<unknown>) => {
		const detail = e.detail as { value?: string } | string | undefined;
		const value = (typeof detail === 'string' ? detail : detail?.value) as ImageQuality | VideoQuality | undefined;
		if (!value || value === state.quality) return;
		void load(value);
	};

	const previewArea = (): TemplateResult => {
		if (state.phase === 'loading') {
			return html`<div style="width: 460px; height: 300px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: rgba(127,127,127,0.12); font-size: 13px;">${state.message}</div>`;
		}
		if (state.phase === 'error') {
			return html`<div style="width: 460px; min-height: 120px; padding: 16px; box-sizing: border-box; border-radius: 6px; background: rgba(127,127,127,0.12); color: #d9534f; font-size: 13px; line-height: 1.6;">${state.message}</div>`;
		}
		if (options.kind === 'image') {
			return html`<img src=${state.url} alt=${options.name} style="display:block; width: 460px; height: 300px; object-fit: contain; border-radius: 6px; background: rgba(127,127,127,0.12);" />`;
		}
		if (isAudio) {
			return html`<div style="width: 460px; height: 300px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: rgba(127,127,127,0.12);"><audio src=${state.url} controls style="width: 420px;"></audio></div>`;
		}
		// H.265 / AV1 浏览器未必能解码（不是本功能的重点），这里直接播放转码产物本体
		return html`<video src=${state.url} controls style="display:block; width: 460px; height: 300px; object-fit: contain; border-radius: 6px; background: #000;"></video>`;
	};

	const view = () => html`
		<div style="text-align: left;">
			<div style="display: flex; gap: 14px; align-items: flex-start;">
				<div>${previewArea()}</div>
				<div style="width: 190px; min-height: 200px; border: 1px solid rgba(127,127,127,0.25); border-radius: 6px; overflow: hidden;">
					${isAudio
						? html`<div style="padding: 12px; font-size: 12px; line-height: 1.8; opacity: 0.8;">音频不区分质量档位<br>token 只跟时长走（≈10 token/s）<br>压缩省不了钱，原样字节直接发给模型</div>`
						: html`<ffbox-radio-list .list=${radioItems} .value=${state.quality} @change=${onQualityChange}></ffbox-radio-list>`}
				</div>
			</div>
			<div style="max-width: 664px; margin-top: 10px; font-size: 12px; line-height: 1.6; opacity: 0.85;">
				${state.info || state.message}
			</div>
			<div style="max-width: 664px; margin-top: 4px; font-size: 12px; line-height: 1.6; opacity: 0.6;">
				${isAudio ? '不做压缩 / 重编码，预览的就是发给模型的字节' : (qualityOptions.find((option) => option.value === state.quality)?.desc ?? '')}
			</div>
		</div>
	`;

	const buttons = isAudio
		? [{ text: '关闭', role: 'cancel' as const }]
		: [
			{
				text: '使用此清晰度',
				type: 'primary' as const,
				role: 'confirm' as const,
				callback: () => { options.onApply(state.quality); },
			},
			{ text: '取消', role: 'cancel' as const },
		];

	box = showMsgbox({
		title: `${options.kind === 'image' ? '图片' : options.kind === 'video' ? '视频' : '音频'}预览 · ${options.name}`,
		content: view,
		buttons,
	});

	void load(options.quality);
}
