export function getTimeString(date: Date, showMs = true): string {
	return `${date.getFullYear()}-${(date.getMonth() + 1 + '').padStart(2, '0')}-${(date.getDate() + '').padStart(2, '0')} ${(date.getHours() + '').padStart(2, '0')}:${(date.getMinutes() + '').padStart(2, '0')}:${(date.getSeconds() + '').padStart(2, '0')}${showMs ? '.' + (date.getMilliseconds() + '').padStart(3, '0') : ''}`;
}

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
 * @param s 待解析的 JSON 字符串
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
