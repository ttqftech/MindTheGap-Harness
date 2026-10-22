{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止查询**，用 `finish` 报出已经拿到的数据与失败原因。
{{else}}
请**尽快收敛**：别再补查，把手上数据用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
</state_update>
{{/if}}
