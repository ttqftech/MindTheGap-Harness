{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}快用完了{{/if}}：总预算剩 {{budgetTotalLeft}} 轮，本实例剩 {{budgetAgentInstanceLeft}} 轮。
{{#if budgetExhausted}}
立刻用 `finish` 交出已经查到的事实与没查到的部分。再调工具就交不出东西了。
{{else}}
收敛：别再开新的查证，把手上结论整理进 `finish`。
{{/if}}
</budget_warning>
{{/if}}
