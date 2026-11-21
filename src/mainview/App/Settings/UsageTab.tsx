/* ==========================================================================
   用量 Tab — 本机组。指标显示开关存 localStorage 的 usage，折线图目前是假数据，
   跟后端 settings.json 没有任何关系，所以归到本机组。
   ========================================================================== */

import { createMemo, For } from 'solid-js';
import { state, actions } from '@mainview/stores';
import common from './SettingsCommon.module.css';

export function UsageTab() {
	// Mock 折线图数据
	const mockData = createMemo(() => {
		const points: { time: string; requests: number; tokens: number }[] = [];
		const range = state.usage.timeRange;
		const count = range === "4h" ? 8 : range === "1d" ? 24 : range === "today" ? 12 : range === "7d" ? 14 : 30;
		for (let i = 0; i < count; i++) {
			points.push({
				time: `${i}`,
				requests: Math.floor(Math.random() * 50 + 5),
				tokens: Math.floor(Math.random() * 10000 + 1000),
			});
		}
		return points;
	});

	const timeRanges: Array<{ value: typeof state.usage.timeRange; label: string }> = [
		{ value: "4h", label: "4h" },
		{ value: "1d", label: "1d" },
		{ value: "today", label: "今天" },
		{ value: "7d", label: "7d" },
		{ value: "30d", label: "30d" },
	];

	// 计算总量
	const totals = createMemo(() => {
		const data = mockData();
		let requests = 0;
		let tokens = 0;
		for (const d of data) {
			requests += d.requests;
			tokens += d.tokens;
		}
		return {
			requests,
			toolCalls: Math.floor(requests * 1.8),
			tokensInput: Math.floor(tokens * 0.6),
			tokensInputCached: Math.floor(tokens * 0.25),
			tokensOutput: Math.floor(tokens * 0.15),
		};
	});

	// 简单的 SVG 折线图
	const chartSvg = createMemo(() => {
		const data = mockData();
		const w = 600;
		const h = 180;
		const pad = 30;
		const max = Math.max(...data.map((d) => d.requests));
		const stepX = (w - pad * 2) / (data.length - 1 || 1);

		const path = data.map((d, i) => {
			const x = pad + i * stepX;
			const y = h - pad - (d.requests / max) * (h - pad * 2);
			return `${i === 0 ? "M" : "L"}${x},${y}`;
		}).join(" ");

		return `
			<svg viewBox="0 0 ${w} ${h}" width="100%" height="180" preserveAspectRatio="none">
				<!-- 网格线 -->
				${[0, 0.25, 0.5, 0.75, 1].map((r) => {
					const y = h - pad - r * (h - pad * 2);
					return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="hwb(var(--borderLight))" stroke-width="1"/>`;
				}).join("")}
				<!-- 折线 -->
				<path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
				<!-- 数据点 -->
				${data.map((d, i) => {
					const x = pad + i * stepX;
					const y = h - pad - (d.requests / max) * (h - pad * 2);
					return `<circle cx="${x}" cy="${y}" r="3" fill="var(--primary)"/>`;
				}).join("")}
			</svg>
		`;
	});

	return (
		<div>
			{/* 时间选择 */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>时间范围</div>
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					<For each={timeRanges}>
						{(r) => (
							<button
								class={common.btnSecondary}
								style={{
									backgroundColor: state.usage.timeRange === r.value
										? "var(--primary)"
										: "hwb(var(--bg90) / 1)",
									color: state.usage.timeRange === r.value ? "#fff" : "var(--fontColor)",
								}}
								onclick={() => actions.setUsage("timeRange", r.value)}
							>
								{r.label}
							</button>
						)}
					</For>
				</div>
			</div>

			{/* Dashboard 项（可开关） */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>指标显示</div>
				<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
					<DashboardItem
						label="API 请求次数"
						value={totals().requests.toLocaleString()}
						icon="📡"
						enabled={state.usage.showApiRequests}
						onToggle={(v) => actions.setUsage("showApiRequests", v)}
					/>
					<DashboardItem
						label="工具调用次数"
						value={totals().toolCalls.toLocaleString()}
						icon="🛠️"
						enabled={state.usage.showToolCalls}
						onToggle={(v) => actions.setUsage("showToolCalls", v)}
					/>
					<DashboardItem
						label="Token 消耗（输入 · 有缓存）"
						value={totals().tokensInputCached.toLocaleString()}
						icon="💾"
						enabled={state.usage.showTokensInputCached}
						onToggle={(v) => actions.setUsage("showTokensInputCached", v)}
					/>
					<DashboardItem
						label="Token 消耗（输入 · 无缓存）"
						value={totals().tokensInput.toLocaleString()}
						icon="📥"
						enabled={state.usage.showTokensInput}
						onToggle={(v) => actions.setUsage("showTokensInput", v)}
					/>
					<DashboardItem
						label="Token 消耗（输出）"
						value={totals().tokensOutput.toLocaleString()}
						icon="📤"
						enabled={state.usage.showTokensOutput}
						onToggle={(v) => actions.setUsage("showTokensOutput", v)}
					/>
				</div>
			</div>

			{/* 折线图 */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>趋势</div>
				<div style={{
					padding: "12px",
					backgroundColor: "hwb(var(--bg95) / 1)",
					borderRadius: "10px",
					border: "1px solid var(--borderLight)",
				}}>
					<div innerHTML={chartSvg()}></div>
				</div>
			</div>
		</div>
	);
}

function DashboardItem(props: {
	label: string;
	value: string;
	icon: string;
	enabled: boolean;
	onToggle: (v: boolean) => void;
}) {
	return (
		<div style={{
			display: "flex",
			alignItems: "center",
			gap: "12px",
			padding: "10px 14px",
			backgroundColor: "hwb(var(--bg95) / 1)",
			borderRadius: "10px",
			border: "1px solid var(--borderLight)",
			opacity: props.enabled ? 1 : 0.5,
			transition: "opacity 0.15s",
		}}>
			<span style={{ fontSize: "20px" }}>{props.icon}</span>
			<div style={{ flex: 1 }}>
				<div style={{ fontSize: "12px", color: "var(--fontColorMuted)" }}>{props.label}</div>
				<div style={{ fontSize: "18px", fontWeight: 600, color: "var(--fontColor)" }}>{props.value}</div>
			</div>
			{/* 原来这里手搓了一个 toggle，改用 FFBox-UI 的 ffbox-switch */}
			<ffbox-switch
				prop:checked={props.enabled}
				onchange={(e) => props.onToggle(e.detail)}
			/>
		</div>
	);
}
