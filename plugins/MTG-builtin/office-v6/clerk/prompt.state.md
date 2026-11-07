{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}快用完了{{/if}}：总预算剩 {{budgetTotalLeft}} 轮，本实例剩 {{budgetAgentInstanceLeft}} 轮。
{{#if budgetExhausted}}
立刻停手。把已经做完的部分和没做完的原因写清楚，不要再调用任何工具。
{{else}}
收尾：别再开新的核对，把手上的产出落盘、确认一遍，然后交付。
{{/if}}
</budget_warning>
{{/if}}
