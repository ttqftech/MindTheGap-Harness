/**
 * 右侧栏 —— 待办清单 + 后台任务
 *
 * 2026-09-17：从 ChatView 的「任务清单小面板」移到这里，独立成栏（数据源 store 的 todoListState）。
 * 2026-11-04：改名「待办清单」（taskList → todoList），并在下面加了「后台任务」区块：
 *   后台任务的进程活在 Service 里（`service/background.ts`），这里只做两件事 ——
 *   列表（每 2s 轮询）与终端详情弹窗（打开期间每 1.2s 轮询增量全文）。
 */

import { createSignal, createEffect, on, onCleanup, For, Index, Show } from 'solid-js';
import { state, getTodoList } from '@mainview/stores';
import * as agentBridge from '@mainview/bridges/agentBridge';
import type { BackgroundTaskView } from '@mainview/bridges/agentBridge';
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

/** 停止：实心方块 */
function StopIcon() {
	return (
		<svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
			<rect x="1" y="1" width="7" height="7" rx="1.2" />
		</svg>
	);
}

// #endregion

/** 把后端存的清单文本拆成行：只认 `- [ ]` / `- [x]` 这种 checkbox 行，其它忽略。 */
const parseTodoLines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ['));
const isDoneLine = (line: string) => /- \[x\]/i.test(line);

/** 毫秒 → 人话时长（后台任务用；精确到秒就够了） */
function formatElapsed(ms: number): string {
	const sec = Math.max(0, Math.round(ms / 1000));
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`;
	return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

const STATUS_TEXT: Record<BackgroundTaskView['status'], string> = {
	running: '运行中',
	completed: '已完成',
	failed: '异常退出',
	stopped: '已停止',
};

export default function RightSidebar() {
	// ⚠️ 默认**展开**：折叠时界面上只有一行标题 + ▸，用户感知到的是「看不到清单」
	//   （2026-09-17 那次投诉的原话）。清单有内容时就该让它直接可见。
	const [todoOpen, setTodoOpen] = createSignal(true);
	const [tasksOpen, setTasksOpen] = createSignal(true);

	/** 侧边栏折叠 / 展开时展示过渡动画，过渡完毕后取消效果 */
	const [isToggling, setIsToggling] = createSignal(false);
	createEffect(on(
		() => state.ui.rightSidebarCollapsed,
		() => {
			setIsToggling(true);
			setTimeout(() => setIsToggling(false), 300);
		},
	));

	const conversationId = () => state.activeConversationId ?? '';

	const todoList = () => getTodoList(conversationId());
	const lines = () => parseTodoLines(todoList());
	const doneCount = () => lines().filter(isDoneLine).length;

	// #region 后台任务：列表轮询

	const [tasks, setTasks] = createSignal<BackgroundTaskView[]>([]);
	/** 每秒走一次的钟：让「已执行时间」自己往上跳，不用等下一次轮询 */
	const [tick, setTick] = createSignal(0);

	const refreshTasks = async () => {
		const id = conversationId();
		if (!id) {
			setTasks([]);
			return;
		}
		setTasks(await agentBridge.listBackgroundTasks(id));
	};

	createEffect(on(conversationId, () => void refreshTasks()));

	createEffect(() => {
		if (state.ui.rightSidebarCollapsed) return;
		const timer = setInterval(() => {
			setTick((v) => v + 1);
			void refreshTasks();
		}, 2000);
		onCleanup(() => clearInterval(timer));
	});

	// #endregion

	// #region 终端详情弹窗

	const [detailId, setDetailId] = createSignal<string | null>(null);
	const [detailText, setDetailText] = createSignal('');
	const [detailError, setDetailError] = createSignal<string | null>(null);
	let panelRef: HTMLPreElement | undefined;

	const openDetail = (task: BackgroundTaskView) => {
		setDetailText('');
		setDetailError(null);
		setDetailId(task.id);
	};

	const closeDetail = () => setDetailId(null);

	const detailTask = () => tasks().find((t) => t.id === detailId());

	/** 弹窗开着的时候轮询：拿全文（后台任务的输出本来就不大，省得维护两套游标） */
	createEffect(() => {
		const id = detailId();
		if (!id) return;
		const convId = conversationId();
		let alive = true;
		// 任务结束后就没必要继续拉全文了：pull 一次发现状态不对就把轮询停掉
		let keepPolling = true;

		const pull = async () => {
			const res = await agentBridge.getBackgroundOutput(convId, id, true);
			if (!alive) return;
			if (!res.ok) {
				setDetailError(res.error ?? '读取失败');
				keepPolling = false;
				return;
			}
			setDetailError(null);
			if (res.status && res.status !== 'running') keepPolling = false;
			// 只有「原本就贴着底」才自动滚到底：用户往上翻着看历史时别把他拽回来
			const pre = panelRef;
			const atBottom = !pre || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
			setDetailText(res.output || '（暂无输出）');
			if (atBottom) queueMicrotask(() => pre && (pre.scrollTop = pre.scrollHeight));
		};

		void pull();
		const timer = setInterval(() => {
			if (keepPolling) void pull();
		}, 1200);
		onCleanup(() => {
			alive = false;
			clearInterval(timer);
		});
	});

	/** 停止：列表与弹窗共用 */
	const stopTask = async (taskId: string) => {
		await agentBridge.stopBackgroundTask(conversationId(), taskId);
		void refreshTasks();
	};

	// #endregion

	return (
		<div
			class={styles.rightSidebar}
			classList={{ [styles.collapsed]: state.ui.rightSidebarCollapsed }}
			style={{ width: `${state.ui.rightSidebarCollapsed ? 0 : state.ui.rightSidebarWidth}px`, transition: isToggling() ? 'width 0.3s cubic-bezier(0.2, 0.2, 0.2, 1.1)' : 'none' }}
		>
			<Show when={!state.ui.rightSidebarCollapsed}>
				{/* ---- 待办清单 ---- */}
				<div class={styles.section}>
					<div class={styles['rightSidebar-header']}>
						<span class={styles['rightSidebar-title']}>待办清单</span>
						<span class={styles['rightSidebar-count']}>{lines().length}</span>
						<span style="flex: 1" />
						<button
							class={styles['rightSidebar-toggle']}
							title={todoOpen() ? '折叠待办清单' : '展开待办清单'}
							aria-label={todoOpen() ? '折叠待办清单' : '展开待办清单'}
							onClick={() => setTodoOpen((v) => !v)}
						>
							<TaskCollapseIcon open={todoOpen()} />
						</button>
					</div>

					<div class={styles['rightSidebar-list']}>
						<Show when={lines().length === 0}>
							<div class={styles['rightSidebar-empty']}>（暂无待办清单）</div>
						</Show>
						<Show when={todoOpen()}>
							<For each={lines()}>
								{(line) => {
									const done = isDoneLine(line);
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
				</div>

				{/* ---- 后台任务 ---- */}
				<div class={`${styles.section} ${styles['section-tasks']}`}>
					<div class={styles['rightSidebar-header']}>
						<span class={styles['rightSidebar-title']}>后台任务</span>
						<span class={styles['rightSidebar-count']}>{tasks().length}</span>
						<span style="flex: 1" />
						<button
							class={styles['rightSidebar-toggle']}
							title={tasksOpen() ? '折叠后台任务' : '展开后台任务'}
							aria-label={tasksOpen() ? '折叠后台任务' : '展开后台任务'}
							onClick={() => setTasksOpen((v) => !v)}
						>
							<TaskCollapseIcon open={tasksOpen()} />
						</button>
					</div>

					<div class={styles['rightSidebar-list']}>
						<Show when={tasks().length === 0}>
							<div class={styles['rightSidebar-empty']}>（暂无后台任务）</div>
						</Show>
						<Show when={tasksOpen()}>
							{/* ⚠️ 用 Index 不用 For：列表每 2s 轮询一次、每次都是全新对象，
							    For 按引用比对会把整行 DOM 拆了重建（滚动位置与 hover 都会丢）。
							    Index 按位置复用一个行，字段变化只更新文本。 */}
							<Index each={tasks()}>
								{(task) => {
									// 读一下 tick，让「已执行时间」每秒刷新（Solid 的依赖追踪靠读信号建立）
									const elapsed = () => {
										void tick();
										const t = task();
										if (t.status !== 'running') {
											return formatElapsed((t.endedAt ?? t.startedAt) - t.startedAt);
										}
										return formatElapsed(Date.now() - t.startedAt);
									};
									return (
										<div
											class={styles.taskItem}
											classList={{ [styles['taskItem-ended']]: task().status !== 'running' }}
											onClick={() => openDetail(task())}
											title="点击查看终端输出"
										>
											<span class={styles.taskDot} data-status={task().status} />
											<div class={styles.taskMain}>
												<div class={styles.taskTitle}>{task().description || task().command}</div>
												<div class={styles.taskMeta}>
													<span class={styles.taskCommand}>{task().command}</span>
													<span class={styles.taskElapsed}>
														{STATUS_TEXT[task().status]} · {elapsed()}
													</span>
												</div>
											</div>
											<Show when={task().status === 'running'}>
												<button
													class={styles.taskStop}
													title="停止这个后台任务"
													aria-label="停止后台任务"
													onClick={(e) => {
														e.stopPropagation();
														void stopTask(task().id);
													}}
												>
													<StopIcon />
												</button>
											</Show>
										</div>
									);
								}}
							</Index>
						</Show>
					</div>
				</div>

				{/* ---- 终端详情弹窗 ---- */}
				<Show when={detailId()}>
					<div class={styles.detailMask} onClick={closeDetail}>
						<div class={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
							<div class={styles.detailHeader}>
								<span class={styles.detailDot} data-status={detailTask()?.status ?? 'running'} />
								<span class={styles.detailTitle}>{detailTask()?.description || detailTask()?.command || detailId()}</span>
								<span class={styles.detailId}>{detailId()}</span>
								<span style="flex: 1" />
								<Show when={detailTask()?.status === 'running'}>
									<button
										class={styles.detailButton}
										onClick={() => void stopTask(detailId()!)}
									>
										停止
									</button>
								</Show>
								<button class={styles.detailClose} onClick={closeDetail} title="关闭">✕</button>
							</div>
							<div class={styles.detailSub}>
								<span class={styles.taskCommand}>$ {detailTask()?.command}</span>
								<span class={styles.taskElapsed}>
									{detailTask() ? STATUS_TEXT[detailTask()!.status] : ''}
									{detailTask()?.status === 'running' && detailTask() ? ` · ${formatElapsed(Date.now() - detailTask()!.startedAt)}` : ''}
									{detailTask()?.exitCode !== undefined && detailTask()?.exitCode !== null ? ` · exit ${detailTask()!.exitCode}` : ''}
								</span>
							</div>
							<pre class={styles.detailOutput} ref={panelRef}>
								{detailError() ?? detailText()}
							</pre>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	);
}
