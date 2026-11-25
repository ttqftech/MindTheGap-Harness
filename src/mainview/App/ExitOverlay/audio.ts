/**
 * 退场声音 —— 每个主题一份，节奏也由主题定
 *
 * 有音频文件的主题播文件，没有文件的用 WebAudio 现场合成，免得为了几秒钟退场再背一个二进制资源。
 * 两个函数都是「发射后不管」：只负责发声，立刻返回；什么时候开始收窗口由主题自己 `await sleep(ms, signal)` 决定。
 *
 * 正在响的都记在 liveAudios / liveContexts 里：用户按了画面上的打断按钮，
 * 编排层调 stopExitAudio() 一次性掐掉 —— 动画停了还继续放关门音是最刺眼的穿帮。
 */

// #region 在播清单

const liveAudios = new Set<HTMLAudioElement>();
const liveContexts = new Set<AudioContext>();

/** 掐掉本轮退场里所有还在响的声音（没在响时是空操作，随时可调） */
export function stopExitAudio(): void {
	for (const audio of liveAudios) audio.pause();
	liveAudios.clear();
	for (const ctx of liveContexts) void ctx.close().catch(() => { /* 已经关了 */ });
	liveContexts.clear();
}

// #endregion

// #region 音乐

/**
 * 播一段音乐，立刻返回（音乐在后台自己放到结束）。
 * 主题通常在 `playMusic(...)` 之后 `await sleep(cueMs, signal)` —— 「什么时候开始收窗口」落在调用方的时间轴上。
 *
 * ⚠️ 没用户手势时 play() 被拒、声音根本不响，但这不影响节奏：节奏由调用方的 sleep 决定，
 *    否则「没声音就关不掉应用」。
 */
export function playMusic(src: string, opts: { volume?: number } = {}): void {
	const audio = new Audio(src);
	audio.volume = opts.volume ?? 0.85;
	liveAudios.add(audio);
	audio.addEventListener('ended', () => liveAudios.delete(audio));
	void audio.play().catch((e) => console.warn('[Exit] 退场音乐被浏览器策略拦截，退场按时钟进行:', e));
}

// #endregion

// #region 合成音

/** at = 距开场多少毫秒；freq 各音色含义不同（见 blip） */
export type SynthEvent = {
	at: number;
	kind: 'clack' | 'chime' | 'whoosh' | 'ping' | 'hum' | 'buzz';
	freq?: number;
	durationMs?: number;
};

let noiseCache: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
	if (noiseCache && noiseCache.sampleRate === ctx.sampleRate) return noiseCache;
	const len = Math.floor(ctx.sampleRate * 1.5);
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
	noiseCache = buf;
	return buf;
}

function env(ctx: AudioContext, at: number, durationMs: number, peak: number, attack = 0.01) {
	const t = ctx.currentTime + at / 1000;
	const d = durationMs / 1000;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(peak, t + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, t + d);
	return g;
}

function blip(ctx: AudioContext, e: SynthEvent) {
	const at = e.at;
	const dur = e.durationMs ?? 260;
	const t = ctx.currentTime + at / 1000;
	const d = dur / 1000;

	switch (e.kind) {
		// 机械翻牌的「啪嗒」：带通白噪短脉冲
		case 'clack': {
			const src = ctx.createBufferSource();
			src.buffer = noiseBuffer(ctx);
			const bp = ctx.createBiquadFilter();
			bp.type = 'bandpass';
			bp.frequency.value = e.freq ?? 1900;
			bp.Q.value = 1.1;
			const g = env(ctx, at, dur, 0.85, 0.004);
			src.connect(bp).connect(g).connect(ctx.destination);
			src.start(t);
			src.stop(t + d);
			break;
		}
		// 屏蔽门提示的「叮咚」：两个正弦叠加
		case 'chime': {
			const g = env(ctx, at, dur, 0.32, 0.02);
			g.connect(ctx.destination);
			for (const mul of [1, 1.5]) {
				const o = ctx.createOscillator();
				o.type = 'sine';
				o.frequency.value = (e.freq ?? 880) * mul;
				o.connect(g);
				o.start(t);
				o.stop(t + d);
			}
			break;
		}
		// 气动泄压 / 加速掠过：低通扫频白噪
		case 'whoosh': {
			const src = ctx.createBufferSource();
			src.buffer = noiseBuffer(ctx);
			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.setValueAtTime(220, t);
			lp.frequency.exponentialRampToValueAtTime(e.freq ?? 5200, t + d);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.35, t + d * 0.65);
			g.gain.exponentialRampToValueAtTime(0.0001, t + d);
			src.connect(lp).connect(g).connect(ctx.destination);
			src.start(t);
			src.stop(t + d);
			break;
		}
		// 到站的清脆一声
		case 'ping': {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = e.freq ?? 1320;
			const g = env(ctx, at, dur, 0.28, 0.006);
			o.connect(g).connect(ctx.destination);
			o.start(t);
			o.stop(t + d);
			break;
		}
		// 低频底噪
		case 'hum': {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = e.freq ?? 68;
			const g = env(ctx, at, dur, 0.3, 0.35);
			o.connect(g).connect(ctx.destination);
			o.start(t);
			o.stop(t + d);
			break;
		}
		// 关门蜂鸣
		case 'buzz': {
			const o = ctx.createOscillator();
			o.type = 'square';
			o.frequency.value = e.freq ?? 440;
			const g = env(ctx, at, dur, 0.12, 0.01);
			o.connect(g).connect(ctx.destination);
			o.start(t);
			o.stop(t + d);
			break;
		}
	}
}

/** 按事件表合成，立刻返回（所有事件已排期进 AudioContext，调用方自己 sleep 等 cue 点） */
export function playSynth(events: SynthEvent[]): void {
	try {
		const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		const ctx = new Ctor();
		void ctx.resume();
		for (const e of events) blip(ctx, e);

		// 记进在播清单直到最后一个事件响完：中途被打断就 close()，已排期的事件一并作废
		liveContexts.add(ctx);
		const lastMs = events.reduce((max, e) => Math.max(max, e.at + (e.durationMs ?? 260)), 0);
		setTimeout(() => {
			liveContexts.delete(ctx);
			void ctx.close().catch(() => { /* 已被打断时关过了 */ });
		}, lastMs + 300);
	} catch (e) {
		console.warn('[Exit] 合成音不可用，退场按时钟进行:', e);
	}
}

// #endregion
