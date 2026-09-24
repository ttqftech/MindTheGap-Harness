// 前后端共享的纯函数工具（避免前端 import 后端 src/bun 造成类型混杂）

import type { Folder } from './agent';

export function getTimeString(date: Date, showMs = true): string {
	return `${date.getFullYear()}-${(date.getMonth() + 1 + '').padStart(2, '0')}-${(date.getDate() + '').padStart(2, '0')} ${(date.getHours() + '').padStart(2, '0')}:${(date.getMinutes() + '').padStart(2, '0')}:${(date.getSeconds() + '').padStart(2, '0')}${showMs ? '.' + (date.getMilliseconds() + '').padStart(3, '0') : ''}`;
}

/**
 * 文件夹的显示名：只取路径最后一段（`D:\code\foo` → `foo`）。
 * 刻意不落成字段 —— 文件夹没有可自定义的名字，界面上也不该显示完整路径。
 */
export function folderLabel(folder: Folder): string {
	if (folder.isLocal || !folder.path) return '本地';
	return folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path;
}

/**
 * 路径归一化，**只用于比较**（不是用来当 id 的）。
 * 去首尾空白、去结尾分隔符、统一分隔符方向；Windows 绝对路径（`C:\x` / UNC）再转小写。
 */
export function normalizeFolderPath(path: string): string {
	const trimmed = path.trim().replace(/[\\/]+$/, '').replace(/[\\/]+/g, '\\');
	const isWindowsPath = /^[a-zA-Z]:\\/.test(trimmed) || trimmed.startsWith('\\\\');
	return isWindowsPath ? trimmed.toLowerCase() : trimmed;
}

/**
 * 两个路径是否指向同一个目录。
 *
 * 存在的理由：用户在「+ 添加文件夹…」里把**同一个目录**选第二次时，`addFolder()` 会返回 null
 * （它只负责「加进列表」，返回 null 表示已经在了）。如果调用方把 null 当成「什么都不用做」，
 * 这次点击就静默失效了 —— 用户的意图明明是「把这个会话放进这个目录」。
 */
export function sameFolderPath(a: string, b: string): boolean {
	return normalizeFolderPath(a) === normalizeFolderPath(b);
}
