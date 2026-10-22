{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.unfinished}}
<unfinished_children>
{{#each unfinished}}- [{{agentId}}] `{{agentInstanceId}}`（{{agentName}}）状态={{statusLabel}}{{#if interruptReason}}｜原因：{{interruptReason}}{{/if}}｜任务：{{taskLine}}
{{/each}}

{{#if hasTool.resume_pending_child}}
你可以用 `resume_pending_child` 让它接着干；已经完成但需要它继续做别的事，用 `resume_completed_child` 并附上补充任务。
**不要对同一个子 Agent 反复 resume**——那会造成恢复风暴。
{{else}}
这些子任务没有跑完。如实告诉用户「该项查询未完成」，**不要替它编造结论**。
{{/if}}
</unfinished_children>
{{/if}}

{{#if stateChanged.children}}
<your_children>
{{#each children}}- [{{agentId}}] `{{agentInstanceId}}`（{{agentName}}）状态={{statusLabel}}｜任务：{{taskLine}}
{{/each}}
</your_children>
{{/if}}

{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止一切动作**，用 `finish` 报出当前结论与未完成项（连同原因）。
{{else}}
请**尽快收敛**：不要追加委托、不要交叉验证，把手上结果整理好交还。
{{/if}}
</budget_warning>
{{/if}}
</state_update>
{{/if}}
