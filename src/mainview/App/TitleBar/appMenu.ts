/** 
 * 标题栏菜单栏的定义 —— 文件 / 编辑 / 视图 / 运行 / 帮助
 * 
 * 这里只负责「菜单长什么样、点了做什么」，渲染与弹出交给 TitleBar。
 * 菜单项在**点击那一刻**才构造，所以读到的 state 一定是最新的；
 * 不要把这些数组提到模块顶层缓存，否则勾选态永远停在首次构建时的值。
 */

import type { MenuItem } from '@mainview/ffboxBridge';
import { state, actions, loadConversationCtx, refreshConversationMeta, isConversationAlive } from '@mainview/store';
import { stopRun } from '@mainview/runController';
import { windowControls } from '@mainview/localBridge';
import { addFolderViaDialog, editCopy, editPaste, editSelectAll, newTask, openUserDataDir, setAppTheme, showAbout } from '@mainview/appCommands';
import type { Accent, Density, ThemeMode } from '@mainview/theme/theme';

export interface AppMenuGroup {
	id: string;
	label: string;
	build: () => MenuItem[];
}

const sep = (): MenuItem => ({ type: 'separator' });

/** 快捷键放 tooltip：FFBox 菜单没有独立的快捷键列，写进 label 会挤在一起 */
const item = (value: string, label: string, shortcut: string | undefined, onClick: () => void, disabled = false): MenuItem => ({
	type: 'normal',
	value,
	label,
	tooltip: shortcut,
	disabled,
	onClick: () => {
		onClick();
	},
});

const radio = (value: string, label: string, checked: boolean, onClick: () => void): MenuItem => ({
	type: 'radio',
	value,
	checked,
	label,
	onClick: () => {
		onClick();
	},
});

const check = (value: string, label: string, checked: boolean, onClick: () => void): MenuItem => ({
	type: 'checkbox',
	value,
	checked,
	label,
	onClick: () => {
		onClick();
	},
});

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string }> = [
	{ id: 'dark', label: '深色' },
	{ id: 'light', label: '浅色' },
	{ id: 'system', label: '跟随系统' },
];

const DENSITY_OPTIONS: Array<{ id: Density; label: string }> = [
	{ id: 'compact', label: '紧凑' },
	{ id: 'standard', label: '标准' },
	{ id: 'comfortable', label: '宽松' },
];

const ACCENT_OPTIONS: Array<{ id: Accent; label: string }> = [
	{ id: 'amber', label: '琥珀' },
	{ id: 'blue', label: '靛蓝' },
	{ id: 'teal', label: '青碧' },
	{ id: 'violet', label: '紫罗兰' },
];

/** 当前会话（没有会话时返回 null） */
function activeConversation() {
	return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
}

export const APP_MENUS: AppMenuGroup[] = []
export const APP_MENUS_bak: AppMenuGroup[] = [
	{
		id: 'file',
		label: '文件',
		build: () => [
			item('new-task', '新建任务', 'Ctrl+N', () => void newTask()),
			item('add-folder', '添加工作目录…', undefined, () => void addFolderViaDialog()),
			sep(),
			item('settings', '设置…', 'Ctrl+,', () => actions.openSettings()),
			sep(),
			item('quit', '退出', undefined, () => void windowControls.close()),
		],
	},
	{
		id: 'edit',
		label: '编辑',
		build: () => [
			item('copy', '复制', 'Ctrl+C', editCopy),
			item('paste', '粘贴', 'Ctrl+V', () => void editPaste()),
			item('select-all', '全选', 'Ctrl+A', editSelectAll),
		],
	},
	{
		id: 'view',
		label: '视图',
		build: () => [
			check('toggle-sidebar', '侧边栏', !state.ui.leftSidebarCollapsed, () => actions.toggleLeftSidebar()),
			sep(),
			{
				type: 'submenu',
				label: '主题',
				subMenu: THEME_OPTIONS.map((o) =>
					radio(`theme:${o.id}`, o.label, state.themeMode === o.id, () => setAppTheme(o.id)),
				),
			},
			{
				type: 'submenu',
				label: '界面密度',
				subMenu: DENSITY_OPTIONS.map((o) =>
					radio(`density:${o.id}`, o.label, state.ui.density === o.id, () => actions.setDensity(o.id)),
				),
			},
			{
				type: 'submenu',
				label: '强调色',
				subMenu: ACCENT_OPTIONS.map((o) =>
					radio(`accent:${o.id}`, o.label, state.ui.accent === o.id, () => actions.setAccent(o.id)),
				),
			},
			sep(),
			{
				type: 'submenu',
				label: '视图模式',
				subMenu: [
					radio('view:chat', '聊天', state.ui.viewMode === 'chat', () => actions.setViewMode('chat')),
					radio('view:diagram', '图示', state.ui.viewMode === 'diagram', () => actions.setViewMode('diagram')),
				],
			},
		],
	},
	{
		id: 'run',
		label: '运行',
		build: () => [
			// ⚠️ 「停止运行」能不能点，看**当前会话自己**的 runStatus（后端 activeRunners + 根实例 status），
			//   running + waiting 都算「可以停」；不再用全局布尔量 —— 全局量会跟着「在跑的那个会话」一起移动，切走就一直亮着。
			item('stop', '停止运行', 'Esc', () => stopRun(), !isConversationAlive(activeConversation())),
			sep(),
			check('mock', `内置 mock${state.mock.enabled ? `（${state.mock.scenario}）` : ''}`, state.mock.enabled, () => {
				void actions.setMock({ enabled: !state.mock.enabled });
			}),
			sep(),
			item('refresh', '重新同步当前会话', undefined, () => {
				const conv = activeConversation();
				if (!conv) return;
				void loadConversationCtx(conv.id, true);
				void refreshConversationMeta(conv.id);
			}, !activeConversation()),
		],
	},
	{
		id: 'help',
		label: '帮助',
		build: () => [
			item('about', '关于 MindTheGap-Harness', undefined, () => void showAbout()),
			item('data-dir', '打开数据目录', undefined, () => void openUserDataDir()),
		],
	},
];
