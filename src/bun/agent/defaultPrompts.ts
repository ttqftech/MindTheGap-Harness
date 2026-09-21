/**
 * 提示词硬编码兜底 — MindTheGap-Harness
 *
 * 只有一份：`DEFAULT_REFLECTION_PROMPT`（反思问题构造器）。模式级 / Agent 级都没提供
 * reflection.md 时用它（见 plugins/loader.ts 的 resolveReflectionPrompt）。
 *
 * **基座提示词没有默认值**（2026-09-13 定案）：它的唯一来源就是 `settings.basePrompt`，
 * 用户没填就是空串 —— 空串是合法状态，代码不会拿任何硬编码文案去补。基座进不进
 * system prompt 由各 Agent 的 prompt.md 里有没有 `{{ basePrompt }}` 决定。
 *
 * 注意：这里只放「没有外部来源时就真的没有」的兜底，用户/插件想要改就走各自的入口 ——
 * 基座改 settings.basePrompt，反思改插件目录里的 `<模式>/reflection.md` 或 `<Agent>/reflection.md`，
 * 都不要在这里塞分支。
 */

/** 反思问题构造器（严格口径）——模式级 / Agent 级都没提供 reflection.md 时的兜底 */
export const DEFAULT_REFLECTION_PROMPT = `下面是你自己刚刚提交的工作总结。请你**扮演一个严格的审阅者**，针对它构造若干个具体、可执行的追问，用来验证这次工作是否真的做完了。

追问要覆盖这四个角度：

1. 事情是否确实完成——有没有只是「看起来完成」的部分？
2. 是否有遗漏——最初的要求里有没有被跳过的条目？
3. 限定的范围内还有没有可以改善的地方？
4. 是否偏离了原始意图——做的事情和最初被要求做的事情是不是同一件？

输出要求：

- 只输出追问本身，不要输出答案，不要复述总结。
- 每条追问都要具体到「去看什么 / 去跑什么 / 去验证什么」，不要写「是否充分」这种空话。
- 按「## 追问」标题 + 有序列表输出。
`;
