/* 一次性：从 Google Fonts 拉 Inter / JetBrains Mono / Archivo 的 latin 子集 woff2，
   下载到 src/mainview/fonts/，并打印可粘贴的 @font-face 片段。
   跑法：node scripts/fetch-fonts.mjs */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'I:/Code/electro-bun/mindTheGap-Harness/src/mainview/fonts';
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FAMILIES = [
	{ css: 'Inter:wght@100..900', file: 'inter-var-latin.woff2', family: 'Inter' },
	{ css: 'JetBrains+Mono:wght@100..800', file: 'jetbrains-mono-var-latin.woff2', family: 'JetBrains Mono' },
	{ css: 'Archivo:wght@100..900', file: 'archivo-var-latin.woff2', family: 'Archivo' },
];

for (const fam of FAMILIES) {
	const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`, { headers: { 'User-Agent': UA } })).text();
	// 下载回来的东西是 CSS，里面全是 @font-face 声明，生命中包含 unicode-range 字段，
	// 这里取 latin（包含 U+0000-00FF 开头那个）的 woff2 链接
	const blocks = css.split('@font-face').slice(1);
	let picked = null;
	for (const b of blocks) {
		if (!/U\+0000-00FF/.test(b)) continue;
		const matched = b.match(/url\((https:[^)]+\.woff2)\)/);
		if (matched) picked = matched[1];
	}
	if (!picked) {
		console.log(`[fail] ${fam.family}: 没找到 latin 子集`);
		continue;
	}
	const buf = Buffer.from(await (await fetch(picked)).arrayBuffer());
	fs.writeFileSync(path.join(OUT, fam.file), buf);
	console.log(`[ok] ${fam.family} → ${fam.file} (${(buf.length / 1024).toFixed(1)} KB)`);
}
