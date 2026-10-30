/**
 * 主题七 · 环线
 *
 * 画面：一条环形线路。列车从「CENTRAL」发车绕行一圈，依次点亮六站，跑满后加速成一道光环。
 * 声音：低频底噪 + 每站一声 ping + 收尾下坠 sweep。
 * 外壳：**螺旋收缩** —— 窗口一边缩小一边绕着屏幕中心转圈，最后一圈拧成一个点。
 */

import { createSignal } from 'solid-js';
import { EASE } from '@mainview/App/ExitOverlay/shell';
import { playSynth, type SynthEvent } from '@mainview/App/ExitOverlay/audio';
import styles from './loop.module.css';
import type { ExitTheme } from '@mainview/App/ExitOverlay/types';

/** 列车绕行一圈 */
const ORBIT_MS = 3800;
/** 跑满一圈 → 开始收外壳 */
const CUE_MS = 4000;
/** 螺旋收缩 */
const SPIRAL_MS = 4200;
/** 绕圈圈数（略多于一圈，末班甩尾的观感） */
const TURNS = 1.15;

const SOUNDS: SynthEvent[] = [
	{ at: 40, kind: 'hum', freq: 74, durationMs: ORBIT_MS + 600 },
	{ at: 480, kind: 'ping', freq: 1180, durationMs: 240 },
	{ at: 1080, kind: 'ping', freq: 1240, durationMs: 240 },
	{ at: 1700, kind: 'ping', freq: 1300, durationMs: 240 },
	{ at: 2320, kind: 'ping', freq: 1360, durationMs: 240 },
	{ at: 2940, kind: 'ping', freq: 1420, durationMs: 240 },
	{ at: 3560, kind: 'ping', freq: 1520, durationMs: 320 },
	{ at: CUE_MS, kind: 'whoosh', freq: 900, durationMs: SPIRAL_MS },
];

/** 环上六站：坐标由 r=200 的圆按 60° 分布算好，写死在 SVG 用户坐标里 */
const STOPS: readonly { x: number; y: number; lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; name: string }[] = [
	{ x: 300, y: 100, lx: 300, ly: 58, anchor: 'middle', name: 'CENTRAL' },
	{ x: 473, y: 200, lx: 505, ly: 205, anchor: 'start', name: 'EXCHANGE' },
	{ x: 473, y: 400, lx: 505, ly: 415, anchor: 'start', name: 'JUNCTION' },
	{ x: 300, y: 500, lx: 300, ly: 548, anchor: 'middle', name: 'DEPOT' },
	{ x: 127, y: 400, lx: 95, ly: 415, anchor: 'end', name: 'HARBOUR' },
	{ x: 127, y: 200, lx: 95, ly: 205, anchor: 'end', name: 'MIND THE GAP' },
];

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'run' | 'spiral';
const [stage, setStage] = createSignal<Stage>('run');

function Loop() {
	return (
		<div class={styles.root} data-stage={stage()}>
			<svg class={styles.map} viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
				{/* 环线本身 */}
				<circle class={styles.ring} cx="300" cy="300" r="200" />
				{/* 已跑过的那一段 */}
				<circle class={styles.trace} cx="300" cy="300" r="200" />

				{/* 六站 */}
				{STOPS.map((s) => (
					<g class={styles.stop}>
						<circle class={styles.stopDot} cx={s.x} cy={s.y} r="8" />
						<text class={styles.stopName} x={s.lx} y={s.ly} text-anchor={s.anchor}>
							{s.name}
						</text>
					</g>
				))}

				{/* 列车：绕 viewBox 中心旋转 */}
				<g class={styles.train}>
					<circle class={styles.halo} cx="300" cy="100" r="20" />
					<rect class={styles.car} x="286" y="86" width="28" height="28" rx="7" />
				</g>
			</svg>

			<div class={styles.caption}>
				<span class={styles.capA}>末班环线 · LAST LOOP</span>
				<span class={styles.capB}>本次列车已回到车库 · SERVICE ENDED</span>
			</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'loop',
	label: '环线',
	desc: '列车绕环线一圈，窗口边转边收成一个点',
	Component: Loop,

	async run({ shell }) {
		setStage('run');
		await playSynth(SOUNDS, CUE_MS);

		setStage('spiral');
		// 螺旋：尺寸按 easeInOutCubic 收到中心，同时 x/y 沿一个逐渐归零的圆偏移 —— 像末班车绕完最后一圈被吸进车库
		await shell.run((t, f) => {
			const k = 1 - EASE.easeInOutCubic(t);
			const width = f.width * k;
			const height = f.height * k;
			const ang = t * Math.PI * 2 * TURNS - Math.PI / 2;
			const swing = 0.09 * (1 - t);	// 绕圈半径一开始就收着，免得窗口甩出屏幕
			const cx = f.x + f.width / 2;
			const cy = f.y + f.height / 2;
			return {
				x: cx - width / 2 + Math.cos(ang) * f.width * swing,
				y: cy - height / 2 + Math.sin(ang) * f.height * swing,
				width,
				height,
			};
		}, SPIRAL_MS);
	},
};

export default theme;
