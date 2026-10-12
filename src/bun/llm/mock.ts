/* ==========================================================================
   内置 mock LLM —— 把「假模型」搬进后端进程（开发用）

   为什么留一个**真的 HTTP + SSE 服务**（而不是直接返回 LlmCallResult）：
   - mock 的价值一半在覆盖 **解析层**。这个项目被「usage 末块 `choices: []`」「reasoning_content」「并行 tool_calls 参数分片」坑过好几次，那些 bug 只有在真 SSE 字节流经过 `parseSseStream` 时才会暴露。直接合成结果会让这层失去覆盖。
   - 顺带零成本：`genStreamUrl(baseUrl, 'chat/completions')` 只做「去尾斜杠 + 补 /v1」，`Authorization` 它也不看，所以只要把 baseUrl 指过来就行，传输层一行都不用改。

   ⚠️ 它只 mock **LLM**，工具是**真执行**的（`web_fetch` 会真发请求，`write_file` 会真写盘）。这是故意的：要验的就是真实工具链路。所以别在 mock 模式下让它跑危险剧本。

   剧本按**请求内容**判断（不是按调用次数），分支有顺序依赖：
     - `tools` 为空                        → 反思请求，回哨兵「无」（reflect 剧本回真追问）
     - system 里有「相关性评审器」          → web_search 的打分请求，回分数对象
     - multi / task / sine 剧本            → 按 toolResults 计数分轮，可以连续发多个工具
     - 历史里已有 tool 结果                 → 回纯文本结论（见下方 ⚠️）
     - 其余                                → 发一个 web_fetch 工具调用（由 runner 真去执行）

   ⚠️ 「历史里已有 tool 结果」这一支的口径是**整个消息历史**里有没有 `role:'tool'`，
   不是「本轮有没有新结果」—— 命中一次之后就对该会话永久生效，之后每轮新提问都只回文本、不再发工具。
   这是 mock 的行为、不是产品 bug，输出文本里会显式把这件事讲出来；要验多轮发工具请用 multi / task 剧本。
   ========================================================================== */

import { createServer, type Server } from 'node:http';
import { logMsg } from '../utils';

/** loopback 端口，沿用命令行版 mock 的习惯值 */
const MOCK_PORT = 18998;

/** 可选剧本（前端下拉用）。label 是给人看的中文说明 */
export const MOCK_SCENARIOS: { id: string; label: string }[] = [
	{ id: 'web', label: 'web：抓一个真实网页（默认）' },
	{ id: 'text', label: 'text：纯长文本（验流式）' },
	{ id: 'delegate', label: 'delegate：委托一个子 Agent' },
	{ id: 'code_web', label: 'code_web：委托 + 多引擎搜索' },
	{ id: 'ask_user', label: 'ask_user：提问卡片' },
	{ id: 'multi', label: 'multi：多轮工具 + 提问 + 收尾' },
	{ id: 'reflect', label: 'reflect：反思给出真追问' },
	{ id: 'task', label: 'task：任务清单读写（add→read→update→read）' },
	{ id: 'web_search', label: 'web_search：多引擎搜索' },
	{ id: 'sine', label: 'sine：调用内置正弦 MCP（mcp__sine__sine）' },
];

/** 进程启动时可被环境变量钉住（headless 场景用），之后可由设置覆盖 */
let currentScenario = process.env.MOCK_SCENARIO ?? 'web';

/** 由调用方（http-server 读设置后）在每次请求前设置 */
export function setMockScenario(scenario: string): void {
	currentScenario = scenario || 'web';
}

export function getMockScenario(): string {
	return currentScenario;
}

let server: Server | null = null;

/**
 * 确保 mock 服务已监听，返回它的 baseUrl（多次调用只起一次）。
 * 懒启动：只有真的开到 mock 模式才会占这个端口。
 */
export function ensureMockServer(): string {
	if (!server) {
		server = createServer(handleRequest);
		server.listen(MOCK_PORT, '127.0.0.1', () => {
			logMsg(`[MockLlm] 已监听 http://127.0.0.1:${MOCK_PORT}（LLM 走 mock，工具仍真实执行）`);
		});
	}
	return `http://127.0.0.1:${MOCK_PORT}`;
}

// #region 响应构造

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LONG_TEXT = `好的，我来说明一下。

首先，这是一段被刻意拉长的回复，用来验证**流式输出**是否真的逐块到达前端，
而不是等模型全部生成完之后一次性整块冒出来。如果流式生效，你应该能看到文字
一段一段地往外长，而不是卡很久然后突然出现一整坨。

其次，这段文字会分成很多个小块下发，每块之间还有几十毫秒的间隔，
这样在界面上就能明显看出「正在生成」的过程。

最后，验证结束。（这是内置 mock 生成的测试文本，不代表真实模型输出。）`;

/** 每次请求的用量都不同（递增），这样前端的「累加」对不对一眼就能看出来 */
let requestSeq = 0;
function nextUsage() {
	requestSeq += 1;
	const prompt = 1000 + requestSeq * 100;
	const completion = 100 + requestSeq * 10;
	return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

type MockRes = import('node:http').ServerResponse;

/** 往 SSE 里写一个 delta 块 */
function chunk(res: MockRes, delta: Record<string, unknown>, finish: string | null = null) {
	res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}

function sseHead(res: MockRes) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});
}

/** 吐一段流式文本（可带思考增量），最后补 usage 末块 */
async function streamText(res: MockRes, text: string, reasoning?: string) {
	sseHead(res);
	if (reasoning) {
		for (const piece of reasoning.match(/.{1,10}/g) ?? []) {
			chunk(res, { reasoning_content: piece });
			await sleep(100);
		}
	}
	for (const piece of text.match(/.{1,10}/g) ?? []) {
		chunk(res, { content: piece });
		await sleep(100);
	}
	chunk(res, {}, 'stop');
	// ⚠️ 带 usage 的末块：`choices` 为空 —— 解析器必须认它，否则流式下 token 用量永远是 0
	res.write(`data: ${JSON.stringify({ choices: [], usage: nextUsage() })}\n\n`);
	res.write('data: [DONE]\n\n');
	res.end();
}

/** 发一个工具调用（参数按 10 字符分片，验 runner 侧的累积） */
async function streamToolCall(res: MockRes, name: string, args: unknown, reasoning?: string) {
	sseHead(res);
	if (reasoning) {
		for (const piece of reasoning.match(/.{1,10}/g) ?? []) {
			chunk(res, { reasoning_content: piece });
			await sleep(100);
		}
	}
	const id = 'call_mock_' + Date.now();
	chunk(res, { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] });
	for (const piece of JSON.stringify(args).match(/.{1,10}/g) ?? []) {
		chunk(res, { tool_calls: [{ index: 0, function: { arguments: piece } }] });
		await sleep(60);
	}
	chunk(res, {}, 'tool_calls');
	res.write(`data: ${JSON.stringify({ choices: [], usage: nextUsage() })}\n\n`);
	res.write('data: [DONE]\n\n');
	res.end();
}

// #endregion

// #region 剧本

interface MockRequest {
	messages: { role?: string; content?: unknown }[];
	tools: unknown[];
	stream?: boolean;
}

async function handleRequest(req: import('node:http').IncomingMessage, res: MockRes) {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', async () => {
		let parsed: MockRequest = { messages: [], tools: [] };
		try {
			parsed = JSON.parse(body || '{}') as MockRequest;
		} catch {
			// 解析不了就当空请求，走默认剧本
		}
		const msgs = parsed.messages ?? [];
		const tools = parsed.tools ?? [];
		const hasToolResult = msgs.some((m) => m.role === 'tool');
		const lastUser = String([...msgs].reverse().find((m) => m.role === 'user')?.content ?? '');
		const systemText = msgs.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
		/**
		 * 子 Agent 识别：它收到的首条 user 消息带这个前缀（见 runner.createInstance）。
		 * 用它替代命令行版里的模块级 `delegateIssued` 旗标 —— 那样在多个会话/多轮之间会串味。
		 */
		const isSubAgent = msgs.some((m) => m.role === 'user' && String(m.content).startsWith('[来自父 Agent 的任务]'));

		logMsg(
			`[MockLlm] scenario=${currentScenario} tools=${tools.length} msgs=${msgs.length} ` +
			`toolResults=${msgs.filter((m) => m.role === 'tool').length} sub=${isSubAgent} ` +
			`lastUser=${JSON.stringify(lastUser.slice(0, 30))}`,
		);

		await sleep(1000);

		if (parsed.stream !== true) {
			// 没走流式时的兜底（便于对比差异）
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				choices: [{ index: 0, message: { role: 'assistant', content: '（内置 mock 的非流式兜底）' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}));
			return;
		}

		// 0) 纯长文本剧本
		if (currentScenario === 'text') {
			await streamText(res, LONG_TEXT, '先想一下怎么把这段话分成很多小块发出去。');
			return;
		}

		// 0.5) web_search 的相关性打分请求（无工具，靠 system 文本区分）
		if (tools.length === 0 && /相关性评审器|link1/.test(systemText + lastUser)) {
			const count = (lastUser.match(/^- link\d+/gm) ?? []).length || 3;
			const scores: Record<string, number> = {};
			for (let i = 1; i <= count; i++) scores[`link${i}`] = i <= 2 ? 9 - i * 0.5 : 2;
			await streamText(res, JSON.stringify(scores), '按 relevance 给每条候选打分，靠前的给高分。');
			return;
		}

		// 1) 反思请求（无工具）：默认回哨兵「无」，验证「无追问则直接收尾」
		if (tools.length === 0) {
			if (currentScenario === 'reflect') {
				await streamText(res, '1. 你还没有把结果告诉用户，请补上。', '再挑一条要补做的事。');
				return;
			}
			await streamText(res, '无', '快速核对了总结，没有影响答案正确性的遗漏。');
			return;
		}

		// 1.5) 多轮工具调用 + 提问（放在「有工具结果 → 给结论」之前，否则第二轮会被它拦掉）
		if (currentScenario === 'multi') {
			const toolResults = msgs.filter((m) => m.role === 'tool').length;
			if (toolResults === 0) {
				await streamToolCall(res, 'web_fetch', { url: 'https://ipinfo.io/json', reason: '先查公网 IP' }, '先确认环境。');
				return;
			}
			if (toolResults === 1) {
				await streamToolCall(res, 'web_fetch', { url: 'https://wttr.in/Beijing?format=%l:+%c+%t&lang=zh', reason: '再查天气' }, '再看看天气。');
				return;
			}
			if (toolResults === 2) {
				await streamToolCall(res, 'ask_user', {
					reason: '两次抓取都完成了，请用户决定下一步',
					question: '信息都拿到了，要我汇总成一段话吗？',
					options: [{ label: '汇总', description: '整理成一句话' }, { label: '不用了', description: '就到这儿' }],
				}, '该问用户了。');
				return;
			}
			await streamToolCall(res, 'finish', { reason: '用户已答复', summary: '汇总：公网 IP 与天气都已查到。' }, '收尾。');
			return;
		}

		// 1.6) 任务清单读写：add → add → read → update(done) → read → finish
		// 同样按 toolResults 计数，且必须排在「有工具结果 → 给结论」之前，否则第二轮起就被它拦掉。
		// ⚠️ task_list_write 只在 `mode.taskList.writable` 为 true 时才会进工具表（code 模式是 true，
		// daily / empty 是 false），所以这个剧本要在 **code 模式**下跑，
		// 否则模型侧根本看不到这两个工具，表现为「剧本没生效」而不是报错。
		if (currentScenario === 'task') {
			const toolResults = msgs.filter((m) => m.role === 'tool').length;
			if (toolResults === 0) {
				await streamToolCall(res, 'task_list_write', { op: 'add', item: '第一步：写一条任务，验证清单可写' }, '先加一条，确认清单能写。');
				return;
			}
			if (toolResults === 1) {
				await streamToolCall(res, 'task_list_write', { op: 'add', item: '第二步：再写一条，验证是追加而不是覆盖' }, '再加一条，看是不是追加。');
				return;
			}
			if (toolResults === 2) {
				await streamToolCall(res, 'task_list_read', {}, '读回全文，确认前两次写入都落盘了。');
				return;
			}
			if (toolResults === 3) {
				await streamToolCall(res, 'task_list_write', { op: 'update', index: 0, done: true, item: '第一步：写一条任务，验证清单可写' }, '把第一条标记完成，验 update + index。');
				return;
			}
			if (toolResults === 4) {
				await streamToolCall(res, 'task_list_read', {}, '再读一次，确认 done 标记写进去了。');
				return;
			}
			await streamToolCall(res, 'finish', { reason: '清单的写入、读取、更新都验过了', summary: '任务清单读写通过：add ×2 → read 全文 → update 标记 done → read 复核。' }, '收尾。');
			return;
		}

		// 1.7) 内置正弦 MCP：mcp__sine__sine（30° → 0.5），再 finish 汇总，验 MCP 工具链路
		// ⚠️ mode.json 的 mcp 策略**只管「能不能被看见」**：它过滤的是发给 LLM 的 tools[] 和提示词里的工具清单（getToolsForAgentInstance → mcpToolsFor）。执行层 getTool() 查的是全量动态源，**不过滤能力**。而 mock 是硬编码输出、压根不看 tools 参数
		// 所以这个剧本在 mcp:'none' 下照样跑得通，但那是 mock 的假象：换真模型就看不到这个工具。
		// ⚠️ 工具名前缀来自 settings.mcpServers 里的 **name**（sanitize 后取首个片段），默认 "sine" → mcp__sine__sine；
		// 改过服务器显示名的话前缀会跟着变，剧本里这个硬编码名字也要一起改。
		if (currentScenario === 'sine') {
			const toolResults = msgs.filter((m) => m.role === 'tool').length;
			if (toolResults === 0) {
				await streamToolCall(res, 'mcp__sine__sine', { angle: 30, unit: 'deg', reason: '算一下 30 度的正弦' }, '用户要算正弦，调内置 MCP。');
				return;
			}
			await streamToolCall(res, 'finish', { reason: '正弦值已由 MCP 算出', summary: 'sin(30°) = 0.5，由内置 sine MCP 服务器算出。' }, '拿到结果，收尾。');
			return;
		}

		// 2) 已有工具结果 → 给结论
		// ⚠️ 这个分支的口径是「整个消息历史里出现过 tool 结果」，不是「本轮有没有新结果」，
		// 所以第一轮发过工具之后，后续每一轮新提问都会停在这里只回文本、不再发工具。
		// 这是 mock 的行为，不是产品 bug —— 输出里会显式把这件事讲出来，免得排查时误判。
		if (hasToolResult) {
			const last = String([...msgs].reverse().find((m) => m.role === 'tool')?.content ?? '');
			await streamText(
				res,
				`查到了，结果如下：\n\n${last.slice(0, 300)}\n\n` +
					`———\n` +
					`【mock 口径提示】命中了「历史里已有工具结果 → 直接给结论」分支（mock.ts 的 hasToolResult）。\n` +
					`它判断的是**整个消息历史**里有没有 role:'tool'，不是「本轮有没有新结果」，` +
					`所以第一轮发过工具之后，之后每一轮新提问都会停在这里、只回文本、不再发工具。\n` +
					`要验「多轮连续发工具」，请改用 multi / task 这类按 toolResults 计数的剧本——它们排在本分支之前。\n` +
					`（以上为 mock 数据，仅供链路验证）`,
				'发现历史里已有工具结果，按本分支口径直接给结论，不再发新工具。',
			);
			return;
		}

		// 2.6) code 模式：根 intent 委托 websearch，子 Agent 再发 web_search → 跑通「多引擎 → 打分 → 展开正文」
		if (currentScenario === 'code_web') {
			if (!isSubAgent) {
				await streamToolCall(res, 'delegate', {
					tasks: [{ agentId: 'websearch', task: '查询北京今天的天气，用 web_search 找权威来源并给出结论' }],
					reason: '需要实时外部信息，交给网络搜索 Agent',
				}, '实时信息交给搜索子 Agent。');
				return;
			}
			await streamToolCall(res, 'web_search', { query: '北京 今天 天气', limit: 2, engines: ['bing', 'sogou'], reason: '多引擎搜索北京今天的天气' }, '需要外部事实，先多引擎搜索。');
			return;
		}

		// 2.5) 委托剧本：根 delegate → 子 finish → 父 finish（验「子总结回填到 delegate 的工具输出」）
		// ⚠️ agentId 必须是**插件里真实存在**的子 Agent，否则 delegate 直接失败、根本不会有子实例，
		// 看起来像「界面不渲染子 Agent」，实际是剧本写错了（曾经写死 'weather'，而 code 模式里只有
		// explore / plan / engineer / verify / review / websearch）。
		if (currentScenario === 'delegate') {
			if (!isSubAgent) {
				await streamToolCall(res, 'delegate', {
					tasks: [{ agentId: 'explore', task: '说明一下这个仓库的目录结构' }],
					reason: '先摸清仓库结构，交给探索 Agent',
				}, '先派个子 Agent 摸清结构。');
				return;
			}
			await streamToolCall(res, 'finish', { reason: '任务已完成', summary: '【explore 子 Agent 总结】仓库分三块：src/bun（主进程）、src/mainview（渲染进程）、plugins（插件数据）。' }, '整理成总结返回。');
			return;
		}

		// 3) 提问卡片剧本
		if (currentScenario === 'ask_user') {
			await streamToolCall(res, 'ask_user', {
				reason: '需要用户决定用哪种方案',
				question: '你希望先做 A 还是 B？',
				options: [{ label: '方案 A', description: '先做 A' }, { label: '方案 B', description: '先做 B' }],
			}, '需要用户拍板，先提问。');
			return;
		}

		// 3.5) 多引擎搜索剧本
		if (currentScenario === 'web_search') {
			await streamToolCall(res, 'web_search', { query: '北京 今天 天气', limit: 2, engines: ['bing', 'sogou'], reason: '用多引擎搜索北京今天的天气' }, '需要外部事实，先多引擎搜索再挑正文。');
			return;
		}

		// 4) 默认：按用户问的主题挑一个真实可访问的网址，交给 runner 真去 fetch
		const isWeather = /天气|气温|下雨|温度/.test(lastUser);
		await streamToolCall(
			res,
			'web_fetch',
			isWeather
				? { url: 'https://wttr.in/Beijing?format=%l:+%c+%t+%f+%h+%w&lang=zh', reason: '查询北京天气（紧凑格式）' }
				: { url: 'https://ipinfo.io/json', reason: '查询本机公网 IP 与归属地' },
			isWeather ? '用户问天气，打开 wttr.in 的紧凑格式。' : '用户问 IP，打开 ipinfo.io。',
		);
	});
}

// #endregion
