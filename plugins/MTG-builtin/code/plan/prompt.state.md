{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.taskList}}
<current_task_list>
{{ taskList }}
</current_task_list>
{{/if}}

{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止一切探索**，把已经成型的计划落盘，并用 `finish` 报出当前结论与未完成项。
{{else}}
请**尽快收敛**：停止扩展性探索，把计划落成可执行的文字，必要时用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
</state_update>
{{/if}}
