/* ==========================================================================
   用户与登录 — MindTheGap-Harness（Service 侧）

   照抄 FFBox 的 userManager + uiBridge 鉴权模型，只保留一个权限项「用户管理」：

   - 用户列表持久化在 settings.json 的 `users` 里；**空用户名 = 管理员账号**，
     管理员没设密码时允许「无密码访问」（optionalAuth 语义，方便本地开发 / 首次使用）。
   - 登录成功后发一个随机 sessionId，前端后续请求带 `Authorization: Bearer <sessionId>`。
   - 会话只存在**内存**里：服务重启即全部失效（前端靠 10s 轮询发现 → 重新登录）。
     刻意不落盘 —— 磁盘上的会话 id 等于一把永久钥匙。

   ⚠️ 这是一道**界面闸门**，不是对抗本机恶意进程的安全边界（与 FFBox 同取舍）。
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { ALL_PERMISSIONS, defaultUsers, type AuthInfo, type LoginResult, type Permission, type UserConfig } from '../shared/agent';
import { settings } from './storage';
import { logMsg } from '../shared/utils';

/**
 * 读用户列表。
 * settings.json 里没有 users（老版本 / 首次启动）或为空数组时，回落到默认管理员 ——
 * 「一个人都没有」不应该等于「谁都能进」，也不应该等于「谁都进不去」。
 */
export function getUsers(): UserConfig[] {
	const users = Array.isArray(settings.users) ? settings.users : [];
	if (users.length === 0) return defaultUsers();
	return users.map((user) => ({
		...user,
		permissions: Array.isArray(user.permissions) ? user.permissions : [...ALL_PERMISSIONS],
	}));
}

export function setUsers(users: UserConfig[]): void {
	settings.users = users;
}

/** 管理员 = 空用户名的那个账号 */
function adminUser(): UserConfig | undefined {
	return getUsers().find((u) => u.username === '');
}

/**
 * 是否允许无密码访问：管理员没设密码时就放行（前端于是能直接进界面，不用先登录）。
 * 一旦给管理员设了密码，所有接口都要求带 session。
 */
export function isPasswordlessAllowed(): boolean {
	const admin = adminUser();
	return !admin || !admin.passkey;
}

// #region 会话

interface Session {
	sessionId: string;
	username: string;
	permissions: Permission[];
	loginTime: number;
}

/** sessionId → 会话（内存，不落盘） */
const sessions = new Map<string, Session>();

/**
 * 建会话。**允许同一用户多登录**：重连 / 另开一处连着都不影响旧会话（FFBox 同做法），
 * 各 session 自己过期、自己 logout，互不干扰。
 */
function createSession(username: string, permissions: Permission[]): string {
	const sessionId = randomBytes(16).toString('hex');
	sessions.set(sessionId, { sessionId, username, permissions: [...permissions], loginTime: Date.now() });
	return sessionId;
}

export function getSession(sessionId: string): Session | undefined {
	return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
	sessions.delete(sessionId);
}

// #endregion

// #region 登录 / 鉴权

/**
 * 登录。`passkey` 是**前端算好的 SHA-256 十六进制**（与 FFBox 一致，明文口令不上线）。
 * 空口令的账号直接放行（对应「无密码访问」）。
 */
export function login(username: string, passkey: string): LoginResult {
	const user = getUsers().find((u) => u.username === (username ?? ''));
	if (!user) {
		logMsg(`[Auth] 登录失败：用户不存在（username=${JSON.stringify(username ?? '')}）`);
		return { isUserExist: false, isSuccess: false };
	}
	if (user.passkey && user.passkey !== (passkey ?? '')) {
		logMsg(`[Auth] 登录失败：密码错误（username=${JSON.stringify(user.username)}）`);
		return { isUserExist: true, isSuccess: false };
	}
	const sessionId = createSession(user.username, user.permissions);
	logMsg(`[Auth] 登录成功：${user.username || '(管理员)'}，权限 ${JSON.stringify(user.permissions)}`);
	return { isUserExist: true, isSuccess: true, sessionId, permissions: [...user.permissions] };
}

/**
 * 解析一次请求的登录态。
 * @returns 通过 → AuthInfo；不通过 → null（调用方回 401）
 *
 * 三条路径（照抄 FFBox 的 optionalAuth）：
 *   ① 带 Bearer sessionId 且有效 → 该用户的身份
 *   ② 带 Bearer 但无效 → 拒绝（**不能**回落到匿名，否则「会话过期」会被悄悄放行）
 *   ③ 没带 → 管理员无密码时按匿名管理员放行，否则拒绝
 */
export function resolveAuth(authorizationHeader: string | string[] | undefined): AuthInfo | null {
	const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
	const token = raw?.startsWith('Bearer ') ? raw.slice(7) : '';
	if (token) {
		const session = sessions.get(token);
		if (!session) return null;
		return { username: session.username, permissions: session.permissions };
	}
	if (isPasswordlessAllowed()) return { username: '', permissions: [...ALL_PERMISSIONS], anonymous: true };
	return null;
}

export function hasPermission(auth: AuthInfo | null, permission: Permission): boolean {
	return !!auth && auth.permissions.includes(permission);
}

// #endregion
