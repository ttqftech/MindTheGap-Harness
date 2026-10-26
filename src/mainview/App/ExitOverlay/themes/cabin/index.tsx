/**
 * 主题八 · 车窗
 *
 * 画面：坐在车厢里看窗外 —— 隧道壁灯一盏盏向后飞掠、站牌划过，尽头的光越来越近，冲出隧道口一片白。
 * 声音：与「隧道」同一首 54 香港.flac（11.2s），第 7 秒进收尾段。
 * 外壳：先**撑大扑面**（1.1 倍，像冲出隧道口那一刻），再急速收成中心一点。
 */

import { createSignal, For } from 'solid-js';
import { EASE } from '../../shell';
import { playMusic } from '../../audio';
import exitMusicUrl from '../../assets/港铁关门提示音.mp3';
import styles from './cabin.module.css';
import type { ExitTheme } from '../../types';

/** 窗外掠过的壁灯数量 */
const LAMP_COUNT = 7;
/** 撑大扑面的时长 / 之后收成一点的时长 */
const PUSH_MS = 1100;
const COLLAPSE_MS = 2700;

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'ride' | 'burst';
const [stage, setStage] = createSignal<Stage>('ride');

function Cabin() {
	return (
		<div class={styles.root} data-stage={stage()}>
			{/* 车窗：窗外的一切都发生在这一个框里 */}
			<div class={styles.window}>
				<div class={styles.outside}>
					<div class={styles.speed} />
					<For each={Array.from({ length: LAMP_COUNT })}>
						{(_, i) => <div class={styles.lamp} style={{ 'animation-delay': `${i() * 0.72}s` }} />}
					</For>
					<div class={styles.sign}>MIND THE GAP</div>
					<div class={styles.end} />
				</div>
				<div class={styles.glass} />
			</div>

			{/* 车厢内：扶手与座椅轮廓 */}
			<div class={styles.interior}>
				<div class={styles.grabBar} />
				<div class={styles.seat} />
			</div>

			<div class={styles.caption}>本次列车开往 MindTheGap · NEXT MindTheGap</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'cabin',
	label: '车窗',
	desc: '车厢内向外看，冲出隧道口后窗口先撑大再收成一点',
	Component: Cabin,

	async run({ shell }) {
		setStage('ride');
		await playMusic(exitMusicUrl, { cueSeconds: 7, volume: 0.85 });

		setStage('burst');
		// 两段：先原地撑大 10%（画面扑面而来，窗口略微超出屏幕），再从撑大态急速收成中心一点
		await shell.run((t, f) => {
			const k = 1 + 0.1 * EASE.easeOutExpo(t);
			const width = f.width * k;
			const height = f.height * k;
			return { x: f.x - (width - f.width) / 2, y: f.y - (height - f.height) / 2, width, height };
		}, PUSH_MS);

		await shell.run((t, f) => {
			const k = 1.1 * (1 - EASE.easeInCubic(t));	// 从撑大态接上，一路收到 0
			const width = f.width * k;
			const height = f.height * k;
			return { x: f.x + (f.width - width) / 2, y: f.y + (f.height - height) / 2, width, height };
		}, COLLAPSE_MS);
	},
};

export default theme;
