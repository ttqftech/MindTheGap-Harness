/* ==========================================================================
   导出某一次 LLM 调用的请求全文（右键某个 LLM 块 → 菜单 → 本弹窗）

   为什么做成弹窗，而不是「点一下就把内容塞进某个面板」：
   ① 「复制」要能**反复点**（先粘到别处、回头还想再来一次）；
   ② 需要一条常驻的文字说明当前是「正在请求 / 导出完成 / 遇到错误」。

   请求由这个弹窗自己发（拿 logId 向后端要那一条 requestLog），
   不经过聊天视图的 state —— 导出是一次性查看，不该污染渲染树。
   ========================================================================== */

import { html } from 'ffbox-ui';
import { showMsgbox } from '@mainview/bridges/ffboxBridge';
import { getRequestDetail } from '@mainview/bridges/agentBridge';
import { fmtSize } from './shared';

// #region 剪贴板

/**
 * 写剪贴板。
 * ⚠️ `views://` 不是安全上下文，`navigator.clipboard` 可能整个不存在（`appCommands.editPaste` 也踩过），所以必须有 execCommand 兜底 —— 否则「复制」按钮在打包版里会静默失效。
 */
async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// 落到下面的兜底
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

// #endregion

// #region 弹窗

interface DetailState {
	phase: 'loading' | 'done' | 'error';
	text: string;	// 弹窗里那行状态说明
	payload: string;	// 待复制全文（phase='done' 才有）
	preview: string;	// 开头一小段预览，让用户确认拿到的是哪次请求
}

/**
 * 弹出一个「LLM 请求详情」框：自己发请求、自己显示进度、自己处理复制。
 *
 * @param conversationId 会话 id（requestLog 按会话存）
 * @param logId          该次调用的日志 id（来自块的账本 `usage.logId`）
 * @param seq            会话内序号，只用于「正在请求 #n」这句提示
 */
export function showRequestDetailMsgbox(conversationId: string, logId: string, seq?: number): void {
	const state: DetailState = {
		phase: 'loading',
		text: `正在向 Service 请求 #${seq ?? '?'} 的日志…`,
		payload: '',
		preview: '',
	};

	// ⚠️ 内容用函数形式：msgbox 每次重渲染都会重新调用它，所以改完 state 只要 requestUpdate()
	const view = () => html`
		<div style="max-width: 560px; text-align: left; line-height: 1.6;">
			<div style=${state.phase === 'error' ? 'color: #d9534f;' : ''}>${state.text}</div>
			${state.preview
				? html`<pre style="margin: 10px 0 0; padding: 8px; max-height: 220px; overflow: auto; border-radius: 6px; background: rgba(127, 127, 127, 0.12); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;">${state.preview}</pre>`
				: ''}
		</div>
	`;

	const refresh = () => box.requestUpdate();

	/** 复制按钮：没有内容时只更新提示，绝不关窗 */
	const copyCurrent = async () => {
		if (!state.payload) {
			state.text = state.phase === 'loading' ? '还在请求，等拿到内容再复制。' : '没有可复制的内容（导出失败了）。';
			refresh();
			return;
		}
		const ok = await copyText(state.payload);
		state.text = ok
			? `已复制到剪贴板（${fmtSize(state.payload.length)}）—— 可直接粘贴`
			: '复制失败：剪贴板不可用，请手动选中文本复制';
		refresh();
	};

	const box = showMsgbox({
		title: 'LLM 请求详情',
		content: view,
		buttons: [
			{
				text: '复制到剪贴板',
				type: 'primary',
				// 返回 false = **保持打开**（msgbox 的约定：undefined/true 会关窗），这样才能反复点
				callback: () => {
					void copyCurrent();
					return false;
				},
			},
			{ text: '关闭', role: 'cancel' },
		],
	});

	void (async () => {
		const res = await getRequestDetail(conversationId, logId);
		if (!res.ok || !res.record) {
			state.phase = 'error';
			state.text = `导出失败：${res.error ?? '后端没有返回这条记录'}`;
			refresh();
			return;
		}

		const record = res.record;
		const messages = record.request?.messages;
		if (!messages) {
			// 最常见的「空手而归」：日志还在，但当时等级是「默认」，正文没落盘
			state.phase = 'error';
			state.text = '这条日志里没有 messages —— 当时「LLM 请求日志等级」是「默认」。把它改成「完整」后重新发一次请求，这一条才会带全文。';
			refresh();
			return;
		}

		// 复制的是整条记录（含 messages 全文 + 归属 / 用量元信息）；预览从 messages 起，
		// 这样一眼能认出「拿到的是发给模型的那份」
		state.payload = JSON.stringify(record, null, 2);
		let preview = JSON.stringify(messages, null, 2);
		if (preview.length > 20000) {
			preview = preview.slice(0, 20000) + '(只显示前 20000 字个字符，超出部分请使用复制按钮查看)';
		}
		state.preview = preview;
		state.phase = 'done';
		state.text = `导出完成：#${record.seq} · ${messages.length} 条 messages · ${fmtSize(state.payload.length)}（点下面的按钮复制全文）`;
		refresh();
	})();
}

// #endregion
