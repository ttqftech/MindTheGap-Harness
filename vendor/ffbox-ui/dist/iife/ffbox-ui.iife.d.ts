/**
 * IIFE 产物的全局类型声明。
 *
 * dist/iife/ffbox-ui.iife.js 以 `<script>` 方式引入时，会把全部导出挂到全局 `FFBoxUI` 上。
 * 本声明让这种用法同样能获得完整类型提示。
 *
 * 这是一个「全局脚本」声明（不含顶层 import/export），因此只有在显式引入 dist/iife/ffbox-ui.iife.js 时才会进入编译上下文。
 * ESM 用法（import from 'ffbox-ui'）不会引入此处的全局变量，不会污染全局命名空间。
 */
declare const FFBoxUI: typeof import('../esm/ffbox-ui.js');

interface Window {
	FFBoxUI: typeof import('../esm/ffbox-ui.js');
}
