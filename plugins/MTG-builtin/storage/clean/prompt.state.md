{{#if stateChanged.any}}
<state_update>
{{#if stateChanged.budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止执行新的删除**，把手上这批收尾（写全 `{{workspaceDir}}` 下的 `cleanup-log.md`），然后用 `finish` 交出已做与未做清单。
{{else}}
请**尽快收敛**：优先把批准清单里收益最大的几条做完，然后收尾记账。
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
