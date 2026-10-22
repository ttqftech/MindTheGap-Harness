import { createSignal } from 'solid-js';
import type { ModelConfig } from '@shared/agent';

// #region 图标

/** 上下文标记（运行文件夹）用的小目录图标 */
export function FolderChipIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		</svg>
	);
}

/** 反思卡片的图标：一个带靶心的圆 */
export function ReflectionIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.2">
			<circle cx="6.5" cy="6.5" r="5.1" />
			<circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

/** MCP 服务图标：两层「服务器」+ 中间一根连线 */
export function McpIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1">
			<rect x="1.6" y="1.8" width="8.8" height="3.2" rx="1" />
			<rect x="1.6" y="7" width="8.8" height="3.2" rx="1" />
			<line x1="3.8" y1="3.4" x2="3.8" y2="8.6" />
		</svg>
	);
}

export function SendIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<line x1="22" y1="2" x2="11" y2="13"/>
			<polygon points="22 2 15 22 11 13 2 9 22 2"/>
		</svg>
	);
}

export function StopIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
			<rect x="6" y="6" width="12" height="12" rx="2"/>
		</svg>
	);
}

// #endregion

// #region 常量

/* 工具入参 / 输出的展示上限：「透明」不等于「无上限」：一条 web_search 的结果动辄几万字符，
   全量渲染会把界面卡死。截断是**渲染层**的事——投影本身给全文，完整内容始终在 ctx 里。 */
export const TOOL_ARGS_LIMIT = 1500;
export const TOOL_OUTPUT_LIMIT = 8000;

/** LLM 用途 → 中文标签。账本里的 purpose 是内部枚举，直接显示用户看不懂 */
export const PURPOSE_LABEL: Record<string, string> = {
	agent_loop: '主循环',
	reflection: '反思',
	ask_child: '询问子 Agent',
	web_rank: '搜索结果打分',
	other: '其他',
};

/** 实例状态 → 中文标签 */
export const STATUS_LABEL: Record<string, string> = {
	running: '进行中',
	pending: '等待中',
	succeeded: '已完成',
	failed: '失败',
	interrupted: '已中断',
};

/**
 * mock 开着时允许没有配置 provider：这份占位配置只是让请求能发出去，
 * 后端会把 baseUrl / apiFormat 覆盖成内置 mock 的（见 `bun/llm/model.ts` 的 mockResolver）。
 */
export const MOCK_PLACEHOLDER_MODEL: ModelConfig = {
	providerId: 'mock',
	modelId: 'mock',
	apiFormat: 'openai-chat',
	baseUrl: '',
	apiKey: 'mock',
	customParams: {},
};

// #endregion

// #region 工具函数

/** 截断到 limit（用于显示） */
export function truncateWithNote(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const head = text.slice(0, Math.floor(limit * 0.8));
	const tail = text.slice(-Math.floor(limit * 0.2));
	return `${head}\n\n…（已省略 ${text.length - head.length - tail.length} 字符）\n\n${tail}`;
}

/** 1234 → "1.2k"：账本里数字位数差别很大，统一压成短形式才不会把一行撑爆 */
export function fmtTokens(n?: number): string {
	if (n === undefined || n === null) return '?';
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(2)}k`;
	if (n < 100000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
}

export function fmtDuration(ms?: number): string {
	if (!ms && ms !== 0) return '';
	return ms < 100 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 秒级心跳：整个 ChatView 共用一份，给「阻塞计时」这类需要自行往前走的显示用 */
export const [clockNow, setClockNow] = createSignal(Date.now());
setInterval(() => setClockNow(Date.now()), 1000);

/** 两位补零 */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 时间戳 → HH:MM:SS（每一块都显示它自己的更新时间） */
export function fmtClock(ts: number | undefined): string {
	if (!ts) return '';
	const d = new Date(ts);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 毫秒 → mm:ss（提问卡的阻塞时长） */
export function fmtElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** 字节数 → "1.2 KB" / "820 B"（MCP 卡的响应行要显示体量） */
export function fmtSize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	return `${(bytes / 1000).toFixed(1)} KB`;
}

/**
 * MCP 工具的命名是 `mcp__<server>__<tool>`（见 `tools.ts` 的注册约定）。
 * 拆开是为了让 MCP 调用按设计稿渲染成「服务名 + 方法」两段。
 */
export function parseMcpName(name: string): { server: string; method: string } | null {
	if (!name.startsWith('mcp__')) return null;
	const rest = name.slice(5);
	const sep = rest.indexOf('__');
	if (sep <= 0) return null;
	return { server: rest.slice(0, sep), method: rest.slice(sep + 2) };
}

// #endregion
