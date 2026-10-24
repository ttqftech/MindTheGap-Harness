{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止派新活**，用 `finish` 交出当前最完整的一版结论：已确认的事实 + 还没做的部分（连同原因）。
{{else}}
请**尽快收敛**：不再追加委托，把现有结果整理成方案交给用户。
{{/if}}
</budget_warning>
{{/if}}
{{#if stateChanged.taskList}}
<task_list>
{{taskList}}
</task_list>
{{/if}}
</state_update>
{{/if}}
