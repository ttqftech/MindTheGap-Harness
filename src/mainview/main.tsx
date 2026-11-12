import { render } from 'solid-js/web';
import App from '@mainview/App/App';
import { state, actions } from '@mainview/stores';
import { rpc } from '@mainview/bridges/rpc';
import '@mainview/styles/global.css';
import '@mainview/theme/theme.css';

// dev-only debug exposure
(window as any).__store = { state, actions };

render(() => <App />, document.getElementById('root')!);

// 首屏渲染完成后与 index.html 里的启动动画交棒。
// 用双 rAF 等首帧真正绘制出来，才置 __bootReady —— 于是「点击退出」只会发生在界面真的在了之后；
// 若 render 直接抛错，这段不会执行，启动动画会一直留着（这正是它存在的意义：hutch 抽风白屏时至少有个画面）。
const bootEl = document.getElementById('boot');
if (bootEl) {
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			bootEl.classList.add('ready');
			(window as any).__bootReady = true;
			// 动画已经放完的情况：不用再等点击
			if ((window as any).__bootAnimDone) (window as any).__bootFinish?.();
		}),
	);
}

// 启动动画是全屏播的（进全屏在主进程建窗时做，见 desktop/index.ts），收尾时退出。
// 页面自己 requestFullscreen() 没有用户手势会被 WebView2 拒掉，所以走 RPC 让主进程改窗口。
function exitBootFullScreen() {
	void rpc.request.windowSetFullScreen({ fullScreen: false });
}
if ((window as any).__bootClosed) exitBootFullScreen();
else window.addEventListener('mtg-boot-close', exitBootFullScreen, { once: true });
