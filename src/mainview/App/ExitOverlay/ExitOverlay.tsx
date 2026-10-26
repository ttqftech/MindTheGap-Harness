/**
 * ExitOverlay — 退场画面的挂载点
 *
 * 这里只负责「当前主题在不在退场、铺在哪一层」，画面本身由主题的 Component 提供。
 * 阶段不经过 props：主题在自己的模块里持有阶段 signal，由它自己的 run() 推进。
 */

import { Show, Dynamic } from 'solid-js/web';
import { activeTheme } from './index';
import styles from './ExitOverlay.module.css';

export default function ExitOverlay() {
	return (
		<Show when={activeTheme()}>
			{(theme) => (
				<div class={styles.overlay}>
					<Dynamic component={theme().Component} />
				</div>
			)}
		</Show>
	);
}
