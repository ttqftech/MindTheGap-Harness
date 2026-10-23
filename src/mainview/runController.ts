/* ==========================================================================
   一轮 run 的控制器

   ⚠️ 这里是「一轮 run」的唯一入口，**不 import 任何 UI 模块**：
     - per-conversation 的 SSE 订阅集合
     - SSE 事件 → 在飞 overlay 的翻译表
     - beginRun / endRun
     - 发起 / 停止 / 回答提问

   组件（ChatView、标题栏菜单、全局快捷键）只是调用方。以前这套逻辑住在 ChatView 里，
   靠「ChatView 单实例常驻」这条**隐式契约**才成立（切会话不卸载 ⇒ 订阅不断）——
   现在它自己持有订阅、生命周期 = 应用生命周期，视图怎么挂载都不影响在飞内容。

   已合并进来的旧文件：`runState.ts`（停止回调桥）、`runSubscription.ts`（订阅集合）。

   ⚠️ 「有没有 run 在飞」**不在这里**：那是 per-conversation 的运行态，由后端经
     ConversationMeta.runStatus（三态 running / waiting / stopped）下发，store 按会话存。
     以前这里有过全局布尔量，结果「某个任务在跑时切换任意一项都会把它点亮」—— 别再加回来。
   ========================================================================== */

import { createEffect, createRoot } from 'solid-js';
import * as agentBridge from '@mainview/agentBridge';
import {
	state as appState,
	actions,
	loadConversationCtx,
	overlayActions,
	runErrorActions,
	streamTickActions,
	taskListActions,
	markConversationUnread,
} from '@mainview/store';
import type { OverlayCtx } from '@mainview/projection';
import type { AgentInstanceMessage, AgentStreamEvent, ModelConfig, ToolResult, UsageEntry } from '@shared/agent';

// #region 订阅集合

/** conversationId → 取消订阅函数 */
const sources = new Map<string, () => void>();
/** conversationId → 当前注册的事件处理器（subscribe 换 handler 时更新） */
const handlers = new Map<string, (event: AgentStreamEvent) => void>();

/** 这个会话当前是不是在监听 SSE */
export function isSubscribed(conversationId: string): boolean {
	return sources.has(conversationId);
}

/** 当前在监听的全部会话 id（供调试用） */
export function subscribedConversationIds(): string[] {
	return Array.from(sources.keys());
}

/**
 * 订阅某个会话的 SSE 流。
 *
 * @param onOpen  建连回调。调用方用它来「等连接真的建立再发 run」——
 *                后端在连接建立前发出的头几条事件（含 `agent_start`）不会重放，
 *                丢了的话在飞期间界面一片空白。
 *                已在监听时也会立即触发（换 handler 场景）。
 */
export function subscribe(
	conversationId: string,
	handler: (event: AgentStreamEvent) => void,
	onOpen?: () => void,
): void {
	handlers.set(conversationId, handler);
	const existing = sources.get(conversationId);
	if (existing) {
		// 已经在监听：只要换 handler，onOpen 照常触发（调用方要等建连完成）
		onOpen?.();
		return;
	}
	const unsub = agentBridge.subscribeStream(
		conversationId,
		(event) => handlers.get(conversationId)?.(event),
		onOpen,
		() => {
			// ⚠️ SSE 连接断开：如果 runStatus 仍为 running/waiting，说明后端已不再推送
			//   但前端还卡在「运行中」（服务崩溃 / 网络断开等），需要兜底收尾（2026-09-22 加）。
			//   用 setTimeout 延迟检查：EventSource onerror 在正常重连时也会触发，
			//   给它一点时间重连，如果 runStatus 仍是 alive 再收尾。
			setTimeout(() => {
				const conv = appState.conversations.find((c) => c.id === conversationId);
				if (conv?.runStatus === 'running' || conv?.runStatus === 'waiting') {
					runErrorActions.set(conversationId, 'SSE 连接断开，运行已中止');
					void endRun(conversationId);
				}
			}, 5000);
		},
	);
	sources.set(conversationId, unsub);
}

/** 停止监听某个会话。run 结束 / 等待用户响应时调用。 */
export function unsubscribe(conversationId: string): void {
	handlers.delete(conversationId);
	const unsub = sources.get(conversationId);
	if (unsub) {
		unsub();
		sources.delete(conversationId);
	}
}

/** 应用退出时清干净（订阅是应用级的，正常退出不需要显式调；留着给调试 / 热重载） */
export function unsubscribeAll(): void {
	for (const unsub of sources.values()) unsub();
	sources.clear();
	handlers.clear();
}

// #endregion

// #region SSE → 在飞 overlay

/**
 * 把一条 SSE 事件翻译成「ctx 形状」的在飞条目（翻译表见设计稿 §5.3）。
 *
 * ⚠️ overlay 必须与 ctx 同形状（实例 → 条目），否则子 Agent 的在飞内容就没法嵌进上级的
 * delegate 块里，只能再写一套拼树逻辑 —— 那正是旧设计病根的复现。
 */
function applyEvent(draft: OverlayCtx, event: AgentStreamEvent): void {
	const getInstanceMessagesByIdSafe = (instanceId: string) => {
		if (!draft.instances[instanceId]) draft.instances[instanceId] = { messages: [] };
		return draft.instances[instanceId]!.messages;
	};

	/**
	 * 取「当前正在写」的 assistant 条目，通常是最后一条，根据尾部情况决定是否另起一条
	 */
	const assistantEntry = (instanceId: string, kind: 'text' | 'toolCall'): AgentInstanceMessage => {
		const messages = getInstanceMessagesByIdSafe(instanceId);
		const tail = messages[messages.length - 1];
		if (tail?.role === 'assistant') {
			if (kind === 'toolCall') return tail;
			if (!tail.toolCalls?.length) return tail;
		}
		// 尾部不是 assistant 消息，另起一条
		messages.push({ role: 'assistant', content: '', updatedAt: event.timestamp });
		return messages[messages.length - 1]!;
	};

	/**
	 * 工具结果按 callId 写（后到的覆盖先到的）。
	 *
	 * 同一个 callId 会来两次：`delegate` / `resume_*` 先发「占位」，等子实例全部终态后再来一次「终态」；
	 * 其余工具只来一次。两次都走同一条「有则改、无则建」的分支，不必区分谁是谁。
	 *
	 * ⚠️ **「无则建」是正常路径，不是异常**：`tool_start` 只往 assistant 条目上挂了 `toolCalls`，overlay 里
	 *    并没有对应的 `role:'tool'` 条目，所以第一次 `tool_end` 一定是「找不到」。
	 *    早先这里写的是「找不到就抛错」，而 SSE 回调外面还有一层 try/catch（`agentBridge.subscribeStream`）
	 *    把异常原样吞掉 —— 于是每条工具结果都在翻译时被丢掉，工具行一直停在「执行中…」，
	 *    直到整轮跑完重拉 ctx（ctx 里有完整结果）才显示出来，界面上还不留任何报错。（2026-09-15）
	 */
	const upsertToolResult = (id: string, event: Extract<AgentStreamEvent, { type: 'tool_end' }>) => {
		function toolOutputText(result: ToolResult): string {
			const body = result.content ?? '';
			if (!result.success) {
				return `[工具执行失败] ${result.error ? `${result.error}\n${body}` : body}`.trim();
			}
			return body;
		}

		const messages = getInstanceMessagesByIdSafe(id);
		const content = toolOutputText(event.result);
		const data = { success: event.result.success, structured: event.result.structured, error: event.result.error };
		const existing = messages.find((m) => m.role === 'tool' && m.toolCallId === event.callId);
		if (existing) {
			existing.content = content;
			existing.kind = 'tool_result';
			existing.data = data;
			existing.updatedAt = event.timestamp;
		} else {
			messages.push({
				role: 'tool',
				content,
				toolCallId: event.callId,
				kind: 'tool_result',
				data,
				updatedAt: event.timestamp,
			});
		}
	};

	// done / error 已在 handleStreamEvent 里提前返回，但这里仍要防一手类型（它们没有 agentInstanceId）
	const instanceId = 'agentInstanceId' in event ? event.agentInstanceId ?? '' : '';
	switch (event.type) {
		case 'agent_start': {
			getInstanceMessagesByIdSafe(instanceId);
			draft.meta[instanceId] = {
				agentInstanceId: instanceId,
				agentId: event.agentId,
				agentName: event.agentName,
				parentAgentInstanceId: event.parentAgentInstanceId,
				depth: event.depth,
				status: 'running',
				task: event.task,
				startedAt: event.timestamp,
			};
			if (!event.parentAgentInstanceId) draft.rootAgentInstanceId = instanceId;
			// 首条 user 条目 = 该实例的任务（与 ctx 里的形态一致）
			getInstanceMessagesByIdSafe(instanceId).push({
				role: 'user',
				content: event.parentAgentInstanceId ? `[来自父 Agent 的任务]\n${event.task ?? ''}` : (event.task ?? ''),
				updatedAt: event.timestamp,
			});
			break;
		}
		case 'text': {
			const entry = assistantEntry(instanceId, 'text');
			entry.content += event.chunk;
			entry.updatedAt = event.timestamp;
			break;
		}
		case 'reasoning': {
			const entry = assistantEntry(instanceId, 'text');
			entry.reasoningContent = (entry.reasoningContent ?? '') + event.chunk;
			entry.updatedAt = event.timestamp;
			break;
		}
		case 'tool_start': {
			const entry = assistantEntry(instanceId, 'toolCall');
			if (!entry.toolCalls) entry.toolCalls = [];
			entry.toolCalls.push({
				id: event.callId,
				type: 'function',
				function: { name: event.toolName, arguments: JSON.stringify(event.args ?? {}) },
			});
			entry.updatedAt = event.timestamp;
			break;
		}
		case 'tool_end': {
			upsertToolResult(instanceId, event);
			break;
		}
		case 'usage': {
			const data: UsageEntry = {
				seq: event.seq ?? 0,
				round: event.round,
				purpose: event.purpose ?? 'agent_loop',
				model: event.model ?? '',
				logId: event.logId,
				input: event.tokens.input,
				output: event.tokens.output,
				cached: event.tokens.inputCached,
				total: event.tokens.total,
				durationMs: event.durationMs ?? 0,
			};
			const messages = getInstanceMessagesByIdSafe(instanceId);
			if (event.purpose === 'reflection') {
				const refl = messages.findLast((m) => m.kind === 'reflection');
				if (refl) {
					refl.usages = [...(refl.usages ?? []), data];
					refl.updatedAt = event.timestamp;
					break;
				}
			}
			const entry = assistantEntry(instanceId, 'text');
			entry.usages = [...(entry.usages ?? []), data];
			entry.updatedAt = event.timestamp;
			break;
		}
		case 'reflection_start': {
			const messages = getInstanceMessagesByIdSafe(instanceId);
			messages.push({
				role: 'system',
				content: '',
				uiOnly: true,
				kind: 'reflection',
				data: { remaining: event.remaining },
				updatedAt: event.timestamp,
			});
			break;
		}
		case 'reflection_chunk': {
			const messages = getInstanceMessagesByIdSafe(instanceId);
			const refl = messages.findLast((m) => m.kind === 'reflection');
			if (refl) {
				refl.content += event.chunk;
				refl.updatedAt = event.timestamp;
			}
			break;
		}
		case 'client_tool_call': {
			// ask_user 挂起：tool_end 事件会带占位结果（含 structured.askUserStatus），不再需要额外消息
			break;
		}
		case 'agent_end': {
			const meta = draft.meta[instanceId];
			if (meta) meta.status = event.status;
			break;
		}
		default:
			break;
	}
}

// #endregion

// #region 事件分发

/** 刷新任务清单面板（按会话隔离：跑完的会话不会把清单写进当前视图） */
const refreshTaskList = async (conversationId: string) => {
	const list = await agentBridge.getTaskList(conversationId);
	taskListActions.set(conversationId, list);
};

const handleStreamEvent = (conversationId: string, event: AgentStreamEvent) => {
	if (event.type === 'done') {
		void refreshTaskList(conversationId);
		void endRun(conversationId);
		return;
	}
	if (event.type === 'error') {
		runErrorActions.set(conversationId, event.message);
		// endRun 会 unsubscribe + clear overlay + set runStatus='stopped' + 重拉 ctx。
		// endRun 不再 clear runError（见下方 endRun 注释），所以错误会持续显示到下一轮 beginRun。
		void endRun(conversationId);
		return;
	}
	// ⚠️ runStatus 是 per-conversation 的：这里刷新的是 `conversationId` 自己那份，
	//   不是「当前查看的会话」——所以切到 B 之后 A 的事件只会让 A 的状态保持新鲜，
	//   不会把 B 的运行态冲掉（旧实现的 setIsGenerating 是组件本地状态，会串场）。
	if (event.type === 'client_tool_call') {
		// ask_user 挂起：本轮还没结束（实例在等用户），但不再主动产出 ⇒ waiting
		actions.setConversationRunStatus(conversationId, 'waiting');
	} else if (event.type === 'tool_end' && event.toolName === 'ask_user') {
		// ask_user 的 tool_end 紧跟 client_tool_call 之后发出，此时实例仍在等用户，
		// 不能把 waiting 冲回 running（否则 UI 会显示"运行中"而非"等待输入"）
	} else {
		actions.setConversationRunStatus(conversationId, 'running');
	}
	overlayActions.produce(conversationId, (draft) => applyEvent(draft, event));
	// 给这个会话的在飞内容打拍子（渲染侧只读「当前查看的那份」的 tick，别的会话在飞不会牵动它）
	streamTickActions.bump(conversationId);
};

// #endregion

// #region 一轮 run 的开始与结束

// 生命周期只有两个动作：
//   beginRun —— 清空 overlay（清掉上一轮的残留）后建订阅
//   endRun   —— 重拉 ctx（拿「已提交」的内容）+ 清空 overlay
// 中间不重拉：§6 决定了「在飞」的内容不在 ctx 里，靠 overlay 呈现即可。

const beginRun = async (conversationId: string) => {
	// ⚠️ 订阅**跟着会话走**，不跟着视图走：这里只负责「这一轮」的订阅，
	//   不清掉其它会话的订阅 —— 否则切到 B 时会把 A 的 SSE 也关掉，A 的在飞内容就彻底丢了。
	runErrorActions.clear(conversationId);
	overlayActions.clear(conversationId);
	streamTickActions.bump(conversationId);
	actions.setConversationRunStatus(conversationId, 'running');
	// ⚠️ 必须**等 SSE 连接真的建立**再返回：EventSource 建连要几百 ms，而调用方紧接着就发 run，后端在连接建立前发出的头几条事件（含 `agent_start`）不会重放，会永久丢失。
	// 丢了 `agent_start` 的后果：overlay 没有 `rootAgentInstanceId`，在飞期间`foldCtxToRenderTree()` 找不到根实例直接返回 null ⇒ 界面上既看不到用户那条消息、也看不到任何内容（2026-09-15 实测：overlay 里只有后续事件，整轮一片空白）。
	// 超时兜底：连不上也照常返回，宁可丢事件也不能把「发送」卡死。
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, 2000);
		subscribe(
			conversationId,
			(event) => handleStreamEvent(conversationId, event),
			() => {
				clearTimeout(timer);
				resolve();
			},
		);
	});
};

const endRun = async (conversationId: string) => {
	// run 结束：停止监听（后端不再推送）。订阅是 per-conversation 的，关掉这个不会影响其它会话。
	unsubscribe(conversationId);
	overlayActions.clear(conversationId);
	// ⚠️ 不再 clear runError：错误消息要持续显示给用户看，直到下一轮 beginRun 才清。
	//   以前 endRun 里 clear 掉了，导致 SSE error 事件设的错误消息被紧接着的 endRun 立刻清掉，
	//   用户只看到状态回到空闲但看不到任何错误提示（2026-09-22 修）。
	// ⚠️ 这里必须**显式**收尾：runStatus 是后端「活着才下发」的运行态，结束时列表接口里没有这个键，
	//   光靠 loadConversationCtx 的 meta 刷新清不掉本地那份 running（见 store 的 refreshConversationMeta 注释）。
	actions.setConversationRunStatus(conversationId, 'stopped');
	// ⚠️ 跑完了但用户没在看这个会话 → 标未读（侧边栏绿点，点开即清）。
	//   本来就在这个会话的不标 —— 内容就在眼前，等于已经看过了。
	if (conversationId !== appState.activeConversationId) markConversationUnread(conversationId);
	// 重拉 ctx（拿「已提交」的内容）+ 刷新 meta（标题 / updatedAt 以后端为准）
	await loadConversationCtx(conversationId, true);
};

// #endregion

// #region 对外：发起 / 停止 / 回答提问

export interface StartRunParams {
	conversationId: string;
	userMessage: string;
	modeId: string;
	runningDir?: string;
	model: ModelConfig;
}

/**
 * 发起一轮 run：建订阅 → 发请求 → 失败时兜底收尾。
 *
 * 成功时不收尾 —— 后面还有一串 SSE 事件，收到 `done` 才 endRun。
 */
export async function startRun(params: StartRunParams): Promise<void> {
	const conversationId = params.conversationId;
	// ⚠️ beginRun 里也会设一次，这里早设是为了「发请求还没建连」这段极短窗口
	//   也能立刻看到「运行中」（否则用户点了发送会感觉没反应）。
	actions.setConversationRunStatus(conversationId, 'running');
	await beginRun(conversationId);
	try {
		const result = await agentBridge.runAgent({
			conversationId,
			userMessage: params.userMessage,
			modeId: params.modeId,
			runningDir: params.runningDir,
			model: params.model,
		});
		if (!result.ok) {
			runErrorActions.set(conversationId, `❌ Agent 错误: ${result.error}`);
			await endRun(conversationId);
		}
	} catch (err: any) {
		runErrorActions.set(conversationId, `❌ 调用失败: ${err?.message || String(err)}`);
		await endRun(conversationId);
	}
}

/**
 * 停止一轮 run。
 *
 * @param conversationId 省略时停「当前查看的会话」—— 外壳（标题栏菜单 / Esc）走这条。
 *   显式给 id 时可以停掉后台还在跑的会话。
 */
export async function stopRun(conversationId?: string): Promise<void> {
	const target = conversationId ?? appState.activeConversationId;
	if (!target) return;
	await agentBridge.cancelAgent(target);
	await endRun(target);
}

/** 回答提问卡片：本地先把状态改成已回答，再 POST 续接（订阅还开着，后续输出继续进 overlay） */
export async function answerAskUser(conversationId: string, callId: string, text: string): Promise<void> {
	const skipped = text === '用户已跳过此提问';
	overlayActions.produce(conversationId, (draft) => {
		// 在 overlay 里把某次提问的工具结果 structured 改掉（回答 / 跳过）
		for (const instance of Object.values(draft.instances)) {
			const entry = instance.messages.find(
				(m) => m.role === 'tool' && m.toolCallId === callId,
			);
			if (entry) {
				const data = entry.data as { success?: boolean; structured?: Record<string, unknown> } | undefined;
				if (data) {
					data.structured = { ...data.structured, askUserStatus: skipped ? 'skipped' : 'answered', askUserAnswer: text };
				} else {
					entry.data = { success: true, structured: { askUserStatus: skipped ? 'skipped' : 'answered', askUserAnswer: text } };
				}
				// 这是**唯一**一处允许前端自己取时间：填回答是界面动作，后端此刻还没有任何事件能对上它
				// （它的真值要等本轮跑完重拉 ctx 才由 writeToolResult 盖过去）。
				entry.updatedAt = Date.now();
				return;
			}
		}
	});
	if (skipped) return;

	actions.setConversationRunStatus(conversationId, 'running');
	const result = await actions.answerToolCall(conversationId, callId, text);
	if (!result.ok) {
		runErrorActions.set(conversationId, `回答提交失败: ${result.error}`);
		await endRun(conversationId);
	}
}

// #endregion

// #region 初始化

/**
 * 把「页面加载时后端仍在跑」的会话接回 SSE。
 *
 * 订阅只在 `beginRun` 里建，而刷新页面 / 重连之后前端一个订阅都没有 ——
 * 列表里 runStatus 是 running / waiting 的会话仍在后端跑，但它的事件无处可送，
 * 于是界面停在「运行中」且收不到任何新内容，只能再刷新一次才看到结果。
 * 这里按列表现状补订阅（已经订阅的会跳过），并随列表 / 运行态变化自动跟进。
 *
 * ⚠️ 交给 `createRoot` 是因为这个 effect 跟任何组件都无关：它是应用级的，
 *   不该因为 ChatView 卸载而消失（那正是旧实现的老毛病）。
 */
export function initRunController(): void {
	createRoot(() => {
		createEffect(() => {
			for (const conv of appState.conversations) {
				if (conv.runStatus !== 'running' && conv.runStatus !== 'waiting') continue;
				if (isSubscribed(conv.id)) continue;
				subscribe(conv.id, (event) => handleStreamEvent(conv.id, event));
			}
		});
	});
}

// #endregion
