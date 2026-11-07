{{!-- 动态状态注入：各块自己判断要不要出现，全空时渲染为空串，runner 不拼这条消息。 --}}

{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。剩余：总预算 {{budgetTotalLeft}} 轮，本实例 {{budgetAgentInstanceLeft}} 轮。

{{#if budgetExhausted}}
**立刻停止查找**，用 `finish` 交出目前已经确认的事实、证据位置，以及还没查到的部分。
{{else}}
请**尽快收敛**：停止扩展性查找，把已确认的事实整理成结论，用 `finish` 交还。
{{/if}}
</budget_warning>
{{/if}}
