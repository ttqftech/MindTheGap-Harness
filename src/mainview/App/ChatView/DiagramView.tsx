/* ==========================================================================
   图示模式 — Agent 执行时间线（v2）

   数据源: Conversation.agentCtx（ctxVersion 2）
   - agentInstances: agentInstanceId → AgentInstance（实例树）
   - events: 扁平事件数组（带 agentInstanceId）

   渲染：每行一个 AgentInstance（按 depth 缩进），横向展示该实例的事件序列
   ========================================================================== */

import { For, Show } from "solid-js";
import { getActiveConversation } from "@mainview/store";
import styles from './DiagramView.module.css';
import type { AgentCtx, AgentEvent, AgentInstance } from "@shared/agent";

/** 事件类型 → 颜色映射 */
const EVENT_COLORS: Record<string, string> = {
	user_message: "hsl(210 80% 55%)",
	assistant_message: "hsl(160 60% 45%)",
	tool_call: "hsl(45 90% 55%)",
	tool_result: "hsl(45 60% 40%)",
	agent_start: "hsl(280 70% 60%)",
	agent_end: "hsl(280 50% 40%)",
	reflection: "hsl(330 70% 55%)",
	system: "hsl(0 0% 50%)",
};

/** 事件类型 → 图标 */
const EVENT_ICONS: Record<string, string> = {
	user_message: "👤",
	assistant_message: "🤖",
	tool_call: "🔧",
	tool_result: "✅",
	agent_start: "▶",
	agent_end: "■",
	reflection: "🪞",
	system: "⚙",
};

const STATUS_CLASS: Record<string, string> = {
	running: "status_running",
	succeeded: "status_completed",
	failed: "status_failed",
	interrupted: "status_failed",
	pending: "status_running",
};

function InstanceRow(props: {
	instance: AgentInstance;
	events: AgentEvent[];
	allInstances: Record<string, AgentInstance>;
}) {
	const instance = () => props.instance;
	const level = () => props.instance.depth;

	const children = () =>
		instance().childAgentInstanceIds
			.map((id) => props.allInstances[id])
			.filter((x): x is AgentInstance => !!x);

	return (
		<div class={styles['diagram-work-row']}>
			<div class={styles['diagram-work-header']} style={{ "padding-left": `${level() * 20}px` }}>
				<span class={styles['diagram-work-icon']}>{level() === 0 ? "🧭" : "🤖"}</span>
				<span class={styles['diagram-work-name']}>{instance().agentName}</span>
				<span class={styles['diagram-work-status']} classList={{ [styles[STATUS_CLASS[instance().status] ?? "status_running"]]: true }}>
					{instance().status}
				</span>
				<Show when={instance().tokens}>
					<span class={styles['diagram-work-tokens']}>
						tokens: {instance().tokens?.input ?? 0}↑ {instance().tokens?.output ?? 0}↓ · 轮次 {instance().rounds}
					</span>
				</Show>
			</div>

			<div class={styles['diagram-events-row']} style={{ "padding-left": `${level() * 20 + 20}px` }}>
				<For each={props.events}>
					{(evt) => (
						<div
							class={styles['diagram-event']}
							title={`${evt.type}${evt.tokens ? ` · input:${evt.tokens.input ?? 0} output:${evt.tokens.output ?? 0}` : ""}`}
							style={{ background: EVENT_COLORS[evt.type] ?? EVENT_COLORS.system }}
						>
							<span class={styles['diagram-event-icon']}>{EVENT_ICONS[evt.type] ?? "?"}</span>
						</div>
					)}
				</For>
			</div>

			<For each={children()}>
				{(child) => (
					<InstanceRow
						instance={child}
						events={props.events.filter((e) => e.agentInstanceId === child.agentInstanceId)}
						allInstances={props.allInstances}
					/>
				)}
			</For>
		</div>
	);
}

export default function DiagramView() {
	const ctx = (): AgentCtx | undefined => getActiveConversation()?.agentCtx;
	const rootInstance = (): AgentInstance | undefined => {
		const current = ctx();
		if (!current) return undefined;
		return current.agentInstances?.[current.rootAgentInstanceId];
	};

	return (
		<div class={styles['diagram-container']}>
			<Show when={!rootInstance()}>
				<div class={styles['diagram-empty']}>
					<div class={styles['diagram-empty-icon']}>🔥</div>
					<h3>还没有 Agent 执行数据</h3>
					<p>在聊天中发送消息让 Agent 工作后，这里会展示执行时间线。</p>
				</div>
			</Show>

			<Show when={rootInstance()}>
				<div class={styles['diagram-header']}>
					<div class={styles['diagram-header-title']}>Agent 执行时间线</div>
					<div class={styles['diagram-header-stats']}>
						<span>📊 {ctx()!.events.length} 个事件</span>
						<span>🤖 {Object.keys(ctx()!.agentInstances ?? {}).length} 个实例</span>
						<span>🔁 预算 {ctx()!.budget.spent} / {ctx()!.budget.total}</span>
						<span>⏱️ 总时长 {((ctx()!.updatedAt - ctx()!.createdAt) / 1000).toFixed(1)}s</span>
					</div>
				</div>

				<div class={styles['diagram-legend']}>
					<For each={Object.entries(EVENT_COLORS)}>
						{([type, color]) => (
							<div class={styles['diagram-legend-item']}>
								<span class={styles['diagram-legend-swatch']} style={{ background: color }} />
								<span>{EVENT_ICONS[type]} {type}</span>
							</div>
						)}
					</For>
				</div>

				<div class={styles['diagram-timeline']}>
					<InstanceRow
						instance={rootInstance()!}
						events={ctx()!.events.filter((e) => e.agentInstanceId === rootInstance()!.agentInstanceId)}
						allInstances={ctx()!.agentInstances}
					/>
				</div>
			</Show>
		</div>
	);
}
