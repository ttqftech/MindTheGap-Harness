/**
 * 主题一 · 隧道穿行
 *
 * 画面：隧道照明环由小放大、列车进站、线路图站点依次点亮、报站「下一站 MindTheGap」。
 * 声音：54 香港.flac（11.2s），第 7 秒进离站段。
 * 外壳：7s 后 4s 内左右同时收窄到 0 —— 宽度归零 = 列车驶进隧道尽头。
 */

import { For } from 'solid-js';
import { exitPhase } from '../../phase';
import { EASE } from '../../shell';
import { playMusic } from '../../audio';
import exitMusicUrl from '../../assets/港铁关门提示音.mp3';
import styles from './tunnel.module.css';
import type { ExitTheme } from '../../types';

/** 隧道环（由小放大淡出，模拟一节节穿过的照明环） */
const RING_COUNT = 9;
/** 线路图上的站点（最后一个是本次终点） */
const STATIONS = ['Code', 'Daily', 'Storage', 'Review', 'MindTheGap'];

function Tunnel() {
	return (
		<div class={styles.root} data-phase={exitPhase() ?? 'play'}>
			{/* 隧道 */}
			<div class={styles.tunnel}>
				<For each={Array.from({ length: RING_COUNT })}>
					{(_, i) => (
						<div class={styles.ring} style={{ 'animation-delay': `${(i() * 2.2) / RING_COUNT}s` }} />
					)}
				</For>
			</div>

			{/* 线路图：站点依次点亮 */}
			<div class={styles.lineMap}>
				<div class={styles.lineTrack} />
				<For each={STATIONS}>
					{(name, i) => (
						<div class={styles.station} style={{ 'animation-delay': `${i() * 0.55}s`, left: `${8 + i() * 21}%` }}>
							<span class={styles.stationDot} />
							<span class={styles.stationName}>{name}</span>
						</div>
					)}
				</For>
			</div>

			{/* 列车 */}
			<svg class={styles.train} viewBox="0 0 640 150" xmlns="http://www.w3.org/2000/svg">
				<path class={styles.body} d="M40 26 H540 C596 26 624 58 624 92 C624 118 596 138 556 138 H40 C18 138 6 122 6 100 V64 C6 42 18 26 40 26 Z" />
				<rect class={styles.stripe} x="6" y="96" width="618" height="12" rx="6" />
				<rect class={styles.window} x="42" y="46" width="86" height="40" rx="6" />
				<rect class={styles.window} x="146" y="46" width="86" height="40" rx="6" />
				<rect class={styles.window} x="250" y="46" width="86" height="40" rx="6" />
				<rect class={styles.window} x="354" y="46" width="86" height="40" rx="6" />
				<path class={styles.cabWindow} d="M470 46 H556 C574 46 588 58 590 86 H470 Z" />
				<circle class={styles.headlight} cx="604" cy="112" r="9" />
				<circle class={styles.taillight} cx="22" cy="112" r="7" />
				<circle class={styles.wheel} cx="86" cy="140" r="9" />
				<circle class={styles.wheel} cx="300" cy="140" r="9" />
				<circle class={styles.wheel} cx="514" cy="140" r="9" />
			</svg>

			{/* 报站 */}
			<div class={styles.announce}>
				<div class={styles.nextStation}>下一站 · NEXT STATION</div>
				<div class={styles.terminus}>MindTheGap</div>
				<div class={styles.subtitle}>本次列车终点站 MindTheGap · GAPPERS SAVE THE WORLD</div>
			</div>

			{/* 站台：安全线（黄黑警示带）向后流动 */}
			<div class={styles.platform}>
				<div class={styles.safetyLine} />
				<div class={styles.platformEdge} />
			</div>
		</div>
	);
}

const theme: ExitTheme = {
	id: 'tunnel',
	label: '隧道',
	desc: '列车进站报站，窗口左右同时收成一条缝',
	Component: Tunnel,

	sound: (onCue) => playMusic(exitMusicUrl, { cueSeconds: 7, volume: 0.85 }, onCue),

	// 左右同时收窄：宽度每少 2px，left 就右移 1px，高度不动
	shell: (shell) =>
		shell.run((t, f) => {
			const width = f.width * (1 - EASE.easeInOutCubic(t));
			return { x: f.x + (f.width - width) / 2, y: f.y, width, height: f.height };
		}, 4000),
};

export default theme;
