/**
 * 主题二 · 翻牌时刻表（Solari split-flap）
 *
 * 画面：老式机械翻牌大屏，一格格啪嗒啪嗒翻出「终点站 / MIND THE GAP / 末班车」。
 * 声音：合成的翻牌噪声 + 收尾一声闷响（不依赖音频文件）。
 * 外壳：两段式 —— 先左右收成「一块牌」的宽度，停顿，再上下同时压扁到 0。
 */

import { For } from 'solid-js';
import { exitPhase } from '../../phase';
import { EASE, sleep } from '../../shell';
import { playSynth, type SynthEvent } from '../../audio';
import styles from './flipboard.module.css';
import type { ExitTheme } from '../../types';

const ROWS = [
	{ text: 'TERMINUS 终点站', cls: 'rowLabel' },
	{ text: 'MIND THE GAP', cls: 'rowMain' },
	{ text: 'LAST TRAIN 23:59', cls: 'rowSub' },
] as const;

/** 全部翻牌格的翻动声：一串带通噪声，频率错开避免糊成一片 */
const FLAP_SOUNDS: SynthEvent[] = Array.from({ length: 30 }, (_, i) => ({
	at: 140 + i * 72,
	kind: 'clack' as const,
	freq: 1450 + ((i * 173) % 1100),
	durationMs: 70,
}));

const SOUNDS: SynthEvent[] = [
	...FLAP_SOUNDS,
	{ at: 2700, kind: 'whoosh', freq: 4200, durationMs: 1150 },
	{ at: 3080, kind: 'clack', freq: 620, durationMs: 420 },
];

/** 收窄成一块牌的目标宽度（再窄就装不下牌面了） */
const BOARD_WIDTH = 560;
/** 翻完牌到开始收外壳的间隔 */
const CUE_MS = 3200;

function Flipboard() {
	return (
		<div class={styles.root} data-phase={exitPhase() ?? 'play'}>
			<div class={styles.rail} />
			<div class={styles.rail} />

			<div class={styles.board}>
				<For each={ROWS}>
					{(row, r) => (
						<div class={styles.row} classList={{ [styles.rowMain]: row.cls === 'rowMain' }}>
							<For each={row.text.split('')}>
								{(ch, i) => (
									<span
										class={styles.flap}
										style={{ 'animation-delay': `${r() * 0.55 + i() * 0.055}s` }}
									>
										{ch === ' ' ? ' ' : ch}
									</span>
								)}
							</For>
						</div>
					)}
				</For>
			</div>

			<div class={styles.footer}>末班车 · 请全体乘客下车　MIND THE GAP</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'flipboard',
	label: '翻牌',
	desc: '机械翻牌翻出终点站，窗口先收成一块牌再压扁',
	Component: Flipboard,

	sound: (onCue) => playSynth(SOUNDS, CUE_MS, onCue),

	shell: async (shell) => {
		// 一段：左右同时收到「一块牌」的宽度
		await shell.run((t, f) => {
			const target = Math.min(BOARD_WIDTH, f.width);
			const width = f.width - (f.width - target) * EASE.easeOutExpo(t);
			return { x: f.x + (f.width - width) / 2, y: f.y, width, height: f.height };
		}, 1700);

		await sleep(320);

		// 二段：上下同时压扁。起点是一段结束时的外框（由 f0 推得，不读实时 frame，避免累积误差）
		await shell.run((t, f) => {
			const w = Math.min(BOARD_WIDTH, f.width);
			const height = f.height * (1 - EASE.easeInCubic(t));
			return { x: f.x + (f.width - w) / 2, y: f.y + (f.height - height) / 2, width: w, height };
		}, 1300);
	},
};

export default theme;
