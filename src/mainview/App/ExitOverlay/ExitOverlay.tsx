/**
 * ExitOverlay — 退场画面的挂载点
 *
 * 这里只负责「当前主题在不在退场、铺在哪一层」，画面本身由主题的 Component 提供。
 * 阶段（play / shell）不经过 props：主题组件自己读 phase.ts，少一条组件间依赖。
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
