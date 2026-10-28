// 前后端共享的纯函数工具（避免前端 import 后端造成类型混杂）
// logMsg / safeParseJson 原在 src/bun/utils.ts；Service 拆成独立进程后，主进程壳（src/desktop）与 Service（src/service）都要用，挪到共享层。

import type { Folder } from './agent';

/** 带时间戳的日志（绿色）；logMsg.error 走红色 + console.error */
export function logMsg(...content: any[]): void {
	console.log(`\x1b[32m${getTimeString(new Date())}\x1b[0m`, ...content);
}
logMsg.error = function (...content: any[]) {
	console.error(`\x1b[31m${getTimeString(new Date())}\x1b[0m`, ...content);
}

/**
 * 安全地解析 JSON 字符串为对象。
 *
 * 当输入为空或解析失败时不会抛出异常，而是返回空对象，
 * 从而保证调用方在处理不完整/畸形 JSON（例如流式输出被截断）时仍能稳定运行。
 *
 * 解析策略：
 * 1. 输入为空字符串时直接返回 `{}`；
 * 2. 优先尝试标准 `JSON.parse`；
 * 3. 若失败，则尝试修复：截断到最后一个完整的 `}`，再解析一次
 *    （适用于尾部被截断、但前缀仍是合法 JSON 对象的场景）；
 * 4. 修复仍失败时返回 `{}`。
 *
 * @param s 待解析的字符串
 * @returns 解析得到的对象，失败时返回空对象
 */
export function safeParseJson(s: string): Record<string, unknown> {
	if (!s) return {};
	try {
		return JSON.parse(s);
	} catch {
		// 尝试修复：截断到最后一个完整的 }
		const lastBrace = s.lastIndexOf('}');
		if (lastBrace > 0) {
			try {
				return JSON.parse(s.slice(0, lastBrace + 1));
			} catch {
				/* ignore */
			}
		}
		return {};
	}
}

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
