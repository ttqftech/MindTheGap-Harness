/* ==========================================================================
   登录 / Service 连接控制器 — MindTheGap-Harness

   职责只有一件事：维护「当前有没有连上 Service、连的是谁」这条状态线。
     - 启动时自动尝试一次（保存的凭据，没有就用空口令试本机管理员）
     - 手动连接 / 断开 / 重连（连接目标可以是任意 IP:端口，见 `RecentConnection`）
     - **10s 轮询**探活 + 校验 session（MTG 没有 FFBox 的 WebSocket 事件，只能靠轮询）

   ⚠️ 为什么是轮询而不是长连接：主进程与 Service 之间只有 HTTP 一条信道，
   前端也一样；没有 WS 就收不到「服务挂了」的推送，10s 一次的探活是这套架构下最省的做法。
   ⚠️ 本文件是**应用级控制器**（同 `runController`），不 import 任何 UI 组件。
   ========================================================================== */

import { localSettings, getServiceInfo, isElectrobunEnv } from '@mainview/bridges/localBridge';
import * as agentBridge from '@mainview/bridges/agentBridge';
import { state, setState, actions, authActions, loadBackendState } from '@mainview/stores';
import { unsubscribeAll } from '@mainview/logic/runController';
import type { ServiceHealth } from '@shared/buildInfo';

/** 掉线检测间隔。改这里就能改「多久发现服务没了」 */
export const POLL_INTERVAL_MS = 10_000;

/**
 * 一次连接的全部参数（= 连接面板里的四个输入框）。
 * 密码是**明文**保存在 localStorage 的（与 FFBox 的 serversInfo 同做法：这是本机自用的登录闸门，不是堡垒）。
 */
export interface ConnectionTarget {
	host: string;
	port: number;
	username: string;
	password: string;
}

/** 「最近连接」的一条记录 */
export interface RecentConnection extends ConnectionTarget {
	lastUsedAt: number;
}

const CREDENTIALS_KEY = 'serviceCredentials';	// 上次用的那一组（启动自动连 / 重连用）
const RECENT_KEY = 'recentConnections';		// 最近连接列表（连接面板右侧展示）
const RECENT_LIMIT = 5;

/** 本机默认目标（主进程 spawn / adopt 的那个） */
const LOCAL_DEFAULT: ConnectionTarget = { ...agentBridge.LOCAL_ENDPOINT, username: '', password: '' };

// #region 保存的凭据 / 最近连接

function isTarget(value: unknown): value is RecentConnection {
	const v = value as RecentConnection;
	return !!v && typeof v.host === 'string' && typeof v.port === 'number' && typeof v.username === 'string';
}

function loadCredentials(): ConnectionTarget | null {
	const saved = localSettings.get<RecentConnection | null>(CREDENTIALS_KEY, null);
	if (!isTarget(saved)) return null;
	return { host: saved.host, port: saved.port, username: saved.username, password: saved.password ?? '' };
}

function saveCredentials(target: ConnectionTarget): void {
	localSettings.set(CREDENTIALS_KEY, { ...target, lastUsedAt: Date.now() } satisfies RecentConnection);
}

/** 清掉保存的凭据（登录失败时用，避免下次启动又用错的密码试一遍） */
function clearCredentials(): void {
	localSettings.remove(CREDENTIALS_KEY);
}

/** 上次连接的目标（连接面板预填 IP / 端口 / 用户名用；**密码不回填**，那太不体面了） */
export function lastTarget(): { host: string; port: number; username: string } | null {
	const saved = loadCredentials();
	return saved ? { host: saved.host, port: saved.port, username: saved.username } : null;
}

/** 最近连接（按最后使用时间倒序；同一 host:port:用户名 只留一条） */
export function listRecentConnections(): RecentConnection[] {
	const list = localSettings.get<RecentConnection[]>(RECENT_KEY, []);
	if (!Array.isArray(list)) return [];
	return list.filter(isTarget).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

function pushRecentConnection(target: ConnectionTarget): void {
	const rest = listRecentConnections().filter(
		(r) => !(r.host === target.host && r.port === target.port && r.username === target.username),
	);
	const next: RecentConnection[] = [{ ...target, lastUsedAt: Date.now() }, ...rest].slice(0, RECENT_LIMIT);
	localSettings.set(RECENT_KEY, next);
}

export function removeRecentConnection(target: { host: string; port: number; username: string }): void {
	const next = listRecentConnections().filter(
		(r) => !(r.host === target.host && r.port === target.port && r.username === target.username),
	);
	localSettings.set(RECENT_KEY, next);
}

export function clearRecentConnections(): void {
	localSettings.remove(RECENT_KEY);
}

// #endregion

/**
 * 服务来源（spawn / adopt）只有主进程知道。
 * 浏览器（vite dev / playwright）没有主进程 —— 页面只能连上已经在跑的服务，直接判定为 adopted，
 * 别显示成「未知」（那会让人以为连接有问题）。
 */
async function detectServiceOrigin(): Promise<void> {
	const info = await getServiceInfo();
	if (info) {
		authActions.setServiceOrigin(info.mode === 'spawned' ? 'spawned' : 'adopted');
		return;
	}
	authActions.setServiceOrigin(isElectrobunEnv() ? 'unknown' : 'adopted');
}

/**
 * 探活并刷新 serviceHealth。不可达返回 null。
 * ⚠️ 探的是 `agentBridge` 的当前 endpoint —— 所以调用前必须先把目标写进去。
 */
async function probeHealth(): Promise<ServiceHealth | null> {
	const health = await agentBridge.health();
	setState('serviceHealth', health);
	return health;
}

/** 把界面切到「掉线」并断开所有 SSE 订阅（服务没了，订阅留着也没用） */
function markDisconnected(error: string): void {
	agentBridge.setSession(null);
	authActions.clearSession();
	authActions.setStatus('disconnected');
	authActions.setError(error);
	unsubscribeAll();
}

// #region 连接 / 断开 / 重连

/**
 * 连接（= 登录）。
 *
 * 顺序不能换：**先写目标、再探活、最后登录**。服务没起来时 login 的 fetch 会抛网络错误，
 * 那样报给用户的会是「登录失败：Failed to connect」，而真正的原因是「这个地址上没服务」。
 *
 * @param remember 是否记下凭据（自动重连 / 下次启动 / 最近连接用）；重连时传 false，别把空口令覆盖掉
 */
async function doConnect(target: ConnectionTarget, options: { remember?: boolean; reconnecting?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
	if (state.auth.status === 'connecting' || state.auth.status === 'reconnecting') {
		return { ok: false, error: '正在连接中，请稍候' };
	}
	authActions.setStatus(options.reconnecting ? 'reconnecting' : 'connecting');
	authActions.setError(null);

	// 请求目标与界面上的「当前目标」一起换，保证紧随其后的探活 / 登录 / 轮询打的是同一个地址
	const endpoint = { host: target.host.trim(), port: target.port };
	agentBridge.setEndpoint(endpoint.host, endpoint.port);
	authActions.setEndpoint(endpoint.host, endpoint.port);

	if (!(await probeHealth())) {
		const error = `连接失败：${endpoint.host}:${endpoint.port} 上没有响应 —— 服务可能没启动、端口不通，或被防火墙挡住`;
		authActions.setStatus('disconnected');
		authActions.setError(error);
		return { ok: false, error };
	}

	await detectServiceOrigin();
	const result = await agentBridge.login(target.username, target.password);
	if (!result.ok || !result.sessionId) {
		const error = result.error ?? '登录失败';
		authActions.setStatus('disconnected');
		authActions.setError(error);
		if (options.remember) clearCredentials();	// 记住的密码不对，别留着下次继续错
		return { ok: false, error };
	}

	agentBridge.setSession(result.sessionId);
	authActions.setSession({ username: result.username ?? target.username, permissions: result.permissions ?? [] });
	authActions.setStatus('connected');
	if (options.remember) {
		saveCredentials(target);
		pushRecentConnection(target);
	}

	// 后端数据（模型 / 文件夹 / 会话 / MCP）全部要等这一刻才拉
	await loadBackendState();
	// 后端在 HTTP 服务启动时就自动连了 MCP，这里拉一次运行态用于展示
	void actions.refreshMcpStatus();
	return { ok: true };
}

/** 手动连接（连接面板的「连接」按钮） */
export function connect(target: ConnectionTarget): Promise<{ ok: boolean; error?: string }> {
	return doConnect(target, { remember: true });
}

/** 点「最近连接」里的一条：用它保存的地址与凭据再连一次 */
export function connectRecent(entry: RecentConnection): Promise<{ ok: boolean; error?: string }> {
	return doConnect({ host: entry.host, port: entry.port, username: entry.username, password: entry.password }, { remember: true });
}

/**
 * 断开连接（手动）。会话在 Service 内存里，不通知后端的话它会一直有效到服务重启。
 * 凭据保留 —— 下次启动 / 重连还要用。
 */
export async function disconnect(): Promise<void> {
	unsubscribeAll();
	await agentBridge.logout();
	agentBridge.setSession(null);
	authActions.clearSession();
	authActions.setStatus('idle');
	authActions.setError(null);
}

/** 重连：拿保存的凭据再登一次（掉线覆盖层的「重试」、侧边栏的「重新连接」都走它） */
export function reconnect(): Promise<{ ok: boolean; error?: string }> {
	const target = loadCredentials() ?? LOCAL_DEFAULT;
	return doConnect(target, { reconnecting: true });
}

/**
 * 启动时自动连一次。
 * - 有保存的凭据 → 用它（可能是别的机器）
 * - 没有 → 用空口令试本机管理员（默认状态下管理员没密码，等于「无感进入」）
 * - 失败 → 界面停在连接面板，让用户手填
 */
export async function autoConnect(): Promise<void> {
	const target = loadCredentials() ?? LOCAL_DEFAULT;
	const result = await doConnect(target, { remember: false });
	if (!result.ok) {
		console.warn(`[Auth] 自动连接未成功：${result.error}`);
	}
}

// #endregion

// #region 10s 轮询（替代 FFBox 的 WebSocket 掉线事件）

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
	// 正在连接时别插一脚（登录请求自己会失败/成功）
	if (state.auth.status === 'connecting' || state.auth.status === 'reconnecting') return;

	const health = await probeHealth();
	if (!health) {
		// 服务没了：只有「本来是登录态」才需要报掉线
		if (state.auth.status === 'connected') markDisconnected('与 Agent Service 的连接已断开');
		return;
	}

	// 没登录（idle / disconnected）时只刷新探活结果，界面上的「重试」按钮仍然由用户决定
	if (state.auth.status !== 'connected') return;

	// 服务在，但 session 可能已经失效（服务重启过 / 会话表在内存里）
	const info = await agentBridge.getAuthInfo();
	if (!info) {
		markDisconnected('登录会话已失效（Agent Service 可能重启过），请重新登录');
		return;
	}
	authActions.setPermissions(info.permissions);
}

/** 启动轮询（幂等：重复调用不会叠加定时器） */
export function startConnectionWatch(): void {
	if (pollTimer !== null) return;
	pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
}

export function stopConnectionWatch(): void {
	if (pollTimer !== null) clearInterval(pollTimer);
	pollTimer = null;
}

// #endregion
