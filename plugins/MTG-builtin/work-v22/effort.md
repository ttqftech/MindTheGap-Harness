{{!--
	强度指令（work-v22）—— 渲染后拼在每次 LLM 请求尾部，不进 system prompt。理由见 code-v22/effort.md。
	clerk / reader / check 的 prompt.md 里不许出现任何强度相关的条件。

	⚠️ 同 code-v22：**短、祈使、可执行**，每档 1~3 行；把「一定会做」的差异放在不依赖委托的地方。
--}}
{{#if isRoot}}
<work_mode>
{{#if isLow}}
数清材料，算完就产出，确认文件在盘上，然后交付。不要为了稳妥把每份材料从头读到尾。
{{/if}}
{{#if isMedium}}
数字一律用脚本算，不要用脑子算。产出后把硬指标（金额、行数、条目数）重算一遍，对不上就改完再交付。
{{#if canDelegate}}数字容不得错时派 `check` 用脚本独立复算。{{/if}}
{{/if}}
{{#if isHigh}}
材料多而杂时{{#if canDelegate}}先派 `reader` 把字段抽成一张事实表（它读原文，你只收表），{{else}}先自己把要的字段列成一张表，{{/if}}再据此产出。
产出后这一步不能省：{{#if canDelegate}}派 `check` 从原始材料独立复算硬指标（合计、各小计、条目数）;{{else}}自己用脚本从原始材料重算一遍;{{/if}}对不上的逐条改完再交付。
{{/if}}
{{#if isUltra}}
分阶段产出：出一份核对一份，确认没跑偏再出下一份。{{#if canDelegate}}每阶段派 `check` 复算。{{/if}}
交付前逐条回读用户原话：格式（文件名、列名、顺序、单位）、口径（含税与否、作废项算不算）、被剔除的条目有没有列全。
{{/if}}
</work_mode>
{{else}}
<sub_task>
{{#if isLow}}只做父 Agent 交的这一段，照抄原文不要改通顺，做完 `finish`。{{/if}}
{{#if isMedium}}只做这一段，数字用脚本算不要用脑子算，做完 `finish`。{{/if}}
{{#if isHigh}}只做这一段，数字一律用脚本算；段外问题只写进 `finish` 备注，不要动手。{{/if}}
{{#if isUltra}}只做这一段（父 Agent 给了阶段划分就只做当前阶段），口径严格照它给的，有歧义在 `finish` 里点出来。{{/if}}
</sub_task>
{{/if}}
