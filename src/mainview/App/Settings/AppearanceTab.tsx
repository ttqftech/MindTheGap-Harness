/* ==========================================================================
   外观 Tab — 本机组。这里每一项都只写 localStorage（themeMode / ui.*），
   不惊动 Agent Service，换一台设备或连到别的服务都不会带过去。
   ⚠️ 聊天用的模式 / 模型 / 强度 / 安全性是会话级数据，默认模板在「服务」Tab。
   ========================================================================== */

import common from './SettingsCommon.module.css';
import { state, actions } from '@mainview/stores';
import { setAppTheme } from '@mainview/logic/appCommands';
import { EXIT_THEME_OPTIONS, previewExitTheme, themeById } from '@mainview/App/ExitOverlay';
import { Segmented } from './SettingsCommon';

const THEME_OPTIONS = [
	{ value: 'dark', label: '深色' },
	{ value: 'light', label: '浅色' },
	{ value: 'system', label: '跟随系统' },
] as const;

const DENSITY_OPTIONS = [
	{ value: 'compact', label: '紧凑' },
	{ value: 'standard', label: '标准' },
	{ value: 'comfortable', label: '宽松' },
] as const;

const ACCENT_OPTIONS = [
	{ value: 'amber', label: '琥珀' },
	{ value: 'blue', label: '靛蓝' },
	{ value: 'teal', label: '青碧' },
	{ value: 'violet', label: '紫罗兰' },
] as const;

export function AppearanceTab() {
	return (
		<>
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>外观</div>

				<div class={common.settingRow}>
					<span class={common.title}>主题</span>
					<Segmented options={THEME_OPTIONS} value={state.themeMode} onChange={(mode) => setAppTheme(mode)} />
				</div>

				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>界面密度</span>
						<span class={common.desc}>影响列表行高、区块间距与正文字号</span>
					</div>
					<Segmented options={DENSITY_OPTIONS} value={state.ui.density} onChange={(v) => actions.setDensity(v)} />
				</div>

				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>强调色</span>
						<span class={common.desc}>按钮、选中态与运行指示灯的颜色</span>
					</div>
					<Segmented options={ACCENT_OPTIONS} value={state.ui.accent} onChange={(v) => actions.setAccent(v)} />
				</div>

				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>退场动画</span>
						<span class={common.desc}>{themeById(state.ui.exitTheme).desc}</span>
					</div>
					<div class={common.exitTheme}>
						<Segmented
							options={EXIT_THEME_OPTIONS}
							value={state.ui.exitTheme}
							onChange={(v) => actions.setExitTheme(v)}
						/>
						<button
							class={common.btnSecondary}
							onclick={() => previewExitTheme(state.ui.exitTheme)}
						>
							预览
						</button>
					</div>
				</div>

				<div class={common.settingRow}>
					<div class={common.label}>
						<span class={common.title}>语言</span>
						<span class={common.desc}>应用界面语言（暂只支持中文）</span>
					</div>
					<span class={common.value}>简体中文</span>
				</div>
			</div>

		</>
	);
}
