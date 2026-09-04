/* ==========================================================================
   路径手动输入模态框 — MindTheGap-Harness

   用于浏览器环境回退：原生目录对话框不可用，让用户手动输入路径。
   用普通 DOM 实现（不用 window.prompt），这样浏览器 Agent / Playwright
   也能像操作按钮、输入框那样来点确定并输入。
   ========================================================================== */

import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './PathInputModal.module.css';

export function PathInputModal(props: {
	open: boolean;
	title?: string;
	placeholder?: string;
	initial?: string;
	onConfirm: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = createSignal(props.initial ?? '');
	let inputEl: HTMLInputElement | undefined;

	const confirm = () => {
		const v = value().trim();
		if (v) props.onConfirm(v);
	};
	const cancel = () => props.onCancel();

	return (
		<Portal>
			<Show when={props.open}>
				<div
					class={styles['path-modal-overlay']}
					onclick={(e) => {
						// 点遮罩空白处关闭
						if (e.target === e.currentTarget) cancel();
					}}
				>
					<div class={styles['path-modal']} role="dialog" aria-label={props.title ?? '输入路径'}>
						<div class={styles['path-modal-title']}>{props.title ?? '输入路径'}</div>
						<input
							ref={inputEl}
							class={styles['path-modal-input']}
							type="text"
							autofocus
							placeholder={props.placeholder ?? '请输入文件夹路径，例如 C:\\Users'}
							value={value()}
							oninput={(e) => setValue(e.currentTarget.value)}
							onkeydown={(e) => {
								if (e.key === 'Enter') confirm();
								if (e.key === 'Escape') cancel();
							}}
						/>
						<div class={styles['path-modal-actions']}>
							<button class={styles['path-modal-cancel']} onclick={cancel}>取消</button>
							<button
								class={styles['path-modal-ok']}
								onclick={confirm}
								disabled={!value().trim()}
							>
								确定
							</button>
						</div>
					</div>
				</div>
			</Show>
		</Portal>
	);
}