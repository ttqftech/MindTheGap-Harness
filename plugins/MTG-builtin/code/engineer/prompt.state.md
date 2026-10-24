{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止一切探索**，用 `finish` 输出当前结论、已完成的部分和未完成项（连同原因）。
{{else}}
请**尽快收敛**：停止扩展性探索，把当前进展整理成可交付的结论，必要时用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
{{#if stateChanged.taskList}}
<task_list>
{{#each taskList}}- {{this}}{{/each}}
</task_list>
{{/if}}
</state_update>
{{/if}}
