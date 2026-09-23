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
