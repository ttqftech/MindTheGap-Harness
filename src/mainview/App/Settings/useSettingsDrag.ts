import { state, actions } from '@mainview/store';

/* ==========================================================================
   设置面板的拖拽拉出（标题栏品牌区 / 面板上的拖拽手柄共用）

   ⚠️ 这个文件只做一件事：把鼠标位移换算成 0~1 的**进度**写进 store。
   位移（transform）、遮罩浓度、可见性全部由 Settings 自己从进度派生 ——
   这里不碰任何 DOM / 样式，所以不存在「内联 style 与 CSS 两套写法互相打架」的问题。

   松手时开还是关 = **把速度也投影到进度上**再判决：速度（进度/ms）× 常量 = 相当于
   「保持这个速度再拖多久」的额外位移，加到当前进度上，看落点在上半边还是下半边。
   于是快速甩一下（位移很小）也能定开合：往下甩投影变大 ⇒ 展开、往上甩投影变小 ⇒ 收回。
   ========================================================================== */

/** 死区（px）：按下后总位移不超过它 = 点击（不是拖拽） */
const DEAD_ZONE = 4;
/** 进度过半即视为「要开」 */
const PROGRESS_THRESHOLD = 0.5;
/**
 * 「甩」的动量投影时长（ms）：松手速度（进度/ms）乘以它，就是「再拖这么久」的额外进度。
 * 越大越灵（轻轻一甩也能定开合），越小越钝。180ms ≈ 一次半行程的惯性。
 */
const FLICK_PROJECT_MS = 180;
/** 速度上限（进度/ms）：约等于一次完整行程 100ms 甩完。防止采样抖动给出离谱投影 */
const MAX_VELOCITY = 0.01;
/** 超过这么久没动过鼠标 ⇒ 松手前手已经停住，速度按 0 算（残速不该参与判决） */
const VELOCITY_STALE_MS = 80;

/**
 * 面板行程（px）= 面板高度，也就是一次完整开合对应的手指位移。
 * 由 Settings 挂载时回写：面板不在 DOM 里（进度 0）时拿不到高度，所以必须给兜底。
 */
let measureTravel: () => number = () => window.innerHeight;

export function setSettingsTravelMeasure(measure: () => number) {
	measureTravel = measure;
}

/** 品牌区 / 手柄按下：开始拖拽（顺带 preventDefault，避免选中文字或触发窗口原生拖拽） */
export function startSettingsDrag(e: MouseEvent) {
	e.preventDefault();

	const startY = e.clientY;
	const startTime = performance.now();
	// 起点进度：拖拽是在它基础上做增量，所以按住时开没开都不影响手感
	const startProgress = state.ui.settingsProgress;
	let lastY = e.clientY;
	let lastTime = startTime;
	let lastProgress = startProgress;
	/** 最近一次采样的即时速度（进度/ms），松手时做动量投影用 */
	let velocity = 0;

	const onMouseMove = (ev: MouseEvent) => {
		lastY = ev.clientY;
		const travel = measureTravel() || window.innerHeight;
		const progress = startProgress + (ev.clientY - startY) / travel;
		const now = performance.now();
		const dt = now - lastTime;
		if (dt > 0) velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, (progress - lastProgress) / dt));
		lastTime = now;
		lastProgress = progress;
		actions.setSettingsProgress(progress);
	};

	const onMouseUp = () => {
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);

		// 开还是关只由「进度 + 动量投影」决定：
		// - 拖拽：当前进度 + 速度投影，看落点在上半边（收回）还是下半边（展开）
		// - 点击（位移在死区内）：进度取反 —— 不足一半就补满、过半就收回，也就是「切换」
		const progress = state.ui.settingsProgress;
		const dragged = Math.abs(lastY - startY) > DEAD_ZONE;
		const still = performance.now() - lastTime > VELOCITY_STALE_MS;
		const projected = progress + (still ? 0 : velocity * FLICK_PROJECT_MS);
		const target = dragged ? projected >= PROGRESS_THRESHOLD : progress < PROGRESS_THRESHOLD;

		if (target) actions.openSettings();
		else actions.closeSettings();
	};

	// 监听挂在 window 上：鼠标可能在面板 / 标题栏之外才松开
	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('mouseup', onMouseUp);
}
