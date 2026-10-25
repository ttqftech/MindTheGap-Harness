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
 * 一个退场主题 = 一段画面 + 一段声音 + 一段外壳动效。
 *
 * ⚠️ 时间与曲线**全在主题里**：加新主题不需要动 electrobun 那边（bun/exitSequence.ts
 * 只负责拦截关闭、停会话、等「放完了」、退出）。
 */
export interface ExitTheme {
	id: ExitThemeId;
	/** 设置页分段控件上的短名 */
	label: string;
	/** 设置页里的一句说明 */
	desc: string;
	Component: Component;
	/** 主题的声音：到点了调 onCue()，「什么算到点」由主题自己定（音乐时间轴 / 合成音长度） */
	sound: (onCue: () => void) => void;
	/** 外壳动效：窗口怎么消失，每个主题各一份 */
	shell: (shell: ShellAnimator) => Promise<void>;
}
