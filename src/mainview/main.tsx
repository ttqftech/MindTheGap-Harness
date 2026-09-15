import { render } from 'solid-js/web';
import App from './App/App';
import { state, actions } from './store';
import './styles/global.css';
import './theme/theme.css';

// dev-only debug exposure
(window as any).__store = { state, actions };

render(() => <App />, document.getElementById('root')!);

// 首屏渲染完成后淡出移除 index.html 里的启动加载页。
// 用双 rAF 等首帧真正绘制出来再淡出，避免中间闪一下空白；
// 若 render 直接抛错，加载页会一直留着——这正是它存在的意义（hutch 抽风白屏时至少有个画面）。
const bootEl = document.getElementById('boot');
if (bootEl) {
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			const bootSub = document.getElementById('boot-sub');
			if (bootSub) {
				const ms = Math.round(performance.now() - ((window as any).__bootStart ?? 0));
				bootSub.textContent = `主界面加载完成 · ${ms} ms`;
			}
			bootEl.classList.add('boot-hide');
			setTimeout(() => bootEl.remove(), 260);
		}),
	);
}
