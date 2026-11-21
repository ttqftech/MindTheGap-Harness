/* ==========================================================================
   服务 Tab — 服务端组。调试开关写 settings.debug，构建信息读 Agent Service 的 /api/health。
   原来这两块混在「通用」页里，和前端外观设置挤在一起，现在按真相源归到服务侧。
   ========================================================================== */

import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { state, actions, serviceOriginLabel } from '@mainview/stores';
import { alertMsgbox } from '@mainview/bridges/ffboxBridge';
import { getRequestLogLevel, setRequestLogLevel, SAFETY_OPTIONS } from '@mainview/bridges/agentBridge';
import type { ToolSafety } from '@mainview/bridges/agentBridge';
import { Segmented, toMenuItems } from './SettingsCommon';
import common from './SettingsCommon.module.css';
import styles from './ServiceTab.module.css';

/** ISO 8601（UTC）→ 本地时间；构建信息里的时间统一存 UTC，只在展示时转换 */
function formatTime(iso: string): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** 构建信息的一行「键 → 值」 */
function InfoRow(props: { label: string; value: string }) {
	return (
		<div class={styles.row}>
			<span class={styles.key}>{props.label}</span>
			<span class={`${styles.value} ${common.mono}`}>{props.value}</span>
		</div>
	);
}

const REQUEST_LOG_LEVEL_OPTIONS = [
	{ value: 'default', label: '默认' },
	{ value: 'input', label: '仅输入' },
	{ value: 'full', label: '完整' },
] as const;

/**
 * LLM 请求日志等级。
 * - 「仅输入」= 每次调用把 messages 全文写进 requestLog.jsonl（能看模型看到了什么）
 * - 「完整」  = 再额外把响应的正文 / 思考也写进去（入参 + 输出）
 * 渲染树上右键 LLM 块（或工具卡看安全审核）「导出详细信息」看到的就是它。
 * 只影响**之后**的请求，已有的日志不会补写。
 */
function RequestLogLevelRow() {
	const [level, setLevel] = createSignal<'default' | 'input' | 'full'>('default');

	onMount(async () => {
		setLevel(await getRequestLogLevel());
	});

	const change = async (next: 'default' | 'input' | 'full') => {
		const prev = level();
		if (next === prev) return;
		setLevel(next);	// 乐观更新：失败再回滚
		const ok = await setRequestLogLevel(next);
		if (!ok) {
			setLevel(prev);
			void alertMsgbox('保存失败', '请求日志等级没能写进后端设置（Service 可能不可达）。');
		}
	};

	return (
		<div class={common.settingRow}>
			<div class={common.label}>
				<span class={common.title}>LLM 请求日志等级</span>
				<span class={common.desc}>
					「仅输入」记 messages 全文，「完整」再记响应正文（体积明显变大，仅调试用）；只影响之后的请求
				</span>
			</div>
			<Segmented options={REQUEST_LOG_LEVEL_OPTIONS} value={level()} onChange={(v) => void change(v)} />
		</div>
	);
}

export function ServiceTab() {
	const modeOptions = createMemo(() => state.modes.map((m) => ({ value: m.id, label: `${m.ui?.icon ?? ''} ${m.name}`.trim() })));

	return (
		<>
			{/* 新会话的默认聊天配置（后端 settings.chatDefaults）。每个会话建好后各存一份，互不影响 */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>新会话默认值</div>
				<div class={common['settingGroup-desc']}>
					新建会话时以这份配置为模板；建好后每个会话在 ctx.json 里存自己的一份，改一个不会影响别的会话。
					模型、思考强度与安全性也可以在「新建会话但还没发第一句」时用输入框下方的 chip 选一次，
					那次选择会同时更新这里的默认模板；已存在会话里的修改只影响该会话本身。
				</div>
				<div class={common.settingRow}>
					<span class={common.title}>默认模式</span>
					<ffbox-dropdown-input
						class={common.ffboxDropdown}
						prop:list={toMenuItems(modeOptions())}
						prop:text={modeOptions().find((o) => o.value === state.chatDefaults.modeId)?.label ?? state.chatDefaults.modeId}
						prop:readonly={true}
						onchange={(e) => actions.updateChatDefaults({ modeId: e.detail as string })}
					/>
				</div>
				<div class={common.settingRow}>
					<span class={common.title}>默认工具安全性</span>
					<ffbox-dropdown-input
						class={common.ffboxDropdown}
						prop:list={toMenuItems(SAFETY_OPTIONS.map((o) => ({ value: o.value, label: o.label })))}
						prop:text={SAFETY_OPTIONS.find((o) => o.value === state.chatDefaults.safety)?.label ?? state.chatDefaults.safety}
						prop:readonly={true}
						onchange={(e) => actions.updateChatDefaults({ safety: e.detail as ToolSafety })}
					/>
				</div>
			</div>

			{/* 调试：LLM 请求日志等级。真相在后端 settings.debug.requestLog.level，
			    改完立刻同步给 llm 层（下一次请求就按新等级记录） */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>调试</div>
				<RequestLogLevelRow />
			</div>

			{/* 构建信息：前端是打包时注入的常量，后端是 Agent Service 自报的（GET /api/health）。
			    两边不一致 = 前端/后端没一起重编；后端显示旧提交 = 18999 端口上还跑着旧进程。 */}
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>服务与构建信息</div>
				<div class={common['settingGroup-desc']}>提交号带 * 表示构建时工作区有未提交改动</div>
				<div class={styles.infoList}>
					{/* MTG 独有：Service 可能是本应用 spawn 的（缀「已托管」），也可能是探活到已在跑而 adopt 的 */}
					<InfoRow label="服务地址" value={serviceOriginLabel()} />
					<InfoRow label="登录用户" value={state.auth.username || '（管理员）'} />
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
						class={common.btnSecondary}
						onclick={() => void actions.refreshServiceHealth()}
					>
						刷新
					</button>
				</div>
			</div>
		</>
	);
}
