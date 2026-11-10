import { Index, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { marked, type MarkedToken, type Token, type Tokens, type MarkedOptions } from 'marked';
import styles from './MarkdownText.module.css';

/** 某一类 token 的具体类型（从 Token 里 Extract 掉 Generic，才拿得到 text / tokens 这些字段） */
type TokenOf<T extends Token['type']> = Extract<MarkedToken, { type: T }>;

// #region 解析与分派

/**
 * marked 选项：
 * - `gfm`：表格 / 任务列表 / 删除线 —— AI 回复里都会有
 * - `breaks`：单个换行就断行。聊天场景比标准 CommonMark「软换行合并成空格」更贴直觉
 */
const MARKED_OPTIONS = { gfm: true, breaks: true } satisfies MarkedOptions;

/**
 * 正文 → token 树。
 *
 * `marked.lexer()` 给的是**顶层块数组**，块内靠 `token.tokens` / `list.items` 继续嵌套：
 * 一次调用就把整篇变成树，不走 HTML 字符串，所以没有 innerHTML 这个注入点。
 * 流式时每来一段就整篇重算 —— 几 KB 的回复在 1ms 以内，不值得做增量解析。
 */
function lex(text: string): Token[] {
	return marked.lexer(text, MARKED_OPTIONS);
}

/** 取指定类型的 token；类型不符给 undefined，让 `<Match>` 判假落进下一个分支 */
function typeEquals<T extends Token['type']>(tok: () => Token, type: T): TokenOf<T> | undefined {
	const t = tok();
	return t.type === type ? (t as unknown as TokenOf<T>) : undefined;
}

/** 兜底文案：绝大多数 token 都有 text，没有就退回 raw */
function rawText(t: Token): string {
	const text = (t as Tokens.Generic).text;
	return typeof text === 'string' ? text : t.raw;
}

/**
 * 链接 / 图片地址的白名单。
 *
 * ⚠️ 正文是模型写的，`href` 不能直接塞进 `<a>` / `<img>`：`javascript:` 会在这个渲染进程里执行，
 * 而渲染进程握着 :18999 的 Bearer。这里只放行 http(s)、mailto、锚点与相对路径，
 * 其余协议（javascript: / data: / vbscript: …）一律降级成纯文本。
 */
function safeUrl(raw: string | null | undefined): string | undefined {
	const url = (raw ?? '').trim();
	if (!url) return undefined;
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^(https?|mailto):/i.test(url) ? url : undefined;
	return url;
}

// #endregion

// #region 行内渲染

/** 行内 token 列表 → JSX（段落、标题、表格单元格、强调内部都走它） */
function renderInlines(tokens: Token[] | undefined): JSX.Element {
	if (!tokens?.length) return null;
	return tokens.map((token) => <MarkdownInline tok={() => token} />);
}

/**
 * 一个行内 token。
 *
 * ⚠️ 分支必须走 `<Switch>` 而不是 `switch (tok.type)`：同一位置上的类型会变 —— 流式时 `**` 刚打出来一段还没闭合，那几个字先是普通 text，闭合之后才变成 strong。
 */
function MarkdownInline(props: { tok: () => Token }): JSX.Element {
	return (
		<Switch fallback={rawText(props.tok())}>
			{/* 块级 text 会再包一层行内集合；行内 text 没有 tokens，直接吐字 */}
			<Match when={typeEquals(props.tok, 'text')}>
				{(t) => (t().tokens?.length ? renderInlines(t().tokens) : t().text)}
			</Match>
			<Match when={typeEquals(props.tok, 'escape')}>{(t) => t().text}</Match>
			<Match when={typeEquals(props.tok, 'strong')}>{(t) => <strong>{renderInlines(t().tokens)}</strong>}</Match>
			<Match when={typeEquals(props.tok, 'em')}>{(t) => <em>{renderInlines(t().tokens)}</em>}</Match>
			<Match when={typeEquals(props.tok, 'del')}>{(t) => <del>{renderInlines(t().tokens)}</del>}</Match>
			<Match when={typeEquals(props.tok, 'codespan')}>{(t) => <code class={styles['inline-code']}>{t().text}</code>}</Match>
			<Match when={typeEquals(props.tok, 'br')}>{<br />}</Match>

			<Match when={typeEquals(props.tok, 'link')}>
				{(t) => (
					<Show when={safeUrl(t().href)} fallback={<span>{renderInlines(t().tokens)}</span>}>
						{(href) => (
							<a href={href()} target="_blank" rel="noreferrer" title={t().title ?? undefined}>
								{renderInlines(t().tokens)}
							</a>
						)}
					</Show>
				)}
			</Match>

			<Match when={typeEquals(props.tok, 'image')}>
				{(t) => (
					<Show when={safeUrl(t().href)}>
						{(src) => (
							<img src={src()} alt={t().text} title={t().title ?? undefined} loading="lazy" />
						)}
					</Show>
				)}
			</Match>

			{/* 正文里混的原始 HTML：按字面文本显示。这是 AST 路线白拿的安全边界，模型真要给可运行的东西，请它用 ```html 围栏（那里有明确的代码 / 预览开关） */}
			<Match when={typeEquals(props.tok, 'html')}>{(t) => t().text}</Match>
			{/* 任务项的方框由 `MarkdownListItem` 的 <input> 负责，这里不能再吐一个字符，否则会变成「一个空方框 + 一个 ☑」两行 */}
			<Match when={typeEquals(props.tok, 'checkbox')}>{null}</Match>
		</Switch>
	);
}

// #endregion

// #region 块级渲染

/**
 * 块列表 → JSX（引用块、列表项内部用）。
 *
 * ⚠️ 这里是一次性求值的，**没有响应性**：
 *    `.map()` 当场把每个块算成元素，token 被常量闭包 `() => token` 冻住，外层重新 lex 时不会按位置对账（Solid 插入数组子节点是先清旧再插新），整段子树会被拆掉重建。
 *
 *    这在外层可以接受 —— `<blockquote>` / 列表项的 `<Match>` 本来就随 token 变化重建子树，下面的 `MarkdownBlock` 重建一次也看不出差别。
 *
 *    但**不要拿它去替代顶层的 `<Index>`**：
 *    流式时每个 chunk 都会重挂整篇 DOM，`HtmlFence` 的 mode / srcdoc / settling 全部归零（预览会一直闪「正在生成…」，防抖等于白写），代码块的滚动与选中位置也一并丢失。
 *    顶层必须按位置保组件实例，见入口组件的注释。
 */
function renderBlocks(tokens: Token[]): JSX.Element {
	return tokens.map((token) => <MarkdownBlock tok={() => token} />);
}

/**
 * 一个块级 token。
 *
 * ⚠️ 同样必须是响应式的 `<Switch>`：流式时同一个位置的块类型会变（`- ` 打出来是段落，补上内容才成为列表；`#` 也是先段落后标题），写死分支会留下上一个类型的 DOM。
 */
function MarkdownBlock(props: { tok: () => Token }): JSX.Element {
	return (
		<Switch fallback={rawText(props.tok())}>
			{/* 块之间的空行 */}
			<Match when={typeEquals(props.tok, 'space')}>{null}</Match>
			{/* 链接引用定义（`[a]: http://…`）本身不出东西 */}
			<Match when={typeEquals(props.tok, 'def')}>{null}</Match>

			<Match when={typeEquals(props.tok, 'paragraph')}>{(t) => <p>{renderInlines(t().tokens)}</p>}</Match>

			{/* 紧凑列表项的内容是 text（不是 paragraph），不能包 <p> —— 否则行距会散开 */}
			<Match when={typeEquals(props.tok, 'text')}>
				{(t) => (t().tokens?.length ? renderInlines(t().tokens) : t().text)}
			</Match>

			<Match when={typeEquals(props.tok, 'heading')}>
				{(t) => <Dynamic component={`h${t().depth}`}>{renderInlines(t().tokens)}</Dynamic>}
			</Match>

			<Match when={typeEquals(props.tok, 'hr')}>{<hr />}</Match>

			<Match when={typeEquals(props.tok, 'blockquote')}>
				{(t) => <blockquote>{renderBlocks(t().tokens)}</blockquote>}
			</Match>

			<Match when={typeEquals(props.tok, 'list')}>
				{(t) => (
					<Dynamic
						component={t().ordered ? 'ol' : 'ul'}
						start={t().ordered && t().start !== '' ? Number(t().start) : undefined}
					>
						<Index each={t().items}>{(item) => <MarkdownListItem item={item} />}</Index>
					</Dynamic>
				)}
			</Match>

			<Match when={typeEquals(props.tok, 'table')}>
				{(t) => (
					<div class={styles['table-wrap']}>
						<table>
							<thead>
								<tr>
									<Index each={t().header}>
										{(cell) => (
											<th style={{ 'text-align': cell().align ?? undefined }}>{renderInlines(cell().tokens)}</th>
										)}
									</Index>
								</tr>
							</thead>
							<tbody>
								<Index each={t().rows}>
									{(row) => (
										<tr>
											<Index each={row()}>
												{(cell) => (
													<td style={{ 'text-align': cell().align ?? undefined }}>{renderInlines(cell().tokens)}</td>
												)}
											</Index>
										</tr>
									)}
								</Index>
							</tbody>
						</table>
					</div>
				)}
			</Match>

			<Match when={typeEquals(props.tok, 'code')}>{(t) => <CodeFence code={t().text} lang={t().lang} />}</Match>

			{/* 块级原始 HTML：同上，按字面文本显示 */}
			<Match when={typeEquals(props.tok, 'html')}>{(t) => t().text}</Match>
		</Switch>
	);
}

/** 一个列表项。任务项前面挂一个禁用的复选框（`- [x]` 由 marked 解析成 task / checked） */
function MarkdownListItem(props: { item: () => Tokens.ListItem }): JSX.Element {
	return (
		<li classList={{ [styles['is-task']]: props.item().task }}>
			<Show when={props.item().task}>
				<input type="checkbox" class={styles['task-box']} disabled checked={!!props.item().checked} />
			</Show>
			{renderBlocks(props.item().tokens)}
		</li>
	);
}

// #endregion

// #region 代码块

/** 围栏代码块：```html 走 HTML 预览组件，其余语言就是一块等宽 `<pre>`（暂不做高亮） */
function CodeFence(props: { code: string; lang?: string }) {
	const lang = () => (props.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
	return (
		<Show
			when={lang() === 'html'}
			fallback={<pre class={styles['code-block']}><code>{props.code}</code></pre>}
		>
			<HtmlFence code={props.code} />
		</Show>
	);
}

/**
 * ```html 代码块：代码 / iframe 预览两个视图，默认预览。
 *
 * 预览用 `sandbox="allow-scripts"` —— **绝不能加 `allow-same-origin`**：
 * 加了以后 srcdoc 与页面同源，里面那段模型写的脚本就能摸 `parent.document`、
 * 甚至拿页面里的登录态去调 :18999。只给 allow-scripts 时它是不可见源，脚本照跑但碰不到外面。
 */
function HtmlFence(props: { code: string }) {
	const [mode, setMode] = createSignal<'preview' | 'code'>('preview');

	/**
	 * iframe 的 srcdoc 每变一次就是整篇文档重载，流式时逐 chunk 更新会让预览一直闪。
	 * 做法是「安静 700ms 才提交」：内容一直在长时计时器不断被重置，一次都不提交；
	 * 模型停手（这一块写完、或者整轮结束）才把最终内容交给 iframe。
	 */
	const [srcdoc, setSrcdoc] = createSignal('');
	const [settling, setSettling] = createSignal(true);
	createEffect(() => {
		const code = props.code;
		const id = setTimeout(() => {
			setSrcdoc(code);
			setSettling(false);
		}, 700);
		setSettling(true);
		onCleanup(() => clearTimeout(id));
	});

	return (
		<div class={styles['html-fence']}>
			<div class={styles['html-fence-head']}>
				<span class={styles['html-fence-lang']}>HTML</span>
				<button
					class={styles['html-fence-tab']}
					onClick={() => setMode((m) => (m === 'code' ? 'preview' : 'code'))}
				>
					{mode() === 'code' ? '预览' : '代码'}
				</button>
			</div>
			<Show
				when={mode() === 'code'}
				fallback={
					<Show when={!settling()} fallback={<div class={styles['html-fence-pending']}>正在生成…</div>}>
						<iframe class={styles['html-fence-frame']} sandbox="allow-scripts" srcdoc={srcdoc()} />
					</Show>
				}
			>
				<pre class={styles['code-block']}><code>{props.code}</code></pre>
			</Show>
		</div>
	);
}

// #endregion

// #region 入口

/**
 * AI 回复正文的 markdown 渲染。
 *
 * ⚠️ 顶层用 `<Index>` 而不是 `<For>`：token 对象每次重新 lex 都是新的，
 *    `<For>` 会按引用判定成「换了一个块」把整段 DOM 拆掉重建
 *    `<Index>` 按位置给 signal，只更新变化的表达式。
 */
export default function MarkdownText(props: { text: string }) {
	const tokens = createMemo(() => lex(props.text));
	return (
		<div class={styles.markdownBody}>
			<Index each={tokens()}>
				{(tok) => <MarkdownBlock tok={tok} />}
			</Index>
		</div>
	);
}

// #endregion