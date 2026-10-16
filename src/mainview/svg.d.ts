// `.svg` 走 config/vite-svg.ts 的 svgComponentPlugin，变成一个 Solid 组件：
//   import MTGlong from "./MTG-long.svg";
//   <MTGlong class={styles.appMark} />
// 带 ?raw / ?url 查询串的导入仍走 Vite 原生资产管线（分别返回字符串 / URL），不在本声明内。
// 组件体内是 <span {...props} innerHTML={svg} />，所以 props 类型按 <span> 给（含 class / style / innerHTML 等），
// 否则 <MTGlong class={...} /> 会报「Property 'class' does not exist on IntrinsicAttributes」。
declare module '*.svg' {
	import type { Component, ComponentProps } from 'solid-js';
	const src: Component<ComponentProps<'span'>>;
	export default src;
}