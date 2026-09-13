/* ==========================================================================
   设置面板 — 四个 Tab：通用 / 模型 / 用量 / 模式配置
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { MenuItem } from 'ffbox-ui';
import styles from './Settings.module.css';
import { createStore, produce } from 'solid-js/store';
import { state, actions } from '../../store';
import { setTheme, getCurrentThemeMode } from '../../theme/theme';
import { z } from 'zod';
import type { ModelProvider } from '../../store';
import type { AgentName, ModelProviderModel } from '../../../shared/agent';
import { confirmMsgbox, alertMsgbox } from '../../ffboxBridge';

/** 把 [{value,label}] 转成 FFBox-UI 的菜单项数组 */
function toMenuItems(options: readonly { value: string; label: string }[]): MenuItem[] {
	return options.map((o) => ({ type: 'normal', value: o.value, label: o.label }));
}

/** 按 value 取显示文本 */
function labelOf(options: readonly { value: string; label: string }[], value: string): string {
	return options.find((o) => o.value === value)?.label ?? '';
}

function XIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="18" y1="6" x2="6" y2="18"/>
			<line x1="6" y1="6" x2="18" y2="18"/>
		</svg>
	);
}

/* ---------- 通用 Tab ---------- */

const THEME_OPTIONS = [
	{ value: 'system', label: '跟随系统' },
	{ value: 'light', label: '浅色' },
	{ value: 'dark', label: '深色' },
] as const;

const LANG_OPTIONS = [{ value: 'zh', label: '简体中文' }] as const;

function GeneralTab() {
	return (
		<div>
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>主题</div>
				<div class={styles['setting-group-desc']}>选择应用的外观模式</div>
				{/* readonly 模式下只能下拉选择，不能手动输入 */}
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(THEME_OPTIONS)}
					prop:text={labelOf(THEME_OPTIONS, state.themeMode)}
					prop:readonly={true}
					onchange={(e) => {
						const mode = e.detail as "light" | "dark" | "system";
						actions.setThemeMode(mode);
						setTheme(mode);
					}}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>语言</div>
				<div class={styles['setting-group-desc']}>应用界面语言（暂只支持中文）</div>
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(LANG_OPTIONS)}
					prop:text={LANG_OPTIONS[0].label}
					prop:readonly={true}
					prop:disabled={true}
				/>
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

	const handleDelete = async (p: ModelProvider) => {
		const ok = await confirmMsgbox(
			"删除模型提供商",
			`确定要删除「${p.name}」吗？其下的 ${p.models.length} 个模型将一并移除。`,
			"删除",
		);
		if (ok) {
			actions.removeProvider(p.id);
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
					<div class={styles['setting-group-label']}>已配置的模型提供商</div>
					<ffbox-button type="primary" onclick={startAdd}>
						+ 添加提供商
					</ffbox-button>
				</div>

				<div class={styles['provider-list']}>
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
							<div class={styles['provider-item']}>
								<div>
									<div class={styles['provider-item-name']}>{p.name}</div>
									<div style={{ fontSize: 12, color: "var(--fontColorMuted)", marginTop: 2 }}>
										{p.models.length} 个模型 · {p.baseUrl}
									</div>
								</div>
								<span class={styles['provider-item-type']}>
									{p.apiFormat === "openai-chat" && "OpenAI Chat"}
									{p.apiFormat === "openai-responses" && "OpenAI Responses"}
									{p.apiFormat === "anthropic" && "Anthropic"}
								</span>
								<div class={styles['provider-item-actions']}>
									<ffbox-button onclick={() => startEdit(p)}>编辑</ffbox-button>
									<ffbox-button type="danger" onclick={() => void handleDelete(p)}>删除</ffbox-button>
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

const API_FORMAT_OPTIONS = [
	{ value: 'openai-chat', label: 'OpenAI Chat Completions' },
	{ value: 'openai-responses', label: 'OpenAI Responses' },
	{ value: 'anthropic', label: 'Anthropic Messages' },
] as const;

const MODEL_ROLE_OPTIONS = [
	{ value: 'standard', label: '标准' },
	{ value: 'economy', label: '节省' },
] as const;

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
				void alertMsgbox("无法保存", "模型 ID 不能为空，请填写后再保存。");
				return;
			}
			if (!model.displayName.trim()) {
				void alertMsgbox("无法保存", `模型 "${model.id}" 的显示名称不能为空，请填写后再保存。`);
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

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>名称</div>
				<ffbox-normal-input
					class={styles['ffbox-input']}
					prop:value={local.provider.name}
					placeholder="我的提供商"
					onchange={(e) => setLocal("provider", "name", e.detail)}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>API 格式</div>
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(API_FORMAT_OPTIONS)}
					prop:text={labelOf(API_FORMAT_OPTIONS, local.provider.apiFormat)}
					prop:readonly={true}
					onchange={(e) => setLocal("provider", "apiFormat", e.detail as ModelProvider['apiFormat'])}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>请求地址</div>
				<ffbox-normal-input
					class={styles['ffbox-input']}
					prop:value={local.provider.baseUrl}
					placeholder="https://api.openai.com/v1"
					onchange={(e) => setLocal("provider", "baseUrl", e.detail)}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>API Key</div>
				<ffbox-normal-input
					class={styles['ffbox-input']}
					// type="password"
					prop:value={local.provider.apiKey}
					placeholder="sk-..."
					onchange={(e) => setLocal("provider", "apiKey", e.detail)}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']} style={{ display: "flex", justifyContent: "space-between" }}>
					模型目录
					<ffbox-button onclick={addModel}>+ 添加模型</ffbox-button>
				</div>

				<div class={styles['setting-group-desc']} style={{ marginBottom: 8 }}>
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
											<ffbox-normal-input
												class={styles['ffbox-input']}
												style={{ flex: 1 }}
												prop:value={model.id}
												placeholder="模型 ID（如 deepseek-v4-pro）"
												onchange={(e) => setLocal("provider", "models", mIdx, "id", e.detail)}
											/>
											<ffbox-normal-input
												class={styles['ffbox-input']}
												style={{ flex: 1 }}
												prop:value={model.displayName}
												placeholder="显示名称"
												onchange={(e) => setLocal("provider", "models", mIdx, "displayName", e.detail)}
											/>
										</div>
										<ffbox-dropdown-input
											class={styles['ffbox-dropdown-auto']}
											prop:list={toMenuItems(MODEL_ROLE_OPTIONS)}
											prop:text={labelOf(MODEL_ROLE_OPTIONS, model.role)}
											prop:readonly={true}
											onchange={(e) => setLocal("provider", "models", mIdx, "role", e.detail as ModelProviderModel['role'])}
										/>
										<ffbox-button
											type="danger"
											size="small"
											title="删除此模型"
											onclick={() => removeModel(mIdx)}
										>
											<XIcon />
										</ffbox-button>
									</div>
									<div>
										<div style={{ fontSize: 11, color: "var(--fontColorMuted)", marginBottom: 4 }}>
											自定义参数（JSON，合并到该模型的每次请求）
										</div>
										<textarea
											class={`${styles['json-textarea']}${jsonErr() ? ` ${styles.error}` : ""}`}
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

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>提供商级自定义参数</div>
				<div class={styles['setting-group-desc']}>
					JSON 对象，会被合并到该提供商下所有模型的每次请求中（模型级参数优先）。
				</div>
				<textarea
					class={`${styles['json-textarea']}${props.jsonError ? ` ${styles.error}` : ""}`}
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
				<ffbox-button type="primary" onclick={doSave}>保存</ffbox-button>
				<ffbox-button type="danger" onclick={props.onCancel}>取消</ffbox-button>
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
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>时间范围</div>
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					<For each={timeRanges}>
						{(r) => (
							<button
								class={styles['btn-secondary']}
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
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>指标显示</div>
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
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>趋势</div>
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
			{/* 原来这里手搓了一个 toggle，改用 FFBox-UI 的 ffbox-switch */}
			<ffbox-switch
				prop:checked={props.enabled}
				onchange={(e) => props.onToggle(e.detail)}
			/>
		</div>
	);
}

/* ---------- 模式配置 Tab ---------- */

const ALL_AGENT_NAMES: AgentName[] = ["默认", "编码", "文件夹浏览总结"];

const AGENT_OPTIONS = ALL_AGENT_NAMES.map((name) => ({ value: name, label: name }));

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
				void alertMsgbox("已保存", "可转接的 Agent 配置已更新。", "好的");
			}
		} catch (e) {
			void alertMsgbox("保存失败", "JSON 格式错误，请检查后重试。");
		}
	};

	return (
		<div>
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>选择 Agent</div>
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(AGENT_OPTIONS)}
					prop:text={selectedAgentName()}
					prop:readonly={true}
					onchange={(e) => setSelectedAgentName(e.detail as AgentName)}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>可转接的 Agent（JSON）</div>
				<div class={styles['setting-group-desc']}>
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
									<ffbox-checkbox
										prop:checked={checked}
										onchange={(e) => {
											const list = currentConfig()?.transferableAgents.slice() || [];
											if (e.detail) {
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
					class={styles['json-textarea']}
					value={jsonText()}
					oninput={(e) => setJsonText(e.currentTarget.value)}
					rows={10}
				/>
				<ffbox-button type="primary" style={{ marginTop: 8 }} onclick={handleSave}>
					保存
				</ffbox-button>
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
			<div class={styles['settings-overlay']} onclick={() => actions.closeSettings()}>
				<div class={styles['settings-panel']} onclick={(e) => e.stopPropagation()}>
					{/* 左侧 Tab */}
					<div class={styles['settings-sidebar']}>
						<h3>设置</h3>
						<For each={TABS}>
							{(tab) => (
								<button
									class={styles['settings-tab']}
									classList={{ [styles.active]: state.ui.activeSettingsTab === tab.id }}
									onclick={() => actions.setSettingsTab(tab.id)}
								>
									<span>{tab.icon}</span>
									<span>{tab.label}</span>
								</button>
							)}
						</For>
					</div>

					{/* 右侧内容 */}
					<div class={styles['settings-content']}>
						<div class={styles['settings-header']}>
							<h2>{state.ui.activeSettingsTab}</h2>
							<button class={styles['settings-close-btn']} onclick={() => actions.closeSettings()}>
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