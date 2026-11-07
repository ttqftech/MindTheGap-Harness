{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。剩余：总预算 {{budgetTotalLeft}} 轮，本实例 {{budgetAgentInstanceLeft}} 轮。

{{#if budgetExhausted}}
**立刻停止验证**，用 `finish` 报出目前已经验到的结论、没验到的范围。
{{else}}
请**尽快收敛**：把已经跑出来的证据整理成结论，用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
