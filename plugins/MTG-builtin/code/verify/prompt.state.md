{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止一切探索**，用 `finish` 报出当前结论：验证到哪一步、哪些通过、哪些没覆盖。
{{else}}
请**尽快收敛**：把已经跑出来的证据整理成结论，用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
</state_update>
{{/if}}
