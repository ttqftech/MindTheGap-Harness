{{!-- 动态状态注入：各块自己判断要不要出现，全空时渲染为空串。 --}}

{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。剩余：总预算 {{budgetTotalLeft}} 轮，本实例 {{budgetAgentInstanceLeft}} 轮。

{{#if budgetExhausted}}
**立刻停止扩展性改动**，用 `finish` 交出当前进度：改完的、没改完的、下一步该怎么做。
{{else}}
请**尽快收敛**：把手上这一处改完并验证，用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}

{{#if stateChanged.taskList}}
{{#if hasTaskList}}
<task_list>
{{ taskList }}
</task_list>
{{/if}}
{{/if}}
