/* ==========================================================================
   设置面板各 Tab 共用的小组件与工具。
   只放被两个以上 Tab 用到的东西；只服务某一个 Tab 的留在它自己的 tsx 里。
   ========================================================================== */

import { For } from 'solid-js';
import type { MenuItem } from 'ffbox-ui';
import common from './SettingsCommon.module.css';

export function XIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="18" y1="6" x2="6" y2="18"/>
			<line x1="6" y1="6" x2="18" y2="18"/>
		</svg>
	);
}

/** 分段控件（主题 / 密度 / 强调色 / 日志等级都长这样） */
export function Segmented<T extends string>(props: {
	options: ReadonlyArray<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div class={common.segmented}>
			<For each={props.options}>
				{(opt) => (
					<button
						class={common.item}
						classList={{ [common.active]: props.value === opt.value }}
						onclick={() => props.onChange(opt.value)}
					>
						{opt.label}
					</button>
				)}
			</For>
		</div>
	);
}

/** 把 [{value,label}] 转成 FFBox-UI 的菜单项数组 */
export function toMenuItems(options: readonly { value: string; label: string }[]): MenuItem[] {
	return options.map((o) => ({ type: 'normal', value: o.value, label: o.label }));
}

/** 按 value 取显示文本 */
export function labelOf(options: readonly { value: string; label: string }[], value: string): string {
	return options.find((o) => o.value === value)?.label ?? '';
}

/** ffbox-radio-list 实际派发的 detail 是 `{ value, index }`（类型声明写的是 string），两种都认 */
export function radioValue(e: CustomEvent<unknown>): string {
	const detail = e.detail as { value?: string } | string | undefined;
	return typeof detail === 'string' ? detail : (detail?.value ?? '');
}
