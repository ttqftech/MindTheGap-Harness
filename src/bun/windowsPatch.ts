/* ==========================================================================
   Windows 无边框窗口样式补丁

   问题：electrobun 的 `titleBarStyle: 'hidden'` 在 Windows 上把窗口建成 `WS_POPUP` 裸窗口
   （实测 GWL_STYLE = 0x94000000，只有 WS_POPUP|WS_VISIBLE|WS_CLIPSIBLINGS），
   没有 WS_CAPTION / WS_THICKFRAME / WS_MAXIMIZEBOX，于是：
     · 没有 DWM 投影
     · Win11 没有圆角
     · 不能拖边缘缩放，也不触发 Windows snap（分屏）

   解法分两步，本模块负责第二步：
     1) 改用 `titleBarStyle: 'hiddenInset'`（在 src/bun/index.ts）。
        electrobun 会给窗口加上 WS_CAPTION|WS_THICKFRAME，并且**正确处理了 WM_NCCALCSIZE**，
		实测客户区上偏移仍是 0 —— 也就是原生标题栏不占地方，内容依然铺满窗口。这一步拿回了投影、圆角、边缘缩放。
     2) 但 hiddenInset 仍缺 WS_SYSMENU / WS_MINIMIZEBOX / WS_MAXIMIZEBOX（实测 GWL_STYLE = 0x16C40000）。
	 	WS_MAXIMIZEBOX 决定 Win11 的 snap layouts 是否可用，所以创建窗口后由本模块通过 Win32 API 补上。
        实测补成 0x16CF0000 后客户区仍是 1187x793、上偏移 0，布局不受影响。

   注意：这是绕 electrobun 公开 API 的补丁，依赖其内部窗口行为。升级 electrobun 后需要重新验证（用 probe_winstyle.py 读 GWL_STYLE 即可）。
   `titleBarStyle` 若改回 'hidden'，本补丁仍会执行，但那时窗口是 WS_POPUP，补 THICKFRAME 之外的位意义不大 —— 详见下方 isPopup 判断。
   ========================================================================== */

import { logMsg } from './utils';

/** GWL_STYLE / GWL_EXSTYLE 索引 */
const GWL_STYLE = -16;

/** 需要补回的样式位 */
const WS_SYSMENU = 0x00080000; // Alt+Space 系统菜单
const WS_MINIMIZEBOX = 0x00020000; // 最小化按钮（影响最小化动画）
const WS_MAXIMIZEBOX = 0x00010000; // 最大化按钮 —— Win11 snap layouts 依赖它
const ADD_STYLE = WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

/** 标识：electrobun 'hidden' 会建 WS_POPUP 窗口，那种情况下本补丁无法救回 */
const WS_POPUP = 0x80000000;

/** SetWindowPos 标志 */
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_FRAMECHANGED = 0x0020; // 必须带，否则 DWM 不会重算非客户区
const SWP_NOACTIVATE = 0x0010;

/**
 * 给主窗口补回系统窗口样式位（Windows 专属；其他平台直接跳过）。
 *
 * 全程 try/catch：本机没有 Win32 / FFI 不可用时静默降级，
 * 最坏情况是回到「无阴影无 snap」的原始状态，不影响功能。
 */
export async function patchFramelessWindowFrame(windowTitle: string): Promise<void> {
	if (process.platform !== 'win32') return;

	try {
		// 动态 import：Cottontail 上 bun:ffi 可用，但失败时不能让整个主进程挂掉。
		// 不能为 'bun:ffi' 写全局 declare module —— 那会覆盖 @types/bun 的声明，
		// 把 .hutch/devkit 里同样用 bun:ffi 的文件一起弄坏，所以这里用 ts-ignore 局部跳过。
		// @ts-ignore
		const ffi: any = await import('bun:ffi');

		const user32 = ffi.dlopen('user32.dll', {
			FindWindowA: { args: ['ptr', 'ptr'], returns: 'ptr' },
			GetWindowLongPtrW: { args: ['ptr', 'i32'], returns: 'i64' },
			SetWindowLongPtrW: { args: ['ptr', 'i32', 'i64'], returns: 'i64' },
			SetWindowPos: { args: ['ptr', 'ptr', 'i32', 'i32', 'i32', 'i32', 'u32'], returns: 'i32' },
		});
		const { FindWindowA, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos } = user32.symbols;

		// 定位窗口：先按标题找；electrobun 注册的窗口类名是 BasicWindowClass，作为兜底
		const titleBuf = Buffer.from(`${windowTitle}\0`, 'utf8');
		let hwnd: any = null;
		try {
			hwnd = FindWindowA(null, titleBuf);
		} catch {
			hwnd = null;
		}
		if (!hwnd) {
			const classBuf = Buffer.from('BasicWindowClass\0', 'utf8');
			try {
				hwnd = FindWindowA(classBuf, null);
			} catch {
				hwnd = null;
			}
		}
		if (!hwnd) {
			logMsg('[win32] 未定位到主窗口，跳过窗口样式补丁');
			return;
		}

		const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
		if (style & WS_POPUP) {
			logMsg(`[win32] 窗口是 WS_POPUP（titleBarStyle 应为 hiddenInset 而非 hidden），跳过样式补丁`);
			return;
		}
		if (style & ADD_STYLE) {
			logMsg(`[win32] 窗口样式位已齐全 (0x${(style >>> 0).toString(16)})，无需补丁`);
			return;
		}

		SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt(style | ADD_STYLE));
		SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);

		const after = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
		logMsg(
			`[win32] 窗口样式补丁已应用: 0x${(style >>> 0).toString(16)} -> 0x${(after >>> 0).toString(16)}`,
		);
	} catch (e) {
		logMsg(`[win32] 窗口样式补丁不可用（不影响功能）: ${(e as Error).message}`);
	}
}
