#!/usr/bin/env node
/* ==========================================================================
   生成 tangent MCP 的本地自签证书（certs/server.crt + certs/server.key）

   用法：
       node create-cert.mjs                        # 只生成（已存在则拒绝覆盖，除非 -f）
       node create-cert.mjs --force                # 覆盖已有证书
       node create-cert.mjs --install              # 生成后导入 Windows「当前用户 / 受信任的根证书颁发机构」
       node create-cert.mjs --host a.example.com   # 额外把一个域名塞进 SAN（可重复；不写就只有 localhost/127.0.0.1/::1）

   说明：
   - 走 openssl（Git for Windows 自带；macOS/Linux 一般自带），不需要 npm 依赖。
   - 证书 SAN 默认 = localhost / 127.0.0.1 / ::1（用 --host 追加域名），自签且 basicConstraints=CA:TRUE，
     这样把 server.crt 直接导入「受信任的根证书颁发机构」就能通过校验。
   - ⚠️ 自签证书只能让「你能给它装 CA 的客户端」信任；公网上的第三方服务器（云厂商的 MCP 代理等）
     一律不认，给它配自签证书没有意义 —— 公网请用真证书（cloudflared / Caddy / Let's Encrypt）。
   - 私钥是明文 PEM，只放在本机；certs/ 已 gitignore。
   ========================================================================== */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(HERE, 'certs');
const CRT = path.join(CERT_DIR, 'server.crt');
const KEY = path.join(CERT_DIR, 'server.key');

const DAYS = 397; // 397 天以内可同时被 macOS / iOS 接受
const SUBJECT = '/CN=localhost/O=MindTheGap-Harness/OU=tangent-mcp';

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const force = argv.includes('--force') || argv.includes('-f');
const install = argv.includes('--install');

// --host <域名> 可重复：把额外的域名塞进 SAN（公网域名/内网域名都要在这儿列出，否则 hostname 校验必失败）
const extraHosts = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--host' && argv[i + 1]) extraHosts.push(argv[++i]);
}
const SAN = [
	'DNS:localhost',
	...extraHosts.map((h) => `DNS:${h}`),
	'IP:127.0.0.1',
	'IP:::1',
].join(',');

/* ---------- 找 openssl ---------- */

function findOpenssl() {
	const candidates = [process.env.OPENSSL, 'openssl'];
	if (process.platform === 'win32') {
		const pf = process.env.ProgramFiles || 'C:\\Program Files';
		const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
		const local = process.env.LOCALAPPDATA || '';
		candidates.push(
			path.join(pf, 'Git', 'usr', 'bin', 'openssl.exe'),
			path.join(pf, 'Git', 'mingw64', 'bin', 'openssl.exe'),
			path.join(pf86, 'Git', 'usr', 'bin', 'openssl.exe'),
			local ? path.join(local, 'Programs', 'Git', 'usr', 'bin', 'openssl.exe') : '',
		);
	}
	for (const bin of candidates) {
		if (!bin) continue;
		try {
			execFileSync(bin, ['version'], { stdio: 'ignore' });
			return bin;
		} catch {
			/* 试下一个 */
		}
	}
	return null;
}

/* ---------- 主流程 ---------- */

const openssl = findOpenssl();
if (!openssl) {
	console.error('[create-cert] 没找到 openssl。');
	console.error('[create-cert] Windows 可装 Git for Windows（自带 openssl），或用 WSL 执行下面的命令后把文件拷回来：');
	console.error(
		`  openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days ${DAYS} \\\n` +
			`    -subj '${SUBJECT}' -addext 'subjectAltName=${SAN}' -addext 'basicConstraints=critical,CA:TRUE' \\\n` +
			"    -addext 'keyUsage=critical,digitalSignature,keyEncipherment' -addext 'extendedKeyUsage=serverAuth'",
	);
	process.exit(1);
}

if (!force && (fs.existsSync(CRT) || fs.existsSync(KEY))) {
	console.error(`[create-cert] 证书已存在：${CRT}`);
	console.error('[create-cert] 想重新生成请加 --force（旧证书导入过系统根存储的话要一并删掉）');
	process.exit(1);
}

fs.mkdirSync(CERT_DIR, { recursive: true });

console.log(`[create-cert] 使用 ${openssl}`);
try {
	execFileSync(
		openssl,
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			KEY,
			'-out',
			CRT,
			'-days',
			String(DAYS),
			'-subj',
			SUBJECT,
			'-addext',
			`subjectAltName=${SAN}`,
			'-addext',
			'basicConstraints=critical,CA:TRUE',
			'-addext',
			'keyUsage=critical,digitalSignature,keyEncipherment',
			'-addext',
			'extendedKeyUsage=serverAuth',
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	);
} catch (err) {
	console.error('[create-cert] openssl 执行失败：');
	console.error(err.stderr ? err.stderr.toString() : err.message);
	process.exit(1);
}

// 私钥收紧到仅本人可读（Windows 上 chmod 基本无效，失败就算了）
try {
	fs.chmodSync(KEY, 0o600);
} catch {
	/* ignore */
}

console.log(`[create-cert] 已生成：\n  ${CRT}\n  ${KEY}`);

if (install) {
	if (process.platform !== 'win32') {
		console.log('[create-cert] --install 只在 Windows 上生效，其他平台请手动信任 server.crt');
	} else {
		try {
			execFileSync('certutil', ['-addstore', '-user', 'Root', CRT], { stdio: 'inherit' });
			console.log('[create-cert] 已导入「当前用户 → 受信任的根证书颁发机构」');
		} catch {
			console.error('[create-cert] 导入失败，可按 README.md 里手工步骤安装');
			process.exitCode = 1;
		}
	}
} else {
	console.log('\n下一步：信任这张证书（否则客户端会报 self-signed certificate）。');
	console.log('  Windows（当前用户，无需管理员）：');
	console.log('    node create-cert.mjs --force --install');
	console.log(`    或  certutil -addstore -user Root "${CRT}"`);
	console.log('  或双击 server.crt → 安装证书 → 受信任的根证书颁发机构');
}
