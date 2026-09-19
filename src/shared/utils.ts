// 前后端共享的纯函数工具（避免前端 import 后端 src/bun 造成类型混杂）

export function getTimeString(date: Date, showMs = true): string {
	return `${date.getFullYear()}-${(date.getMonth() + 1 + '').padStart(2, '0')}-${(date.getDate() + '').padStart(2, '0')} ${(date.getHours() + '').padStart(2, '0')}:${(date.getMinutes() + '').padStart(2, '0')}:${(date.getSeconds() + '').padStart(2, '0')}${showMs ? '.' + (date.getMilliseconds() + '').padStart(3, '0') : ''}`;
}
