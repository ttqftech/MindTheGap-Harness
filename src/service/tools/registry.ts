/**
 * 工具注册表 —— 状态底座。
 * 单独成文件是为了打破「core.ts 装配内置工具 / 内置工具反向 import core.ts」的循环：
 * 若 registerTool 留在 core.ts，工具模块会先于 toolRegistry 初始化执行，第一个注册就会撞 TDZ。
 */
import type { AgentTool } from './core';

const toolRegistry = new Map<string, AgentTool>();

/**
 * 动态工具源（当前只有 MCP）。
 * 静态注册表放内置工具，动态源放运行时连上才有的工具，
 * 两者在 getToolsForAgentInstance() 里合并，断开时按 sourceId 整体注销。
 */
const dynamicToolSources = new Map<string, AgentTool[]>();

export function registerTool<TArgs extends Record<string, unknown> = Record<string, unknown>>(tool: AgentTool<TArgs>): void {
	toolRegistry.set(tool.name, tool as AgentTool);
}

/** 内置工具快照（供能力过滤用） */
export function allBuiltinTools(): AgentTool[] {
	return Array.from(toolRegistry.values());
}

/** 全部动态工具（MCP 等） */
export function allDynamicTools(): AgentTool[] {
	return Array.from(dynamicToolSources.values()).flat();
}

export function getTool(name: string): AgentTool | undefined {
	return toolRegistry.get(name) ?? allDynamicTools().find((t) => t.name === name);
}

/** 内置（静态注册表）工具名，用于插件加载时的校验 */
export function getBuiltinToolNames(): string[] {
	return Array.from(toolRegistry.keys());
}

/** 注册/替换某个来源的全部动态工具（如 MCP 服务器连上后） */
export function setDynamicTools(sourceId: string, tools: AgentTool[]): void {
	dynamicToolSources.set(sourceId, tools);
}

/** 注销某个来源的全部动态工具（如 MCP 服务器断开时） */
export function clearDynamicTools(sourceId: string): void {
	dynamicToolSources.delete(sourceId);
}
