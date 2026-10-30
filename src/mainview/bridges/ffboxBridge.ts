/* ==========================================================================
   FFBox-UI 桥接层 — MindTheGap-Harness

   职责：
   1. 统一注册 FFBox-UI 自定义元素（副作用导入，只需在一处做）
   2. 为「命令式组件」（menu / msgbox / popup）提供统一的挂载容器
   3. 包装成更符合本项目习惯的调用形式（如 Promise 版确认框）

   为什么需要挂载容器：
   FFBox-UI 用 @lit/context 传递主题，ContextRoot 挂在 document.body 上。
   命令式组件默认 `document.createElement` 后挂到 document.body，
   这样会脱离 <ffbox-theme-provider> 子树、拿不到主题而退化成浅色。
   因此统一把它们挂在 provider 元素上（见 App.tsx）。
   ========================================================================== */

import 'ffbox-ui';
import {
	FFBoxMenu,
	FFBoxMsgbox,
	FFBoxPopup,
	type MenuOptions,
	type MenuItem,
	type MsgboxOptions,
	type MsgboxButton,
	type PopupOptions,
	type FFBoxMenuHandle,
	type ButtonType,
} from 'ffbox-ui';

export type { MenuItem, MenuOptions, MsgboxOptions, MsgboxButton, PopupOptions, FFBoxMenuHandle };

/* ---------- 挂载容器 ---------- */

let ffboxUIContainer: HTMLElement | undefined;

/** 由 App.tsx 在挂载 <ffbox-theme-provider> 时调用 */
export function setFFBoxContainer(el: HTMLElement | undefined) {
	ffboxUIContainer = el;
}

/** 命令式组件的挂载容器，未设置时退回 document.body */
export function getFFBoxContainer(): HTMLElement {
	return ffboxUIContainer ?? document.body;
}

/* ---------- 命令式菜单 ---------- */

/** 显示菜单（自动带上主题容器） */
export function showMenu(options: MenuOptions): FFBoxMenuHandle {
	return FFBoxMenu.showMenu({ container: getFFBoxContainer(), ...options });
}

/* ---------- 对话框 ---------- */

/** 显示对话框（自动带上主题容器） */
export function showMsgbox(options: MsgboxOptions = {}) {
	return FFBoxMsgbox.show({ container: getFFBoxContainer(), ...options });
}

/**
 * 确认框 —— 替代 window.confirm
 * @returns Promise<true> 表示确认，Promise<false> 表示取消
 */
export function confirmMsgbox(
	title: string,
	content: string,
	confirmText = '确定',
	confirmType: ButtonType = 'danger',
): Promise<boolean> {
	return new Promise((resolve) => {
		showMsgbox({
			title,
			content,
			buttons: [
				{ text: '取消', role: 'cancel', callback: () => resolve(false) },
				{ text: confirmText, type: confirmType, role: 'confirm', callback: () => resolve(true) },
			],
		});
	});
}

/**
 * 提示框 —— 替代 window.alert
 */
export function alertMsgbox(title: string, content: string, buttonText = '知道了'): Promise<void> {
	return new Promise((resolve) => {
		showMsgbox({
			title,
			content,
			buttons: [{ text: buttonText, type: 'primary', role: 'confirm', callback: () => resolve() }],
		});
	});
}

/* ---------- 气泡通知 ---------- */

/** 显示气泡通知（0 白 | 1 绿 | 2 黄 | 3 红） */
export function showPopup(message: string, level: 0 | 1 | 2 | 3 = 0) {
	return FFBoxPopup.show({ message, level });
}
