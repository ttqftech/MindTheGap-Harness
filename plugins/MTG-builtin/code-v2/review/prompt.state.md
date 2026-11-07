{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。剩余：总预算 {{budgetTotalLeft}} 轮，本实例 {{budgetAgentInstanceLeft}} 轮。

{{#if budgetExhausted}}
**立刻停止审查**，用 `finish` 报出已经确认的问题，并说明还有哪些范围没看到。
{{else}}
请**尽快收敛**：把已确认的意见整理好，用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
