/* ==========================================================================
   设置面板 — 四个 Tab：通用 / 模型 / 用量 / 模式配置
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { state, actions } from '../store';
import { setTheme, getCurrentThemeMode } from '../theme/theme';
import { z } from 'zod';
import type { ModelProvider } from '../store';
import type { AgentName, ModelProviderModel } from '../../shared/agent';

function XIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="18" y1="6" x2="6" y2="18"/>
			<line x1="6" y1="6" x2="18" y2="18"/>
		</svg>
	);
}

/* ---------- 通用 Tab ---------- */
function GeneralTab() {
	return (
		<div>
			<div class="setting-group">
				<div class="setting-group-label">主题</div>
				<div class="setting-group-desc">选择应用的外观模式</div>
				<select
					class="select-input"
					value={state.themeMode}
					onchange={(e) => {
						const mode = e.currentTarget.value as "light" | "dark" | "system";
						actions.setThemeMode(mode);
						setTheme(mode);
					}}
				>
					<option value="system">跟随系统</option>
					<option value="light">浅色</option>
					<option value="dark">深色</option>
				</select>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">语言</div>
				<div class="setting-group-desc">应用界面语言（暂只支持中文）</div>
				<select class="select-input" disabled>
					<option value="zh">简体中文</option>
				</select>
			</div>
		</div>
	);
}

/* ---------- 模型 Tab ---------- */

const jsonSchema = z.record(z.unknown());

function ModelsTab() {
	const [editingProvider, setEditingProvider] = createSignal<ModelProvider | null>(null);
	const [jsonError, setJsonError] = createSignal<string>("");

	const startAdd = () => {
		setEditingProvider({
			id: "",
			name: "新提供商",
			apiFormat: "openai-chat",
			baseUrl: "https://api.deepseek.com/v1",
			apiKey: "",
			models: [
				{ id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", role: "economy" },
			],
			customParams: {},
		});
		setJsonError("");
	};

	const startEdit = (provider: ModelProvider) => {
		setEditingProvider({ ...provider });
		setJsonError("");
	};

	const handleSave = () => {
		const p = editingProvider();
		if (!p) return;

		if (p.id) {
			actions.updateProvider(p.id, p);
		} else {
			actions.addProvider(p);
		}
		setEditingProvider(null);
	};

	const handleDelete = (id: string) => {
		if (confirm("确定要删除此模型提供商吗？")) {
			actions.removeProvider(id);
		}
	};

	const handleCancel = () => {
		setEditingProvider(null);
		setJsonError("");
	};

	return (
		<div>
			<Show when={!editingProvider()}>
				<div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<div class="setting-group-label">已配置的模型提供商</div>
					<button class="btn-secondary" onclick={startAdd}>
						+ 添加提供商
					</button>
				</div>

				<div class="provider-list">
					<Show when={state.providers.length === 0}>
						<div style={{
							padding: "24px",
							textAlign: "center",
							color: "var(--fontColorMuted)",
							backgroundColor: "hwb(var(--bg95) / 1)",
							borderRadius: 10,
						}}>
							还没有配置任何模型提供商。点击上方 "添加提供商" 开始。
						</div>
					</Show>

					<For each={state.providers}>
						{(p) => (
							<div class="provider-item">
								<div>
									<div class="provider-item-name">{p.name}</div>
									<div style={{ fontSize: 12, color: "var(--fontColorMuted)", marginTop: 2 }}>
										{p.models.length} 个模型 · {p.baseUrl}
									</div>
								</div>
								<span class="provider-item-type">
									{p.apiFormat === "openai-chat" && "OpenAI Chat"}
									{p.apiFormat === "openai-responses" && "OpenAI Responses"}
									{p.apiFormat === "anthropic" && "Anthropic"}
								</span>
								<div class="provider-item-actions">
									<button class="btn-secondary" onclick={() => startEdit(p)}>编辑</button>
									<button class="btn-danger" onclick={() => handleDelete(p.id)}>删除</button>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>

			<Show when={editingProvider()}>
				<ProviderEditor
					provider={editingProvider()!}
					onChange={setEditingProvider}
					onSave={handleSave}
					onCancel={handleCancel}
					jsonError={jsonError()}
					onJsonError={setJsonError}
				/>
			</Show>
		</div>
	);
}

function ProviderEditor(props: {
	provider: ModelProvider;
	onChange: (p: ModelProvider) => void;
	onSave: () => void;
	onCancel: () => void;
	jsonError: string;
	onJsonError: (e: string) => void;
}) {
	const [local, setLocal] = createStore<{ provider: ModelProvider }>({
		provider: JSON.parse(JSON.stringify(props.provider)),
	});

	const [providerJsonText, setProviderJsonText] = createSignal(
		JSON.stringify(local.provider.customParams, null, 2) || "{}",
	);
	const [modelJsonTexts, setModelJsonTexts] = createSignal<Record<string, string>>({});
	const [modelJsonErrors, setModelJsonErrors] = createSignal<Record<string, string>>({});

	const getModelJsonText = (modelIdx: number) => {
		const model = local.provider.models[modelIdx];
		if (!model) return "{}";
		const key = `__model_${modelIdx}`;
		const existing = modelJsonTexts()[key];
		if (existing !== undefined) return existing;
		return JSON.stringify(model.customParams ?? {}, null, 2);
	};

	const addModel = () => {
		const newModel: ModelProviderModel = {
			id: "",
			displayName: "",
			role: "standard",
			customParams: {},
		};
		setLocal("provider", "models", (prev) => [...prev, newModel]);
	};

	const removeModel = (modelIdx: number) => {
		setLocal("provider", "models", (prev) => prev.filter((_, i) => i !== modelIdx));
	};

	const validateProviderJson = () => {
		try {
			const parsed = JSON.parse(providerJsonText());
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				props.onJsonError("必须是一个 JSON 对象");
			} else {
				props.onJsonError("");
				setLocal("provider", "customParams", parsed as Record<string, unknown>);
			}
		} catch (e) {
			props.onJsonError("JSON 格式错误");
		}
	};

	const validateModelJson = (modelIdx: number) => {
		const model = local.provider.models[modelIdx];
		if (!model) return;
		const key = `__model_${modelIdx}`;
		const text = modelJsonTexts()[key] ?? JSON.stringify(model.customParams ?? {}, null, 2);
		try {
			const parsed = JSON.parse(text);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				setModelJsonErrors((prev) => ({ ...prev, [key]: "必须是一个 JSON 对象" }));
			} else {
				setModelJsonErrors((prev) => ({ ...prev, [key]: "" }));
				setLocal("provider", "models", modelIdx, "customParams", parsed as Record<string, unknown>);
			}
		} catch (e) {
			setModelJsonErrors((prev) => ({ ...prev, [key]: "JSON 格式错误" }));
		}
	};

	const doSave = () => {
		try {
			jsonSchema.parse(local.provider.customParams);
		} catch (e: any) {
			props.onJsonError("提供商自定义参数必须是合法的 JSON 对象");
			return;
		}

		for (const model of local.provider.models) {
			if (!model.id.trim()) {
				alert("模型 ID 不能为空，请填写后再保存。");
				return;
			}
			if (!model.displayName.trim()) {
				alert(`模型 "${model.id}" 的显示名称不能为空，请填写后再保存。`);
				return;
			}
		}

		props.onChange(JSON.parse(JSON.stringify(local.provider)));
		props.onSave();
	};

	return (
		<div>
			<h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>
				{local.provider.id ? "编辑提供商" : "添加提供商"}
			</h3>

			<div class="setting-group">
				<div class="setting-group-label">名称</div>
				<input
					class="text-input"
					value={local.provider.name}
					oninput={(e) => setLocal("provider", "name", e.currentTarget.value)}
					placeholder="我的提供商"
				/>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">API 格式</div>
				<select
					class="select-input"
					value={local.provider.apiFormat}
					onchange={(e) => setLocal("provider", "apiFormat", e.currentTarget.value as any)}
				>
					<option value="openai-chat">OpenAI Chat Completions</option>
					<option value="openai-responses">OpenAI Responses</option>
					<option value="anthropic">Anthropic Messages</option>
				</select>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">请求地址</div>
				<input
					class="text-input"
					value={local.provider.baseUrl}
					oninput={(e) => setLocal("provider", "baseUrl", e.currentTarget.value)}
					placeholder="https://api.openai.com/v1"
				/>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">API Key</div>
				<input
					class="text-input"
					type="password"
					value={local.provider.apiKey}
					oninput={(e) => setLocal("provider", "apiKey", e.currentTarget.value)}
					placeholder="sk-..."
				/>
			</div>

			<div class="setting-group">
				<div class="setting-group-label" style={{ display: "flex", justifyContent: "space-between" }}>
					模型目录
					<button class="btn-secondary" onclick={addModel}>+ 添加模型</button>
				</div>

				<div class="setting-group-desc" style={{ marginBottom: 8 }}>
					每个模型可独立配置 ID、名称、角色和自定义参数。新添加的模型请填写 ID 和显示名称后保存。
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<For each={local.provider.models}>
						{(model, idx) => {
							const mIdx = idx();
							const jsonKey = `__model_${mIdx}`;
							const jsonErr = () => modelJsonErrors()[jsonKey] ?? "";
							return (
								<div style={{
									padding: "12px",
									backgroundColor: "hwb(var(--bg95) / 1)",
									borderRadius: 8,
									border: "1px solid var(--borderLight)",
								}}>
									<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 8 }}>
										<div style={{ flex: 1, display: "flex", gap: "8px" }}>
											<input
												class="text-input"
												style={{ flex: 1 }}
												value={model.id}
												oninput={(e) => setLocal("provider", "models", mIdx, "id", e.currentTarget.value)}
												placeholder="模型 ID（如 deepseek-v4-pro）"
											/>
											<input
												class="text-input"
												style={{ flex: 1 }}
												value={model.displayName}
												oninput={(e) => setLocal("provider", "models", mIdx, "displayName", e.currentTarget.value)}
												placeholder="显示名称"
											/>
										</div>
										<select
											class="select-input"
											style={{ width: "auto" }}
											value={model.role}
											onchange={(e) => setLocal("provider", "models", mIdx, "role", e.currentTarget.value as any)}
										>
											<option value="standard">标准</option>
											<option value="economy">节省</option>
										</select>
										<button
											class="icon-btn"
											title="删除此模型"
											onclick={() => removeModel(mIdx)}
											style={{ color: "var(--error)" }}
										>
											<XIcon />
										</button>
									</div>
									<div>
										<div style={{ fontSize: 11, color: "var(--fontColorMuted)", marginBottom: 4 }}>
											自定义参数（JSON，合并到该模型的每次请求）
										</div>
										<textarea
											class={`json-textarea${jsonErr() ? " error" : ""}`}
											value={getModelJsonText(mIdx)}
											oninput={(e) => {
												setModelJsonTexts((prev) => ({ ...prev, [jsonKey]: e.currentTarget.value }));
												setModelJsonErrors((prev) => ({ ...prev, [jsonKey]: "" }));
											}}
											onblur={() => validateModelJson(mIdx)}
											placeholder='{"temperature": 0.7}'
											rows={2}
											style={{ fontSize: 12 }}
										/>
										<Show when={jsonErr()}>
											<div style={{ fontSize: 11, color: "var(--error)", marginTop: 2 }}>
												⚠️ {jsonErr()}
											</div>
										</Show>
									</div>
								</div>
							);
						}}
					</For>
				</div>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">提供商级自定义参数</div>
				<div class="setting-group-desc">
					JSON 对象，会被合并到该提供商下所有模型的每次请求中（模型级参数优先）。
				</div>
				<textarea
					class={`json-textarea${props.jsonError ? " error" : ""}`}
					value={providerJsonText()}
					oninput={(e) => {
						setProviderJsonText(e.currentTarget.value);
						props.onJsonError("");
					}}
					onblur={validateProviderJson}
					placeholder='{"temperature": 0.7}'
				/>
				<Show when={props.jsonError}>
					<div style={{ fontSize: 12, color: "var(--error)", marginTop: 4 }}>
						⚠️ {props.jsonError}
					</div>
				</Show>
			</div>

			<div style={{ display: "flex", gap: "10px", marginTop: 24 }}>
				<button class="btn-secondary" onclick={doSave}>保存</button>
				<button class="btn-danger" onclick={props.onCancel}>取消</button>
			</div>
		</div>
	);
}

/* ---------- 用量 Tab ---------- */

function UsageTab() {
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
			<div class="setting-group">
				<div class="setting-group-label">时间范围</div>
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					<For each={timeRanges}>
						{(r) => (
							<button
								class="btn-secondary"
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
			<div class="setting-group">
				<div class="setting-group-label">指标显示</div>
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
			<div class="setting-group">
				<div class="setting-group-label">趋势</div>
				<div style={{
					padding: "12px",
					backgroundColor: "hwb(var(--bg95) / 1)",
					borderRadius: 10,
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
			borderRadius: 10,
			border: "1px solid var(--borderLight)",
			opacity: props.enabled ? 1 : 0.5,
			transition: "opacity 0.15s",
		}}>
			<span style={{ fontSize: 20 }}>{props.icon}</span>
			<div style={{ flex: 1 }}>
				<div style={{ fontSize: 12, color: "var(--fontColorMuted)" }}>{props.label}</div>
				<div style={{ fontSize: 18, fontWeight: 600, color: "var(--fontColor)" }}>{props.value}</div>
			</div>
			<button
				onclick={() => props.onToggle(!props.enabled)}
				title={props.enabled ? "隐藏此指标" : "显示此指标"}
				style={{
					width: 40,
					height: 22,
					borderRadius: 11,
					backgroundColor: props.enabled ? "var(--primary)" : "hwb(var(--bg90) / 1)",
					position: "relative",
					transition: "background-color 0.15s",
				}}
			>
				<span style={{
					position: "absolute",
					top: 2,
					left: props.enabled ? 20 : 2,
					width: 18,
					height: 18,
					borderRadius: 9,
					backgroundColor: "#fff",
					transition: "left 0.15s",
				}}></span>
			</button>
		</div>
	);
}

/* ---------- 模式配置 Tab ---------- */

const ALL_AGENT_NAMES: AgentName[] = ["默认", "编码", "文件夹浏览总结"];

function ModeConfigTab() {
	const [selectedAgentName, setSelectedAgentName] = createSignal<AgentName>(state.currentAgentName);
	const currentConfig = createMemo(() =>
		state.agentConfigs.find((c) => c.name === selectedAgentName())
	);
	const [jsonText, setJsonText] = createSignal("");

	createEffect(() => {
		setJsonText(JSON.stringify({
			agentName: selectedAgentName(),
			transferableAgents: currentConfig()?.transferableAgents || [],
		}, null, 2));
	});

	const handleSave = () => {
		try {
			const parsed = JSON.parse(jsonText());
			if (parsed.transferableAgents && Array.isArray(parsed.transferableAgents)) {
				actions.updateAgentConfig(selectedAgentName(), parsed.transferableAgents);
				alert("已保存！");
			}
		} catch (e) {
			alert("JSON 格式错误");
		}
	};

	return (
		<div>
			<div class="setting-group">
				<div class="setting-group-label">选择 Agent</div>
				<select
					class="select-input"
					value={selectedAgentName()}
					onchange={(e) => setSelectedAgentName(e.currentTarget.value as AgentName)}
				>
					<For each={ALL_AGENT_NAMES}>
						{(name) => <option value={name}>{name}</option>}
					</For>
				</select>
			</div>

			<div class="setting-group">
				<div class="setting-group-label">可转接的 Agent（JSON）</div>
				<div class="setting-group-desc">
					这个 Agent 运行时，允许通过 "转接" 工具将工作转交给这些 Agent。
					<br />
					提示：直接编辑下面的 JSON，或勾选下方的复选框快速配置。
				</div>

				{/* 快速复选框 */}
				<div style={{
					display: "flex",
					gap: "16px",
					padding: "10px 14px",
					backgroundColor: "hwb(var(--bg95) / 1)",
					borderRadius: 8,
					marginBottom: 12,
				}}>
					<For each={ALL_AGENT_NAMES.filter((m) => m !== selectedAgentName())}>
						{(name) => {
							const checked = currentConfig()?.transferableAgents.includes(name) ?? false;
							return (
								<label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
									<input
										type="checkbox"
										checked={checked}
										onchange={(e) => {
											const list = currentConfig()?.transferableAgents.slice() || [];
											if (e.currentTarget.checked) {
												if (!list.includes(name)) list.push(name);
											} else {
												const idx = list.indexOf(name);
												if (idx >= 0) list.splice(idx, 1);
											}
											actions.updateAgentConfig(selectedAgentName(), list);
										}}
									/>
									<span>{name}</span>
								</label>
							);
						}}
					</For>
				</div>

				{/* JSON 编辑器 */}
				<textarea
					class="json-textarea"
					value={jsonText()}
					oninput={(e) => setJsonText(e.currentTarget.value)}
					rows={10}
				/>
				<button class="btn-secondary" style={{ marginTop: 8 }} onclick={handleSave}>
					保存
				</button>
			</div>
		</div>
	);
}

/* ---------- 设置面板主体 ---------- */

type TabId = "通用" | "模型" | "用量" | "模式配置";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
	{ id: "通用", label: "通用", icon: "⚙️" },
	{ id: "模型", label: "模型", icon: "🧠" },
	{ id: "用量", label: "用量", icon: "📊" },
	{ id: "模式配置", label: "模式配置", icon: "🔀" },
];

export default function Settings() {
	const open = createMemo(() => state.ui.settingsOpen);

	return (
		<Show when={open()}>
			<div class="settings-overlay" onclick={() => actions.closeSettings()}>
				<div class="settings-panel" onclick={(e) => e.stopPropagation()}>
					{/* 左侧 Tab */}
					<div class="settings-sidebar">
						<h3>设置</h3>
						<For each={TABS}>
							{(tab) => (
								<button
									class="settings-tab"
									classList={{ active: state.ui.activeSettingsTab === tab.id }}
									onclick={() => actions.setSettingsTab(tab.id)}
								>
									<span>{tab.icon}</span>
									<span>{tab.label}</span>
								</button>
							)}
						</For>
					</div>

					{/* 右侧内容 */}
					<div class="settings-content">
						<div class="settings-header">
							<h2>{state.ui.activeSettingsTab}</h2>
							<button class="settings-close-btn" onclick={() => actions.closeSettings()}>
								<XIcon />
							</button>
						</div>

						{state.ui.activeSettingsTab === "通用" && <GeneralTab />}
						{state.ui.activeSettingsTab === "模型" && <ModelsTab />}
						{state.ui.activeSettingsTab === "用量" && <UsageTab />}
						{state.ui.activeSettingsTab === "模式配置" && <ModeConfigTab />}
					</div>
				</div>
			</div>
		</Show>
	);
}
