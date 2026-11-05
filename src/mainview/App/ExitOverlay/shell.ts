/**
 * 外壳动效驱动 —— 「外壳」= electrobun 的原生窗口，不是 html body
 *
 * 前端只通过两个 RPC 原语碰它：windowGetFrame / windowSetFrame。
 * 主进程那侧（bun/exitSequence.ts）不认识任何动画参数，它只提供读写外框；
 * 收多久、怎么收、缓动曲线长什么样，全部写在各主题的 shell() 里。
 *
 * 逐帧下发用 setInterval 而不是 requestAnimationFrame：收窄后期窗口宽度的变化会让
 * 合成器忙起来，rAF 有被拖慢甚至停摆的风险，而退场必须保证收得完。
 */

import { rpc } from '@mainview/bridges/rpc';
import type { Frame, FrameShape, ShellAnimator } from './types';

const FRAME_MS = 16;	// ≈60fps

// #region 缓动

export const EASE = {
	linear: (t: number) => t,
	easeInCubic: (t: number) => t * t * t,
	/** 两端都慢（隧道收窄用） */
	easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
	easeInOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
	/** 先快后极缓（翻牌收成一块牌） */
	easeOutExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

// #endregion

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 原生窗口最小尺寸给 1：给 0 有些平台的窗口管理会直接把窗口销毁，动画就断了 */
function clamp(f: Frame): Frame {
	return { x: f.x, y: f.y, width: Math.max(1, Math.round(f.width)), height: Math.max(1, Math.round(f.height)) };
}

async function getWindowFrame(): Promise<Frame> {
	try {
		const r = await rpc.request.windowGetFrame();
		if (r.ok) return r.data;
	} catch {
		/* 浏览器 / mock 环境：下面兜底 */
	}
	return { x: 0, y: 0, width: 1280, height: 800 };
}

export async function createShellAnimator(preview: boolean): Promise<ShellAnimator> {
	/**
	 * 起点的外框**在第一次 run 时才读**：主进程是先 unmaximize 再通知前端的，
	 * 最大化状态下读到的外框是无效值（窗口由 shell 托管，setFrame 不生效）。
	 */
	let frame0: Frame | null = null;
	const frame = async (): Promise<Frame> => (frame0 ??= await getWindowFrame());

	/** 本次退场是否解过锁（主进程侧解/还原都是幂等的，这里只是省一次 RPC） */
	let unlocked = false;

	/** 外壳是否已经开始动（= 已经通知主进程「可以先停后端了」） */
	let moved = false;

	return {
		preview,

		async run(shape: FrameShape, durationMs: number) {
			const f0 = await frame();	// 动画开始时窗口的外形尺寸
			const end = shape(1, f0);	// 动画结束时窗口的外形尺寸

			// 外壳第一次动起来 = 退场进入尾声（该演的画面已经演完），先让主进程停会话与后端，窗口留着放完剩下的动画。
			// 不 await：停后端不耽误这一帧。预览只是看效果、应用还要继续用，绝不能真去停后端。
			if (!preview && !moved) {
				moved = true;
				void rpc.request.exitStage({ stage: 'collapse' });
			}

			if (!unlocked && (end.width < 200 || end.height < 120)) {
				// 终点低于系统最小尺寸（实测 ~131x36）时需要临时解限（这会临时使投影消失）
				try {
					unlocked = (await rpc.request.windowSetFrameUnlocked({ unlocked: true })).ok;
				} catch {
					unlocked = false;
				}
			}

			return new Promise<void>((resolve) => {
				const t0 = Date.now();
				const timer = setInterval(() => {
					const t = Math.min(1, (Date.now() - t0) / durationMs);
					// 不等回程：逐帧 RPC 排队等待会让节奏越走越慢
					void rpc.request.windowSetFrame(clamp(shape(t, f0)));
					if (t >= 1) {
						clearInterval(timer);
						resolve();
					}
				}, FRAME_MS);
			});
		},

		async restore() {
			if (unlocked) {
				unlocked = false;
				try {
					await rpc.request.windowSetFrameUnlocked({ unlocked: false });
				} catch {
					/* 预览收尾失败无所谓：下次预览会重新解/还原 */
				}
			}
			void rpc.request.windowSetFrame(clamp(await frame()));
		},
	};
}
