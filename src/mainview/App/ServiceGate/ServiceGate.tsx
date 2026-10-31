/**
 * ServiceGate — 未登录时的整屏闸门（= FFBox 的 loginArea / disconnectArea）
 *
 * 为什么是整屏而不是覆盖层：需求要求「未登录时两个侧边栏不打开且不允许打开」，
 * 那两个侧边栏干脆不渲染，这里独占 clientArea。
 *
 * 三个职责：
 *   ① 连接：**手动填 IP / 端口 / 用户名 / 密码**（默认本机 127.0.0.1:18999）
 *   ② 掉线提示 + 重试（服务没响应、会话失效都走这里）
 *   ③ 「最近连接」：点一条就用它保存的地址与凭据再连一次
 *
 * ⚠️ 目标行（灰底那条）显示的是**输入框里那个地址**的探活结果 —— 它同时承担
 *   「连的是哪个服务、是不是本应用托管」这个指示，因为这是用户最需要知道这件事的时刻。
 */

import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, For } from 'solid-js';
import { state, isLocalEndpoint, serviceManaged } from '@mainview/stores';
import { probeHealthAt, LOCAL_ENDPOINT } from '@mainview/bridges/agentBridge';
import { connect, reconnect, lastTarget, listRecentConnections, removeRecentConnection, clearRecentConnections, connectRecent, type RecentConnection } from '@mainview/logic/authController';
import styles from './ServiceGate.module.css';

/** 最近连接的时间戳：今天给 HH:mm，更早给 MM-DD（列表很窄，别塞完整时间） */
function compactTime(timestamp: number): string {
	const d = new Date(timestamp);
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 小圆点：服务在线 / 不在线 */
function StatusDot(props: { ok: boolean }) {
	return <span class={styles.dot} classList={{ [styles.dotOk]: props.ok, [styles.dotBad]: !props.ok }} />;
}

/** 探活结果（只针对输入框里那个地址，与「当前连接目标」无关） */
type ProbeState = 'checking' | 'ok' | 'fail';

export default function ServiceGate() {
	const saved = lastTarget();
	const [host, setHost] = createSignal(saved?.host ?? LOCAL_ENDPOINT.host);
	const [portText, setPortText] = createSignal(String(saved?.port ?? LOCAL_ENDPOINT.port));
	const [username, setUsername] = createSignal(saved?.username ?? '');
	const [password, setPassword] = createSignal('');
	const [localError, setLocalError] = createSignal<string | null>(null);
	const [probe, setProbe] = createSignal<ProbeState>('checking');
	const [probePid, setProbePid] = createSignal<number | null>(null);
	const [recent, setRecent] = createSignal<RecentConnection[]>(listRecentConnections());
	let hostRef: HTMLInputElement | undefined;

	const port = () => Number(portText());
	const busy = createMemo(() => state.auth.status === 'connecting' || state.auth.status === 'reconnecting');
	/** 后端 / 控制器给出的错误优先，其次才是本地校验 */
	const error = createMemo(() => localError() ?? state.auth.error);

	/**
	 * 掉线（本次运行里连上过、现在断了）→ 多给一个「用上次凭据重试」的入口。
	 * ⚠️ 判据必须带上 `everConnected`：启动时第一次就没登上也是 `disconnected`，
	 *    那种情况说「服务掉线了？」纯属误导。
	 */
	const wasConnected = createMemo(() => state.auth.status === 'disconnected' && state.auth.everConnected);

	// #region 目标探活（防抖 400ms：边输 IP 边探活会打出一串请求）

	let probeTimer: ReturnType<typeof setTimeout> | undefined;
	let probeSeq = 0;

	const runProbe = async () => {
		const seq = ++probeSeq;
		setProbe('checking');
		setProbePid(null);
		const result = await probeHealthAt(host().trim(), port(), 2000);
		if (seq !== probeSeq) return;	// 期间又改了输入，这次结果作废
		setProbe(result ? 'ok' : 'fail');
		setProbePid(result?.pid ?? null);
	};

	const scheduleProbe = () => {
		clearTimeout(probeTimer);
		// 端口没填好就先不探，省得打一串必然失败的请求
		if (!host().trim() || !Number.isFinite(port()) || port() < 1 || port() > 65535) {
			setProbe('fail');
			setProbePid(null);
			return;
		}
		probeTimer = setTimeout(() => void runProbe(), 400);
	};

	createEffect(on([host, portText], scheduleProbe));
	onCleanup(() => clearTimeout(probeTimer));

	/**
	 * 输入一改就先把状态打回「正在检测」。
	 * ⚠️ 不能只在 effect 里做：`createEffect` 是排队执行的，改完输入到 effect 跑之间
	 *    会有一帧显示**上一个地址**的探活结果（旧 pid 挂在新端口上，看着像真的）。
	 */
	const markPending = () => {
		setProbe('checking');
		setProbePid(null);
	};

	/** 目标行的说明文字：托管 / 接入现有 / 外部服务，跟着输入框走 */
	const targetHint = () => {
		if (probe() === 'checking') return '正在检测…';
		if (probe() === 'fail') return '无响应';
		if (!isLocalEndpoint(host().trim(), port())) return '外部服务';
		return serviceManaged(host().trim(), port()) ? '已托管' : '接入现有';
	};

	// #endregion

	onMount(() => {
		// 先按输入框里的地址探一次（不依赖 effect 的 400ms 防抖，打开面板就能看到状态）
		scheduleProbe();
		hostRef?.focus();
	});

	// #region 动作

	const validate = (): string | null => {
		if (!host().trim()) return '请填写 IP 或主机名';
		if (!Number.isInteger(port()) || port() < 1 || port() > 65535) return '端口需要是 1–65535 的整数';
		return null;
	};

	const submit = async (e: Event) => {
		e.preventDefault();
		if (busy()) return;
		const invalid = validate();
		if (invalid) {
			setLocalError(invalid);
			return;
		}
		setLocalError(null);
		const result = await connect({ host: host().trim(), port: port(), username: username(), password: password() });
		if (!result.ok) setLocalError(result.error ?? '连接失败');
	};

	const retry = async () => {
		if (busy()) return;
		setLocalError(null);
		const result = await reconnect();
		if (!result.ok) setLocalError(result.error ?? '重连失败');
	};

	/** 点「最近连接」的一条：回填表单（失败时方便改）并立刻连 */
	const useRecent = async (entry: RecentConnection) => {
		if (busy()) return;
		setHost(entry.host);
		setPortText(String(entry.port));
		setUsername(entry.username);
		setPassword(entry.password);
		setLocalError(null);
		markPending();
		const result = await connectRecent(entry);
		if (!result.ok) setLocalError(result.error ?? '连接失败');
	};

	const removeRecent = (entry: RecentConnection) => {
		removeRecentConnection(entry);
		setRecent(listRecentConnections());
	};

	const clearRecent = () => {
		clearRecentConnections();
		setRecent([]);
	};

	// #endregion

	return (
		<div class={styles.gate}>
			<div class={styles.card}>
				<div class={styles.brand}>MindTheGap-Harness</div>
				<h2 class={styles.title}>连接 Agent Service</h2>

				<form class={styles.form} onsubmit={(e) => void submit(e)}>
					<div class={styles.row}>
						<label class={`${styles.field} ${styles.grow}`}>
							<span class={styles.fieldLabel}>IP / 主机</span>
							<input
								ref={hostRef}
								class={styles.input}
								type="text"
								spellcheck={false}
								autocomplete="off"
								placeholder="127.0.0.1"
								value={host()}
								oninput={(e) => {
									markPending();
									setHost(e.currentTarget.value);
								}}
							/>
						</label>
						<label class={`${styles.field} ${styles.port}`}>
							<span class={styles.fieldLabel}>端口</span>
							<input
								class={styles.input}
								type="text"
								inputmode="numeric"
								autocomplete="off"
								placeholder="18999"
								value={portText()}
								oninput={(e) => {
									markPending();
									setPortText(e.currentTarget.value.replace(/[^\d]/g, ''));
								}}
							/>
						</label>
					</div>

					<div class={styles.row}>
						<label class={`${styles.field} ${styles.grow}`}>
							<span class={styles.fieldLabel}>用户名</span>
							<input
								class={styles.input}
								type="text"
								autocomplete="username"
								placeholder="留空 = 管理员"
								value={username()}
								oninput={(e) => setUsername(e.currentTarget.value)}
							/>
						</label>
						<label class={`${styles.field} ${styles.grow}`}>
							<span class={styles.fieldLabel}>密码</span>
							<input
								class={styles.input}
								type="password"
								autocomplete="current-password"
								placeholder="未设置密码可留空"
								value={password()}
								oninput={(e) => setPassword(e.currentTarget.value)}
							/>
						</label>
					</div>

					<button class={styles.primary} type="submit" disabled={busy()}>
						{busy() ? '正在连接…' : '连接'}
					</button>
				</form>

				{/* 目标状态：输入框里那个地址探不探得到 + 是不是本应用托管的 */}
				<div class={styles.target}>
					<StatusDot ok={probe() === 'ok'} />
					<span class={styles.targetAddr}>{host().trim() || '—'}:{portText() || '—'}</span>
					<span class={styles.targetSep}>·</span>
					<span class={styles.targetOrigin}>{targetHint()}</span>
					<Show when={probe() === 'ok' && probePid()}>
						<span class={styles.targetSep}>·</span>
						<span class={styles.targetPid}>pid {probePid()}</span>
					</Show>
				</div>

				<Show when={error()}>
					<div class={styles.error}>{error()}</div>
				</Show>

				<Show when={wasConnected()}>
					<div class={styles.retryBlock}>
						<span class={styles.retryHint}>服务掉线了？确认目标地址上的服务还在跑，再点重试。</span>
						<button class={styles.secondary} type="button" disabled={busy()} onclick={() => void retry()}>
							用上次的凭据重试
						</button>
					</div>
				</Show>

				{/* 最近连接：点一条 = 用它保存的地址与凭据直接连 */}
				<div class={styles.recent}>
					<div class={styles.recentHead}>
						<span class={styles.recentTitle}>最近连接</span>
						<span style="flex: 1" />
						<Show when={recent().length > 0}>
							<button class={styles.recentClear} type="button" onclick={clearRecent}>
								清空
							</button>
						</Show>
					</div>
					<Show when={recent().length === 0}>
						<div class={styles.recentEmpty}>（还没有成功连接过）</div>
					</Show>
					<For each={recent()}>
						{(entry) => (
							<div class={styles.recentRow} onclick={() => void useRecent(entry)} title="点击用这条记录连接">
								<span class={styles.recentAddr}>
									{entry.host}:{entry.port}
								</span>
								<span class={styles.recentUser}>{entry.username || '（管理员）'}</span>
								<span class={styles.recentTime}>{compactTime(entry.lastUsedAt)}</span>
								<button
									class={styles.recentRemove}
									type="button"
									title="删除这条记录"
									onclick={(e) => {
										e.stopPropagation();
										removeRecent(entry);
									}}
								>
									×
								</button>
							</div>
						)}
					</For>
				</div>

				<div class={styles.footer}>
					首次使用：管理员是<strong>空用户名 + 无密码</strong>，直接点连接即可。密码在「设置 → 用户管理」里设置。
				</div>
			</div>
		</div>
	);
}
