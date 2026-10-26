/**
 * 主题五 · 闸机
 *
 * 画面：出站闸机正对视角 —— 投卡 → 指示灯由红转绿 → 翼门向两侧收起 → 通行。
 * 声音：刷卡「哔」+ 吸卡 + 放行提示 + 电机开门 + 门合拢 + 远去的车厢。
 * 外壳：**宽高全程不变，整个窗口匀速向左滑出屏幕** —— 唯一一个「位移型」主题。
 */

import { createSignal } from 'solid-js';
import { EASE } from '../../shell';
import { playSynth, type SynthEvent } from '../../audio';
import styles from './turnstile.module.css';
import type { ExitTheme } from '../../types';

/** 刷卡到放行 */
const PASS_MS = 1500;
/** 翼门合拢、画面被带走的时刻 */
const CUE_MS = 2900;
/** 滑出屏幕的时长（比 cue 之后的时间富余一点，收尾由主进程兜底） */
const SLIDE_MS = 1500;
/** 放行前那一下「卡住了又放行」的顿挫 */
const JITTER_MS = 380;

const SOUNDS: SynthEvent[] = [
	{ at: 120, kind: 'ping', freq: 2100, durationMs: 170 },
	{ at: 660, kind: 'clack', freq: 1450, durationMs: 130 },
	{ at: PASS_MS - 160, kind: 'ping', freq: 1560, durationMs: 220 },
	{ at: PASS_MS + 80, kind: 'whoosh', freq: 2600, durationMs: 720 },
	{ at: CUE_MS - 460, kind: 'clack', freq: 880, durationMs: 170 },
	{ at: CUE_MS, kind: 'hum', freq: 84, durationMs: 900 },
];

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'check' | 'leave';
const [stage, setStage] = createSignal<Stage>('check');

function Turnstile() {
	return (
		<div class={styles.root} data-stage={stage()}>
			<div class={styles.hall} />
			<div class={styles.floor} />

			{/* 两侧闸机机身 */}
			<div class={styles.pillar} data-side="left">
				<div class={styles.pillarTop} />
				<div class={styles.pillarBody} />
			</div>
			<div class={styles.pillar} data-side="right">
				<div class={styles.pillarTop} />
				<div class={styles.pillarBody} />
			</div>

			{/* 通道中间：回收口 + 被吸入的车票 + 两片翼门 */}
			<div class={styles.lane}>
				<div class={styles.slot} />
				<div class={styles.ticket} />
				<div class={styles.wing} data-side="left" />
				<div class={styles.wing} data-side="right" />
			</div>

			{/* 通行指示灯：红叉 → 绿箭头 */}
			<div class={styles.lamp}>
				<span class={styles.cross}>✕</span>
				<span class={styles.arrow}>➜</span>
			</div>

			<div class={styles.caption}>
				<span class={styles.capA}>请验票 · INSERT TICKET</span>
				<span class={styles.capB}>通行 · GO THROUGH</span>
			</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'turnstile',
	label: '闸机',
	desc: '刷卡出站，窗口整体向左滑出屏幕',
	Component: Turnstile,

	async run({ shell }) {
		setStage('check');
		await playSynth(SOUNDS, CUE_MS);

		setStage('leave');
		// 两段：先原地顿一下（像闸机犹豫了半拍），再匀速向左滑出屏幕。
		// 宽高全程不变，所以这一主题的画面不会被两侧裁掉，是整体「走掉」的观感。
		await shell.run((t, f) => ({
			x: f.x + Math.sin(t * Math.PI * 4) * 5 * (1 - EASE.linear(t)),
			y: f.y,
			width: f.width,
			height: f.height,
		}), JITTER_MS);

		await shell.run((t, f) => ({
			x: f.x - (f.width + 80) * EASE.easeInCubic(t),
			y: f.y,
			width: f.width,
			height: f.height,
		}), SLIDE_MS);
	},
};

export default theme;
