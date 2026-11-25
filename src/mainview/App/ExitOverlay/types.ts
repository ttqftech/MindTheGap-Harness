import type { Component } from 'solid-js';

// #region 外壳

/**
 * 原生窗口外框（屏幕坐标）。
 * 「外壳」= electrobun 创建的那个窗口（Win32 HWND），**不是** html body ——
 * 退场时收的是它，所以页面里的元素只会被两侧裁掉，不会被压扁。
 */
export type Frame = { x: number; y: number; width: number; height: number };

/**
 * 外壳动效的形状函数：进度 t ∈ [0,1] → 这一帧的外框。
 * f0 恒为动效开始时的外框（不是上一帧），多段动效各自从 f0 推导，避免累积误差。
 */
export type FrameShape = (t: number, f0: Frame) => Frame;

export interface ShellAnimator {
	/** 预览模式：不退出进程，收尾时把窗口还原 */
	readonly preview: boolean;
	/**
	 * 跑一段：durationMs 内逐帧把 shape(t) 下发给原生窗口。
	 * 起点的 frame0 在 run 时才读（那时最大化已还原），并以第二参数传给 shape。
	 * 退场被打断（编排层给的 AbortSignal 亮起）之后一律是空操作。
	 */
	run(shape: FrameShape, durationMs: number): Promise<void>;
	/** 还原成初始外框（预览收尾 / 被打断 / 异常兜底），等外框真的落回去了才返回 */
	restore(): Promise<void>;
}

// #endregion

export type ExitThemeId =
	| 'tunnel'
	| 'flipboard'
	| 'gate'
	| 'schematic'
	| 'turnstile'
	| 'blackout'
	| 'loop'
	| 'cabin'
	| 'escalator'
	| 'taillight';

/**
 * 主题跑退场时拿到的东西。编排层（index.ts）只给这三样，其余全不干预。
 */
export interface ExitRunContext {
	readonly preview: boolean;	// 预览模式下，不退出进程，结束后把窗口还原
	readonly shell: ShellAnimator;	// 外壳驱动，主题自己在这上面编排
	/**
	 * 本轮退场的取消信号：按下打断按钮时亮起。
	 * 主题里所有等待（sleep / shell.run）都吃它，亮起后当前这个 await 直接 reject，
	 * 这条 async 链就此退栈 —— 不会再在下一轮退场中途醒来改画面。
	 */
	readonly signal: AbortSignal;
}

/**
 * 主题画面（Component）的 props：画面上那枚「打断按钮」的状态与入口。
 *
 * 按钮只在外壳开始收（第二阶段：会话与 Service 已停，反悔不回来了）之前存在，
 * 所以 `interruptible` 会在那一刻由 true 翻成 false，主题用
 * `<Show when={props.interruptible}>` 包住按钮即可。
 *
 * 走 props 而不是模块级全局：主题 ↔ 编排层互相 import 会成环（index.ts 要 import 每一个主题）。
 */
export interface ExitThemeProps {
	/** 打断按钮是否还有效（外壳第一次动起来 = 分界） */
	readonly interruptible: boolean;
	/** 按钮被按下 */
	readonly onInterrupt: () => void;
}

/**
 * 退场主题
 */
export interface ExitTheme {
	id: ExitThemeId;
	label: string;	// 设置页分段控件上的短名
	desc: string;	// 设置页里的一句说明
	Component: Component<ExitThemeProps>;
	run: (ctx: ExitRunContext) => Promise<void>;
}