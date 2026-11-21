/* ---------- 模型 Tab — 服务端组 ----------
   设计稿：docs/设计-模型设置页重设计.html
   三条硬规则：
   ① 列表是表格（提供商 / API 格式 / 请求地址 / 模型 / 操作）：URL 等宽截断，模型是带角色圆点的小胶囊
   ② **没有保存按钮**：任何改动直接进 store，由 `scheduleSaveBackend` 防抖落盘
   ③ 「编辑」= 就地拉高当前行（同时只展开一行）；旁边「复制」一键克隆（含模型目录与参数）
   -------------------------------------------------------------------------- */

import { createEffect, createSignal, For, onCleanup, Show, untrack, type JSX } from 'solid-js';
import { state, actions } from '@mainview/stores';
import type { ModelProvider } from '@mainview/stores';
import type { ModelProviderModel, VideoCodec } from '@shared/agent';
import { DEFAULT_THINKING_PARAM, VIDEO_CODEC_OPTIONS } from '@shared/agent';
import { confirmMsgbox, alertMsgbox } from '@mainview/bridges/ffboxBridge';
import { testProviderModel } from '@mainview/bridges/agentBridge';
import { XIcon, radioValue } from './SettingsCommon';
import common from './SettingsCommon.module.css';
import styles from './ModelsTab.module.css';

const API_FORMAT_OPTIONS = [
	{ value: 'openai-chat', label: 'OpenAI Chat Completions', short: 'OpenAI Chat' },
	{ value: 'openai-responses', label: 'OpenAI Responses', short: 'OpenAI Responses' },
	{ value: 'anthropic', label: 'Anthropic Messages', short: 'Anthropic' },
] as const;

const MODEL_ROLE_OPTIONS = [
	{ value: 'standard', label: '标准' },
	{ value: 'economy', label: '节省' },
] as const;

/** 上下文窗口的快捷预设（点一下直接填进输入框） */
const CTX_PRESETS_IN = [128_000, 256_000, 512_000, 1_000_000] as const;
const CTX_PRESETS_OUT = [4_000, 16_000, 32_000, 128_000] as const;

const formatShort = (f: string) => API_FORMAT_OPTIONS.find((o) => o.value === f)?.short ?? f;

/** 1000000 → 1M、128000 → 128k（预设按钮上的短标签） */
function shortTokens(n: number): string {
	return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;
}

const modelLabel = (m: ModelProviderModel) => m.displayName || m.id || '(未命名)';

/** 竖排的「小标签 + 控件」（设计稿里的 `label.f`） */
function Field(props: { label: string; hint?: string; wide?: boolean; children: JSX.Element }) {
	return (
		<div class={`${styles.field}${props.wide ? ` ${styles.span2}` : ''}`}>
			<span class={styles.label}>{props.label}</span>
			{props.children}
			<Show when={props.hint}>
				<span class={styles.hint}>{props.hint}</span>
			</Show>
		</div>
	);
}

/** 表格「模型」列的小胶囊：圆点区分标准 / 节省，超过 2 个折成 +N */
function ModelChips(props: { models: ModelProviderModel[] }) {
	const shown = () => props.models.slice(0, 2);
	const rest = () => props.models.length - shown().length;
	return (
		<div class={styles.mChips}>
			<For each={shown()}>
				{(m) => (
					<span class={styles.mChip} title={m.id ? `${modelLabel(m)} · ${m.id}` : '未填写模型名称'}>
						<span class={`${styles.dot}${m.role === 'economy' ? ` ${styles.eco}` : ''}`} />
						{modelLabel(m)}
					</span>
				)}
			</For>
			<Show when={rest() > 0}>
				<span class={`${styles.mChip} ${styles.more}`}>+{rest()}</span>
			</Show>
		</div>
	);
}

/**
 * 模型目录里的一行：模型名称 / 显示名称 / 模式 + 连通性，参数挂在下面一条虚线之后。
 *
 * ⚠️ 每次改动都走 `actions.updateProviderModel`（**就地**改对象，不换数组）：
 * 换数组会让 `<For>` 认为整片行都是新对象、把 DOM 重建一遍 —— 正在输入的框会丢焦点。
 */
function ModelRow(props: {
	provider: ModelProvider;
	model: ModelProviderModel;
	index: () => number;
	onSaved: () => void;
	onRemove: () => void;
}) {
	const [jsonText, setJsonText] = createSignal(JSON.stringify(props.model.customParams ?? {}, null, 2));
	const [jsonError, setJsonError] = createSignal('');
	const [tagDraft, setTagDraft] = createSignal('');
	const [test, setTest] = createSignal<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text: string }>({
		kind: 'idle',
		text: '未测试',
	});

	// 换到另一个提供商时组件实例会被复用：草稿与测试态都重置。
	// ⚠️ 只跟踪 provider.id，**不能跟踪 customParams** —— 否则在 JSON 框里每敲一个字都会
	//    把草稿按 JSON.stringify 重排一遍（光标乱跳、缩进被抹掉）。所以读取用 untrack。
	createEffect(() => {
		props.provider.id;
		setJsonText(untrack(() => JSON.stringify(props.model.customParams ?? {}, null, 2)));
		setJsonError('');
		setTest({ kind: 'idle', text: '未测试' });
	});

	const patch = (p: Partial<ModelProviderModel>) => {
		actions.updateProviderModel(props.provider.id, props.index(), p);
		props.onSaved();
	};

	/** 上下文窗口：只收数字，清空 = 用默认值 */
	const patchCtx = (key: 'input' | 'output', raw: string) => {
		const digits = raw.replace(/[^\d]/g, '');
		patch({ contextWindow: { ...props.model.contextWindow, [key]: digits ? Number(digits) : undefined } });
	};

	/** JSON 只有「能解析成对象」才写进配置；解析失败只标红，不落盘 */
	const onJsonInput = (text: string) => {
		setJsonText(text);
		if (!text.trim()) {
			setJsonError('');
			patch({ customParams: {} });
			return;
		}
		try {
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				setJsonError('必须是一个 JSON 对象');
				return;
			}
			setJsonError('');
			patch({ customParams: parsed as Record<string, unknown> });
		} catch {
			setJsonError('JSON 格式错误，修改未生效');
		}
	};

	const thinkValues = () => props.model.thinking?.values ?? [];
	const setThinkValues = (values: string[], param = props.model.thinking?.param || DEFAULT_THINKING_PARAM) => patch({ thinking: { param, values } });

	const addTag = () => {
		const v = tagDraft().trim();
		if (!v) return;
		if (!thinkValues().includes(v)) setThinkValues([...thinkValues(), v]);
		setTagDraft('');
	};

	/** 连通性按「提供商 + 这个模型」测：地址与 Key 来自提供商，模型名来自这一行 */
	const runTest = async () => {
		const id = (props.model.id ?? '').trim();
		if (!id) {
			setTest({ kind: 'err', text: '先填「模型名称」' });
			return;
		}
		setTest({ kind: 'busy', text: '测试中…' });
		const p = props.provider;
		const result = await testProviderModel({
			providerId: p.id,
			modelId: id,
			apiFormat: p.apiFormat,
			baseUrl: p.baseUrl,
			fullUrl: p.fullUrl,
			apiKey: p.apiKey,
			customParams: { ...p.customParams, ...(props.model.customParams ?? {}) },
		});
		setTest({ kind: result.ok ? 'ok' : 'err', text: result.ok ? `✓ ${result.message}` : `✗ ${result.message}` });
	};

	return (
		<div class={styles.mrow}>
			<div class={styles.top}>
				<Field label="模型名称">
					<input
						class={`${styles.input} ${common.mono}`}
						value={props.model.id}
						placeholder="deepseek-v4-pro"
						oninput={(e) => patch({ id: e.currentTarget.value })}
					/>
				</Field>
				<Field label="显示名称">
					<input
						class={styles.input}
						value={props.model.displayName}
						placeholder="留空则显示模型名称"
						oninput={(e) => patch({ displayName: e.currentTarget.value })}
					/>
				</Field>
				<Field label="模式">
					<select
						class={styles.input}
						value={props.model.role}
						onchange={(e) => patch({ role: e.currentTarget.value as ModelProviderModel['role'] })}
					>
						<For each={MODEL_ROLE_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
					</select>
				</Field>
				<Field label="连通性">
					<div class={styles.connLine}>
						<ffbox-button size="small" prop:disabled={test().kind === 'busy'} onclick={() => void runTest()}>
							测试连通性
						</ffbox-button>
						<span class={styles.connStatus} data-kind={test().kind} title={test().text}>{test().text}</span>
					</div>
				</Field>
				<div class={styles.del}>
					<ffbox-button size="small" type="danger" title="删除此模型" onclick={() => props.onRemove()}>
						<XIcon />
					</ffbox-button>
				</div>
			</div>

			<div class={styles.mparams}>
				<Field label="上下文窗口（Token）" hint="留空则使用该模型的默认值" wide>
					<div class={styles.ctxLine}>
						<span class={styles.tagLab}>输入</span>
						<input
							class={`${styles.input} ${common.mono}`}
							value={props.model.contextWindow?.input ?? ''}
							placeholder="请输入数值，留空则使用最佳默认值"
							inputmode="numeric"
							onchange={(e) => patchCtx('input', e.currentTarget.value)}
						/>
						<div class={styles.presets}>
							<For each={CTX_PRESETS_IN}>
								{(v) => (
									<button type="button" class={styles.chipBtn} onclick={() => patch({ contextWindow: { ...props.model.contextWindow, input: v } })}>
										{shortTokens(v)}
									</button>
								)}
							</For>
						</div>
					</div>
					<div class={styles.ctxLine}>
						<span class={styles.tagLab}>输出</span>
						<input
							class={`${styles.input} ${common.mono}`}
							value={props.model.contextWindow?.output ?? ''}
							placeholder="请输入数值，留空则使用最佳默认值"
							inputmode="numeric"
							onchange={(e) => patchCtx('output', e.currentTarget.value)}
						/>
						<div class={styles.presets}>
							<For each={CTX_PRESETS_OUT}>
								{(v) => (
									<button type="button" class={styles.chipBtn} onclick={() => patch({ contextWindow: { ...props.model.contextWindow, output: v } })}>
										{shortTokens(v)}
									</button>
								)}
							</For>
						</div>
					</div>
				</Field>

				<Field label="支持图片输入">
					<label class={styles.checkLine}>
						<ffbox-checkbox prop:checked={!!props.model.supportsVision} onchange={(e) => patch({ supportsVision: e.detail === true })} />
						<span>该模型可以接收图片</span>
					</label>
				</Field>

				<Field label="支持视频输入">
					<label class={styles.checkLine}>
						<ffbox-checkbox prop:checked={!!props.model.supportsVideo} onchange={(e) => patch({ supportsVideo: e.detail === true })} />
						<span>该模型可以接收视频（转码后的 mp4 本体）</span>
					</label>
				</Field>

				<Show when={props.model.supportsVideo}>
					<Field label="视频编码" hint="转码产物既用于前端预览，也用于抽取发给模型的帧；H.266 是彩蛋，不会真的启用" wide>
						<div class={common.codecRadio}>
							<ffbox-radio-list
								prop:list={VIDEO_CODEC_OPTIONS.map((option) => ({ value: option.value, caption: option.label }))}
								prop:value={props.model.videoCodec ?? 'h264'}
								onchange={(e) => {
									const value = radioValue(e) as VideoCodec;
									if (value === 'h266') {
										// 组件内部已经把 value 改成 h266，先弹回去再提示，别让它停在选中态
										(e.currentTarget as unknown as { value: string }).value = props.model.videoCodec ?? 'h264';
										void alertMsgbox('才不让你选呢', '相信我，选这项会浪费你的时间，不可以选～');
										return;
									}
									if (value) patch({ videoCodec: value });
								}}
							/>
						</div>
						<div class={common.mediaOptionList}>
							<For each={VIDEO_CODEC_OPTIONS}>{(option) => (
								<div class={common.mediaOptionDesc}>{option.label} · {option.desc}</div>
							)}</For>
						</div>
					</Field>
				</Show>

				<Field label="思考模式" hint="填模型 API 文档里的强度参数路径（嵌套用点号）；可选值回车添加，点 × 删除" wide>
					<div class={styles.thinkLine}>
						<div class={styles.ctxLine}>
							<span class={styles.tagLab}>参数名</span>
							<input
								class={`${styles.input} ${common.mono}`}
								value={props.model.thinking?.param || DEFAULT_THINKING_PARAM}
								placeholder="reasoning_effort 或 reasoning.effort"
								oninput={(e) => patch({ thinking: { param: e.currentTarget.value, values: thinkValues() } })}
							/>
						</div>
						{/* 可选值直接长在输入框里：标签是框内的 chip，回车添加、点 × 删除 */}
						<div class={styles.tagsBox}>
							<For each={thinkValues()}>
								{(v) => (
									<span class={styles.tag}>
										{v}
										<button type="button" class={styles.tagX} title="移除" onclick={() => setThinkValues(thinkValues().filter((x) => x !== v))}>
											×
										</button>
									</span>
								)}
							</For>
							<input
								class={styles.tagsInput}
								value={tagDraft()}
								placeholder="输入思考强度，如 low / high，回车添加"
								oninput={(e) => setTagDraft(e.currentTarget.value)}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addTag();
									} else if (e.key === 'Backspace' && !tagDraft() && thinkValues().length > 0) {
										setThinkValues(thinkValues().slice(0, -1));
									}
								}}
							/>
						</div>
					</div>
				</Field>

				<Field label="自定义参数（JSON，合并到该模型的每次请求）" wide>
					<textarea
						class={`${common.jsonTextarea}${jsonError() ? ` ${common.error}` : ''}`}
						value={jsonText()}
						oninput={(e) => onJsonInput(e.currentTarget.value)}
						placeholder='{"temperature": 0.7}'
						rows={2}
					/>
					<Show when={jsonError()}>
						<span class={styles.err}>⚠️ {jsonError()}</span>
					</Show>
				</Field>
			</div>
		</div>
	);
}

/**
 * 提供商的行内编辑面板（不跳页）：基本信息 + 模型目录 + 提供商级自定义参数。
 * 右上角那枚「✓ 已生效」是保存按钮的替代品 —— 它只是提示，不承担任何写盘职责。
 */
function ProviderEditor(props: {
	provider: ModelProvider;
	live: () => boolean;
	onSaved: () => void;
	onCollapse: () => void;
}) {
	const [jsonText, setJsonText] = createSignal(JSON.stringify(props.provider.customParams ?? {}, null, 2));
	const [jsonError, setJsonError] = createSignal('');

	createEffect(() => {
		props.provider.id;
		// 同上：customParams 是用户正在编辑的草稿，不能当依赖
		setJsonText(untrack(() => JSON.stringify(props.provider.customParams ?? {}, null, 2)));
		setJsonError('');
	});

	const patch = (p: Partial<ModelProvider>) => {
		actions.updateProvider(props.provider.id, p);
		props.onSaved();
	};

	const onJsonInput = (text: string) => {
		setJsonText(text);
		if (!text.trim()) {
			setJsonError('');
			patch({ customParams: {} });
			return;
		}
		try {
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				setJsonError('必须是一个 JSON 对象');
				return;
			}
			setJsonError('');
			patch({ customParams: parsed as Record<string, unknown> });
		} catch {
			setJsonError('JSON 格式错误，修改未生效');
		}
	};

	return (
		<div class={styles.editor}>
			<div class={styles.editorHead}>
				<div>
					<div class={styles.overline}>Edit Provider · 编辑中</div>
					<div class={styles.editorTitle}>编辑提供商「{props.provider.name || '未命名'}」</div>
				</div>
				<div class={styles.right}>
					<span class={styles.live} classList={{ [styles.show]: props.live() }}>
						✓ 已生效 <span class={styles.note}>· 修改即时写入，无需保存</span>
					</span>
					<ffbox-button size="small" onclick={props.onCollapse}>收起 ▴</ffbox-button>
				</div>
			</div>

			<div class={styles.egrid}>
				<Field label="显示名称">
					<input
						class={styles.input}
						value={props.provider.name}
						placeholder="我的提供商"
						oninput={(e) => patch({ name: e.currentTarget.value })}
					/>
				</Field>
				<Field label="API 格式">
					<select
						class={styles.input}
						value={props.provider.apiFormat}
						onchange={(e) => patch({ apiFormat: e.currentTarget.value as ModelProvider['apiFormat'] })}
					>
						<For each={API_FORMAT_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
					</select>
				</Field>
				<Field label="请求地址" hint="勾选「完整 URL」后，这里填的就是完整端点，不再补 /v1 与接口路径（如智谱 /api/paas/v4/chat/completions）" wide>
					<div class={styles.urlLine}>
						<input
							class={`${styles.input} ${common.mono}`}
							value={props.provider.baseUrl}
							placeholder="https://api.openai.com/v1"
							oninput={(e) => patch({ baseUrl: e.currentTarget.value })}
						/>
						<label class={styles.checkLine} title="勾选后按原样请求这个地址，不拼接 /v1/chat/completions 等后缀">
							<ffbox-checkbox
								prop:checked={!!props.provider.fullUrl}
								onchange={(e) => patch({ fullUrl: e.detail === true })}
							/>
							<span>完整 URL</span>
						</label>
					</div>
				</Field>
				<Field label="API Key" hint="仅保存在本机 settings.json，请求时放进鉴权头">
					<input
						class={`${styles.input} ${common.mono}`}
						value={props.provider.apiKey}
						placeholder="sk-..."
						oninput={(e) => patch({ apiKey: e.currentTarget.value })}
					/>
				</Field>
			</div>

			<div class={styles.esec}>
				<h4>模型目录</h4>
				<span class={styles.num}>{props.provider.models.length} 个模型</span>
				<span class={styles.line} />
				<ffbox-button
					size="small"
					onclick={() => {
						actions.addProviderModel(props.provider.id);
						props.onSaved();
					}}
				>
					＋ 添加模型
				</ffbox-button>
			</div>

			<div class={styles.models}>
				<For each={props.provider.models}>
					{(m, i) => (
						<ModelRow
							provider={props.provider}
							model={m}
							index={i}
							onSaved={props.onSaved}
							onRemove={() => {
								actions.removeProviderModel(props.provider.id, i());
								props.onSaved();
							}}
						/>
					)}
				</For>
				<Show when={props.provider.models.length === 0}>
					<div class={styles.modelsEmpty}>这个提供商下还没有模型，点上面的「＋ 添加模型」。</div>
				</Show>
			</div>

			<div class={styles.esec}>
				<h4>自定义参数（提供商级）</h4>
				<span class={styles.line} />
			</div>
			<textarea
				class={`${common.jsonTextarea}${jsonError() ? ` ${common.error}` : ''}`}
				value={jsonText()}
				oninput={(e) => onJsonInput(e.currentTarget.value)}
				placeholder='{"temperature": 0.7}'
				rows={2}
			/>
			<Show when={jsonError()}>
				<span class={styles.err}>⚠️ {jsonError()}</span>
			</Show>
			<div class={styles.hint}>JSON 对象，会合并到该提供商下所有模型的每次请求（模型级参数优先）。</div>
		</div>
	);
}

export function ModelsTab() {
	const [openId, setOpenId] = createSignal<string | null>(null);
	const [live, setLive] = createSignal(false);
	let liveTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(liveTimer));

	/** 「✓ 已生效」闪一下：每次写入都调它，代替保存按钮（它只负责提示，不负责写盘） */
	const touch = () => {
		setLive(true);
		clearTimeout(liveTimer);
		liveTimer = setTimeout(() => setLive(false), 1800);
	};

	const modelCount = () => state.providers.reduce((n, p) => n + p.models.length, 0);

	const startAdd = () => {
		const id = actions.addProvider({
			name: '新提供商',
			apiFormat: 'openai-chat',
			baseUrl: 'https://api.deepseek.com/v1',
			apiKey: '',
			models: [{ id: '', displayName: '', role: 'standard', customParams: {} }],
			customParams: {},
		});
		setOpenId(id);
	};

	const handleCopy = (p: ModelProvider) => {
		const id = actions.copyProvider(p.id);
		// 副本直接展开：复制出来的多半是「同站不同 Key」，下一步就是改 Key
		if (id) setOpenId(id);
	};

	const handleDelete = async (p: ModelProvider) => {
		const ok = await confirmMsgbox(
			'删除模型提供商',
			`确定要删除「${p.name}」吗？其下的 ${p.models.length} 个模型将一并移除。`,
			'删除',
		);
		if (!ok) return;
		if (openId() === p.id) setOpenId(null);
		actions.removeProvider(p.id);
	};

	return (
		<div>
			<div class={styles.modelsHead}>
				<div>
					<div class={styles.overline}>Model Providers</div>
					<div class={styles.modelsTitle}>
						已配置的模型提供商
						<span class={styles.countPill}>{state.providers.length} 个提供商 · {modelCount()} 个模型</span>
					</div>
					<div class={styles.modelsDesc}>推理请求按「提供商 → 模型」两级配置发出；任意修改即刻写入配置，无需保存。</div>
				</div>
				<ffbox-button type="primary" onclick={startAdd}>＋ 添加提供商</ffbox-button>
			</div>

			<div class={styles.tableWrap}>
				<table class={styles.ptable}>
					<thead>
						<tr>
							<th class={styles.colP}>提供商</th>
							<th class={styles.colF}>API 格式</th>
							<th class={styles.colU}>请求地址</th>
							<th class={styles.colM}>模型</th>
							<th class={styles.colA}>操作</th>
						</tr>
					</thead>
					<tbody>
						<For each={state.providers}>
							{(p) => (
								<>
									<tr class={styles.rowMain} classList={{ [styles.open]: openId() === p.id }}>
										<td>
											<div class={styles.pName}>
												<span class={styles.pDot} />
												{p.name || '(未命名)'}
											</div>
											<div class={styles.pMeta}>{p.models.length} 个模型</div>
										</td>
										<td>
											<span class={styles.badge} data-format={p.apiFormat}>{formatShort(p.apiFormat)}</span>
										</td>
										<td>
											<span class={`${styles.pUrl} ${common.mono}`} title={p.baseUrl}>{p.baseUrl}</span>
										</td>
										<td>
											<ModelChips models={p.models} />
										</td>
										<td>
											<div class={styles.rowActions}>
												<ffbox-button size="small" onclick={() => setOpenId(openId() === p.id ? null : p.id)}>
													{openId() === p.id ? '收起' : '编辑'}
												</ffbox-button>
												<ffbox-button size="small" onclick={() => handleCopy(p)}>复制</ffbox-button>
												<ffbox-button size="small" type="danger" onclick={() => void handleDelete(p)}>删除</ffbox-button>
											</div>
										</td>
									</tr>
									<Show when={openId() === p.id}>
										<tr class={styles.rowEdit}>
											<td colspan={5}>
												<ProviderEditor
													provider={p}
													live={live}
													onSaved={touch}
													onCollapse={() => setOpenId(null)}
												/>
											</td>
										</tr>
									</Show>
								</>
							)}
						</For>
					</tbody>
				</table>
				<Show when={state.providers.length === 0}>
					<div class={styles.modelsEmpty} style={{ padding: '24px', 'text-align': 'center' }}>
						还没有配置任何模型提供商。点右上角「＋ 添加提供商」开始。
					</div>
				</Show>
			</div>

			<div class={styles.modelsFoot}>
				<span class={styles.spark}>◆</span>
				更改即时生效 · 配置写入 <code class={common.mono}>~/.mindthegap-harness/settings.json</code> · 「测试连通性」每个模型单独发一次最小请求
			</div>
		</div>
	);
}
