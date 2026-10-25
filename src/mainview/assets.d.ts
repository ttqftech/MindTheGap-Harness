// 二进制资产（音频 / 图片）走 Vite 原生资产管线：import 进来的是打包后的 URL 字符串。
// 退场音乐就这么引入（声明缺失会导致 TS2307）。
declare module '*.flac' {
	const src: string;
	export default src;
}
