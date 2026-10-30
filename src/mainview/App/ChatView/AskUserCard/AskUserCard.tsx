import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import type { RenderAskInfo } from '@mainview/logic/projection';
import { fmtElapsed, clockNow } from '@mainview/App/ChatView/RenderTree/shared';
import styles from './AskUserCard.module.css';

/**
 * 提问卡片：序号选项（可按数字键选）+ 自由输入 +「还有什么要补充的吗？」+ 提交 / 跳过本轮。
 *
 * 阻塞时长 = **后端时间戳 + 本地秒级心跳**现算，不是组件自己的计数器：
 * 组件一旦被换掉（任何一次投影重算都可能让 `<For>` 把它当新项），局部 state 直接清零重数。
 */
export default function AskUserCard(props: { block: RenderAskInfo; onSubmit: (text: string) => void }) {
	const answered = () => props.block.status !== 'waiting';
	const questions = () => props.block.questions;

	const [singleChoices, setSingleChoices] = createSignal<Record<number, string | null>>({});
	const [multiChoices, setMultiChoices] = createSignal<Record<number, Set<string>>>({});
	const [questionFreeTexts, setQuestionFreeTexts] = createSignal<Record<number, string>>({});
	const [extra, setExtra] = createSignal('');

	const toggleSingle = (qi: number, label: string) => {
		setSingleChoices((prev) => ({ ...prev, [qi]: prev[qi] === label ? null : label }));
	};

	const toggleMulti = (qi: number, label: string) => {
		setMultiChoices((prev) => {
			const next = new Map(Object.entries(prev).map(([k, v]) => [Number(k), new Set(v)]));
			const set = next.get(qi) ?? new Set<string>();
			if (set.has(label)) set.delete(label); else set.add(label);
			next.set(qi, set);
			const obj: Record<number, Set<string>> = {};
			next.forEach((v, k) => { obj[k] = v; });
			return obj;
		});
	};

	// block.updatedAt 来自后端（ctx 里是条目的更新时间，在飞时是 SSE 的 timestamp）
	const elapsedText = () => {
		const since = props.block.updatedAt;
		if (!since) return '已等待 --:--';
		return `已等待 ${fmtElapsed(clockNow() - since)}`;
	};

	const submit = () => {
		const parts: string[] = [];
		for (let i = 0; i < questions().length; i++) {
			const q = questions()[i];
			const selected: string[] = [];
			if (q.selectionMode === 'multi') {
				const set = multiChoices()[i];
				if (set?.size) selected.push(...set);
			} else {
				const c = singleChoices()[i];
				if (c) selected.push(c);
			}
			const ft = questionFreeTexts()[i]?.trim();
			if (selected.length > 0 || ft) {
				const subParts: string[] = [];
				if (selected.length > 0) subParts.push(`选择：${selected.join('、')}`);
				if (ft) subParts.push(ft);
				parts.push(`${q.question}\n${subParts.join('\n')}`);
			}
		}
		if (extra().trim()) parts.push(`补充：${extra().trim()}`);
		props.onSubmit(parts.join('\n') || '(未填写内容)');
	};

	const firstQuestionWithOptions = () => {
		const qs = questions();
		if (qs.length === 1 && qs[0].selectionMode !== 'multi') return qs[0];
		return null;
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (answered()) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
		const fq = firstQuestionWithOptions();
		if (!fq) return;
		const n = Number(e.key);
		if (!Number.isInteger(n) || n < 1 || n > fq.options.length) return;
		e.preventDefault();
		toggleSingle(0, fq.options[n - 1].label);
	};

	onMount(() => {
		window.addEventListener('keydown', onKeyDown);
	});
	onCleanup(() => window.removeEventListener('keydown', onKeyDown));

	return (
		<div class={styles['ask-card']} classList={{ [styles['is-answered']]: answered() }}>
			<div class={styles['ask-card-head']}>
				<span class={styles['ask-card-icon']}>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
						<path d="M4.3 4.4a1.7 1.7 0 1 1 2.2 1.9c-.4.15-.6.5-.6.9v.3" />
						<circle cx="6" cy="9.4" r="0.7" fill="currentColor" stroke="none" />
					</svg>
				</span>
				<span class={styles['ask-card-title']}>对齐颗粒度</span>
				<Show when={!answered()}>
					<span class={styles['ask-card-timer']}>{elapsedText()}</span>
				</Show>
			</div>

			<Show when={!answered()}>
				<For each={questions()}>{(question, qi) => (
					<div class={styles.questionGroup}>
						<div class={styles.questionTitle}>{question.question}</div>
						<Show when={question.options.length > 0}>
							<div class={styles.options}>
								<For each={question.options}>
									{(opt, oi) => {
										const isPicked = () => {
											if (question.selectionMode === 'multi') {
												return multiChoices()[qi()]?.has(opt.label) ?? false;
											}
											return singleChoices()[qi()] === opt.label;
										};
										return (
											<button
												class={styles['ask-card-option']}
												classList={{ [styles['is-picked']]: isPicked() }}
												onclick={() => {
													if (question.selectionMode === 'multi') toggleMulti(qi(), opt.label);
													else toggleSingle(qi(), opt.label);
												}}
											>
												<Show when={question.selectionMode === 'multi'}>
													<span class={styles['ask-card-option-check']}>
														<Show when={isPicked()}>
															✓
														</Show>
													</span>
												</Show>
												<Show when={question.selectionMode !== 'multi'}>
													<span class={styles['ask-card-option-index']}>{oi() + 1}</span>
												</Show>
												<span class={styles['ask-card-option-label']}>{opt.label}</span>
												<Show when={opt.description}>
													<span class={styles['ask-card-option-desc']}>{opt.description}</span>
												</Show>
											</button>
										);
									}}
								</For>
							</div>
						</Show>
						<textarea
							class={styles['ask-card-input']}
							placeholder="或直接输入你的回答..."
							rows={1}
							value={questionFreeTexts()[qi()] ?? ''}
							oninput={(e) => setQuestionFreeTexts((prev) => ({ ...prev, [qi()]: e.currentTarget.value }))}
						/>
					</div>
				
				)}</For>

				<div class={styles['ask-card-extra-label']}>还有什么要补充的吗？（可留空）</div>
				<textarea
					class={styles['ask-card-input']}
					placeholder="补充说明会一起交给 Agent。"
					rows={1}
					value={extra()}
					oninput={(e) => setExtra(e.currentTarget.value)}
				/>

				<div class={styles['ask-card-foot']}>
					<span class={styles['ask-card-hint']}>
						{(() => {
							const fq = firstQuestionWithOptions();
							if (fq) return `按 1 - ${fq.options.length} 选择 · 也可以直接输入`;
							return '直接输入回答 · esc 跳过本轮';
						})()}
					</span>
					<span class={styles['ask-card-foot-spacer']} />
					<button class={styles['ask-card-submit']} onclick={submit}>
						提交
					</button>
					<button class={styles['ask-card-skip']} onclick={() => props.onSubmit('用户已跳过此提问')}>
						跳过本轮
					</button>
				</div>
			</Show>

			<Show when={answered()}>
				<div class={styles.finalAnswer}>{props.block.answer}</div>
			</Show>
		</div>
	);
}