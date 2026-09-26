/* ==========================================================================
   主题管理
   - 检测系统深浅色
   - 切换主题
   - 持久化用户选择

   界面密度与强调色由 store 持有（见 store 的 ui.density / ui.accent），
   这里只提供「值 → 类名」的映射与应用函数，不重复持久化。
   令牌定义见 theme/theme.css。
   ========================================================================== */

import { createSignal } from 'solid-js';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 界面密度 */
export type Density = 'compact' | 'standard' | 'comfortable';

/** 强调色 */
export type Accent = 'amber' | 'blue' | 'teal' | 'violet';

export const DENSITY_CLASS: Record<Density, string> = {
	compact: 'densityCompact',
	standard: 'densityStandard',
	comfortable: 'densityComfortable',
};

export const ACCENT_CLASS: Record<Accent, string> = {
	amber: 'accentAmber',
	blue: 'accentBlue',
	teal: 'accentTeal',
	violet: 'accentViolet',
};

export const ALL_DENSITY_CLASSES = Object.values(DENSITY_CLASS);
export const ALL_ACCENT_CLASSES = Object.values(ACCENT_CLASS);

/** 应用界面密度（替换而非累加，保证同时只有一个） */
export function applyDensity(density: Density) {
	const root = document.documentElement;
	root.classList.remove(...ALL_DENSITY_CLASSES);
	root.classList.add(DENSITY_CLASS[density] ?? DENSITY_CLASS.standard);
}

/** 应用强调色（替换而非累加） */
export function applyAccent(accent: Accent) {
	const root = document.documentElement;
	root.classList.remove(...ALL_ACCENT_CLASSES);
	root.classList.add(ACCENT_CLASS[accent] ?? ACCENT_CLASS.amber);
}

const THEME_KEY = 'colorTheme';

function getSystemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * 实际生效的深浅色（system 模式解析后的结果）。
 * FFBox-UI 的 <ffbox-theme-provider> 需要具体值而非 'system'，故在此统一暴露。
 */
const [resolvedTheme, setResolvedTheme] = createSignal<'light' | 'dark'>(getSystemTheme());

export { resolvedTheme };

function applyTheme(theme: 'light' | 'dark') {
	document.documentElement.classList.remove('themeLight', 'themeDark');
	document.documentElement.classList.add(theme === 'light' ? 'themeLight' : 'themeDark');
	setResolvedTheme(theme);
}

// 初始化主题并监听系统主题变化（直接应用到 documentElement.classList）
export function initTheme(): ThemeMode {
	let stored: ThemeMode = 'system';

	try {
		stored = (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
	} catch {
		stored = 'system';
	}

	const resolved = stored === 'system' ? getSystemTheme() : stored;
	applyTheme(resolved);

	// 监听系统主题变化
	if (typeof window !== 'undefined') {
		const mq = window.matchMedia('(prefers-color-scheme: light)');
		mq.addEventListener('change', () => {
			if (getCurrentThemeMode() === 'system') {
				applyTheme(getSystemTheme());
			}
		});
	}

	return stored;
}

// 切换主题（持久化到 localStorage）
export function setTheme(mode: ThemeMode) {
	try {
		localStorage.setItem(THEME_KEY, mode);
	} catch {}
	const resolved = mode === 'system' ? getSystemTheme() : mode;
	applyTheme(resolved);
}

export function getCurrentThemeMode(): ThemeMode {
	try {
		return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
	} catch {
		return 'system';
	}
}

export function getResolvedTheme(): 'light' | 'dark' {
	const mode = getCurrentThemeMode();
	return mode === 'system' ? getSystemTheme() : mode;
}
