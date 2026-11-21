/* ---------- 提示词 Tab — 服务端组 ----------
   基座提示词是后端设置的一部分（settings.basePrompt），所有模式共享。
   它由各 Agent 的 prompt.md 用 {{ basePrompt }} 决定是否内嵌；被内嵌时按当前作用域再渲染一遍，
   所以这里可以写 {{platform}} / {{time}} / {{todoList}} 等任意作用域变量。
   没有默认值：留空就是空串（合法状态），代码不会拿任何内置文案去补。
   -------------------------------------------------------------------------- */

import { createEffect, createSignal, For, Show } from 'solid-js';
import { state, actions } from '@mainview/stores';
import { alertMsgbox } from '@mainview/bridges/ffboxBridge';
import common from './SettingsCommon.module.css';

const BASE_PROMPT_VARS = [
	{ name: '{{platform}}', desc: '操作系统（Windows / macOS / Linux）' },
	{ name: '{{shell}}', desc: 'shell 名称（cmd.exe / /bin/sh）' },
	{ name: '{{time}}', desc: '当前时间（东八区）' },
	{ name: '{{runningDir}}', desc: '工作目录' },
];

export function PromptTab() {
	// 本地草稿：只在点「保存」时才写后端，避免每敲一个字就落盘
	const [draft, setDraft] = createSignal(state.basePrompt);
	const [saving, setSaving] = createSignal(false);

	// 后端值变化（首次加载 / 别处保存）时同步草稿
	createEffect(() => setDraft(state.basePrompt));

	const dirty = () => draft() !== state.basePrompt;

	const handleSave = async () => {
		setSaving(true);
		const ok = await actions.saveBasePrompt(draft());
		setSaving(false);
		if (!ok) {
			void alertMsgbox('保存失败', '基座提示词未能写入后端设置，请检查 Agent Service 是否在运行。');
			return;
		}
		void alertMsgbox('已保存', '基座提示词已写入 settings.json，下一轮对话生效。', '好的');
	};

	return (
		<div>
			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>基座提示词</div>
				<div class={common['settingGroup-desc']}>
					所有模式共享这段提示词，但<strong>不会自动拼进 system prompt</strong>：由各 Agent 的 prompt.md 里写不写{' '}
					<code>{'{{ basePrompt }}'}</code> 决定要不要放、放在哪一段（不写就等于关闭，「空」模式就是这么做的）。
					<br />
					常用变量（和 prompt.md 共用同一套，其余变量见各 Agent 的 prompt.md 末尾说明）：<For each={BASE_PROMPT_VARS}>{(v) => (
						<>
							<code>{v.name}</code>（{v.desc}）{' '}
						</>
					)}</For>
				</div>
				<textarea
					class={common.jsonTextarea}
					style={{ 'font-family': 'ui-monospace, Consolas, monospace', 'min-height': '360px' }}
					value={draft()}
					oninput={(e) => setDraft(e.currentTarget.value)}
				/>
				<div style={{ display: 'flex', gap: '10px', 'margin-top': '10px' }}>
					<ffbox-button type="primary" prop:disabled={saving() || !dirty()} onclick={() => void handleSave()}>
						{saving() ? '保存中…' : '保存'}
					</ffbox-button>
					<ffbox-button prop:disabled={!dirty()} onclick={() => setDraft(state.basePrompt)}>放弃修改</ffbox-button>
				</div>
				<Show when={dirty()}>
					<div style={{ 'font-size': '12px', color: 'var(--fontColorDim)', 'margin-top': '6px' }}>
						有未保存的修改。
					</div>
				</Show>
			</div>
		</div>
	);
}
