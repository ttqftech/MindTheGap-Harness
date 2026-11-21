/* ---------- 插件 / 模式 Tab — 服务端组 ----------
   这是模式配置的**唯一入口**（需求 11）：
   - 插件列表（内置 / 用户、被覆盖标记、重新加载）
   - 选中模式的 **mode.json 源码编辑器**（直接改插件目录里的那个文件，合法才允许保存）
   - 只读展示该模式的 Agent（名字 / 工具白名单 / 可委托目标 / 反思轮数）
   - 只读展示当前会话的 LLM 请求日志（§8.7）

   ⚠️ 「当前聊天用哪个模式」是本机偏好，已经搬到「外观」Tab；这里只管插件目录里的配置。
   -------------------------------------------------------------------------- */

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import common from './SettingsCommon.module.css';
import { state, actions } from '@mainview/stores';
import type { AgentDefinition, LlmRequestRecord } from '@shared/agent';
import { alertMsgbox } from '@mainview/bridges/ffboxBridge';
import { getMode, getRequests, clearRequests, saveModeJson } from '@mainview/bridges/agentBridge';
import { shell } from '@mainview/bridges/localBridge';
import { toMenuItems } from './SettingsCommon';

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
		<div class={common.settingGroup}>
			<div class={common['settingGroup-label']}>
				mode.json（直接编辑插件文件）
				<span style={{ 'margin-left': '10px' }}>
					<ffbox-button type="primary" prop:disabled={!!validate(jsonText()) || !dirty() || saving()} onclick={() => void handleSave()}>
						{saving() ? '保存中…' : '保存'}
					</ffbox-button>
					<ffbox-button style={{ 'margin-left': '6px' }} onclick={() => void load()}>放弃修改</ffbox-button>
				</span>
			</div>
			<div class={common['settingGroup-desc']}>
				该模式的全部配置就是这一个文件（<code>{jsonPath() || '…'}</code>），保存即写回插件目录并重新加载插件。
				<br />
				字段：<code>rootAgent</code>（根 Agent）· <code>maxDepth</code>（最大委托深度）·
				<code>todoList</code>（待办清单开关 / 是否可写）· <code>mcp</code>（<code>none</code> /{' '}
				<code>all</code> / 服务器 id 数组）·
				<code>limits.totalRounds</code> / <code>limits.agentInstanceRounds</code> /{' '}
				<code>limits.warnAtRemaining</code>（循环预算，缺省 1000 / 200 / 0；根实例与子 Agent 同一个上限）· <code>ui</code>（图标 / 配色）。
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
				class={`${common.jsonTextarea}${error() ? ` ${common.error}` : ''}`}
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
		<div class={common.settingGroup}>
			<div class={common['settingGroup-label']}>该模式的 Agent（只读）</div>
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
		<div class={common.settingGroup}>
			<div class={common['settingGroup-label']}>
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
				<div class={common['settingGroup-desc']}>先打开一个会话，这里会显示它的 LLM 请求账本。</div>
			</Show>
			<Show when={state.activeConversationId && records().length === 0 && !loading()}>
				<div class={common['settingGroup-desc']}>还没有记录（或 requestLog 被关闭了）。</div>
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

export function PluginModeTab() {
	/** 这里选的是「要查看 / 编辑哪个模式」，不是聊天用的当前模式（那在本机组） */
	const [selectedModeId, setSelectedModeId] = createSignal(state.chatConfig.modeId);
	const modeOptions = createMemo(() => state.modes.map((m) => ({ value: m.id, label: `${m.ui?.icon ?? ''} ${m.name}`.trim() })));

	createEffect(() => {
		// 模式列表变化（插件重载）后，保证选中的模式依然存在
		const ids = state.modes.map((m) => m.id);
		if (ids.length > 0 && !ids.includes(selectedModeId())) setSelectedModeId(ids[0]);
	});

	return (
		<div>
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>插件</div>
				<div class={common['settingGroup-desc']}>
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

			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>模式配置</div>
				<ffbox-dropdown-input
					class={common.ffboxDropdown}
					prop:list={toMenuItems(modeOptions())}
					prop:text={modeOptions().find((o) => o.value === selectedModeId())?.label ?? selectedModeId()}
					prop:readonly={true}
					onchange={(e) => setSelectedModeId(e.detail as string)}
				/>
				<div class={common['settingGroup-desc']} style={{ 'margin-top': '8px' }}>
					下面编辑的是选中模式的配置文件；它对所有连到这个服务的客户端生效。聊天时用哪个模式请到「外观」页选。
				</div>
			</div>

			<ModeJsonEditor modeId={selectedModeId()} />
			<AgentsReadonly modeId={selectedModeId()} />
			<RequestLogReadonly />
		</div>
	);
}
