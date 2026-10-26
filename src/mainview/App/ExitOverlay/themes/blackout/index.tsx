/**
 * 主题六 · 末班
 *
 * 画面：打烊的站台 —— 顶灯一盏盏熄、站牌灭、广告灯箱灭、时刻表灭，最后只剩一行字。
 * 声音：空旷底噪 + 五声继电器「咔哒」（与收窗口的档位同步）+ 一声泄压式收尾。
 * 外壳：**阶梯式收窄** —— 分 5 档从两侧同时收，档间有停顿，像卷帘一档档落下。
 */

import { createSignal, For } from 'solid-js';
import { EASE, sleep } from '../../shell';
import { playSynth, type SynthEvent } from '../../audio';
import styles from './blackout.module.css';
import type { ExitTheme } from '../../types';

/** 收窄的档数（与灯熄灭的盏数一致，一档一声继电器） */
const STEPS = 5;
/** 每档时长 / 档间停顿 */
const STEP_MS = 300;
const STEP_GAP_MS = 140;
/** 最后一盏灯熄灭 → 开始收外壳 */
const CUE_MS = 2700;

const SOUNDS: SynthEvent[] = [
	{ at: 60, kind: 'hum', freq: 62, durationMs: 3200 },
	{ at: 300, kind: 'clack', freq: 780, durationMs: 130 },
	{ at: 620, kind: 'clack', freq: 760, durationMs: 130 },
	{ at: 940, kind: 'clack', freq: 740, durationMs: 130 },
	{ at: 1260, kind: 'clack', freq: 720, durationMs: 130 },
	{ at: 1580, kind: 'clack', freq: 700, durationMs: 130 },
	{ at: 2050, kind: 'clack', freq: 660, durationMs: 150 },
	{ at: 2380, kind: 'clack', freq: 640, durationMs: 150 },
	{ at: CUE_MS, kind: 'whoosh', freq: 1500, durationMs: 1100 },
];

const LAMPS = [0, 1, 2, 3, 4];

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'dim' | 'out';
const [stage, setStage] = createSignal<Stage>('dim');

function Blackout() {
	return (
		<div class={styles.root} data-stage={stage()}>
			<div class={styles.tunnel} />

			{/* 顶部灯带：一盏盏熄 */}
			<div class={styles.ceiling}>
				<For each={LAMPS}>{() => <div class={styles.tube} />}</For>
			</div>

			{/* 站牌 */}
			<div class={styles.board}>
				<span>MIND THE GAP</span>
			</div>

			{/* 左右广告灯箱 */}
			<div class={styles.poster} data-side="left" />
			<div class={styles.poster} data-side="right" />

			{/* 时刻表 + 长椅 */}
			<div class={styles.timetable} />
			<div class={styles.bench} />

			{/* 地面与安全线 */}
			<div class={styles.platform} />
			<div class={styles.safety} />

			<div class={styles.closed}>末班车已过 · SERVICE ENDED</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'blackout',
	label: '末班',
	desc: '站台逐盏熄灯，窗口一档档收窄',
	Component: Blackout,

	async run({ shell }) {
		setStage('dim');
		await playSynth(SOUNDS, CUE_MS);

		setStage('out');
		// 阶梯式：每档收掉 1/STEPS，档内用 easeOutExpo（「咔」一下到位），档间停一下。
		// 与隧道那种连续收窄的区别是离散感 —— 一档一声继电器。
		for (let step = 1; step <= STEPS; step++) {
			const from = (step - 1) / STEPS;
			await shell.run((t, f) => {
				const k = from + (1 / STEPS) * EASE.easeOutExpo(t);
				const width = f.width * (1 - k);
				return { x: f.x + (f.width - width) / 2, y: f.y, width, height: f.height };
			}, STEP_MS);
			await sleep(STEP_GAP_MS);
		}
	},
};

export default theme;
