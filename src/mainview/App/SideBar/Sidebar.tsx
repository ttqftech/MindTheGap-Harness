/* ==========================================================================
   侧边栏组件（设计稿：新建任务按钮 + 任务列表 + 底部运行时状态）

   分组沿用既有语义：一个「文件夹」= 一个工作目录，`id` 就是路径，
   显示名由 `folderLabel()` 现算（Folder 没有 name 字段）。
   ========================================================================== */

import { createSignal, createMemo, For, Show, onMount } from 'solid-js';
import styles from './Sidebar.module.css';
import { state, actions } from '@mainview/store';
import { running } from '@mainview/runState';
import { showMenu, type MenuItem } from '@mainview/ffboxBridge';
import { addFolderViaDialog, newTask } from '@mainview/appCommands';
import { getEnvInfo } from '@mainview/localBridge';
import { folderLabel } from '@shared/utils';
import type { ConversationSort } from '@mainview/store';

/* ---------- 图标 ---------- */

function ChevronIcon(props: { open: boolean }) {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 11 11"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			style={{ transform: props.open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
		>
			<polyline points="2.2 4 5.5 7.3 8.8 4" />
		</svg>
	);
}

function NewIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
			<line x1="7" y1="2.6" x2="7" y2="11.4" />
			<line x1="2.6" y1="7" x2="11.4" y2="7" />
		</svg>
	);
}

function SearchIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
			<circle cx="6.2" cy="6.2" r="4.2" />
			<line x1="9.4" y1="9.4" x2="12.2" y2="12.2" />
		</svg>
	);
}

/** 列表选项：三行递短 + 一个节点，对应设计稿的「排序筛选」图标 */
function ListOptionsIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
			<line x1="2" y1="4.2" x2="12" y2="4.2" />
			<line x1="2" y1="7.6" x2="9.4" y2="7.6" />
			<line x1="2" y1="11" x2="6.8" y2="11" />
			<circle cx="11.2" cy="7.6" r="1.3" fill="currentColor" stroke="none" />
		</svg>
	);
}

function SettingsIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</svg>
	);
}

function EnterIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="4.4 3.2 7.6 6 4.4 8.8" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		</svg>
	);
}

/* ---------- 时间短标签 ---------- */

/**
 * 列表右侧的时间：今天给 HH:mm，昨天给「昨天」，一周内给「Nd」，更早给 MM-DD。
 * 设计稿用的就是这种短形式（09:41 / 2d），比完整时间戳省地方。
 */
function compactTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	if (ts >= dayStart) {
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
	const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.floor((dayStart - dStart) / 86400000);
	if (days === 1) return '昨天';
	if (days < 7) return `${days}d`;
	return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SORT_OPTIONS: Array<{ id: ConversationSort; label: string }> = [
	{ id: 'updated', label: '按更新时间' },
	{ id: 'created', label: '按创建时间' },
	{ id: 'title', label: '按名称' },
];

/* ---------- 组件 ---------- */

export default function Sidebar() {
	const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set(['local']));
	const [searchText, setSearchText] = createSignal('');
	const [showSearch, setShowSearch] = createSignal(false);
	const [appVersion, setAppVersion] = createSignal('');

	onMount(() => {
		void getEnvInfo().then((env) => setAppVersion(env?.appVersion ?? ''));
	});

	const toggleFolder = (id: string) => {
		setExpandedFolders((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	/** 折叠 / 展开全部分组 */
	const setAllFoldersExpanded = (expanded: boolean) => {
		setExpandedFolders(expanded ? new Set(state.folders.map((f) => f.id)) : new Set<string>());
	};

	/** 列表选项菜单：加目录 + 排序 + 折叠全部（都挂在这个图标上，表头保持干净） */
	const openListOptions = (el: HTMLElement) => {
		const menu: MenuItem[] = [
			{ type: 'normal', value: 'add-folder', label: '添加工作目录…', onClick: () => void addFolderViaDialog() },
			{ type: 'separator' },
			{
				type: 'submenu',
				label: '排序方式',
				subMenu: SORT_OPTIONS.map((o) => ({
					type: 'radio',
					value: o.id,
					checked: state.ui.conversationSort === o.id,
					label: o.label,
					onClick: () => actions.setConversationSort(o.id),
				})),
			},
			{ type: 'separator' },
			{ type: 'normal', value: 'expand-all', label: '展开全部分组', onClick: () => setAllFoldersExpanded(true) },
			{ type: 'normal', value: 'collapse-all', label: '折叠全部分组', onClick: () => setAllFoldersExpanded(false) },
		];
		const rect = el.getBoundingClientRect();
		showMenu({
			menu,
			type: 'action',
			triggerRect: { xMin: rect.left, yMin: rect.bottom, xMax: rect.right, yMax: rect.bottom },
		});
	};

	// 会话按 folderId 分组（createMemo 确保 Solid 追踪 state.conversations 变化）
	const conversationsByFolder = createMemo(() => {
		const map = new Map<string, typeof state.conversations>();
		for (const conv of state.conversations) {
			const list = map.get(conv.folderId) || [];
			list.push(conv);
			map.set(conv.folderId, list);
		}
		return map;
	});

	// 某文件夹下过滤+排序后的会话（createMemo 返回响应式数组，供 <For> 追踪）
	const conversationsInFolder = (folderId: string) =>
		createMemo(() => {
			const map = conversationsByFolder();
			const items = map.get(folderId) || [];
			const s = searchText().toLowerCase();
			const filtered = s ? items.filter((c) => c.title.toLowerCase().includes(s)) : items;
			const sort = state.ui.conversationSort;
			return [...filtered].sort((a, b) => {
				if (sort === 'created') return b.createdAt - a.createdAt;
				if (sort === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN');
				return b.updatedAt - a.updatedAt;
			});
		});

	return (
		<div
			class={styles.sidebar}
			classList={{ [styles.collapsed]: state.ui.sidebarCollapsed }}
			style={{ width: `${state.ui.sidebarCollapsed ? 0 : state.ui.sidebarWidth}px` }}
		>
			<Show when={!state.ui.sidebarCollapsed}>
				{/* 顶部：新建任务 + 列表表头 */}
				<div class={styles['sidebar-top']}>
					<button class={styles['new-task-btn']} onclick={() => void newTask()}>
						<NewIcon />
						<span class={styles['new-task-text']}>新建任务</span>
						<span class={styles['new-task-spacer']} />
						<span class={styles['new-task-shortcut']}>Ctrl N</span>
					</button>

					<div class={styles['list-header']}>
						<span class={styles['list-header-title']}>任务列表</span>
						<span class={styles['list-header-spacer']} />
						<button
							class={styles['list-header-btn']}
							title="搜索任务"
							aria-label="搜索任务"
							onclick={() => setShowSearch((v) => !v)}
						>
							<SearchIcon />
						</button>
						<button
							class={styles['list-header-btn']}
							title="列表选项"
							aria-label="列表选项"
							onclick={(e) => openListOptions(e.currentTarget)}
						>
							<ListOptionsIcon />
						</button>
					</div>

					<Show when={showSearch()}>
						<input
							type="text"
							class={styles['search-input']}
							placeholder="搜索任务..."
							value={searchText()}
							oninput={(e) => setSearchText(e.currentTarget.value)}
						/>
					</Show>
				</div>

				{/* 树形目录 */}
				<div class={styles['sidebar-tree']}>
					<For each={state.folders}>
						{(folder) => {
							const convs = conversationsInFolder(folder.id);
							// 注意：expandedFolders() 必须在 JSX 表达式里读取才会被追踪，
							// 放在回调体顶部（const isOpen = ...）会导致折叠点击不刷新
							return (
								<div class={styles['tree-folder']}>
									<div class={styles['tree-folder-header']} onclick={() => toggleFolder(folder.id)}>
										<span class={styles['tree-expand-indicator']}>
											<ChevronIcon open={expandedFolders().has(folder.id)} />
										</span>
										<span class={styles['tree-folder-name']}>{folderLabel(folder)}</span>
										<span class={styles['tree-folder-spacer']} />
										<span class={styles['tree-folder-count']}>{convs().length}</span>
										<Show when={!folder.isLocal && expandedFolders().has(folder.id)}>
											<button
												class={styles['row-action']}
												title="移除工作目录"
												aria-label="移除工作目录"
												onclick={(e) => {
													e.stopPropagation();
													actions.removeFolder(folder.id);
												}}
											>
												<TrashIcon />
											</button>
										</Show>
									</div>

									<Show when={expandedFolders().has(folder.id)}>
										<div class={styles['tree-items']}>
											<For each={convs()}>
												{(conv) => {
													const isActive = () => state.activeConversationId === conv.id;
													return (
														<div
															class={styles['tree-item']}
															classList={{
																[styles.active]: isActive(),
																[styles['is-running']]: isActive() && running(),
															}}
															onclick={() => actions.setActiveConversation(conv.id)}
															title={`${conv.title}\n创建: ${new Date(conv.createdAt).toLocaleString()}\n更新: ${new Date(conv.updatedAt).toLocaleString()}`}
														>
															<span class={styles['tree-item-marker']} />
															<span class={styles['tree-item-title']}>{conv.title}</span>
															<span class={styles['tree-item-time']}>{compactTime(conv.updatedAt)}</span>
															<button
																class={styles['row-action']}
																title="删除任务"
																aria-label="删除任务"
																onclick={(e) => {
																	e.stopPropagation();
																	actions.deleteConversation(conv.id);
																}}
															>
																<TrashIcon />
															</button>
														</div>
													);
												}}
											</For>
											<Show when={convs().length === 0}>
												<div class={styles['tree-empty']}>{searchText() ? '（无匹配任务）' : '（暂无任务）'}</div>
											</Show>
										</div>
									</Show>
								</div>
							);
						}}
					</For>
				</div>

				{/* 底部：运行时状态 + 设置 */}
				<div class={styles['sidebar-footer-divider']} />
				<div class={styles['sidebar-footer']}>
					<div class={styles['runtime-status']}>
						<span class={styles['status-dot']} />
						<span class={styles['runtime-text']}>本地运行时 · Agent 在线</span>
						<span class={styles['runtime-spacer']} />
						<span class={styles['runtime-version']}>{appVersion() ? `v${appVersion()}` : ''}</span>
					</div>
					<button class={styles['settings-btn']} onclick={() => actions.openSettings('通用')}>
						<SettingsIcon />
						<span class={styles['settings-text']}>设置</span>
						<span class={styles['settings-spacer']} />
						<span class={styles['settings-chevron']}>
							<EnterIcon />
						</span>
					</button>
				</div>
			</Show>
		</div>
	);
}
