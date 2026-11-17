/* ==========================================================================
   上下文用量（输入框发送按钮左边的那个小面板）

   **优先用真值**：实例最近一次 LLM 请求的 usage 里有 prompt_tokens 与 completion_tokens
   （`UsageEntry.input` / `UsageEntry.output`，两种协议在 llm 层都已归一：
   OpenAI 的 prompt_tokens 含缓存命中，Anthropic 已在解析时把 input + cache_read + cache_creation 相加）。

   **量的是「下一次请求会装进上下文的东西」**，所以 = 上次 prompt_tokens + 上次 completion_tokens（模型自己的输出会作为历史消息进下一轮）+ 那次调用之后新追加的消息（工具结果 / 反思等，这次还没进过请求）。

   只有**从没跑过请求**的实例（刚建、还没调 LLM）才退回字符估算，界面用 `estimated` 区分（估算值前面带 ≈）。
   ========================================================================== */

import type { AgentCtx, AgentInstance, AgentInstanceMessage, AgentInstanceStatus, UsageEntry } from '@shared/agent';

/** 一张图片在上下文里大致占的 token（OpenAI / Anthropic 高清图基本落在这个量级） */
const IMAGE_TOKENS = 1024;

/**
 * 估算文本 token（适配 o200k_base / gpt-5-codex，仅前端预估算进度条，非精确值、不可计费）
 * 规则：
 *  1. ASCII半角 (U+0000~U+007F)：≈ 0.25 token/字符（4 字符 ≈ 1 token）
 *  2. 普通 CJK 宽字符（常用汉字、日文假名、韩文、全角标点、全角字母）：0.8 token / 字符
 *     示例：今 天 ， 。 Ａ Ｂ Ｃ ひ ら が な 한 국
 *  3. 高危昂贵字符（扩展生僻汉字、ZWJ、组合变音标记、藏 / 泰 / 梵文、大部分 emoji）：按 UTF-8 字节数估算
 *     示例：𰻝、𠀀、👨‍👩‍👧、T̷̨̙̳̼̀ͅe̷̡̹̯̪̽̓s̷̢̫̩̟̽̈́ẗ̷̨̜̬̯̚、བོད་、สวัสดี
 * @param text 输入文本，支持空/undefined/null
 * @returns 预估 token 总数
 */
export function estimateTextTokens(text: string | undefined | null): number {
    if (!text) return 0;

    // 判断是否【昂贵字符】
    function isHighCostWideChar(code: number): boolean {
        return (
            // CJK扩展B/C/D/E 生僻古汉字
            (code >= 0x20000 && code <= 0x2a6df) ||
            (code >= 0x2a700 && code <= 0x2b73f) ||
            (code >= 0x2b740 && code <= 0x2b81f) ||
            (code >= 0x2b820 && code <= 0x2ceaf) ||
            // 私用区
            (code >= 0xf0000 && code <= 0xffffd) ||
            // 组合变音标记（Zalgo文字）
            (code >= 0x0300 && code <= 0x036f) ||
            // ZWJ 零宽连接符（组合emoji）
            code === 0x200d ||
            // 藏文、泰文、天城文
            (code >= 0x0f00 && code <= 0x0fff) ||
            (code >= 0x0e00 && code <= 0x0e7f) ||
            (code >= 0x0900 && code <= 0x097f) ||
            // Emoji / 其他冷门符号平面
            (code >= 0x1f000 && code <= 0x1ffff)
        );
    }

    // 判断是否【普通CJK宽字符（低消耗，o200k合并友好）】
    function isNormalWideChar(code: number): boolean {
        return (
            (code >= 0x4e00 && code <= 0x9fff) ||     // CJK统一汉字
            (code >= 0x3000 && code <= 0x303f) ||     // CJK标点
            (code >= 0x3400 && code <= 0x4dbf) ||     // CJK扩展A
            (code >= 0xff00 && code <= 0xffef) ||     // 全角ASCII/全角符号
            (code >= 0x3040 && code <= 0x30ff) ||     // 日文平假名、片假名
            (code >= 0xac00 && code <= 0xd7af)        // 韩文谚文
        );
    }

    // 单个字符 token 预估
    function estimateSingleCharToken(char: string): number {
        const code = char.codePointAt(0)!;
        // ASCII半角
        if (code <= 0x007f) {
            return 0.25;
        }
        // 高消耗字符，按 UTF8 字节保守估算
        if (isHighCostWideChar(code)) {
            return new Blob([char]).size;
        }
        // 普通 CJK 宽字符
        if (isNormalWideChar(code)) {
            return 0.8;
        }
        // 其余全部兜底：按UTF8字节
        return new Blob([char]).size;
    }

    let total = 0;
    // for...of 自动遍历codepoint，正确处理4字节Unicode（𰻝、复杂emoji）
    for (const char of text) {
        total += estimateSingleCharToken(char);
    }
    return total;
}

function messageTokens(msg: AgentInstanceMessage): number {
	if (msg.uiOnly) return 0;
	let tokens = estimateTextTokens(msg.content) + estimateTextTokens(msg.reasoningContent);
	for (const call of msg.toolCalls ?? []) {
		tokens += estimateTextTokens(call.function.name) + estimateTextTokens(call.function.arguments);
	}
	// 图片不计 base64 字符数（那会失真），按张折算
	tokens += (msg.images?.length ?? 0) * IMAGE_TOKENS;
	return tokens;
}

/**
 * 实例最近一次请求的账本（带 `input` 的那条）**及其所在消息下标**。
 * 从后往前扫：消息是按时间追加的，最后一个带 usage 的消息就是「最后一次调用」。
 * 返回下标是为了把「那次调用之后新追加的消息」也算进用量。
 */
function lastUsageEntry(instance: AgentInstance): { usage: UsageEntry; index: number } | undefined {
	for (let i = instance.messages.length - 1; i >= 0; i--) {
		const usages = instance.messages[i].usages;
		if (!usages?.length) continue;
		const usage = usages[usages.length - 1];
		if (typeof usage.input === 'number') return { usage, index: i };
	}
	return undefined;
}

export interface ContextUsageRow {
	agentInstanceId: string;
	agentName: string;
	depth: number;	// 0 = 根
	status: AgentInstanceStatus;
	tokens: number;
	estimated: boolean;	// true = 该实例还没跑过请求，token 是字符估算，不是 prompt_tokens
	limit?: number;	// 模型配置的上下文窗口（input），没配就没有百分比
	percent?: number;	// 0-100+；limit 缺失时 undefined
}

/**
 * 依次列出根 Agent 与所有子 Agent 的上下文用量。
 * 顺序按父子关系 DFS，和聊天记录里 Agent 的嵌套顺序一致。
 */
export function collectContextUsage(ctx: AgentCtx | null | undefined, limitOf: (modelId: string | undefined) => number | undefined): ContextUsageRow[] {
	if (!ctx) return [];
	const rows: ContextUsageRow[] = [];
	const visit = (id: string) => {
		const instance = ctx.agentInstances[id];
		if (!instance) return;
		const last = lastUsageEntry(instance);
		// 上次请求的真实输入 + 真实输出 + 那次调用之后新追加的消息（工具结果 / 反思等）
		let tokens: number;
		if (last) {
			tokens = (last.usage.input ?? 0) + (last.usage.output ?? 0);
			for (let i = last.index + 1; i < instance.messages.length; i++) {
				tokens += messageTokens(instance.messages[i]);
			}
		} else {
			tokens = instance.messages.reduce((sum, msg) => sum + messageTokens(msg), 0);
		}
		tokens = Math.round(tokens);
		// 上限按「产生这条 usage 的模型」查：历史会话可能换过模型
		const limit = limitOf(last?.usage.model);
		rows.push({
			agentInstanceId: instance.agentInstanceId,
			agentName: instance.agentName,
			depth: instance.depth,
			status: instance.status,
			tokens,
			estimated: !last,
			limit,
			percent: limit && limit > 0 ? (tokens / limit) * 100 : undefined,
		});
		for (const childId of instance.childAgentInstanceIds ?? []) visit(childId);
	};
	visit(ctx.rootAgentInstanceId);
	return rows;
}
