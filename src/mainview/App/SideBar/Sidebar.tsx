/* ==========================================================================
   侧边栏组件
   ========================================================================== */

import { createSignal, createMemo, For, Show, onMount } from 'solid-js';
import styles from './Sidebar.module.css';
import { state, setState, actions } from '../../store';
import { requestFolderPath } from '../../localBridge';
import { getTimeString } from '../../../bun/utils';

function FolderIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
		</svg>
	);
}

function ChatIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
		</svg>
	);
}

function ChevronIcon(props: { open: boolean }) {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
			 style={{ transform: props.open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}>
			<polyline points="9 18 15 12 9 6"/>
		</svg>
	);
}

function NewIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<line x1="12" y1="5" x2="12" y2="19"/>
			<line x1="5" y1="12" x2="19" y2="12"/>
		</svg>
	);
}

function SearchIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8"/>
			<line x1="21" y1="21" x2="16.65" y2="16.65"/>
		</svg>
	);
}

function SettingsIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="3"/>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
		</svg>
	);
}

function CollapseIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="15 18 9 12 15 6"/>
		</svg>
	);
}

function ExpandIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="9 18 15 12 9 6"/>
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="3 6 5 6 21 6"/>
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
			<line x1="10" y1="11" x2="10" y2="17"/>
			<line x1="14" y1="11" x2="14" y2="17"/>
		</svg>
	);
}

export default function Sidebar() {
	const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(
		new Set(["local"]),
	);
	const [searchText, setSearchText] = createSignal("");
	const [showSearch, setShowSearch] = createSignal(false);

	const toggleFolder = (id: string) => {
		setExpandedFolders((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleNewTask = () => {
		// 默认在 "本地" 文件夹下创建新任务
		actions.createConversation("local");
	};

	const handleNewFolder = async () => {
		const folderPath = await requestFolderPath();
		if (!folderPath) return;  // 用户取消
		// 用目录名作为 folderId 和显示名
		const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
		actions.addFolder(folderPath, folderName);
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
			return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
		});

	return (
		<div
			class={styles.sidebar}
			classList={{ [styles.collapsed]: state.ui.sidebarCollapsed }}
			style={{ width: `${state.ui.sidebarWidth}px` }}
		>
			{/* 顶部：Logo + 折叠按钮 */}
			<div class={styles['sidebar-header']}>
				<div class={styles['app-logo']}>M</div>
				<Show when={!state.ui.sidebarCollapsed}>
					<span class={styles['app-title']}>MindTheGap</span>
					<button
						class={styles['sidebar-toggle-btn']}
						title="折叠侧边栏"
						onclick={() => actions.toggleSidebar()}
					>
						<CollapseIcon />
					</button>
				</Show>
				<Show when={state.ui.sidebarCollapsed}>
					<button
						class={`${styles['app-logo']} ${styles['logo-collapsed']}`}
						title="展开侧边栏"
						onclick={() => actions.toggleSidebar()}
					>
						<ExpandIcon />
					</button>
				</Show>
			</div>

			{/* 新建任务按钮 */}
			<Show when={!state.ui.sidebarCollapsed}>
				<button class={styles['sidebar-new-task']} onclick={handleNewTask}>
					<NewIcon />
					<span class={styles['sidebar-new-task-text']}>新建任务</span>
				</button>
			</Show>

			{/* 任务列表标题栏 */}
			<Show when={!state.ui.sidebarCollapsed}>
				<div class={styles['sidebar-section-header']}>
					<span class={styles['section-title']}>任务列表</span>
					<div class={styles['section-actions']}>
						<button
							class="icon-btn"
							title="搜索"
							onclick={() => setShowSearch((v) => !v)}
						>
							<SearchIcon />
						</button>
						<button
							class="icon-btn"
							title="新建文件夹"
							onclick={handleNewFolder}
						>
							<NewIcon />
						</button>
					</div>
				</div>

				{/* 搜索框 */}
				<Show when={showSearch()}>
					<div style={{ padding: "0 12px 8px" }}>
						<input
							type="text"
							class="text-input"
							placeholder="搜索任务..."
							value={searchText()}
							oninput={(e) => setSearchText(e.currentTarget.value)}
						/>
					</div>
				</Show>
			</Show>

			{/* 树形目录 */}
			<div class={styles['sidebar-tree']}>
				<For each={state.folders}>
					{(folder) => {
						const convs = conversationsInFolder(folder.id);
						// 注意：expandedFolders() 必须在 JSX 表达式里读取才会被追踪，
						// 放在回调体顶部（const isOpen = ...）会导致折叠点击不刷新
						return (
							<div
								class={styles['tree-folder']}
								classList={{ [styles.expanded]: expandedFolders().has(folder.id) }}
							>
								<div
									class={styles['tree-folder-header']}
									onclick={() => toggleFolder(folder.id)}
								>
									<span class={styles['tree-expand-indicator']}>
										<ChevronIcon open={expandedFolders().has(folder.id)} />
									</span>
									<span style={{ color: "var(--fontColorMuted)" }}>
										<FolderIcon />
									</span>
									<span class={styles['tree-folder-name']}>
										{folder.name}
									</span>
									<Show when={!folder.isLocal}>
										<button
											class={styles['tree-folder-delete']}
											title="删除文件夹"
											onclick={(e) => {
												e.stopPropagation();
												actions.removeFolder(folder.id);
											}}
										>
											<TrashIcon />
										</button>
									</Show>
								</div>

								<div class={styles['tree-items']}>
									<For each={convs()}>
										{(conv) => {
											const tooltipText = () => {
												const created = getTimeString(new Date(conv.createdAt), false);
												const updated = getTimeString(new Date(conv.updatedAt), false);
												return `创建: ${created}\n更新: ${updated}`;
											};
											return (
												<div
													class={styles['tree-item']}
													classList={{
														[styles.active]:
															state.activeConversationId ===
															conv.id,
													}}
													onclick={() =>
														actions.setActiveConversation(
															conv.id,
														)
													}
													title={tooltipText()}
												>
													<span style={{ marginRight: 6 }}>
														<ChatIcon />
													</span>
													<span class={styles['tree-item-title']}>{conv.title}</span>
													<button
														class={styles['tree-item-delete']}
														title="删除任务"
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
										<div
											style={{
												padding: "6px 8px",
												fontSize: 12,
												color: "var(--fontColorMuted)",
											}}
										>
											（暂无任务）
										</div>
									</Show>
								</div>
							</div>
						);
					}}
				</For>
			</div>

			{/* 底部：设置 */}
			<div class={styles['sidebar-footer']}>
				<button
					class="icon-btn"
					title="设置"
					onclick={() => actions.openSettings("通用")}
				>
					<SettingsIcon />
				</button>
			</div>
		</div>
	);
}