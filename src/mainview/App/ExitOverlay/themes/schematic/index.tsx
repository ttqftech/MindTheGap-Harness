/**
 * 主题四 · 线路蓝图
 *
 * 画面：工程蓝图底色 + 网格，一条折线线路图，光点从起点一路跑到终点 MindTheGap。
 * 声音：低频底噪 + 每到一个站点一声 ping + 收尾上扬 sweep（合成）。
 * 外壳：**向右上角**收 —— x 增大、y 不动、宽高同时归零，像整张图被吸进终点那个点。
 */

import { createSignal, For } from 'solid-js';
import { EASE } from '@mainview/App/ExitOverlay/shell';
import { playSynth, type SynthEvent } from '@mainview/App/ExitOverlay/audio';
import styles from './schematic.module.css';
import type { ExitTheme } from '@mainview/App/ExitOverlay/types';

/** 线路折点（SVG 用户坐标，viewBox 1200×600） */
const STOPS = [
	{ x: 90, y: 470, name: 'Code' },
	{ x: 280, y: 470, name: 'Daily' },
	{ x: 390, y: 330, name: 'Storage' },
	{ x: 660, y: 330, name: 'Review' },
	{ x: 770, y: 205, name: 'Draft' },
	{ x: 1120, y: 205, name: 'MindTheGap' },
] as const;

const POLYLINE = STOPS.map((s) => `${s.x},${s.y}`).join(' ');
/** 光点跑完全程的时长（与 CSS 的 ride 动画一致） */
const RIDE_MS = 3200;
const CUE_MS = 3500;

const SOUNDS: SynthEvent[] = [
	{ at: 0, kind: 'hum', freq: 64, durationMs: 3000 },
	{ at: 620, kind: 'ping', freq: 990, durationMs: 220 },
	{ at: 1240, kind: 'ping', freq: 1108, durationMs: 220 },
	{ at: 1880, kind: 'ping', freq: 1244, durationMs: 220 },
	{ at: 2520, kind: 'ping', freq: 1396, durationMs: 220 },
	{ at: 3150, kind: 'whoosh', freq: 5600, durationMs: 800 },
	{ at: 3260, kind: 'ping', freq: 1760, durationMs: 520 },
];

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'trace' | 'collapse';
const [stage, setStage] = createSignal<Stage>('trace');

function Schematic() {
	return (
		<div class={styles.root} data-stage={stage()}>
			<div class={styles.grid} />

			<svg class={styles.map} viewBox="0 0 1200 600" xmlns="http://www.w3.org/2000/svg">
				<polyline class={styles.track} points={POLYLINE} />
				<polyline class={styles.trace} points={POLYLINE} />

				<For each={STOPS}>
					{(s, i) => (
						<g class={styles.stop} style={{ 'animation-delay': `${i() * 0.52}s` }}>
							<circle class={styles.stopDot} cx={s.x} cy={s.y} r="7" />
							<text class={styles.stopName} x={s.x} y={s.y - 18}>{s.name}</text>
						</g>
					)}
				</For>

				<circle class={styles.rider} cx={STOPS[0].x} cy={STOPS[0].y} r="9" />
				<circle class={styles.riderHalo} cx={STOPS[0].x} cy={STOPS[0].y} r="20" />
			</svg>

			<div class={styles.title}>LINE MAP · 线路图</div>
			<div class={styles.terminus}>TERMINUS · MindTheGap</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'schematic',
	label: '线路图',
	desc: '光点跑到线路终点，窗口向右上角收成一点',
	Component: Schematic,

	async run({ shell }) {
		setStage('trace');
		await playSynth(SOUNDS, CUE_MS);

		setStage('collapse');
		// 右上角锚定：x 一路右移、y 不动，宽高同时收缩 → 收进右上角那个点
		await shell.run((t, f) => {
			const e = EASE.easeInOutQuint(t);
			const width = f.width * (1 - e);
			const height = f.height * (1 - e);
			return { x: f.x + (f.width - width), y: f.y, width, height };
		}, 3000);
	},
};

export default theme;
