#!/usr/bin/env node
/* ==========================================================================
   最简单的 MCP 服务器：sine（求正弦）

   - 零依赖，只用 Node 标准库
   - 传输：stdio（stdin 收 JSON-RPC，stdout 回 JSON-RPC，一行一条）
   - 工具：sine —— 计算 sin(x)，支持弧度(rad)与角度(deg)

   ⚠️ 关键约束：stdout 是协议通道，绝对不能用 console.log 打日志，
      调试信息一律走 console.error（stderr），否则会污染 JSON-RPC 流。

   手动自测：
       echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' | node index.js
   ========================================================================== */

const PROTOCOL_VERSION = '2024-11-05';

const SERVER_INFO = {
	name: 'sine-mcp',
	version: '1.0.0',
};

/* ---------- 工具定义 ---------- */

const TOOLS = [
	{
		name: 'sine',
		title: '正弦函数',
		description:
			'计算正弦值 sin(x)。' +
			'angle 为数值；unit 为 "rad"（弧度，默认）或 "deg"（角度）。' +
			'例如求 30 度的正弦，传 {"angle": 30, "unit": "deg"}，结果为 0.5。',
		inputSchema: {
			type: 'object',
			properties: {
				angle: {
					type: 'number',
					description: '角度或弧度数值',
				},
				unit: {
					type: 'string',
					enum: ['rad', 'deg'],
					description: '单位：rad 弧度（默认） / deg 角度',
				},
			},
			required: ['angle'],
			additionalProperties: false,
		},
	},
];

/** 执行工具调用，返回 MCP 规定的 CallToolResult */
function callSine(args) {
	const raw = args?.angle;
	const unit = args?.unit === 'deg' ? 'deg' : 'rad';

	// 允许字符串形式的数字：LLM 偶尔会把参数写成 "0.5"
	const angle = typeof raw === 'string' ? Number(raw) : raw;
	if (typeof angle !== 'number' || Number.isNaN(angle)) {
		return {
			content: [{ type: 'text', text: '参数错误：angle 必须是一个数字' }],
			isError: true,
		};
	}

	const radians = unit === 'deg' ? (angle * Math.PI) / 180 : angle;
	const value = Math.sin(radians);

	const text = `sin(${angle}${unit === 'deg' ? '°' : ' rad'}) = ${value}`;
	return {
		content: [{ type: 'text', text }],
		structuredContent: { angle, unit, radians, value },
		isError: false,
	};
}

function callTool(params) {
	const name = params?.name;
	const args = params?.arguments ?? {};

	if (name === 'sine') return callSine(args);

	return {
		content: [{ type: 'text', text: `未知工具: ${name}` }],
		isError: true,
	};
}

/* ---------- JSON-RPC 分发 ---------- */

function handleRequest(msg) {
	const { id, method, params } = msg;

	switch (method) {
		case 'initialize':
			return {
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: { listChanged: false } },
					serverInfo: SERVER_INFO,
				},
			};

		case 'tools/list':
			return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

		case 'tools/call':
			return { jsonrpc: '2.0', id, result: callTool(params) };

		case 'ping':
			return { jsonrpc: '2.0', id, result: {} };

		// 没有实现资源 / 提示词，返回空列表让客户端不至于报错
		case 'resources/list':
			return { jsonrpc: '2.0', id, result: { resources: [] } };
		case 'prompts/list':
			return { jsonrpc: '2.0', id, result: { prompts: [] } };

		default:
			// 通知类消息（notifications/*）没有 id，不需要响应
			if (id === undefined) return null;
			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32601, message: `Method not found: ${method}` },
			};
	}
}

/* ---------- stdio 主循环 ---------- */

let buffer = '';

process.stdin.setEncoding('utf-8');

process.stdin.on('data', (chunk) => {
	buffer += chunk;

	let newlineIndex;
	while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
		const line = buffer.slice(0, newlineIndex).trim();
		buffer = buffer.slice(newlineIndex + 1);
		if (!line) continue;

		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			console.error(`[sine-mcp] 忽略非法 JSON: ${line.slice(0, 200)}`);
			continue;
		}

		const response = handleRequest(msg);
		// 通知（如 notifications/initialized）不响应
		if (response) process.stdout.write(JSON.stringify(response) + '\n');
	}
});

process.stdin.on('close', () => {
	console.error('[sine-mcp] stdin 关闭，退出');
	process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

console.error('[sine-mcp] 已启动，等待 JSON-RPC 请求...');
