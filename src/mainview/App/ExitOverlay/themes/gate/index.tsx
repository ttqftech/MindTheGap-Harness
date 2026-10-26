/**
 * 主题三 · 屏蔽门
 *
 * 画面：站台视角。门后列车灯带掠过，两扇玻璃屏蔽门从左右滑来合拢，门缝合上。
 * 声音：两声「叮咚」+ 关门蜂鸣 + 气动泄压（合成）。
 * 外壳：宽度不动，**上下同时压扁**到 0 —— 门缝被压成一条水平线。
 */

import { createSignal } from 'solid-js';
import { EASE } from '../../shell';
import { playSynth, type SynthEvent } from '../../audio';
import styles from './gate.module.css';
import type { ExitTheme } from '../../types';

/** 玻璃门合拢 */
const CLOSE_MS = 2200;
/** 门合拢到开始收外壳的间隔（等蜂鸣响完） */
const CUE_MS = 2900;

const SOUNDS: SynthEvent[] = [
	{ at: 120, kind: 'chime', freq: 988, durationMs: 520 },
	{ at: 640, kind: 'chime', freq: 740, durationMs: 620 },
	{ at: CLOSE_MS - 900, kind: 'buzz', freq: 520, durationMs: 180 },
	{ at: CLOSE_MS - 600, kind: 'buzz', freq: 520, durationMs: 180 },
	{ at: CLOSE_MS - 300, kind: 'buzz', freq: 520, durationMs: 180 },
	{ at: CLOSE_MS, kind: 'whoosh', freq: 3600, durationMs: 900 },
];

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'open' | 'closing';
const [stage, setStage] = createSignal<Stage>('open');

function Gate() {
	return (
		<div class={styles.root} data-stage={stage()}>
			{/* 门后：掠过的车厢灯 */}
			<div class={styles.behind}>
				<div class={styles.lightBar} />
				<div class={styles.lightBar} />
				<div class={styles.lightBar} />
				<div class={styles.headlight} />
			</div>

			{/* 站台顶部的关门警示灯 */}
			<div class={styles.beacon} />
			<div class={styles.station}>MIND THE GAP · 屏蔽门</div>

			{/* 两扇玻璃门 */}
			<div class={styles.doorLeft} />
			<div class={styles.doorRight} />
			<div class={styles.seam} />

			<div class={styles.sign}>车门关闭 · DOORS CLOSING</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'gate',
	label: '屏蔽门',
	desc: '站台屏蔽门合拢，窗口上下同时压成一条线',
	Component: Gate,

	async run({ shell }) {
		setStage('open');
		await playSynth(SOUNDS, CUE_MS);

		setStage('closing');
		// 上下同时压：高度每少 2px，top 就下移 1px，宽度自始至终不动
		await shell.run((t, f) => {
			const height = f.height * (1 - EASE.easeInOutCubic(t));
			return { x: f.x, y: f.y + (f.height - height) / 2, width: f.width, height };
		}, 2200);
	},
};

export default theme;
