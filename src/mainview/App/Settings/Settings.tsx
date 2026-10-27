/* ==========================================================================
   设置面板 — 六个 Tab：通用 / 模型 / 提示词 / 用量 / 插件·模式 / MCP
   （v2：原「模式配置」Tab 换成「插件 / 模式」，模式配置就是插件目录里的 mode.json，
     面板直接编辑该文件的源码；基座提示词独立成「提示词」Tab，存后端 settings.basePrompt）
   ========================================================================== */

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { MenuItem } from 'ffbox-ui';
import styles from './Settings.module.css';
import { createStore, produce } from 'solid-js/store';
import { state, actions } from '@mainview/store';
import { getCurrentThemeMode } from '@mainview/theme/theme';
import { setAppTheme } from '@mainview/appCommands';
import { z } from 'zod';
import type { ModelProvider } from '@mainview/store';
import type {
	ModelProviderModel, McpServerConfig, McpToolInfo, LlmRequestRecord, AgentDefinition,
} from '@shared/agent';
import { confirmMsgbox, alertMsgbox } from '@mainview/ffboxBridge';
import { testMcpServer, getMode, getRequests, clearRequests, saveModeJson } from '@mainview/agentBridge';
import { shell } from '@mainview/localBridge';
import { startSettingsDrag, setSettingsTravelMeasure } from './useSettingsDrag';
import { EXIT_THEME_OPTIONS, previewExitTheme, themeById } from '../ExitOverlay';

/** ISO 8601（UTC）→ 本地时间；构建信息里的时间统一存 UTC，只在展示时转换 */
function formatTime(iso: string): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** 构建信息的一行「键 → 值」 */
function InfoRow(props: { label: string; value: string }) {
	return (
		<div class={styles['info-row']}>
			<span class={styles['info-key']}>{props.label}</span>
			<span class={`${styles['info-value']} ${styles.mono}`}>{props.value}</span>
		</div>
	);
}

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

/* ---------- 通用 Tab ---------- */

const THEME_OPTIONS = [
	{ value: 'dark', label: '深色' },
	{ value: 'light', label: '浅色' },
	{ value: 'system', label: '跟随系统' },
] as const;

const DENSITY_OPTIONS = [
	{ value: 'compact', label: '紧凑' },
	{ value: 'standard', label: '标准' },
	{ value: 'comfortable', label: '宽松' },
] as const;

const ACCENT_OPTIONS = [
	{ value: 'amber', label: '琥珀' },
	{ value: 'blue', label: '靛蓝' },
	{ value: 'teal', label: '青碧' },
	{ value: 'violet', label: '紫罗兰' },
] as const;

/** 分段控件（设计稿里主题 / 密度 / 强调色都长这样） */
function Segmented<T extends string>(props: {
	options: ReadonlyArray<{ value: T; label: string }>;
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div class={styles['segmented']}>
			<For each={props.options}>
				{(opt) => (
					<button
						class={styles['segmented-item']}
						classList={{ [styles.active]: props.value === opt.value }}
						onclick={() => props.onChange(opt.value)}
					>
						{opt.label}
					</button>
				)}
			</For>
		</div>
	);
}

function GeneralTab() {
	return (
		<>
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>外观</div>

				<div class={styles['setting-row']}>
					<span class={styles['setting-row-title']}>主题</span>
					<Segmented options={THEME_OPTIONS} value={state.themeMode} onChange={(mode) => setAppTheme(mode)} />
				</div>

				<div class={styles['setting-row']}>
					<div class={styles['setting-row-label']}>
						<span class={styles['setting-row-title']}>界面密度</span>
						<span class={styles['setting-row-desc']}>影响列表行高、区块间距与正文字号</span>
					</div>
					<Segmented options={DENSITY_OPTIONS} value={state.ui.density} onChange={(v) => actions.setDensity(v)} />
				</div>

				<div class={styles['setting-row']}>
					<div class={styles['setting-row-label']}>
						<span class={styles['setting-row-title']}>强调色</span>
						<span class={styles['setting-row-desc']}>按钮、选中态与运行指示灯的颜色</span>
					</div>
					<Segmented options={ACCENT_OPTIONS} value={state.ui.accent} onChange={(v) => actions.setAccent(v)} />
				</div>

				<div class={styles['setting-row']}>
					<div class={styles['setting-row-label']}>
						<span class={styles['setting-row-title']}>退场动画</span>
						<span class={styles['setting-row-desc']}>{themeById(state.ui.exitTheme).desc}</span>
					</div>
					<div class={styles['exit-theme']}>
						<Segmented
							options={EXIT_THEME_OPTIONS}
							value={state.ui.exitTheme}
							onChange={(v) => actions.setExitTheme(v)}
						/>
						<button
							class={styles['btn-secondary']}
							onclick={() => previewExitTheme(state.ui.exitTheme)}
						>
							预览
						</button>
					</div>
				</div>

				<div class={styles['setting-row']}>
					<div class={styles['setting-row-label']}>
						<span class={styles['setting-row-title']}>语言</span>
						<span class={styles['setting-row-desc']}>应用界面语言（暂只支持中文）</span>
					</div>
					<span class={styles['setting-row-value']}>简体中文</span>
				</div>
			</div>

			{/* 构建信息：前端是打包时注入的常量，后端是 Agent Service 自报的（GET /api/health）。
			    两边不一致 = 前端/后端没一起重编；后端显示旧提交 = 18999 端口上还跑着旧进程。 */}
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>构建信息</div>
				<div class={styles['setting-group-desc']}>提交号带 * 表示构建时工作区有未提交改动</div>
				<div class={styles['info-list']}>
					<InfoRow
						label="前端"
						value={`${buildInfo.gitCommit} · ${buildInfo.isDev ? '开发' : '生产'} · ${formatTime(buildInfo.buildTime)}`}
					/>
					<Show
						when={state.serviceHealth}
						fallback={<InfoRow label="后端" value="未连接（Agent Service 不可达）" />}
					>
						<InfoRow
							label="后端"
							value={`${state.serviceHealth?.build.gitCommit} · ${state.serviceHealth?.build.isDev ? '开发' : '生产'} · ${formatTime(state.serviceHealth?.build.buildTime ?? '')}`}
						/>
						<InfoRow label="通道" value={state.serviceHealth?.channel ?? 'unknown'} />
						<InfoRow label="进程" value={`pid ${state.serviceHealth?.pid} · 端口 ${state.serviceHealth?.port}`} />
						<InfoRow label="服务启动" value={formatTime(state.serviceHealth?.startedAt ?? '')} />
					</Show>
					<button
						class={styles['btn-secondary']}
						onclick={() => void actions.refreshServiceHealth()}
					>
						刷新
					</button>
				</div>
			</div>
		</>
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
				<div style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
							borderRadius: "10px",
						}}>
							还没有配置任何模型提供商。点击上方 "添加提供商" 开始。
						</div>
					</Show>

					<For each={state.providers}>
						{(p) => (
							<div class={styles['provider-item']}>
								<div>
									<div class={styles['provider-item-name']}>{p.name}</div>
									<div style={{ fontSize: "12px", color: "var(--fontColorMuted)", marginTop: "2px" }}>
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
			<h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600 }}>
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

				<div class={styles['setting-group-desc']} style={{ marginBottom: "8px" }}>
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
									borderRadius: "8px",
									border: "1px solid var(--borderLight)",
								}}>
									<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
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
										<div style={{ fontSize: "11px", color: "var(--fontColorMuted)", marginBottom: "4px" }}>
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
											style={{ fontSize: "12px" }}
										/>
										<Show when={jsonErr()}>
											<div style={{ fontSize: "11px", color: "var(--error)", marginTop: "2px" }}>
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
					<div style={{ fontSize: "12px", color: "var(--error)", marginTop: "4px" }}>
						⚠️ {props.jsonError}
					</div>
				</Show>
			</div>

			<div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
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

/* ---------- 插件 / 模式 Tab ----------
   这是模式配置的**唯一入口**（需求 11）：
   - 插件列表（内置 / 用户、被覆盖标记、重新加载）
   - 选中模式的 **mode.json 源码编辑器**（直接改插件目录里的那个文件，合法才允许保存）
   - 只读展示该模式的 Agent（名字 / 工具白名单 / 可委托目标 / 反思轮数）
   - 只读展示当前会话的 LLM 请求日志（§8.7）
   -------------------------------------------------------------------------- */

/** 模式配置 = 该模式的 mode.json 源码，直接编辑并写回插件目录 */
function ModeJsonEditor(props: { modeId: string }) {
	const [jsonText, setJsonText] = createSignal('');
	const [savedText, setSavedText] = createSignal('');
	const [jsonPath, setJsonPath] = createSignal('');
	const [error, setError] = createSignal('');
	const [saving, setSaving] = createSignal(false);

	const load = async () => {
		setError('');
		const detail = await getMode(props.modeId) as {
			modeJson?: string;
			modeJsonPath?: string;
		} | null;
		const text = detail?.modeJson ?? '';
		setJsonText(text);
		setSavedText(text);
		setJsonPath(detail?.modeJsonPath ?? '');
	};

	createEffect(() => {
		props.modeId;
		void load();
	});

	/** 本地校验：只在「JSON 能解析成对象」时才允许点保存（后端还会再做一遍语义校验） */
	const validate = (text: string): string => {
		if (!text.trim()) return '内容为空';
		try {
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '顶层必须是一个 JSON 对象';
		} catch (e) {
			return `JSON 解析失败：${(e as Error).message}`;
		}
		return '';
	};

	const dirty = () => jsonText() !== savedText();

	const handleSave = async () => {
		const localError = validate(jsonText());
		if (localError) {
			setError(localError);
			return;
		}
		setSaving(true);
		const result = await saveModeJson(props.modeId, jsonText());
		setSaving(false);
		if (!result.ok) {
			const message = result.error ?? '保存失败';
			setError(message);
			void alertMsgbox('保存失败', `${message}\n\n（文件未被修改）`);
			return;
		}
		setError('');
		setSavedText(jsonText());
		await actions.refreshModes();
		void alertMsgbox('已保存', `mode.json 已写入：\n${jsonPath()}`, '好的');
	};

	return (
		<div class={styles['setting-group']}>
			<div class={styles['setting-group-label']}>
				mode.json（直接编辑插件文件）
				<span style={{ 'margin-left': '10px' }}>
					<ffbox-button type="primary" prop:disabled={!!validate(jsonText()) || !dirty() || saving()} onclick={() => void handleSave()}>
						{saving() ? '保存中…' : '保存'}
					</ffbox-button>
					<ffbox-button style={{ 'margin-left': '6px' }} onclick={() => void load()}>放弃修改</ffbox-button>
				</span>
			</div>
			<div class={styles['setting-group-desc']}>
				该模式的全部配置就是这一个文件（<code>{jsonPath() || '…'}</code>），保存即写回插件目录并重新加载插件。
				<br />
				字段：<code>rootAgent</code>（根 Agent）· <code>maxDepth</code>（最大委托深度）·
				<code>taskList</code>（任务清单开关 / 是否可写）· <code>mcp</code>（<code>none</code> /{' '}
				<code>all</code> / 服务器 id 数组）·
				<code>limits.totalRounds</code> / <code>limits.agentInstanceRounds</code> /{' '}
				<code>limits.warnAtRemaining</code>（循环预算，缺省 200 / 50 / 3）· <code>ui</code>（图标 / 配色）。
				<br />
				反思提示词不在这个文件里：读 <code>&lt;模式&gt;/reflection.md</code> →{' '}
				<code>&lt;Agent&gt;/reflection.md</code>（Agent 级存在即整份替换，都没有时用代码内置默认）。
				<Show when={jsonPath()}>
					<span style={{ 'margin-left': '8px' }}>
						<ffbox-button onclick={() => {
							const p = jsonPath();
							const sep = p.includes('\\') ? '\\' : '/';
							const dir = p.substring(0, p.lastIndexOf(sep));
							if (dir) void shell.openPath(dir);
						}}>打开文件夹</ffbox-button>
					</span>
				</Show>
			</div>
			<textarea
				class={`${styles['json-textarea']}${error() ? ` ${styles.error}` : ''}`}
				style={{ 'font-family': 'ui-monospace, Consolas, monospace' }}
				value={jsonText()}
				oninput={(e) => {
					setJsonText(e.currentTarget.value);
					setError(validate(e.currentTarget.value));
				}}
				rows={16}
			/>
			<Show when={error()}>
				<div style={{ 'font-size': '12px', color: 'var(--error)', 'margin-top': '4px' }}>
					⚠️ {error()}　（修好之前无法保存）
				</div>
			</Show>
		</div>
	);
}

/** 某个模式的 Agent 只读清单 */
function AgentsReadonly(props: { modeId: string }) {
	const [agents, setAgents] = createSignal<AgentDefinition[]>([]);
	const [rootAgent, setRootAgent] = createSignal('');

	createEffect(() => {
		void (async () => {
			const detail = await getMode(props.modeId) as { rootAgent?: string; agents?: Record<string, AgentDefinition> } | null;
			setRootAgent(detail?.rootAgent ?? '');
			setAgents(Object.values(detail?.agents ?? {}));
		})();
	});

	const allowOf = (def: AgentDefinition) => def.ability?.tools?.allow?.join(', ') || '(全部内置工具)';

	return (
		<div class={styles['setting-group']}>
			<div class={styles['setting-group-label']}>该模式的 Agent（只读）</div>
			<For each={agents()}>
				{(def) => (
					<div style={{ padding: '8px 0', 'border-bottom': '1px solid hwb(var(--fg90) / 0.08)' }}>
						<div style={{ display: 'flex', gap: '8px', 'align-items': 'baseline' }}>
							<strong>{def.name}</strong>
							<span style={{ color: 'var(--fontColorDim)', 'font-size': '0.85em' }}>{def.id}</span>
							<Show when={def.id === rootAgent()}>
								<span style={{ color: 'hwb(220 70% 55%)', 'font-size': '0.8em' }}>[根 Agent]</span>
							</Show>
						</div>
						<div style={{ color: 'var(--fontColorDim)', 'font-size': '0.85em', 'margin-top': '4px' }}>
							工具：{allowOf(def)}
						</div>
						<div style={{ color: 'var(--fontColorDim)', 'font-size': '0.85em' }}>
							可委托：{def.delegatable?.length ? def.delegatable.join(', ') : '—'} ｜ 反思轮数：{def.reflectionCount ?? 0}
						</div>
						<div style={{ color: 'var(--fontColorDim)', 'font-size': '0.85em' }}>
							反思提示词：{def.reflectionPrompt?.trim()
								? `自带 ${def.reflectionPromptFile ?? 'reflection.md'}（整份替换模式级）`
								: '跟随模式级 / 内置默认'}
						</div>
					</div>
				)}
			</For>
		</div>
	);
}

/** 当前会话的 LLM 请求日志（只读） */
function RequestLogReadonly() {
	const [records, setRecords] = createSignal<LlmRequestRecord[]>([]);
	const [loading, setLoading] = createSignal(false);

	const refresh = async () => {
		const convId = state.activeConversationId;
		if (!convId) {
			setRecords([]);
			return;
		}
		setLoading(true);
		setRecords(await getRequests(convId, { limit: 50 }));
		setLoading(false);
	};

	createEffect(() => {
		state.activeConversationId;
		void refresh();
	});

	return (
		<div class={styles['setting-group']}>
			<div class={styles['setting-group-label']}>
				请求日志（当前会话，最近 50 条）
				<span style={{ 'margin-left': '10px' }}>
					<ffbox-button onclick={() => void refresh()}>刷新</ffbox-button>
					<ffbox-button
						style={{ 'margin-left': '6px' }}
						onclick={async () => {
							const convId = state.activeConversationId;
							if (!convId) return;
							await clearRequests(convId);
							void refresh();
						}}
					>
						清空
					</ffbox-button>
				</span>
			</div>
			<Show when={!state.activeConversationId}>
				<div class={styles['setting-group-desc']}>先打开一个会话，这里会显示它的 LLM 请求账本。</div>
			</Show>
			<Show when={state.activeConversationId && records().length === 0 && !loading()}>
				<div class={styles['setting-group-desc']}>还没有记录（或 requestLog 被关闭了）。</div>
			</Show>
			<Show when={records().length > 0}>
				<div style={{ 'font-size': '0.85em', color: 'var(--fontColorDim)', 'line-height': '1.7' }}>
					<For each={records()}>
						{(r) => (
							<div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
								<span>{new Date(r.startedAt).toLocaleTimeString('zh-CN')}</span>
								<span>{r.agentName ?? '(llm 层)'}</span>
								<span>{r.purpose}</span>
								<span>{r.model}</span>
								<span>{r.usage?.input ?? 0}↑ {r.usage?.output ?? 0}↓</span>
								<span>{r.durationMs}ms</span>
								<span style={{ color: r.status === 'success' ? 'inherit' : 'var(--error)' }}>{r.status}</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

function PluginModeTab() {
	const [selectedModeId, setSelectedModeId] = createSignal(state.currentModeId);
	const modeOptions = createMemo(() => state.modes.map((m) => ({ value: m.id, label: `${m.ui?.icon ?? ''} ${m.name}`.trim() })));

	createEffect(() => {
		// 模式列表变化（插件重载）后，保证选中的模式依然存在
		const ids = state.modes.map((m) => m.id);
		if (ids.length > 0 && !ids.includes(selectedModeId())) setSelectedModeId(ids[0]);
	});

	return (
		<div>
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>插件</div>
				<div class={styles['setting-group-desc']}>
					插件目录：应用内置 <code>plugins/</code> 与用户目录 <code>~/.mindthegap-harness/plugins/</code>。
					同名模式以用户插件为准（会被标记「被覆盖」）。
				</div>
				<For each={state.modes}>
					{(m) => (
						<div style={{ padding: '6px 0', 'font-size': '0.9em' }}>
							<span>{m.ui?.icon ?? '🧩'} </span>
							<strong>{m.name}</strong>
							<span style={{ color: 'var(--fontColorDim)' }}> （{m.id}）</span>
							<span style={{ color: 'var(--fontColorDim)' }}> — 来自插件 {m.pluginName}</span>
							<Show when={m.overridden}>
								<span style={{ color: 'hwb(35 80% 45%)' }}> [被用户插件覆盖]</span>
							</Show>
							<div style={{ color: 'var(--fontColorDim)', 'font-size': '0.85em' }}>
								{m.description} ｜ 根 Agent：{m.rootAgent} ｜ 最大深度：{m.maxDepth} ｜ Agent 数：
								{m.agents.length}
							</div>
						</div>
					)}
				</For>
				<Show when={state.pluginErrors.length > 0}>
					<div style={{ 'margin-top': '8px', 'font-size': '0.85em' }}>
						<For each={state.pluginErrors}>
							{(err) => (
								<div style={{ color: err.level === 'error' ? 'var(--error)' : 'hwb(35 80% 45%)' }}>
									[{err.level}] {[err.pluginId, err.modeId, err.agentId].filter(Boolean).join('/')} {err.message}
								</div>
							)}
						</For>
					</div>
				</Show>
				<ffbox-button
					type="primary"
					style={{ 'margin-top': '10px' }}
					onclick={async () => {
						const result = await actions.reloadPlugins();
						void alertMsgbox(
							result.ok ? '已重新加载' : '重载失败',
							result.ok ? `当前模式：${(result.modes ?? []).join(', ')}` : '请查看上方的加载错误。',
						);
					}}
				>
					重新加载插件
				</ffbox-button>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>模式</div>
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(modeOptions())}
					prop:text={modeOptions().find((o) => o.value === selectedModeId())?.label ?? selectedModeId()}
					prop:readonly={true}
					onchange={(e) => setSelectedModeId(e.detail as string)}
				/>
				<div class={styles['setting-group-desc']} style={{ 'margin-top': '8px' }}>
					当前聊天使用的模式：
					<strong>{state.modes.find((m) => m.id === state.currentModeId)?.name ?? state.currentModeId}</strong>
					<span style={{ 'margin-left': '8px' }}>
						<ffbox-button onclick={() => actions.setCurrentModeId(selectedModeId())}>设为当前模式</ffbox-button>
					</span>
				</div>
			</div>

			<ModeJsonEditor modeId={selectedModeId()} />
			<AgentsReadonly modeId={selectedModeId()} />
			<RequestLogReadonly />
		</div>
	);
}


/* ---------- 提示词 Tab ----------
   基座提示词是后端设置的一部分（settings.basePrompt），所有模式共享。
   它由各 Agent 的 prompt.md 用 {{ basePrompt }} 决定是否内嵌；被内嵌时按当前作用域再渲染一遍，
   所以这里可以写 {{platform}} / {{time}} / {{taskList}} 等任意作用域变量。
   没有默认值：留空就是空串（合法状态），代码不会拿任何内置文案去补。
   -------------------------------------------------------------------------- */

const BASE_PROMPT_VARS = [
	{ name: '{{platform}}', desc: '操作系统（Windows / macOS / Linux）' },
	{ name: '{{shell}}', desc: 'shell 名称（cmd.exe / /bin/sh）' },
	{ name: '{{time}}', desc: '当前时间（东八区）' },
	{ name: '{{runningDir}}', desc: '工作目录' },
];

function PromptTab() {
	// 本地草稿：只在点「保存」时才写后端，避免每敲一个字就落盘
	const [draft, setDraft] = createSignal(state.basePrompt);
	const [saving, setSaving] = createSignal(false);

	// 后端值变化（首次加载 / 别处保存）时同步草稿
	createEffect(() => setDraft(state.basePrompt));

	const dirty = () => draft() !== state.basePrompt;

	const handleSave = async () => {
		setSaving(true);
		const ok = await actions.saveBasePrompt(draft());
		setSaving(false);
		if (!ok) {
			void alertMsgbox('保存失败', '基座提示词未能写入后端设置，请检查 Agent Service 是否在运行。');
			return;
		}
		void alertMsgbox('已保存', '基座提示词已写入 settings.json，下一轮对话生效。', '好的');
	};

	return (
		<div>
			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>基座提示词</div>
				<div class={styles['setting-group-desc']}>
					所有模式共享这段提示词，但<strong>不会自动拼进 system prompt</strong>：由各 Agent 的 prompt.md 里写不写{' '}
					<code>{'{{ basePrompt }}'}</code> 决定要不要放、放在哪一段（不写就等于关闭，「空」模式就是这么做的）。
					<br />
					常用变量（和 prompt.md 共用同一套，其余变量见各 Agent 的 prompt.md 末尾说明）：<For each={BASE_PROMPT_VARS}>{(v) => (
						<>
							<code>{v.name}</code>（{v.desc}）{' '}
						</>
					)}</For>
				</div>
				<textarea
					class={styles['json-textarea']}
					style={{ 'font-family': 'ui-monospace, Consolas, monospace', 'min-height': '360px' }}
					value={draft()}
					oninput={(e) => setDraft(e.currentTarget.value)}
				/>
				<div style={{ display: 'flex', gap: '10px', 'margin-top': '10px' }}>
					<ffbox-button type="primary" prop:disabled={saving() || !dirty()} onclick={() => void handleSave()}>
						{saving() ? '保存中…' : '保存'}
					</ffbox-button>
					<ffbox-button prop:disabled={!dirty()} onclick={() => setDraft(state.basePrompt)}>放弃修改</ffbox-button>
				</div>
				<Show when={dirty()}>
					<div style={{ 'font-size': '12px', color: 'var(--fontColorDim)', 'margin-top': '6px' }}>
						有未保存的修改。
					</div>
				</Show>
			</div>
		</div>
	);
}

/* ---------- MCP Tab ---------- */

const MCP_TRANSPORT_OPTIONS = [
	{ value: 'stdio', label: 'stdio（本地子进程）' },
	{ value: 'http', label: 'http（Streamable HTTP）' },
] as const;

/** 某一台 MCP 服务器当前的运行态（可能还没连上，不存在于 mcpStatus 里） */
function statusOf(id: string) {
	return state.mcpStatus.find((s) => s.id === id);
}

function McpTab() {
	const [editing, setEditing] = createSignal<McpServerConfig | null>(null);
	const [testing, setTesting] = createSignal(false);
	const [testResult, setTestResult] = createSignal<{
		ok: boolean;
		message: string;
		tools: McpToolInfo[];
	} | null>(null);

	const startAdd = () => {
		setEditing({
			id: '',
			name: '新 MCP 服务器',
			enabled: true,
			transport: 'stdio',
			command: 'node',
			args: [],
			env: {},
		});
		setTestResult(null);
	};

	const startEdit = (server: McpServerConfig) => {
		setEditing(JSON.parse(JSON.stringify(server)) as McpServerConfig);
		setTestResult(null);
	};

	const handleSave = async () => {
		const s = editing();
		if (!s) return;
		if (s.transport === 'stdio' && !s.command?.trim()) {
			void alertMsgbox('无法保存', 'stdio 传输必须填写启动命令（如 node / npx / python）。');
			return;
		}
		if (s.transport === 'http' && !s.url?.trim()) {
			void alertMsgbox('无法保存', 'http 传输必须填写服务器地址。');
			return;
		}

		if (s.id) {
			actions.updateMcpServer(s.id, s);
		} else {
			actions.addMcpServer(s);
		}
		// 新增/修改后立刻让后端重连，不用等 debounce
		await actions.flushMcpServers();
		setEditing(null);
	};

	const handleReset = async () => {
		const ok = await confirmMsgbox(
			'重置 MCP 服务器',
			'将恢复为内置的示例配置，你自己添加的服务器会被移除。确定继续吗？',
			'重置',
		);
		if (ok) await actions.resetMcpServers();
	};

	const handleDelete = async (s: McpServerConfig) => {
		const ok = await confirmMsgbox('删除 MCP 服务器', `确定要删除「${s.name}」吗？`, '删除');
		if (ok) {
			actions.removeMcpServer(s.id);
			await actions.flushMcpServers();
		}
	};

	const handleTest = async () => {
		const s = editing();
		if (!s) return;
		setTesting(true);
		setTestResult(null);
		const result = await testMcpServer(s);
		setTestResult({
			ok: result.ok,
			message: result.ok
				? `连接成功${result.serverInfo?.name ? `，服务器：${result.serverInfo.name}` : ''}`
				: `连接失败：${result.error}`,
			tools: result.tools,
		});
		setTesting(false);
	};

	return (
		<div>
			<Show when={!editing()}>
				<div style={{ marginBottom: "16px", display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div class={styles['setting-group-label']}>已接入的 MCP 服务器</div>
					<div style={{ display: 'flex', gap: "8px" }}>
						<ffbox-button onclick={() => void actions.refreshMcpStatus()}>刷新状态</ffbox-button>
						<ffbox-button onclick={() => void handleReset()}>重置为默认</ffbox-button>
						<ffbox-button type="primary" onclick={startAdd}>+ 添加服务器</ffbox-button>
					</div>
				</div>

				<div class={styles['setting-group-desc']}>
					接入后，服务器提供的工具会以 <code class={styles.mono}>mcp__服务器名__工具名</code> 的形式出现在 Agent 的工具列表里，模型可像内置工具一样调用。
					模型能不能看到它们由模式的 <code class={styles.mono}>mcp</code> 策略决定（<code class={styles.mono}>mode.json</code> 顶层字段：<code class={styles.mono}>none</code> / <code class={styles.mono}>all</code> / 工具名数组）；内置的编码、日常模式是 <code class={styles.mono}>all</code>。
				</div>

				<div class={styles['provider-list']}>
					<Show when={state.mcpServers.length === 0}>
						<div style={{
							padding: '24px',
							textAlign: 'center',
							color: 'var(--fontColorMuted)',
							backgroundColor: 'hwb(var(--bg95) / 1)',
							borderRadius: "10px",
						}}>
							还没有接入任何 MCP 服务器。点击上方 "添加服务器" 开始。
						</div>
					</Show>

					<For each={state.mcpServers}>
						{(s) => {
							const st = () => statusOf(s.id);
							const dotClass = () => {
								if (!s.enabled) return 'disabled';
								return st()?.connected ? 'connected' : 'error';
							};
							return (
								<div class={styles['provider-item']}>
									<span class={`${styles['mcp-status-dot']} ${styles[dotClass()]}`} />
									<div style={{ flex: 1 }}>
										<div class={styles['provider-item-name']}>{s.name}</div>
										<div class={styles['mcp-item-desc']}>
											{s.transport === 'stdio'
												? `${s.command} ${(s.args ?? []).join(' ')}`
												: s.url}
										</div>
										<Show when={st()?.error}>
											<div class={styles['mcp-error']}>⚠️ {st()?.error}</div>
										</Show>
										<Show when={(st()?.tools.length ?? 0) > 0}>
											<div class={styles['tool-list']}>
												<For each={st()?.tools}>
													{(t) => (
														<div class={styles['tool-item']}>
															<div class={styles['tool-item-name']}>{t.name}</div>
															<div class={styles['tool-item-desc']}>{t.description}</div>
														</div>
													)}
												</For>
											</div>
										</Show>
									</div>
									<ffbox-switch
										prop:checked={s.enabled}
										onchange={async (e) => {
											actions.setMcpServerEnabled(s.id, e.detail);
											await actions.flushMcpServers();
										}}
									/>
									<div class={styles['provider-item-actions']}>
										<ffbox-button onclick={() => startEdit(s)}>编辑</ffbox-button>
										<ffbox-button type="danger" onclick={() => void handleDelete(s)}>删除</ffbox-button>
									</div>
								</div>
							);
						}}
					</For>
				</div>
			</Show>

			<Show when={editing()}>
				<McpEditor
					server={editing()!}
					onChange={setEditing}
					onSave={() => void handleSave()}
					onCancel={() => setEditing(null)}
					onTest={() => void handleTest()}
					testing={testing()}
					testResult={testResult()}
				/>
			</Show>
		</div>
	);
}

function McpEditor(props: {
	server: McpServerConfig;
	onChange: (s: McpServerConfig) => void;
	onSave: () => void;
	onCancel: () => void;
	onTest: () => void;
	testing: boolean;
	testResult: { ok: boolean; message: string; tools: McpToolInfo[] } | null;
}) {
	const [local, setLocal] = createStore<{ server: McpServerConfig }>({
		server: JSON.parse(JSON.stringify(props.server)),
	});
	// args / env / launch.args 用文本编辑（数组结构在输入框里不方便），失焦时解析回填
	const [argsText, setArgsText] = createSignal((props.server.args ?? []).join('\n'));
	const [launchArgsText, setLaunchArgsText] = createSignal((props.server.launch?.args ?? []).join('\n'));
	const [envText, setEnvText] = createSignal(
		Object.entries(props.server.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
	);

	const applyArgs = () => {
		setLocal('server', 'args', argsText().split('\n').map((l) => l.trim()).filter(Boolean));
	};
	const applyLaunchArgs = () => {
		setLocal('server', 'launch', 'args', launchArgsText().split('\n').map((l) => l.trim()).filter(Boolean));
	};
	const applyEnv = () => {
		const env: Record<string, string> = {};
		for (const line of envText().split('\n')) {
			const idx = line.indexOf('=');
			if (idx <= 0) continue;
			env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
		setLocal('server', 'env', env);
	};
	// 保存/测试前确保文本里的改动已同步进对象
	const flush = () => { applyArgs(); applyEnv(); applyLaunchArgs(); };

	return (
		<div>
			<h3 style={{ margin: '0 0 16px', fontSize: "15px", fontWeight: 600 }}>
				{local.server.id ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
			</h3>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>名称</div>
				<div class={styles['setting-group-desc']}>
					会作为工具名前缀。建议以英文字母开头（如 sine），因为多数模型要求工具名只能含字母数字和下划线。
				</div>
				<ffbox-normal-input
					class={styles['ffbox-input']}
					prop:value={local.server.name}
					placeholder="我的 MCP 服务器"
					onchange={(e) => setLocal('server', 'name', e.detail)}
				/>
			</div>

			<div class={styles['setting-group']}>
				<div class={styles['setting-group-label']}>传输方式</div>
				<ffbox-dropdown-input
					class={styles['ffbox-dropdown']}
					prop:list={toMenuItems(MCP_TRANSPORT_OPTIONS)}
					prop:text={labelOf(MCP_TRANSPORT_OPTIONS, local.server.transport)}
					prop:readonly={true}
					onchange={(e) => setLocal('server', 'transport', e.detail as McpServerConfig['transport'])}
				/>
			</div>

			<Show when={local.server.transport === 'stdio'}>
				<div class={styles['setting-group']}>
					<div class={styles['setting-group-label']}>启动命令</div>
					<div class={styles['setting-group-desc']}>
						例如 node / npx / python。Windows 上 npx、npm 等会自动补 .cmd 后缀。
					</div>
					<ffbox-normal-input
						class={styles['ffbox-input']}
						prop:value={local.server.command ?? ''}
						placeholder="node"
						onchange={(e) => setLocal('server', 'command', e.detail)}
					/>
				</div>

				<div class={styles['setting-group']}>
					<div class={styles['setting-group-label']}>参数（每行一个）</div>
					<textarea
						class={styles['json-textarea']}
						rows={3}
						value={argsText()}
						oninput={(e) => setArgsText(e.currentTarget.value)}
						onblur={applyArgs}
						placeholder={'D:\\mcp-servers\\sine\\index.js'}
					/>
				</div>

				<div class={styles['setting-group']}>
					<div class={styles['setting-group-label']}>环境变量（每行一个 KEY=VALUE，可选）</div>
					<textarea
						class={styles['json-textarea']}
						rows={2}
						value={envText()}
						oninput={(e) => setEnvText(e.currentTarget.value)}
						onblur={applyEnv}
						placeholder={'API_KEY=xxx'}
					/>
				</div>
			</Show>

			<Show when={local.server.transport === 'http'}>
				<div class={styles['setting-group']}>
					<div class={styles['setting-group-label']}>服务器地址</div>
					<ffbox-normal-input
						class={styles['ffbox-input']}
						prop:value={local.server.url ?? ''}
						placeholder="http://localhost:3000/mcp"
						onchange={(e) => setLocal('server', 'url', e.detail)}
					/>
				</div>

				<div class={styles['setting-group']}>
					<div class={styles['setting-group-label']}>由本应用启动进程</div>
					<div class={styles['setting-group-desc']}>
						开启后，后端在启动时和每次调用前都会探测上面的地址；探测不到就按下面的命令拉起进程，仍无响应则标记为未连通。
					</div>
					<ffbox-switch
						prop:checked={!!local.server.launch}
						onchange={(e) => setLocal('server', 'launch', e.detail ? { command: 'node', args: [] } : undefined)}
					/>
				</div>

				<Show when={local.server.launch}>
					<div class={styles['setting-group']}>
						<div class={styles['setting-group-label']}>启动命令</div>
						<ffbox-normal-input
							class={styles['ffbox-input']}
							prop:value={local.server.launch?.command ?? ''}
							placeholder="node"
							onchange={(e) => setLocal('server', 'launch', 'command', e.detail)}
						/>
					</div>

					<div class={styles['setting-group']}>
						<div class={styles['setting-group-label']}>参数（每行一个）</div>
						<textarea
							class={styles['json-textarea']}
							rows={2}
							value={launchArgsText()}
							oninput={(e) => setLaunchArgsText(e.currentTarget.value)}
							onblur={applyLaunchArgs}
							placeholder={'D:\\mcp-servers\\tangent\\index.js'}
						/>
					</div>
				</Show>
			</Show>

			<div class={styles['setting-group']}>
				<div style={{ display: 'flex', gap: "10px" }}>
					<ffbox-button onclick={() => { flush(); props.onChange(JSON.parse(JSON.stringify(local.server))); props.onTest(); }}>
						{props.testing ? '测试中…' : '测试连接'}
					</ffbox-button>
				</div>
				<Show when={props.testResult}>
					<div class={props.testResult?.ok ? styles['mcp-hint'] : styles['mcp-error']}>
						{props.testResult?.ok ? '✅ ' : '❌ '}{props.testResult?.message}
					</div>
					<Show when={(props.testResult?.tools.length ?? 0) > 0}>
						<div class={styles['tool-list']}>
							<For each={props.testResult?.tools}>
								{(t) => (
									<div class={styles['tool-item']}>
										<div class={styles['tool-item-name']}>{t.name}</div>
										<div class={styles['tool-item-desc']}>{t.description}</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>

			<div style={{ display: 'flex', gap: "10px", marginTop: "24px" }}>
				<ffbox-button type="primary" onclick={() => { flush(); props.onSave(); }}>保存</ffbox-button>
				<ffbox-button type="danger" onclick={props.onCancel}>取消</ffbox-button>
			</div>
		</div>
	);
}

/* ---------- 设置面板主体 ---------- */

type TabId = '通用' | '模型' | '提示词' | '用量' | '插件 / 模式' | 'MCP';

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: '通用', label: '通用' },
	{ id: '模型', label: '模型' },
	{ id: '提示词', label: '提示词' },
	{ id: '用量', label: '用量' },
	{ id: '插件 / 模式', label: '插件 / 模式' },
	{ id: 'MCP', label: 'MCP' },
];

export default function Settings() {
	let panelRef: HTMLDivElement | undefined;

	/** 设置面板唯一的真相：0 = 完全收起，1 = 完全展开，中间 = 拖拽中的实时位置 */
	const progress = () => state.ui.settingsProgress;
	/**
	 * 可见性直接派生自进度（> 0 即挂载）。
	 * 不再单独存一个 visible / open 布尔量：那种「布尔量说开着、进度却是 0」的坏状态根本不可能出现。
	 */
	const visible = () => progress() > 0;

	// 面板高度 = 一次完整开合的手指行程，交给拖拽换算 px → 进度（只是测量，不写任何样式）
	onMount(() => setSettingsTravelMeasure(() => panelRef?.offsetHeight || window.innerHeight));
	onCleanup(() => setSettingsTravelMeasure(() => window.innerHeight));

	return (
		<Show when={visible()}>
			{/* 这个根节点是唯一的动画载体：进度写在它身上，位移 / 遮罩都由它派生 */}
			<div class={styles['settings-root']} style={{ '--settings-progress': progress() }}>
				{/* 遮罩：什么都不干、也不响应鼠标点击（面板铺满整个区域，本来也没有「点外面」这回事） */}
				<div class={styles['settings-overlay']} />

				<div ref={panelRef} class={styles['settings-panel']}>
					{/* 头部：拖拽手柄 + 标题 + 面包屑 + 关闭 */}
					<div class={styles['settings-header']}>
						<div class={styles['settings-drag-handle']} onmousedown={startSettingsDrag} title="按住拖动设置面板">
							<DragHandleIcon />
						</div>
						<div class={styles['settings-title-block']}>
							<div class={styles['settings-title']}>设置</div>
						</div>
						<button class={styles['settings-close-btn']} onclick={() => actions.closeSettings()}>
							<XIcon />
						</button>
					</div>

					{/* 分页栏（沿用原有 6 个 Tab，只换成设计稿的横排样式）+ 完成 */}
					<div class={styles['settings-tabs']}>
						<For each={TABS}>
							{(tab) => (
								<button
									class={styles['settings-tab']}
									classList={{ [styles.active]: state.ui.activeSettingsTab === tab.id }}
									onclick={() => actions.setSettingsTab(tab.id)}
								>
									{tab.label}
								</button>
							)}
						</For>
						<span class={styles['settings-tabs-spacer']} />
						<button class={styles['settings-done-btn']} onclick={() => actions.closeSettings()}>
							完成
						</button>
					</div>

					<div class={styles['settings-divider']} />

					<div class={styles['settings-content']}>
						{state.ui.activeSettingsTab === '通用' && <GeneralTab />}
						{state.ui.activeSettingsTab === '模型' && <ModelsTab />}
						{state.ui.activeSettingsTab === '提示词' && <PromptTab />}
						{state.ui.activeSettingsTab === '用量' && <UsageTab />}
						{state.ui.activeSettingsTab === '插件 / 模式' && <PluginModeTab />}
						{state.ui.activeSettingsTab === 'MCP' && <McpTab />}
					</div>
				</div>

				{/* 全屏浮动占位小方块：跟着设置的下拉量移动，演示一个变量控制多个元素（后期可换成进度页等） */}
				<div class={styles['settings-placeholder']}>
					<div class={styles['settings-placeholder-box']} />
				</div>
			</div>
		</Show>
	);
}
