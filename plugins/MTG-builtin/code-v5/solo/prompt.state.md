{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}快用完了{{/if}}：总预算剩 {{budgetTotalLeft}} 轮，本实例剩 {{budgetAgentInstanceLeft}} 轮。
{{#if budgetExhausted}}
立刻停手。把已经做完的部分、没做成的原因写进回复，不要再调用任何工具。
{{else}}
收尾：不要开新的探索，把手上这处改完、跑一条验证命令，然后交付。
{{/if}}
</budget_warning>
{{/if}}
