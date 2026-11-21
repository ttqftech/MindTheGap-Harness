/* ---------- MCP Tab — 服务端组 ---------- */

import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { state, actions } from '@mainview/stores';
import type { McpServerConfig, McpToolInfo } from '@shared/agent';
import { confirmMsgbox, alertMsgbox } from '@mainview/bridges/ffboxBridge';
import { testMcpServer } from '@mainview/bridges/agentBridge';
import { toMenuItems, labelOf } from './SettingsCommon';
import common from './SettingsCommon.module.css';
import styles from './McpTab.module.css';

const MCP_TRANSPORT_OPTIONS = [
	{ value: 'stdio', label: 'stdio（本地子进程）' },
	{ value: 'http', label: 'http（Streamable HTTP）' },
] as const;

/** 某一台 MCP 服务器当前的运行态（可能还没连上，不存在于 mcpStatus 里） */
function statusOf(id: string) {
	return state.mcpStatus.find((s) => s.id === id);
}

export function McpTab() {
	const [editing, setEditing] = createSignal<McpServerConfig | null>(null);
	const [testing, setTesting] = createSignal(false);
	const [testResult, setTestResult] = createSignal<{
		ok: boolean;
		message: string;
		tools: McpToolInfo[];
	} | null>(null);

	const startAdd = () => {
		setEditing({
			id: '',
			name: '新 MCP 服务器',
			enabled: true,
			transport: 'stdio',
			command: 'node',
			args: [],
			env: {},
		});
		setTestResult(null);
	};

	const startEdit = (server: McpServerConfig) => {
		setEditing(JSON.parse(JSON.stringify(server)) as McpServerConfig);
		setTestResult(null);
	};

	const handleSave = async () => {
		const s = editing();
		if (!s) return;
		if (s.transport === 'stdio' && !s.command?.trim()) {
			void alertMsgbox('无法保存', 'stdio 传输必须填写启动命令（如 node / npx / python）。');
			return;
		}
		if (s.transport === 'http' && !s.url?.trim()) {
			void alertMsgbox('无法保存', 'http 传输必须填写服务器地址。');
			return;
		}

		if (s.id) {
			actions.updateMcpServer(s.id, s);
		} else {
			actions.addMcpServer(s);
		}
		// 新增/修改后立刻让后端重连，不用等 debounce
		await actions.flushMcpServers();
		setEditing(null);
	};

	const handleReset = async () => {
		const ok = await confirmMsgbox(
			'重置 MCP 服务器',
			'将恢复为内置的示例配置，你自己添加的服务器会被移除。确定继续吗？',
			'重置',
		);
		if (ok) await actions.resetMcpServers();
	};

	const handleDelete = async (s: McpServerConfig) => {
		const ok = await confirmMsgbox('删除 MCP 服务器', `确定要删除「${s.name}」吗？`, '删除');
		if (ok) {
			actions.removeMcpServer(s.id);
			await actions.flushMcpServers();
		}
	};

	const handleTest = async () => {
		const s = editing();
		if (!s) return;
		setTesting(true);
		setTestResult(null);
		const result = await testMcpServer(s);
		setTestResult({
			ok: result.ok,
			message: result.ok
				? `连接成功${result.serverInfo?.name ? `，服务器：${result.serverInfo.name}` : ''}`
				: `连接失败：${result.error}`,
			tools: result.tools,
		});
		setTesting(false);
	};

	return (
		<div>
			<Show when={!editing()}>
				<div style={{ marginBottom: "16px", display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div class={common['settingGroup-label']}>已接入的 MCP 服务器</div>
					<div style={{ display: 'flex', gap: "8px" }}>
						<ffbox-button onclick={() => void actions.refreshMcpStatus()}>刷新状态</ffbox-button>
						<ffbox-button onclick={() => void handleReset()}>重置为默认</ffbox-button>
						<ffbox-button type="primary" onclick={startAdd}>+ 添加服务器</ffbox-button>
					</div>
				</div>

				<div class={common['settingGroup-desc']}>
					接入后，服务器提供的工具会以 <code class={common.mono}>mcp__服务器名__工具名</code> 的形式出现在 Agent 的工具列表里，模型可像内置工具一样调用。
					模型能不能看到它们由模式的 <code class={common.mono}>mcp</code> 策略决定（<code class={common.mono}>mode.json</code> 顶层字段：<code class={common.mono}>none</code> / <code class={common.mono}>all</code> / 工具名数组）；内置的编码、日常模式是 <code class={common.mono}>all</code>。
				</div>

				<div class={styles.providerList}>
					<Show when={state.mcpServers.length === 0}>
						<div style={{
							padding: '24px',
							textAlign: 'center',
							color: 'var(--fontColorMuted)',
							backgroundColor: 'hwb(var(--bg95) / 1)',
							borderRadius: "10px",
						}}>
							还没有接入任何 MCP 服务器。点击上方 "添加服务器" 开始。
						</div>
					</Show>

					<For each={state.mcpServers}>
						{(s) => {
							const st = () => statusOf(s.id);
							const dotClass = () => {
								if (!s.enabled) return 'disabled';
								return st()?.connected ? 'connected' : 'error';
							};
							return (
								<div class={styles.item}>
									<span class={`${styles.statusDot} ${styles[dotClass()]}`} />
									<div style={{ flex: 1 }}>
										<div class={styles.title}>{s.name}</div>
										<div class={styles.itemDesc}>
											{s.transport === 'stdio'
												? `${s.command} ${(s.args ?? []).join(' ')}`
												: s.url}
										</div>
										<Show when={st()?.error}>
											<div class={styles.mcpError}>⚠️ {st()?.error}</div>
										</Show>
										<Show when={(st()?.tools.length ?? 0) > 0}>
											<div class={styles.toolList}>
												<For each={st()?.tools}>
													{(t) => (
														<div class={styles.tool}>
															<div class={styles.name}>{t.name}</div>
															<div class={styles.desc}>{t.description}</div>
														</div>
													)}
												</For>
											</div>
										</Show>
									</div>
									<ffbox-switch
										prop:checked={s.enabled}
										onchange={async (e) => {
											actions.setMcpServerEnabled(s.id, e.detail);
											await actions.flushMcpServers();
										}}
									/>
									<div class={styles.actions}>
										<ffbox-button onclick={() => startEdit(s)}>编辑</ffbox-button>
										<ffbox-button type="danger" onclick={() => void handleDelete(s)}>删除</ffbox-button>
									</div>
								</div>
							);
						}}
					</For>
				</div>
			</Show>

			<Show when={editing()}>
				<McpEditor
					server={editing()!}
					onChange={setEditing}
					onSave={() => void handleSave()}
					onCancel={() => setEditing(null)}
					onTest={() => void handleTest()}
					testing={testing()}
					testResult={testResult()}
				/>
			</Show>
		</div>
	);
}

function McpEditor(props: {
	server: McpServerConfig;
	onChange: (s: McpServerConfig) => void;
	onSave: () => void;
	onCancel: () => void;
	onTest: () => void;
	testing: boolean;
	testResult: { ok: boolean; message: string; tools: McpToolInfo[] } | null;
}) {
	const [local, setLocal] = createStore<{ server: McpServerConfig }>({
		server: JSON.parse(JSON.stringify(props.server)),
	});
	// args / env / launch.args 用文本编辑（数组结构在输入框里不方便），失焦时解析回填
	const [argsText, setArgsText] = createSignal((props.server.args ?? []).join('\n'));
	const [launchArgsText, setLaunchArgsText] = createSignal((props.server.launch?.args ?? []).join('\n'));
	const [envText, setEnvText] = createSignal(
		Object.entries(props.server.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
	);

	const applyArgs = () => {
		setLocal('server', 'args', argsText().split('\n').map((l) => l.trim()).filter(Boolean));
	};
	const applyLaunchArgs = () => {
		setLocal('server', 'launch', 'args', launchArgsText().split('\n').map((l) => l.trim()).filter(Boolean));
	};
	const applyEnv = () => {
		const env: Record<string, string> = {};
		for (const line of envText().split('\n')) {
			const idx = line.indexOf('=');
			if (idx <= 0) continue;
			env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
		setLocal('server', 'env', env);
	};
	// 保存/测试前确保文本里的改动已同步进对象
	const flush = () => { applyArgs(); applyEnv(); applyLaunchArgs(); };

	return (
		<div>
			<h3 style={{ margin: '0 0 16px', fontSize: "15px", fontWeight: 600 }}>
				{local.server.id ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
			</h3>

			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>名称</div>
				<div class={common['settingGroup-desc']}>
					会作为工具名前缀。建议以英文字母开头（如 sine），因为多数模型要求工具名只能含字母数字和下划线。
				</div>
				<ffbox-normal-input
					class={common.ffboxInput}
					prop:value={local.server.name}
					placeholder="我的 MCP 服务器"
					onchange={(e) => setLocal('server', 'name', e.detail)}
				/>
			</div>

			<div class={common.settingGroup}>
				<div class={common['settingGroup-label']}>传输方式</div>
				<ffbox-dropdown-input
					class={common.ffboxDropdown}
					prop:list={toMenuItems(MCP_TRANSPORT_OPTIONS)}
					prop:text={labelOf(MCP_TRANSPORT_OPTIONS, local.server.transport)}
					prop:readonly={true}
					onchange={(e) => setLocal('server', 'transport', e.detail as McpServerConfig['transport'])}
				/>
			</div>

			<Show when={local.server.transport === 'stdio'}>
				<div class={common.settingGroup}>
					<div class={common['settingGroup-label']}>启动命令</div>
					<div class={common['settingGroup-desc']}>
						例如 node / npx / python。Windows 上 npx、npm 等会自动补 .cmd 后缀。
					</div>
					<ffbox-normal-input
						class={common.ffboxInput}
						prop:value={local.server.command ?? ''}
						placeholder="node"
						onchange={(e) => setLocal('server', 'command', e.detail)}
					/>
				</div>

				<div class={common.settingGroup}>
					<div class={common['settingGroup-label']}>参数（每行一个）</div>
					<textarea
						class={common.jsonTextarea}
						rows={3}
						value={argsText()}
						oninput={(e) => setArgsText(e.currentTarget.value)}
						onblur={applyArgs}
						placeholder={'D:\\mcp-servers\\sine\\index.js'}
					/>
				</div>

				<div class={common.settingGroup}>
					<div class={common['settingGroup-label']}>环境变量（每行一个 KEY=VALUE，可选）</div>
					<textarea
						class={common.jsonTextarea}
						rows={2}
						value={envText()}
						oninput={(e) => setEnvText(e.currentTarget.value)}
						onblur={applyEnv}
						placeholder={'API_KEY=xxx'}
					/>
				</div>
			</Show>

			<Show when={local.server.transport === 'http'}>
				<div class={common.settingGroup}>
					<div class={common['settingGroup-label']}>服务器地址</div>
					<ffbox-normal-input
						class={common.ffboxInput}
						prop:value={local.server.url ?? ''}
						placeholder="http://localhost:3000/mcp"
						onchange={(e) => setLocal('server', 'url', e.detail)}
					/>
				</div>

				<div class={common.settingGroup}>
					<div class={common['settingGroup-label']}>由本应用启动进程</div>
					<div class={common['settingGroup-desc']}>
						开启后，后端在启动时和每次调用前都会探测上面的地址；探测不到就按下面的命令拉起进程，仍无响应则标记为未连通。
					</div>
					<ffbox-switch
						prop:checked={!!local.server.launch}
						onchange={(e) => setLocal('server', 'launch', e.detail ? { command: 'node', args: [] } : undefined)}
					/>
				</div>

				<Show when={local.server.launch}>
					<div class={common.settingGroup}>
						<div class={common['settingGroup-label']}>启动命令</div>
						<ffbox-normal-input
							class={common.ffboxInput}
							prop:value={local.server.launch?.command ?? ''}
							placeholder="node"
							onchange={(e) => setLocal('server', 'launch', 'command', e.detail)}
						/>
					</div>

					<div class={common.settingGroup}>
						<div class={common['settingGroup-label']}>参数（每行一个）</div>
						<textarea
							class={common.jsonTextarea}
							rows={2}
							value={launchArgsText()}
							oninput={(e) => setLaunchArgsText(e.currentTarget.value)}
							onblur={applyLaunchArgs}
							placeholder={'D:\\mcp-servers\\tangent\\index.js'}
						/>
					</div>
				</Show>
			</Show>

			<div class={common.settingGroup}>
				<div style={{ display: 'flex', gap: "10px" }}>
					<ffbox-button onclick={() => { flush(); props.onChange(JSON.parse(JSON.stringify(local.server))); props.onTest(); }}>
						{props.testing ? '测试中…' : '测试连接'}
					</ffbox-button>
				</div>
				<Show when={props.testResult}>
					<div class={props.testResult?.ok ? styles.mcpHint : styles.mcpError}>
						{props.testResult?.ok ? '✅ ' : '❌ '}{props.testResult?.message}
					</div>
					<Show when={(props.testResult?.tools.length ?? 0) > 0}>
						<div class={styles.toolList}>
							<For each={props.testResult?.tools}>
								{(t) => (
									<div class={styles.tool}>
										<div class={styles.name}>{t.name}</div>
										<div class={styles.desc}>{t.description}</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>

			<div style={{ display: 'flex', gap: "10px", marginTop: "24px" }}>
				<ffbox-button type="primary" onclick={() => { flush(); props.onSave(); }}>保存</ffbox-button>
				<ffbox-button type="danger" onclick={props.onCancel}>取消</ffbox-button>
			</div>
		</div>
	);
}
