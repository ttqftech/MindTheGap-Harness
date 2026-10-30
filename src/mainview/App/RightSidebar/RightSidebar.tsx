/**
 * 右侧栏 —— 任务清单（Agent 经 task_list_write / task_list_read 落的那条字符串）
 *
 * 2026-09-17：从 ChatView 的「任务清单小面板」移到这里，独立成栏。
 * 数据源与面板时期完全一致（store 的 taskListState[conversationId]），只是渲染位置变了：
 * 原来埋在聊天消息列表顶部，用户感知是「找不到任务清单」；现在挂在右边栏，和左边栏「任务列表 = 会话列表」对称，一眼能看到。
 */

import { createSignal, createEffect, on, For, Show } from 'solid-js';
import { state, getTaskList } from '@mainview/stores';
import styles from './RightSidebar.module.css';

// #region 图标

/** 折叠箭头：与左侧 Sidebar 的 ChevronIcon 同款，收起时指向左 */
function TaskCollapseIcon(props: { open: boolean }) {
	return (
		<svg
			width="11" height="11" viewBox="0 0 11 11"
			fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
			style={{ transform: props.open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
		>
			<polyline points="2.2 4 5.5 7.3 8.8 4" />
		</svg>
	);
}

// #endregion

/** 把后端存的清单文本拆成行：只认 `- [ ]` / `- [x]` 这种 checkbox 行，其它忽略。 */
const parseTaskListLines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['));

export default function RightSidebar() {
	// ⚠️ 默认**展开**：折叠时界面上只有一行标题 + ▸，用户感知到的是「看不到任务清单」
	//   （2026-09-17 那次投诉的原话）。清单有内容时就该让它直接可见。
	const [taskListOpen, setTaskListOpen] = createSignal(true);

	/** 侧边栏折叠 / 展开时展示过渡动画，过渡完毕后取消效果 */
	const [isToggling, setIsToggling] = createSignal(false);
	createEffect(on(
		() => state.ui.rightSidebarCollapsed,
		() => {
			setIsToggling(true);
			setTimeout(() => setIsToggling(false), 300);
		},
	));

	const taskList = () => getTaskList(state.activeConversationId ?? '');
	const lines = () => parseTaskListLines(taskList());
	const doneCount = () => lines().filter((l) => /- \[x\]/i.test(l)).length;

	return (
		<div
			class={styles.rightSidebar}
			classList={{ [styles.collapsed]: state.ui.rightSidebarCollapsed }}
			style={{ width: `${state.ui.rightSidebarCollapsed ? 0 : state.ui.rightSidebarWidth}px`, transition: isToggling() ? 'width 0.3s cubic-bezier(0.2, 0.2, 0.2, 1.1)' : 'none' }}
		>
			<Show when={!state.ui.rightSidebarCollapsed}>
				<div class={styles['rightSidebar-header']}>
					<span class={styles['rightSidebar-title']}>任务清单</span>
					<span class={styles['rightSidebar-count']}>{lines().length}</span>
					<span style="flex: 1" />
					<button
						class={styles['rightSidebar-toggle']}
						title={taskListOpen() ? '折叠清单' : '展开清单'}
						aria-label={taskListOpen() ? '折叠任务清单' : '展开任务清单'}
						onClick={() => setTaskListOpen((v) => !v)}
					>
						<TaskCollapseIcon open={taskListOpen()} />
					</button>
				</div>

				<div class={styles['rightSidebar-list']}>
					<Show when={lines().length === 0}>
						<div class={styles['rightSidebar-empty']}>（暂无任务清单）</div>
					</Show>
					<Show when={taskListOpen()}>
						<For each={lines()}>
							{(line) => {
								const done = /- \[x\]/i.test(line);
								return (
									<div
										class={styles['rightSidebar-item']}
										classList={{ [styles['rightSidebar-item-done']]: done }}
									>
										<span class={styles['rightSidebar-checkbox']}>{done ? '✅' : '⬜'}</span>
										<span class={styles['rightSidebar-text']}>{line.replace(/^-\s*\[[ xX]\]\s*/, '')}</span>
									</div>
								);
							}}
						</For>
					</Show>
				</div>

				<div class={styles['rightSidebar-footer']}>
					<span class={styles['rightSidebar-footer-text']}>{doneCount()} / {lines().length} 完成</span>
				</div>
			</Show>
		</div>
	);
}