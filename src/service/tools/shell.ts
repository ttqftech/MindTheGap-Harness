/** 内置工具 —— 进程 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { decodeShellOutput } from '../textEncoding';
import { registerTool } from './registry';

// #region 内置工具 —— 进程

registerTool({
	name: 'shell',
	access: 'exec',
	description: `在运行目录中执行 shell 命令。${
		process.platform === 'win32'
			? [
					'当前运行环境是 Windows（shell 为 cmd.exe），请使用 Windows 兼容命令（如 dir、type、echo），不要用 Unix 专属命令（如 ls、date +%Y、grep -r）。',
					// '实测踩过的坑，照下面写：临时环境变量要用 `set X=1 && node a.mjs`（写成 `X=1 node a.mjs` 会报「不是内部或外部命令」）；多条命令按顺序用 `&&` 串，不要用 `;`（不是分隔符）也不要用单个 `&`（会把前一条扔到后台，输出跟后一条搅在一起）；退出码在结果末尾（形如 [exit 2]），不要自己去 echo %ERRORLEVEL% 或 $?（拿不到）；不要试图用 `echo ... >> 文件` 写多行内容，换行会被截断、中文还会乱码——要往文件里写超过一行的东西就用 file_write。',
				].join('\n')
			: process.platform === 'darwin'
				? '当前运行环境是 macOS（shell 为 /bin/sh），请使用 Unix 兼容命令（如 ls、cat、echo、grep）。'
				: '当前运行环境是 Linux（shell 为 /bin/sh），请使用 Unix 兼容命令（如 ls、cat、echo、grep）。'
		}\n超过一行的脚本先用 file_write 写成文件再运行——命令行里的换行会被截断。`,
	parameters: {
		type: 'object',
		properties: {
			command: { type: 'string', description: '要执行的 shell 命令' },
			timeout: { type: 'integer', description: '超时时间（秒），默认 180' },
		},
		required: ['command'],
	},
	async execute(args, ctx) {
		const cmd = args.command as string;
		const timeout = (args.timeout as number) ?? 180;

		try {
			// 不要 encoding:'utf-8'：Windows cmd 内建命令按 OEM 代码页（936/GBK）写，直接解会乱码。
			// 拿到字节再交给 decodeShellOutput 按行判（先严格 UTF-8，不行再 GBK）。
			const res = spawnSync(cmd, {
				cwd: ctx.runningDir && existsSync(ctx.runningDir) ? ctx.runningDir : undefined,
				encoding: 'buffer',
				timeout: timeout * 1000,
				shell: true,
				windowsHide: true,
			});
			if (res.error) {
				const msg = res.signal
					? `执行超时或被终止（${res.signal}）`
					: res.error.message;
				return { success: false, content: msg, error: msg };
			}
			// encoding: 'buffer' → stdout / stderr 都是字节，各自按行判编码后再拼
			const stdout = decodeShellOutput(res.stdout);
			const stderr = decodeShellOutput(res.stderr);
			const parts: string[] = [];
			if (stdout.trim()) parts.push(stdout.trimEnd());
			if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`);
			parts.push(`[exit ${res.status}]`);	// 退出码
			return { success: true, content: parts.join('\n') };
		} catch (err: any) {
			return {
				success: false,
				content: `执行失败：${err.message}`,
				error: err.message,
			};
		}
	},
});

// #endregion
