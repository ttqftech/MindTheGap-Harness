/* ---------- 用户管理 Tab — 服务端组 ---------- */

import { createSignal, onMount, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { hasPermission } from '@mainview/stores';
import { PERMISSION_LABELS } from '@shared/agent';
import type { UserConfig } from '@shared/agent';
import { sha256Hex } from '@shared/sha256';
import { getUsers, setUsers as saveUsers } from '@mainview/bridges/agentBridge';
import common from './SettingsCommon.module.css';
import styles from './UsersTab.module.css';

/**
 * 用户管理（本项目只开放这一个权限项，见 `shared/agent.ts` §11）。
 *
 * 规则照抄 FFBox：
 *   · 空用户名 = 管理员账号（不可改名 / 不可删除）
 *   · 密码只存 SHA-256；界面上既不显示明文也不显示摘要，输入新密码才会覆盖（输入框留空 = 不动）
 *   · 新用户默认无权限
 *   · 改了自己的权限要重新登录才生效（提示，不强制踢下线）
 */
export function UsersTab() {
	const [users, setUserList] = createStore<UserConfig[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [saving, setSaving] = createSignal(false);
	/** 行内提示（保存结果 / 校验失败），不弹窗打扰 */
	const [notice, setNotice] = createSignal<{ level: 'ok' | 'error'; text: string } | null>(null);

	const canEdit = () => hasPermission('userManagement');

	onMount(async () => {
		const list = await getUsers();
		setUserList(list.map((u) => ({ ...u, permissions: [...u.permissions] })));
		setLoading(false);
	});

	/** 密码输入框失焦：非空才算「改密码」，空则保持原样（要清空密码请显式点「清除」） */
	const applyPassword = (index: number, plain: string) => {
		if (!plain) return;
		setUserList(index, 'passkey', sha256Hex(plain));
	};

	const addUser = () => {
		let n = 1;
		while (users.some((u) => u.username === `user${n}`)) n++;
		setUserList(users.length, { username: `user${n}`, passkey: '', permissions: [] });
	};

	const removeUser = (index: number) => {
		setUserList((list) => list.filter((_, i) => i !== index));
	};

	const togglePermission = (index: number) => {
		const has = users[index].permissions.includes('userManagement');
		setUserList(index, 'permissions', has ? [] : ['userManagement']);
	};

	const save = async () => {
		// 先做本地校验：空用户名只允许一个（= 管理员），重名会让登录找到第一个而「另一个永远登不上」
		const names = users.map((u) => u.username);
		if (names.filter((n) => n === '').length > 1) {
			setNotice({ level: 'error', text: '只允许一个空用户名的管理员账号' });
			return;
		}
		if (new Set(names).size !== names.length) {
			setNotice({ level: 'error', text: '用户名不能重复' });
			return;
		}
		if (names.some((n) => n !== n.trim())) {
			setNotice({ level: 'error', text: '用户名首尾不能有空格' });
			return;
		}

		setSaving(true);
		const result = await saveUsers(JSON.parse(JSON.stringify(users)) as UserConfig[]);
		setSaving(false);
		if (!result.ok) {
			setNotice({ level: 'error', text: `保存失败：${result.error ?? '权限不足或网络错误'}` });
			return;
		}
		setNotice({ level: 'ok', text: '用户配置已保存。若修改了自身权限，需重新登录才能生效。' });
	};

	return (
		<div>
			<div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '12px' }}>
				<div>
					<div class={common['settingGroup-label']}>用户</div>
					<div class={common['settingGroup-desc']}>
						空用户名 = 管理员（无密码时可空账号登录）。密码只保存 SHA-256 摘要。
					</div>
				</div>
				<Show when={canEdit()}>
					<ffbox-button onclick={addUser}>+ 添加用户</ffbox-button>
				</Show>
			</div>

			<Show when={!canEdit()}>
				<div class={common['settingGroup-desc']} style={{ 'margin-bottom': '10px' }}>
					当前账号没有「用户管理」权限，只能查看。
				</div>
			</Show>

			<Show when={loading()}>
				<div class={common['settingGroup-desc']}>正在读取用户列表…</div>
			</Show>

			<Show when={!loading()}>
				<div class={styles.userTable}>
					<div class={`${styles.row} ${styles.head}`}>
						<span>用户名</span>
						<span>密码</span>
						<span>权限</span>
						<span>操作</span>
					</div>
					<For each={users}>
						{(user, index) => {
							const isAdmin = () => user.username === '';
							return (
								<div class={styles.row}>
									<span>
										<Show
											when={!isAdmin()}
											fallback={<span class={styles.admin} title="空用户名 = 管理员">（管理员）</span>}
										>
											<input
												class={styles.input}
												value={user.username}
												disabled={!canEdit()}
												oninput={(e) => setUserList(index(), 'username', e.currentTarget.value)}
											/>
										</Show>
									</span>
									<span class={styles.pass}>
										<input
											class={styles.input}
											type="password"
											placeholder={user.passkey ? '已设置 · 留空不改' : '未设置'}
											disabled={!canEdit()}
											onblur={(e) => {
												applyPassword(index(), e.currentTarget.value);
												e.currentTarget.value = '';
											}}
										/>
										<Show when={canEdit() && user.passkey}>
											<button class={styles.link} onclick={() => setUserList(index(), 'passkey', '')}>
												清除
											</button>
										</Show>
									</span>
									<span class={styles.perm}>
										<label>
											<input
												type="checkbox"
												checked={user.permissions.includes('userManagement')}
												disabled={!canEdit()}
												onchange={() => togglePermission(index())}
											/>
											{PERMISSION_LABELS.userManagement}
										</label>
									</span>
									<span>
										<Show when={canEdit() && !isAdmin()}>
											<button class={styles.link} onclick={() => removeUser(index())}>
												删除
											</button>
										</Show>
									</span>
								</div>
							);
						}}
					</For>
				</div>

				<Show when={notice()}>
					<div
						class={styles.notice}
						style={{ color: notice()!.level === 'ok' ? 'var(--success)' : 'var(--danger)' }}
					>
						{notice()!.text}
					</div>
				</Show>

				<div style={{ display: 'flex', gap: '10px', 'margin-top': '14px' }}>
					<Show when={canEdit()}>
						<ffbox-button type="primary" onclick={() => void save()}>
							{saving() ? '保存中…' : '保存'}
						</ffbox-button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
