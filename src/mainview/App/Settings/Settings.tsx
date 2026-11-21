/* ==========================================================================
   设置面板 — 按「真相在哪」分成两组 Tab：
     本机（localStorage）  ：外观 / 用量
     服务（Agent Service） ：服务 / 模型 / 媒体 / 提示词 / 插件 / 模式 / MCP / 用户管理
   两组之间用组标签 + 竖直分隔线隔开，内容区顶部再给一条作用域提示，
   让用户随时知道手上这项改动会落在本地还是落在服务上。
   每个 Tab 的内容各在一个 tsx 里；本文件只管面板壳、拖拽与 Tab 栏。
   ========================================================================== */

import { For, onCleanup, onMount, Show } from 'solid-js';
import { state, actions, hasPermission } from '@mainview/stores';
import type { SettingsTabId } from '@mainview/stores';
import { startSettingsDrag, setSettingsTravelMeasure } from './useSettingsDrag';
import { XIcon } from './SettingsCommon';
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

/** 设置面板头部的拖拽手柄（三道横线 = grip），按住它可以上下滑动面板拉出 / 关闭 */
function DragHandleIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			<line x1="4" y1="6" x2="20" y2="6"/>
			<line x1="4" y1="12" x2="20" y2="12"/>
			<line x1="4" y1="18" x2="20" y2="18"/>
		</svg>
	);
}

type TabScope = 'local' | 'service';
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
	const activeScope = (): TabScope => LOCAL_TABS.some((tab) => tab.id === activeTab()) ? 'local' : 'service';

	function TabButton(props: { tab: TabDef; scope: TabScope }) {
		return (
			<button
				class={styles.settingsTab}
				data-scope={props.scope}
				classList={{ [styles.active]: activeTab() === props.tab.id }}
				onclick={() => actions.setSettingsTab(props.tab.id)}
			>
				{props.tab.label}
			</button>
		);
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

				<div ref={panelRef} class={styles.settingsPanel}>
					{/* 头部：拖拽手柄 + 标题 + 面包屑 + 关闭 */}
					<div class={styles.settingsHeader}>
						<div class={styles.settingsDragHandle} onmousedown={startSettingsDrag} title="按住拖动设置面板">
							<DragHandleIcon />
						</div>
						<div class={styles.settingsTitleBlock}>
							<div class={styles.settingsTitle}>设置</div>
						</div>
						<button class={styles.settingsCloseBtn} onclick={() => actions.closeSettings()}>
							<XIcon />
						</button>
					</div>

					{/* 分页栏：本机组 | 服务组，中间一条竖线 + 两组标签 */}
					<div class={styles.settingsTabs}>
						<span class={styles.settingsTabGroup} data-scope="local" title="只保存在这台设备">
							本机
						</span>
						<For each={LOCAL_TABS}>{(tab) => <TabButton tab={tab} scope="local" />}</For>

						<span class={styles.settingsTabSplit} />

						<span class={styles.settingsTabGroup} data-scope="service" title="保存在 Agent Service，所有连接此服务的客户端共享">
							服务
						</span>
						<For each={visibleServiceTabs()}>{(tab) => <TabButton tab={tab} scope="service" />}</For>

						<span class={styles.settingsTabsSpacer} />
						<button class={styles.settingsDoneBtn} onclick={() => actions.closeSettings()}>
							完成
						</button>
					</div>

					<div class={styles.settingsDivider} />

					<div class={styles.settingsContent}>
						{/* 作用域提示：切到哪一组，就说明这一页的设置会写去哪 */}
						<div class={styles.settingsScope} data-scope={activeScope()}>
							<span class={styles.dot} />
							{activeScope() === 'local'
								? '本机设置 · 只保存在这台设备的本地存储里，换设备或换服务都不会带过去'
								: '服务设置 · 由 Agent Service 保管（settings.json / 插件目录），所有连到这个服务的客户端共享'}
						</div>

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
				</div>

				{/* 全屏浮动占位小方块：跟着设置的下拉量移动，演示一个变量控制多个元素（后期可换成进度页等） */}
				<div class={styles.settingsPlaceholder}>
					<div class={styles.box} />
				</div>
			</div>
		</Show>
	);
}
