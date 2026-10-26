/**
 * 主题十 · 尾灯
 *
 * 画面：漆黑的隧道里，末班车的两盏红色尾灯越来越远、越来越小，最后闪一下灭掉。
 * 声音：与「隧道」同一首 54 香港.flac（11.2s），第 7 秒进收尾段。
 * 外壳：**右下角钉死**收成一点，且高度比宽度收得快 —— 先被压扁，再没掉。
 */

import { createSignal } from 'solid-js';
import { EASE } from '../../shell';
import { playMusic } from '../../audio';
import exitMusicUrl from '../../assets/港铁关门提示音.mp3';
import styles from './taillight.module.css';
import type { ExitTheme } from '../../types';

/** 本主题的画面阶段：由自己的 run() 推进，没有全局阶段这回事 */
type Stage = 'fade' | 'depart';
const [stage, setStage] = createSignal<Stage>('fade');

function Taillight() {
	return (
		<div class={styles.root} data-stage={stage()}>
			{/* 隧道轮廓与掠过的壁灯 */}
			<div class={styles.tunnel}>
				<div class={styles.rib} />
				<div class={styles.rib} />
				<div class={styles.rib} />
			</div>
			<div class={styles.wall} />

			{/* 两盏尾灯 */}
			<div class={styles.lamps}>
				<div class={styles.lamp}>
					<span class={styles.halo} />
					<span class={styles.dot} />
				</div>
				<div class={styles.lamp}>
					<span class={styles.halo} />
					<span class={styles.dot} />
				</div>
			</div>

			<div class={styles.sign}>末班车已驶离 · LAST TRAIN DEPARTED</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'taillight',
	label: '尾灯',
	desc: '末班车尾灯远去熄灭，窗口向右下角压扁着收没',
	Component: Taillight,

	async run({ shell }) {
		setStage('fade');
		await playMusic(exitMusicUrl, { cueSeconds: 7, volume: 0.85 });

		setStage('depart');
		// 右下角钉死：右下两条边不动，左上两条边往这边追。
		// 高度用更陡的曲线，于是先被压成一条扁片，再被抽掉 —— 像尾灯沉进轨道尽头
		await shell.run((t, f) => {
			const width = f.width * (1 - EASE.easeInOutCubic(t));
			const height = f.height * (1 - EASE.easeInOutQuint(t));
			return { x: f.x + f.width - width, y: f.y + f.height - height, width, height };
		}, 3800);
	},
};

export default theme;
