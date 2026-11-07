{{#if stateChanged.unfinished}}
{{#if hasUnfinished}}
<unfinished_children>
{{#each unfinished}}- [{{agentId}}] `{{agentInstanceId}}`（{{agentName}}）状态={{statusLabel}}{{#if interruptReason}}｜原因：{{interruptReason}}{{/if}}｜任务：{{taskLine}}
{{/each}}

{{#if hasTool.resume_pending_child}}
可以用 `resume_pending_child` 让它接着干；已完成但需要继续做别的事，用 `resume_completed_child` 并附补充任务。不要对同一个子 Agent 反复 resume。
{{else}}
这些子任务没跑完。如实告诉用户哪一项没完成，不要替它编结论。
{{/if}}
</unfinished_children>
{{/if}}
{{/if}}

{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}快用完了{{/if}}：总预算剩 {{budgetTotalLeft}} 轮，本实例剩 {{budgetAgentInstanceLeft}} 轮。
{{#if budgetExhausted}}
立刻停止派活。把已经拿到的结果、以及哪些没做完写进回复，不要再调用工具。
{{else}}
收敛：不要再委托新的子任务，把手上已有的结果收口交付。
{{/if}}
</budget_warning>
{{/if}}
