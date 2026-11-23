/* ---------- 媒体 Tab — 服务端组 ----------
   默认值真相在后端 settings.media；改动走 store 的防抖写盘（和 providers 同一条通道）。
   -------------------------------------------------------------------------- */

import { For } from 'solid-js';
import { state, actions } from '@mainview/stores';
import { IMAGE_QUALITY_OPTIONS, VIDEO_QUALITY_OPTIONS } from '@shared/agent';
import type { ImageQuality, VideoQuality } from '@shared/agent';
import { radioValue } from './SettingsCommon';
import common from './SettingsCommon.module.css';

export function MediaTab() {
	return (
		<>
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>图片输入</div>
				<div class={common['settingGroup-desc']}>新放进输入框的图片默认按这一档压缩；每张图都能点缩略图在弹窗里单独改。</div>
				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>默认清晰度</span>
						<span class={common.desc}>压缩由后端完成，发给模型与弹窗预览用的是同一份产物</span>
					</div>
					<div class={common.mediaRadio}>
						<ffbox-radio-list
							prop:list={IMAGE_QUALITY_OPTIONS.map((option) => ({ value: option.value, caption: option.label }))}
							prop:value={state.media.imageQuality}
							onchange={(e) => actions.setMediaImageQuality(radioValue(e) as ImageQuality)}
						/>
					</div>
				</div>
				<For each={IMAGE_QUALITY_OPTIONS}>{(option) => (
					<div class={common.mediaOptionDesc}>{option.label} · {option.desc}</div>
				)}</For>
			</div>

			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>视频输入</div>
				<div class={common['settingGroup-desc']}>视频按 1fps 重编码后以 mp4 本体交给模型；是否允许输入、用哪种编码在「模型」页按模型单独设置。</div>
				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>默认清晰度</span>
						<span class={common.desc}>三档统一按 1fps 重编码，转码后的 mp4 本体直接发给模型</span>
					</div>
					<div class={common.mediaRadio}>
						<ffbox-radio-list
							prop:list={VIDEO_QUALITY_OPTIONS.map((option) => ({ value: option.value, caption: option.label }))}
							prop:value={state.media.videoQuality}
							onchange={(e) => actions.setMediaVideoQuality(radioValue(e) as VideoQuality)}
						/>
					</div>
				</div>
			<For each={VIDEO_QUALITY_OPTIONS}>{(option) => (
				<div class={common.mediaOptionDesc}>{option.label} · {option.desc}</div>
			)}</For>
		</div>

		<div class={common.settingGroup}>
			<div class={common['settingGroup-label']}>音频输入</div>
			<div class={common['settingGroup-desc']}>音频不区分质量档位：token 只跟时长走（约 10 token/s），压缩省不了钱，因此原样传输、不重编码。这里没有可调项。</div>
			<div class={common.settingRow}>
				<div class={common.label}>
					<span class={common.title}>内容块格式</span>
					<span class={common.desc}>各家的音频块写法不一致且无法通用，所以不再自动探测：按模型在「模型」页选「支持音频输入」与接口（input_audio / audio_url）</span>
				</div>
			</div>
		</div>
	</>
);
}
