/*
 * 输入框里点媒体 chip → 弹出的预览 / 清晰度 Msgbox
 *
 * ⚠️ 预览的是**后端真实转码产物**，不是前端用 canvas 模拟的：
 * 切档时先 prepare 判重，缺原始字节才上传；后端已有 raw 时它自己重编码，
 * 前端连字节都不用再发一次。所以「看到的 = 模型会收到的」。
 *
 * 内容用 lit-html 写在 `content: () => TemplateResult` 里（msgbox 每次重渲染都会
 * 重新调用这个函数），状态变更后调 `box.requestUpdate()` 刷新。
 */

import { html, type TemplateResult } from 'ffbox-ui';
import { ensureMedia, getAttachmentUrl, type MediaParams } from '@mainview/bridges/agentBridge';
import { showMsgbox } from '@mainview/bridges/ffboxBridge';
import {
	IMAGE_QUALITY_OPTIONS, VIDEO_CODEC_OPTIONS, VIDEO_QUALITY_OPTIONS,
	type ImageQuality, type LlmImageRef, type LlmVideoRef, type VideoCodec, type VideoQuality,
} from '@shared/agent';

export interface MediaPreviewOptions {
	/** 真会话 id；空白会话传 DRAFT_MEDIA_CONVERSATION_ID（产物落在全局媒体缓存里） */
	conversationId: string;
	file: File;
	name: string;
	kind: 'image' | 'video';
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
	kind: 'image' | 'video',
	image: LlmImageRef | undefined,
	video: LlmVideoRef | undefined,
	cached: boolean | undefined,
): string {
	const target = image ?? video;
	if (!target) return '';
	const parts: string[] = [];
	if (target.width && target.height) parts.push(`${target.width} × ${target.height}`);
	const size = fmtSize(target.size);
	if (size) parts.push(size);
	if (kind === 'image' && image) {
		const option = IMAGE_QUALITY_OPTIONS.find((o) => o.value === image.quality);
		if (option && image.quality !== 'original') parts.push(`预估 ${image.quality === 'low' ? 300 : 2000} token`);
	} else if (video) {
		parts.push('1fps');
		if (video.duration) parts.push(`${video.duration.toFixed(1)} 秒`);
		parts.push(VIDEO_CODEC_OPTIONS.find((o) => o.value === video.codec)?.label ?? video.codec);
	}
	parts.push(cached ? '已命中缓存（未重新传输 / 转码）' : '本次已完成转码');
	return parts.join(' · ');
}

export function showMediaPreviewMsgbox(options: MediaPreviewOptions): void {
	const state: PreviewState = {
		phase: 'loading',
		quality: options.quality,
		url: '',
		info: '',
		message: '正在准备预览…',
	};
	let box: ReturnType<typeof showMsgbox> | undefined;
	const refresh = () => box?.requestUpdate();

	const radioItems = (options.kind === 'image' ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS)
		.map((option) => ({ value: option.value, caption: option.label }));

	const withCacheBuster = (url: string) => `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;

	/** 向后端要当前档位的真实产物：prepare 判重 → 需要才上传 → 完成才拿到 URL */
	const load = async (quality: ImageQuality | VideoQuality) => {
		state.quality = quality;
		state.phase = 'loading';
		state.url = '';
		state.info = '';
		const label = (options.kind === 'image' ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS)
			.find((option) => option.value === quality)?.label ?? String(quality);
		state.message = `正在按「${label}」接收并转码…`;
		refresh();

		const params: MediaParams = {
			kind: options.kind,
			hash: options.hash,
			name: options.name,
			mime: options.file.type || 'application/octet-stream',
			quality,
			codec: options.kind === 'video' ? options.codec : undefined,
		};
		const result = await ensureMedia(options.conversationId, params, options.file);
		if (!result.ok) {
			state.phase = 'error';
			state.message = result.error ?? '后端没有返回预览产物';
			refresh();
			return;
		}
		const target = result.image ?? result.video;
		if (!target) {
			state.phase = 'error';
			state.message = '后端没有返回预览产物';
			refresh();
			return;
		}
		state.phase = 'ready';
		state.url = withCacheBuster(getAttachmentUrl(options.conversationId, target.file));
		state.info = describeResult(options.kind, result.image, result.video, result.cached);
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
		// H.265 / AV1 浏览器未必能解码（不是本功能的重点），这里直接播放转码产物本体
		return html`<video src=${state.url} controls style="display:block; width: 460px; height: 300px; object-fit: contain; border-radius: 6px; background: #000;"></video>`;
	};

	const view = () => html`
		<div style="text-align: left;">
			<div style="display: flex; gap: 14px; align-items: flex-start;">
				<div>${previewArea()}</div>
				<div style="width: 190px; min-height: 200px; border: 1px solid rgba(127,127,127,0.25); border-radius: 6px; overflow: hidden;">
					<ffbox-radio-list
						.list=${radioItems}
						.value=${state.quality}
						@change=${onQualityChange}
					></ffbox-radio-list>
				</div>
			</div>
			<div style="max-width: 664px; margin-top: 10px; font-size: 12px; line-height: 1.6; opacity: 0.85;">
				${state.info || state.message}
			</div>
			<div style="max-width: 664px; margin-top: 4px; font-size: 12px; line-height: 1.6; opacity: 0.6;">
				${(options.kind === 'image' ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS)
					.find((option) => option.value === state.quality)?.desc ?? ''}
			</div>
		</div>
	`;

	box = showMsgbox({
		title: `${options.kind === 'image' ? '图片' : '视频'}预览 · ${options.name}`,
		content: view,
		buttons: [
			{
				text: '使用此清晰度',
				type: 'primary',
				role: 'confirm',
				callback: () => { options.onApply(state.quality); },
			},
			{ text: '取消', role: 'cancel' },
		],
	});

	void load(options.quality);
}
