/**
 * 主题九 · 扶梯
 *
 * 画面：站厅上行扶梯 —— 台阶一格格向上滚、扶手带流动，上方出口的光越来越亮。
 * 声音：与「隧道」同一首 54 香港.flac（11.2s），第 7 秒进收尾段。
 * 外壳：**顶边钉死，底边一路向上追** —— 单向收高度（屏蔽门是上下对压，这个是只从下面收）。
 */

import { createSignal } from 'solid-js';
import { EASE } from '../../shell';
import { playMusic } from '../../audio';
import exitMusicUrl from '../../assets/港铁关门提示音.mp3';
import styles from './escalator.module.css';
import type { ExitTheme } from '../../types';

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'ride' | 'rise';
const [stage, setStage] = createSignal<Stage>('ride');

function Escalator() {
	return (
		<div class={styles.root} data-stage={stage()}>
			<div class={styles.shaft}>
				<div class={styles.steps} />
				<div class={styles.rail} data-side="left" />
				<div class={styles.rail} data-side="right" />
				<div class={styles.handLeft} />
				<div class={styles.handRight} />
			</div>

			{/* 上方出口 */}
			<div class={styles.exit}>
				<span class={styles.exitArrow}>↑</span>
				<span class={styles.exitText}>出口 · WAY OUT</span>
			</div>

			<div class={styles.tip}>请握紧扶手 · HOLD THE HANDRAIL</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'escalator',
	label: '扶梯',
	desc: '上行扶梯把人送出站，窗口底边一路向上收',
	Component: Escalator,

	async run({ shell }) {
		setStage('ride');
		await playMusic(exitMusicUrl, { cueSeconds: 7, volume: 0.85 });

		setStage('rise');
		// y 不动 = 顶边钉死；高度一路减到 0，视觉上就是整扇窗被上头「吞」上去
		await shell.run((t, f) => ({
			x: f.x,
			y: f.y,
			width: f.width,
			height: f.height * (1 - EASE.easeInOutQuint(t)),
		}), 3900);
	},
};

export default theme;
