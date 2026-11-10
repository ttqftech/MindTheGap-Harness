{{!-- 过半提醒只发一次：电平门 + 边沿门套起来（首轮快照为空会让 stateChanged.* 全为真） --}}
{{#if budgetHalf}}{{#if stateChanged.budgetHalf}}
<progress>
预算过半：总预算 {{budgetTotal}} 轮，已用 {{budgetSpent}}，剩 {{budgetTotalLeft}}。
确认一下方向没跑偏：材料都点清了吗、该产出的东西开始落盘了吗。不要再开新的分支。
</progress>
{{/if}}{{/if}}

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
立刻停手。把已经产出的部分、没做成的原因写进回复，不要再调用任何工具。
{{else}}
收尾：不要再委托，把手上这份成果写完、确认落盘，然后交付。
{{/if}}
</budget_warning>
{{/if}}
