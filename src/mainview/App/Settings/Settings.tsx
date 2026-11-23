/* ==========================================================================
   设置面板 — Tab 按「真相在哪」分成两组：
     本机（localStorage）  ：外观 / 用量
     服务（Agent Service） ：服务 / 模型 / 媒体 / 提示词 / 插件 / 模式 / MCP / 用户管理
   Tab 栏紧跟在「设置」标题右边；悬浮某一组时浮出一圈淡边框框住整组，
   并用 tooltip 说明这组设置落在哪 —— 两串说明文字不再常驻占版面。
   每个 Tab 的内容各在一个 tsx 里；本文件只管面板壳、拖拽与 Tab 栏。
   ========================================================================== */

import { For, onCleanup, onMount, Show } from 'solid-js';
import { useTooltip } from 'ffbox-ui';
import { state, actions, hasPermission } from '@mainview/stores';
import type { SettingsTabId } from '@mainview/stores';
import { startSettingsDrag, setSettingsTravelMeasure } from './useSettingsDrag';
import { AppearanceTab } from './AppearanceTab';
import { UsageTab } from './UsageTab';
import { ServiceTab } from './ServiceTab';
import { ModelsTab } from './ModelsTab';
import { MediaTab } from './MediaTab';
import { PromptTab } from './PromptTab';
import { PluginModeTab } from './PluginModeTab';
import { McpTab } from './McpTab';
import { UsersTab } from './UsersTab';
import styles from './Settings.module.css';

/** 设置面板左上角的齿轮标记：纯装饰，不响应鼠标 */
function GearIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
			<circle cx="12" cy="12" r="3"/>
		</svg>
	);
}

type TabDef = { id: SettingsTabId; label: string };

/** 本机组：每一项都只写 localStorage，换设备 / 换服务不会带过去 */
const LOCAL_TABS: TabDef[] = [
	{ id: '外观', label: '外观' },
	{ id: '用量', label: '用量' },
];

/** 服务组：真相在 Agent Service（settings.json / 插件目录），所有连到它的客户端共享 */
const SERVICE_TABS: TabDef[] = [
	{ id: '服务', label: '服务' },
	{ id: '模型', label: '模型' },
	{ id: '媒体', label: '媒体' },
	{ id: '提示词', label: '提示词' },
	{ id: '插件 / 模式', label: '插件 / 模式' },
	{ id: 'MCP', label: 'MCP' },
	{ id: '用户管理', label: '用户管理' },
];

const ALL_TAB_IDS: string[] = [...LOCAL_TABS, ...SERVICE_TABS].map((tab) => tab.id);

/** 面板整块可拖拽，但控件上的按下要留给控件自己（点击 / 输入 / 下拉 / 滚动条） */
const INTERACTIVE_SELECTOR = 'button, input, textarea, select, a, label, [contenteditable], [role="button"], [role="slider"], [role="checkbox"]';

export default function Settings() {
	let panelRef: HTMLDivElement | undefined;

	/** 设置面板唯一的真相：0 = 完全收起，1 = 完全展开，中间 = 拖拽中的实时位置 */
	const progress = () => state.ui.settingsProgress;
	/**
	 * 可见性直接派生自进度（> 0 即挂载）。
	 * 不再单独存一个 visible / open 布尔量：那种「布尔量说开着、进度却是 0」的坏状态根本不可能出现。
	 */
	const visible = () => progress() > 0;

	/** 「用户管理」只有拿到 `userManagement` 权限才出现（见 UsersTab / 侧边栏状态行菜单） */
	const visibleServiceTabs = () => SERVICE_TABS.filter((tab) => tab.id !== '用户管理' || hasPermission('userManagement'));

	/** localStorage 里可能存着旧版 Tab id（如「通用」）；不在清单里就回到默认页，别留一片空白 */
	const activeTab = (): SettingsTabId => ALL_TAB_IDS.includes(state.ui.activeSettingsTab)
		? state.ui.activeSettingsTab
		: '外观';

	function TabButton(props: { tab: TabDef }) {
		return (
			<button
				class={styles.settingsTab}
				classList={{ [styles.active]: activeTab() === props.tab.id }}
				onclick={() => actions.setSettingsTab(props.tab.id)}
			>
				{props.tab.label}
			</button>
		);
	}

	function onPanelMouseDown(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (target.closest(INTERACTIVE_SELECTOR)) return;
		// 面板内部的 ffbox-* 控件整棵子树都不参与拖拽（shadow DOM 的事件会 retarget 到宿主）。
		// ⚠️ 只查到面板根节点为止：再往上是 <ffbox-theme-provider> 这类应用级自定义元素，
		//    把整条祖先链算进来会把面板上所有按下都误判成「在控件里」。
		for (let node: Element | null = target; node && node !== panelRef; node = node.parentElement) {
			if (node.localName.includes('-')) return;
		}
		// 点在滚动条上：滚动条不是 DOM 节点，事件落到滚动容器自己，offsetX 会超出 clientWidth
		if (target.classList.contains(styles.settingsContent) && e.offsetX > target.clientWidth) return;
		// 面板表面的单击只算「点了一下」，不切换开合（标题栏品牌区才切换）
		startSettingsDrag(e, false);
	}

	// 面板高度 = 一次完整开合的手指行程，交给拖拽换算 px → 进度（只是测量，不写任何样式）
	onMount(() => setSettingsTravelMeasure(() => panelRef?.offsetHeight || window.innerHeight));
	onCleanup(() => setSettingsTravelMeasure(() => window.innerHeight));

	return (
		<Show when={visible()}>
			{/* 这个根节点是唯一的动画载体：进度写在它身上，位移 / 遮罩都由它派生 */}
			<div class={styles.settingsRoot} style={{ '--settings-progress': progress() }}>
				{/* 遮罩：什么都不干、也不响应鼠标点击（面板铺满整个区域，本来也没有「点外面」这回事） */}
				<div class={styles.settingsOverlay} />

				<div ref={panelRef} class={styles.settingsPanel} onmousedown={onPanelMouseDown}>
					{/* 头部：齿轮标记 + 标题 + 紧跟标题的 Tab 栏 */}
					<div class={styles.settingsHeader}>
						<div class={styles.settingsGear}>
							<GearIcon />
						</div>
						<div class={styles.settingsTitleBlock}>
							<div class={styles.settingsTitle}>设置</div>
						</div>

						{/* 两组各包一层：悬浮时淡边框框住整组，tooltip 说明这一组写去哪 */}
						<div class={styles.settingsTabs}>
							<div class={styles.settingsTabScope}>
								<For each={LOCAL_TABS}>{(tab) => <TabButton tab={tab} />}</For>
							</div>

							<span class={styles.settingsTabSplit} />

							<div class={styles.settingsTabScope}>
								<For each={visibleServiceTabs()}>{(tab) => <TabButton tab={tab} />}</For>
							</div>
						</div>
					</div>

					<div class={styles.settingsDivider} />

					<div class={styles.settingsContent}>
						{activeTab() === '外观' && <AppearanceTab />}
						{activeTab() === '用量' && <UsageTab />}
						{activeTab() === '服务' && <ServiceTab />}
						{activeTab() === '模型' && <ModelsTab />}
						{activeTab() === '媒体' && <MediaTab />}
						{activeTab() === '提示词' && <PromptTab />}
						{activeTab() === '插件 / 模式' && <PluginModeTab />}
						{activeTab() === 'MCP' && <McpTab />}
						{/* 权限被撤回时（Tab 已经不在列表里）也别把内容留在原地 */}
						{activeTab() === '用户管理' && hasPermission('userManagement') && <UsersTab />}
					</div>

					<div class={styles.deco} />
				</div>

			</div>
		</Show>
	);
}
