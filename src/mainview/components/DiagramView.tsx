/* ==========================================================================
   图示模式 — Agent 执行时间线
   
   数据源: Conversation.agentCtx
   - works: workId → AgentWorkInfo（Agent 树结构）
   - events: 扁平事件数组，按时间排序
   
   渲染：每行一个 Agent work（按层级缩进），横向展示该 work 的事件序列
   ========================================================================== */

import { For, Show } from "solid-js";
import { getActiveConversation } from "../store";
import type { AgentCtx, AgentEvent, AgentWorkInfo } from "../shared/agent";

/** 事件类型 → 颜色映射 */
const EVENT_COLORS: Record<string, string> = {
	user_message: "hsl(210 80% 55%)",
	assistant_message: "hsl(160 60% 45%)",
	tool_call: "hsl(45 90% 55%)",
	tool_result: "hsl(45 60% 40%)",
	agent_start: "hsl(280 70% 60%)",
	agent_end: "hsl(280 50% 40%)",
	transfer: "hsl(330 70% 55%)",
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
	transfer: "↗",
	system: "⚙",
};

function WorkRow(props: {
	workId: string;
	work: AgentWorkInfo;
	events: AgentEvent[];
	level: number;
	allWorks: Record<string, AgentWorkInfo>;
}) {
	const { work, events, level, allWorks } = props;

	// 子 work（按 parentWorkId 过滤）
	const childWorks = Object.values(allWorks).filter(
		(w) => w.parentWorkId === props.workId,
	);

	const formatDuration = (ms?: number) => {
		if (!ms) return "";
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	};

	return (
		<div class="diagram-work-row">
			{/* 当前 work */}
			<div
				class="diagram-work-header"
				style={{ "padding-left": `${level * 20}px` }}
			>
				<span class="diagram-work-icon">🤖</span>
				<span class="diagram-work-name">{work.agentName}</span>
				<span
					classList={{
						"diagram-work-status": true,
						status_running: work.status === "running",
						status_completed: work.status === "completed",
						status_failed: work.status === "failed",
					}}
				>
					{work.status}
				</span>
				{work.tokens && (
					<span class="diagram-work-tokens">
						tokens: {work.tokens.input ?? 0}↑ {work.tokens.output ?? 0}↓
					</span>
				)}
			</div>

			{/* 当前 work 的事件 */}
			<div
				class="diagram-events-row"
				style={{ "padding-left": `${level * 20 + 20}px` }}
			>
				<For each={events}>
					{(evt) => (
						<div
							class="diagram-event"
							title={`${evt.type}${evt.duration ? ` · ${formatDuration(evt.duration)}` : ""}${evt.tokens ? ` · input:${evt.tokens.input ?? 0} output:${evt.tokens.output ?? 0}` : ""}`}
							style={{
								background: EVENT_COLORS[evt.type] ?? EVENT_COLORS.system,
							}}
						>
							<span class="diagram-event-icon">
								{EVENT_ICONS[evt.type] ?? "?"}
							</span>
							<Show when={evt.duration && evt.duration > 500}>
								<span class="diagram-event-duration">
									{formatDuration(evt.duration)}
								</span>
							</Show>
						</div>
					)}
				</For>
			</div>

			{/* 递归渲染子 work */}
			<For each={childWorks}>
				{(child) => (
					<WorkRow
						workId={child.workId}
						work={child}
						events={events.filter((e) => e.workId === child.workId)}
						level={level + 1}
						allWorks={allWorks}
					/>
				)}
			</For>
		</div>
	);
}

export default function DiagramView() {
	const conv = getActiveConversation();
	const ctx = conv?.agentCtx;

	// 根 workId
	const rootWorkId = ctx?.rootWorkId;
	const rootWork = rootWorkId ? ctx.works[rootWorkId] : null;

	return (
		<div class="diagram-container">
			<Show when={!ctx}>
				<div class="diagram-empty">
					<div class="diagram-empty-icon">🔥</div>
					<h3>还没有 Agent 执行数据</h3>
					<p>在聊天中发送消息让 Agent 工作后，这里会展示执行时间线。</p>
				</div>
			</Show>

			<Show when={ctx && rootWork}>
				<div class="diagram-header">
					<div class="diagram-header-title">Agent 执行时间线</div>
					<div class="diagram-header-stats">
						<span>📊 {ctx.events.length} 个事件</span>
						<span>🤖 {Object.keys(ctx.works).length} 个 Agent</span>
						<span>⏱️ 总时长 {((ctx.updatedAt - ctx.createdAt) / 1000).toFixed(1)}s</span>
					</div>
				</div>

				<div class="diagram-legend">
					<For each={Object.entries(EVENT_COLORS)}>
						{([type, color]) => (
							<div class="diagram-legend-item">
								<span class="diagram-legend-swatch" style={{ background: color }} />
								<span>{EVENT_ICONS[type]} {type}</span>
							</div>
						)}
					</For>
				</div>

				<div class="diagram-timeline">
					<WorkRow
						workId={rootWorkId!}
						work={rootWork!}
						events={ctx.events.filter((e) => e.workId === rootWorkId)}
						level={0}
						allWorks={ctx.works}
					/>
				</div>
			</Show>
		</div>
	);
}
