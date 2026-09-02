/* ==========================================================================
   主题管理
   - 检测系统深浅色
   - 切换主题
   - 持久化用户选择
   ========================================================================== */

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'colorTheme';

function getSystemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: 'light' | 'dark') {
	document.documentElement.classList.remove('themeLight', 'themeDark');
	document.documentElement.classList.add(theme === 'light' ? 'themeLight' : 'themeDark');
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
