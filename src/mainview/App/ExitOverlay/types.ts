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
	 */
	run(shape: FrameShape, durationMs: number): Promise<void>;
	/** 还原成初始外框（预览收尾 / 异常兜底） */
	restore(): Promise<void>;
}

// #endregion

/** 退场阶段：play = 只放动画还没碰窗口；shell = 已经开始收外壳 */
export type ExitPhase = 'play' | 'shell';

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
 * 主题跑退场时拿到的东西。编排层（index.ts）只给这两个，其余全不干预。
 */
export interface ExitRunContext {
	readonly preview: boolean;	// 预览模式下，不退出进程，结束后把窗口还原
	readonly shell: ShellAnimator;	// 外壳驱动，主题自己在这上面编排
}

/**
 * 退场主题
 */
export interface ExitTheme {
	id: ExitThemeId;
	label: string;	// 设置页分段控件上的短名
	desc: string;	// 设置页里的一句说明
	Component: Component;
	run: (ctx: ExitRunContext) => Promise<void>;
}
