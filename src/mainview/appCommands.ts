/**
 * 外壳级命令 —— 标题栏菜单、侧边栏、全局快捷键共用的动作
 *
 * 放在一处的原因：同一个命令会从多个入口触发（如「新建任务」在菜单和侧边栏都有），
 * 各自抄一份必然走岔（历史教训：选文件夹的两条路径就有一处漏了错误提示）。
 */

import { actions, state } from './store';
import { requestFolderPath, shell, getEnvInfo } from './localBridge';
import { alertMsgbox } from './ffboxBridge';
import { setTheme } from './theme/theme';
import type { ThemeMode } from './theme/theme';
import { sameFolderPath } from '@shared/utils';

/**
 * 切换深浅色。
 * ⚠️ 两处都要写：theme.ts 负责「真正应用 + 被启动加载页读取的 key」，
 *    store.themeMode 是设置页与界面的真相源。只写一边会出现「切了但设置页没变」。
 */
export function setAppTheme(mode: ThemeMode) {
	actions.setThemeMode(mode);
	setTheme(mode);
}

/** 新建会话：只把界面切成空白态，**不建后端会话**。文件夹同理：空白态里选的目录只存在前端（`state.draftFolder`），发首句时才 `addFolder()` */
export function newConversation() {
	actions.newConversation();
}

/**
 * 选一个目录并加进文件夹列表；选中后顺手展开。
 * ⚠️ 同一目录选第二次时 `addFolder()` 返回 null（它只负责「加进列表」），
 *    这时必须复用已有的那个，否则这次点击看着像没反应。
 */
export async function addFolderViaDialog(): Promise<string | null> {
	try {
		const { path, error } = await requestFolderPath();
		if (error) {
			// 拿不到路径（对话框调不起来 / RPC 没接通）和「用户按了取消」长得一样，必须报出来
			void alertMsgbox('添加文件夹失败', error);
			return null;
		}
		if (!path) return null;	// 用户取消
		const folder = state.folders.find((f) => sameFolderPath(f.id, path)) ?? actions.addFolder(path);
		return folder?.id ?? null;
	} catch (err) {
		console.error('[appCommands] 添加文件夹出错', err);
		void alertMsgbox('添加文件夹失败', String((err as Error)?.message ?? err));
		return null;
	}
}

/* ---------- 编辑菜单：全都作用在「当前聚焦的可编辑元素」上 ---------- */

/** 复制选中内容（交给浏览器默认实现） */
export function editCopy() {
	document.execCommand('copy');
}

/**
 * 粘贴：读系统剪贴板后用 insertText 插到光标处。
 * 用 execCommand('insertText') 而不是直接改 value —— 前者会派发 input 事件，
 * Solid 绑定的 oninput 才会跑，输入框状态不会和界面脱节。
 */
export async function editPaste() {
	try {
		const text = await navigator.clipboard.readText();
		if (!text) return;
		document.execCommand('insertText', false, text);
	} catch (err) {
		void alertMsgbox('粘贴失败', `读剪贴板被拒绝：${String((err as Error)?.message ?? err)}`);
	}
}

/** 全选（聚焦在输入框时全选输入框，否则全选页面） */
export function editSelectAll() {
	document.execCommand('selectAll');
}

/* ---------- 帮助菜单 ---------- */

export async function showAbout() {
	const env = await getEnvInfo();
	const lines = [
		`版本：${env?.appVersion ?? '未知'}`,
		`构建：${buildInfo.gitCommit}${buildInfo.isDev ? '（开发构建）' : ''}`,
		`平台：${env ? `${env.platform} ${env.arch}` : '未知'}`,
		`系统：${env?.osVersion ?? '未知'}`,
		`数据目录：${env?.userDataPath ?? '未知'}`,
		'',
		'请小心间隙！Please Mind The Gap！',
	];
	void alertMsgbox('MindTheGap-Harness', lines.join('\n'), '知道了');
}

export async function openUserDataDir() {
	const env = await getEnvInfo();
	if (!env?.userDataPath) {
		void alertMsgbox('打开数据目录失败', '拿不到用户数据目录路径');
		return;
	}
	await shell.openPath(env.userDataPath);
}
