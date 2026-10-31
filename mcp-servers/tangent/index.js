#!/usr/bin/env node
/* ==========================================================================
   最简单的 HTTP MCP 服务器：tangent（求正切）

   - 零依赖，只用 Node 标准库
   - 传输：Streamable HTTP（POST JSON-RPC，响应 JSON）
     ⚠️ 本应用客户端（src/bun/mcp/client.ts）是一问一答：一个请求一个 POST、一个往返。
        这里对 GET 也做了兼容（text/event-stream 给只保活的事件流，普通 GET 给说明页），
        否则部分浏览器类客户端会把探测失败显示成「需要认证」。
   - 工具：tangent —— 计算 tan(x)，支持弧度(rad)与角度(deg)

   和 stdio 版（sine）的两处差别：
   1. initialize 的响应要带 mcp-session-id 头 —— 客户端会存下来后续回带。
   2. 自己监听端口，父进程没了收不到 stdin 关闭信号，所以这里也监听 stdin close：
      被本应用托管时父进程退出能跟着退，不至于变成占着端口的孤儿进程。

   HTTPS：同一份处理函数再挂一个 https 监听（默认 3928），HTTP 照旧 3927，两个并存。
     - 证书走本目录 certs/server.crt + server.key（自签，见 create-cert.mjs 与 README.md）。
     - 证书不存在就只起 HTTP 并打一行提示，不阻塞、不自动生成文件。
     - 开关/路径：TANGENT_MCP_TLS=off 关闭；TANGENT_MCP_TLS_PORT 改端口；
       TANGENT_MCP_TLS_CERT / TANGENT_MCP_TLS_KEY 改证书路径。

   手动自测：
       node index.js
       curl -s -X POST http://127.0.0.1:3927/mcp -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
       curl -sk -X POST https://127.0.0.1:3928/mcp -H 'Content-Type: application/json' \
            -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ========================================================================== */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2024-11-05';
const PORT = Number(process.env.TANGENT_MCP_PORT ?? 3927);
const TLS_PORT = Number(process.env.TANGENT_MCP_TLS_PORT ?? 3928);
const TLS_CERT_PATH = process.env.TANGENT_MCP_TLS_CERT || path.join(HERE, 'certs', 'server.crt');
const TLS_KEY_PATH = process.env.TANGENT_MCP_TLS_KEY || path.join(HERE, 'certs', 'server.key');
const SESSION_ID = 'tangent-session';

/**
 * 监听地址。默认只回环（安全）；要让外网 / 局域网访问必须显式改。
 * 「::」= 双栈（同时收 IPv4 与 IPv6，公网 IPv6 直连用这个）；「0.0.0.0」= 只听 IPv4。
 * ⚠️ 一旦不是回环，务必同时设 TANGENT_MCP_TOKEN —— 否则等于把工具端点公开。
 */
const HOST = process.env.TANGENT_MCP_HOST || '127.0.0.1';

/** 可选的 Bearer 校验：设了才校验（留空 = 无鉴权，保持原来的行为） */
const TOKEN = process.env.TANGENT_MCP_TOKEN || '';


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
					// 客户端带版本就跟着回（2024-11-05 / 2025-03-26 / 2025-06-18 的 tools 部分完全兼容），
					// 免得某些客户端因为「服务器版本比我要的旧」直接判定握手失败
					protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
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

/* ---------- HTTP/HTTPS 共用的请求处理 ---------- */

/**
 * 浏览器类 MCP 客户端（跑在页面里的那种）会先发跨域预检，缺这几个头一定失败，
 * 而且失败理由在客户端界面上经常被笼统显示成「需要认证」。
 * 本机自用、无 Cookie 凭据，直接放行任意 Origin。
 */
function corsHeaders(req) {
	return {
		'Access-Control-Allow-Origin': req.headers.origin ?? '*',
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers':
			'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-Requested-With',
		'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
		'Access-Control-Max-Age': '86400',
	};
}

/** 探测日志：设 TANGENT_MCP_LOG=1 才打，用来事后确认客户端到底发了什么请求 */
function logRequest(req, note) {
	if (!process.env.TANGENT_MCP_LOG) return;
	console.error(
		`[tangent-mcp] ${req.method} ${req.url} → ${note} | accept=${req.headers.accept ?? '-'} ua=${
			req.headers['user-agent'] ?? '-'
		}`,
	);
}

const INFO_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>tangent-mcp</title>
<style>
	body { font: 14px/1.7 system-ui, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #222; }
	h1 { font-size: 18px; margin: 0 0 4px; }
	code, pre { background: #f3f4f6; border-radius: 6px; }
	code { padding: 1px 5px; }
	pre { padding: 12px; overflow-x: auto; font-size: 12px; }
	.ok { color: #15803d; } .bad { color: #b91c1c; }
	button { font: inherit; padding: 6px 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; }
	button:hover { background: #f9fafb; }
	muted { color: #6b7280; }
</style>
<h1>tangent-mcp 在线</h1>
<p>这是一个 MCP（Model Context Protocol）服务器，只接受 <code>POST</code> 的 JSON-RPC。
浏览器直接打开这个地址看到本页是正常的 —— 说明 TLS + 服务都活着，<b>没有任何鉴权</b>。</p>
<p>端点：<code id="ep"></code></p>
<p><button id="btn">在浏览器里试调 tools/list</button> <span id="state"><muted>未执行</muted></span></p>
<pre id="out">（结果会显示在这里）</pre>
<script>
	document.getElementById('ep').textContent = location.origin + '/mcp';
	document.getElementById('btn').onclick = async () => {
		const state = document.getElementById('state');
		const out = document.getElementById('out');
		state.textContent = '请求中…';
		try {
			const r = await fetch(location.pathname, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
			const t = await r.text();
			state.innerHTML = '<span class="ok">HTTP ' + r.status + ' · 浏览器侧可用</span>';
			out.textContent = t.slice(0, 2000);
		} catch (e) {
			state.innerHTML = '<span class="bad">失败：' + e.message + '</span>';
			out.textContent = String(e);
		}
	};
</script>`;

/**
 * GET 不是错误：按 MCP Streamable HTTP 的约定，Accept 带 text/event-stream 就开一条
 * 只做保活的事件流；普通 GET（浏览器地址栏打开）给一页能自证连通性的说明。
 * 原来的 405 会让不少客户端把「探测失败」当成「需要认证」。
 */
function handleGet(req, res) {
	const accept = String(req.headers.accept ?? '');
	if (accept.includes('text/event-stream')) {
		res.writeHead(200, {
			...corsHeaders(req),
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-store',
			Connection: 'keep-alive',
		});
		res.write(': tangent-mcp connected\n\n');
		// 只保活、不推送消息：本服务器没有服务端主动发起的东西
		const timer = setInterval(() => res.write(': ping\n\n'), 15000);
		req.on('close', () => clearInterval(timer));
		logRequest(req, '200 sse');
		return;
	}

	res.writeHead(200, {
		...corsHeaders(req),
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(req.method === 'HEAD' ? undefined : INFO_PAGE);
	logRequest(req, '200 info page');
}

function handleHttp(req, res) {
	const method = req.method ?? 'GET';

	// 跨域预检
	if (method === 'OPTIONS') {
		res.writeHead(204, corsHeaders(req));
		res.end();
		logRequest(req, '204 preflight');
		return;
	}

	// 可选 Bearer 鉴权（TANGENT_MCP_TOKEN 设了才生效）。
	// OPTIONS 预检必须放行：浏览器不会在预检里带 Authorization。
	if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
		res.writeHead(401, {
			...corsHeaders(req),
			'Content-Type': 'application/json',
			'WWW-Authenticate': 'Bearer realm="tangent-mcp"',
		});
		res.end(JSON.stringify({ error: 'unauthorized', hint: '需要 Authorization: Bearer <TANGENT_MCP_TOKEN>' }));
		logRequest(req, '401 unauthorized');
		return;
	}

	if (method === 'GET' || method === 'HEAD') {
		handleGet(req, res);
		return;
	}

	// 2025-03-26 的会话终止
	if (method === 'DELETE') {
		res.writeHead(204, corsHeaders(req));
		res.end();
		logRequest(req, '204 session delete');
		return;
	}

	if (method !== 'POST') {
		res.writeHead(405, { ...corsHeaders(req), Allow: 'GET, POST, DELETE, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' });
		res.end(`tangent-mcp: 不接受 ${method}，JSON-RPC 请用 POST\n`);
		logRequest(req, `405 ${method}`);
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
			res.writeHead(400, { ...corsHeaders(req), 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
			logRequest(req, '400 parse error');
			return;
		}

		const response = handleRequest(msg);
		if (response === null) {
			res.writeHead(202, corsHeaders(req));
			res.end();
			logRequest(req, `202 ${msg?.method ?? '-'}`);
			return;
		}

		res.writeHead(200, {
			...corsHeaders(req),
			'Content-Type': 'application/json',
			'mcp-session-id': SESSION_ID,
		});
		res.end(JSON.stringify(response));
		logRequest(req, `200 ${msg?.method ?? '-'}`);
	});
}

/* ---------- 监听 ---------- */

const server = http.createServer(handleHttp);

server.on('error', (err) => {
	console.error(`[tangent-mcp] 监听失败: ${err.message}`);
	process.exit(1);
});

server.listen(PORT, HOST, () => {
	console.error(`[tangent-mcp] 已启动，${HOST}:${PORT}${TOKEN ? '（已启用 Bearer 鉴权）' : ''}`);
});

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1' && !TOKEN) {
	console.error(`[tangent-mcp] ⚠️ 监听在 ${HOST}（非回环）但没有设 TANGENT_MCP_TOKEN，任何人都能调用工具`);
}

/**
 * HTTPS 监听：与 HTTP 并存，证书缺失或监听失败都只降级、不退出。
 * 自签证书需要用户自己信任（浏览器/curl 用系统根存储，Node 客户端用 NODE_EXTRA_CA_CERTS），
 * 具体步骤见同目录 README.md。
 */
function startTls() {
	if (process.env.TANGENT_MCP_TLS === 'off') {
		console.error('[tangent-mcp] TANGENT_MCP_TLS=off，跳过 HTTPS');
		return;
	}

	if (!fs.existsSync(TLS_CERT_PATH) || !fs.existsSync(TLS_KEY_PATH)) {
		console.error(`[tangent-mcp] 未找到证书（${TLS_CERT_PATH}），HTTPS 未启用；`);
		console.error('[tangent-mcp] 需要时运行 `node create-cert.mjs` 生成自签证书，详见 README.md');
		return;
	}

	let options;
	try {
		options = { cert: fs.readFileSync(TLS_CERT_PATH), key: fs.readFileSync(TLS_KEY_PATH) };
	} catch (err) {
		console.error(`[tangent-mcp] 读取证书失败（${err.message}），HTTPS 未启用`);
		return;
	}

	const tlsServer = https.createServer(options, handleHttp);
	tlsServer.on('error', (err) => {
		console.error(`[tangent-mcp] HTTPS 监听失败: ${err.message}（HTTP 仍在 ${PORT} 运行）`);
	});
	tlsServer.listen(TLS_PORT, HOST, () => {
		console.error(`[tangent-mcp] HTTPS 已启动，${HOST}:${TLS_PORT}`);
	});
}

startTls();

process.stdin.on('close', () => {
	console.error('[tangent-mcp] stdin 关闭，退出');
	process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
