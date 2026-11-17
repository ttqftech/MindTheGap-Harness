{{!-- 动态状态注入模板：各块自己判断要不要出现，全都不出现时渲染结果为空串，runner 就不会拼这条消息。不写入 instance.messages。 --}}

{{#if stateChanged.todoList}}
{{#if hasTodoList}}
<current_todo_list>
{{ todoList }}
</current_todo_list>
{{/if}}
{{/if}}

{{#if stateChanged.unfinished}}
{{#if hasUnfinished}}
<unfinished_children>
{{#each unfinished}}- [{{agentId}}] `{{agentInstanceId}}`（{{agentName}}）状态={{statusLabel}}{{#if interruptReason}}｜原因：{{interruptReason}}{{/if}}｜任务：{{taskLine}}
{{/each}}

你可以用 `resume_pending_child` 让它接着干（一次只恢复一个：从直接子实例里挑最深的那个未完成实例）。
已经完成但需要它继续做别的事，用 `resume_completed_child` 并附上补充任务。
**不要对同一个子 Agent 反复 resume**——那会造成恢复风暴。
</unfinished_children>
{{/if}}
{{/if}}

{{#if stateChanged.children}}
{{#if hasChildren}}
<your_children>
{{#each children}}- [{{agentId}}] `{{agentInstanceId}}`（{{agentName}}）状态={{statusLabel}}｜任务：{{taskLine}}
{{/each}}
</your_children>
{{/if}}
{{/if}}

{{#if budgetWarn}}
<budget_warning>
循环预算{{#if budgetExhausted}}已耗尽{{else}}即将耗尽{{/if}}。
剩余轮数：总预算 {{budgetTotalLeft}}，本实例 {{budgetAgentInstanceLeft}}。

{{#if budgetExhausted}}
**立刻停止一切探索**，在正文里给出当前结论、已完成的部分和未完成项（连同原因），然后结束本轮。
{{else}}
请**尽快收敛**：停止扩展性探索，把当前进展整理成可交付的结论，然后结束本轮。
{{/if}}
</budget_warning>
{{/if}}
