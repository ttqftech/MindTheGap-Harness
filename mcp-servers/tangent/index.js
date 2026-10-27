#!/usr/bin/env node
/* ==========================================================================
   最简单的 HTTP MCP 服务器：tangent（求正切）

   - 零依赖，只用 Node 标准库
   - 传输：Streamable HTTP（POST JSON-RPC，响应 JSON）
     ⚠️ 客户端（src/bun/mcp/client.ts）是一问一答：一个请求一个 POST、一个往返，
        不开 SSE 长连接，所以这里也不做服务端推送。
   - 工具：tangent —— 计算 tan(x)，支持弧度(rad)与角度(deg)

   和 stdio 版（sine）的两处差别：
   1. initialize 的响应要带 mcp-session-id 头 —— 客户端会存下来后续回带。
   2. 自己监听端口，父进程没了收不到 stdin 关闭信号，所以这里也监听 stdin close：
      被本应用托管时父进程退出能跟着退，不至于变成占着端口的孤儿进程。

   手动自测：
       node index.js
       curl -s -X POST http://127.0.0.1:3927/mcp -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ========================================================================== */

import http from 'node:http';

const PROTOCOL_VERSION = '2024-11-05';
const PORT = Number(process.env.TANGENT_MCP_PORT ?? 3927);
const SESSION_ID = 'tangent-session';

const SERVER_INFO = {
	name: 'tangent-mcp',
	version: '1.0.0',
};

/* ---------- 工具定义 ---------- */

const TOOLS = [
	{
		name: 'tangent',
		title: '正切函数',
		description:
			'计算正切值 tan(x)。' +
			'angle 为数值；unit 为 "rad"（弧度，默认）或 "deg"（角度）。' +
			'例如求 45 度的正切，传 {"angle": 45, "unit": "deg"}，结果为 1。',
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
function callTangent(args) {
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
	const value = Math.tan(radians);

	const text = `tan(${angle}${unit === 'deg' ? '°' : ' rad'}) = ${value}`;
	return {
		content: [{ type: 'text', text }],
		structuredContent: { angle, unit, radians, value },
		isError: false,
	};
}

function callTool(params) {
	const name = params?.name;
	const args = params?.arguments ?? {};

	if (name === 'tangent') return callTangent(args);

	return {
		content: [{ type: 'text', text: `未知工具: ${name}` }],
		isError: true,
	};
}

/* ---------- JSON-RPC 分发 ---------- */

/** @returns 响应对象；通知类消息返回 null（HTTP 下回 202 空体） */
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

/* ---------- HTTP 主循环 ---------- */

const server = http.createServer((req, res) => {
	if (req.method !== 'POST') {
		res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
		res.end('tangent-mcp: 只接受 POST JSON-RPC\n');
		return;
	}

	let body = '';
	req.on('data', (chunk) => {
		body += chunk;
		if (body.length > 1024 * 1024) req.destroy();
	});

	req.on('end', () => {
		let msg;
		try {
			msg = JSON.parse(body);
		} catch {
			console.error(`[tangent-mcp] 忽略非法 JSON: ${body.slice(0, 200)}`);
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
			return;
		}

		const response = handleRequest(msg);
		if (response === null) {
			res.writeHead(202).end();
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'application/json',
			'mcp-session-id': SESSION_ID,
		});
		res.end(JSON.stringify(response));
	});
});

server.on('error', (err) => {
	console.error(`[tangent-mcp] 监听失败: ${err.message}`);
	process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
	console.error(`[tangent-mcp] 已启动，端口 ${PORT}`);
});

process.stdin.on('close', () => {
	console.error('[tangent-mcp] stdin 关闭，退出');
	process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
