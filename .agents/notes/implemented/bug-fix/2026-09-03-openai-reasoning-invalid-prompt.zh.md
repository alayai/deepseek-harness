# Agent Note: OpenAI reasoning models reject accumulated chain-of-thought input

Status: implemented

[English](2026-09-03-openai-reasoning-invalid-prompt.md) | 中文

## Problem

经 `dsh-llm-pi-ai` 的多步骤 `gpt-5.5` 轮次在若干工具回合之后，会因 OpenAI 的 `invalid_prompt` 拒绝而失败（"your prompt was flagged as potentially violating our usage policy"，并链向 [prompting 建议](https://platform.openai.com/docs/guides/reasoning#advice-on-prompting)）。`classifyPiAiError` 把该措辞映射到兜底的 `PI_AI_ERROR`。同一会话的前几步能成功：分类器只在 assistant 历史累积之后才触发。

pi-ai 的 OpenAI Responses 转换器会 JSON 解析每个 thinking 块的 `thinkingSignature`，并把存储的 item 作为输入发送。该 item 是完整的 `output_item`（`JSON.stringify(item)`），包含明文 `summary`。未签名的 thinking——中断的回合、降级的回放——会变成 assistant 文本，因为外部历史使用 `api: 'dsh-foreign'`。两条路径都会把先前的思维链放进后续输入。压缩（compaction）指令中 "lets another model resume the work" 的措辞，与 Codex 压缩前缀触发的同类误报属于同一类。

## Decision

- **`toPiReplayState` 与 `replayedAssistant` 会净化 OpenAI Responses 推理（reasoning）项签名**，只保留 `{ type, id?, encrypted_content? }`，去掉 `summary` 和其他展示字段。Completions 的字段名签名与非推理 JSON 保持不变。恢复时净化可修复已经记录的项。
- **`foreignAssistant` 省略未签名的 thinking。** 否则 pi-ai 会把它拍平为 assistant 文本；省略它与 Responses 转换器“无签名 → 丢弃”的协议行为一致，并阻止在降级或中断历史上注入思维链。
- **`COMPACTION_INSTRUCTION` 开场即要求模型把上方对话浓缩为结构化检查点，使本会话可以继续。** 它不提及另一个模型。会话检查点前导不变，因此已落地的 `user/message` 快照仍然有效。
- **`classifyPiAiError` 把 `invalid_prompt`／usage-policy 措辞映射为 `INVALID_REQUEST`。** 它仍是永久性的 400 类拒绝，而不是未分类兜底。

## Alternatives considered

**保留摘要并只靠 `encrypted_content` 满足配对。** 否决：分类器扫描整个输入，包括推理项的 `summary` 文本。加密内容是 `store: false` 配对所需要的；摘要只用于展示，并且会跨工具回合累积。

**把未签名 thinking 作为 thinking 块传递，交给 pi-ai 丢弃。** 对外历史否决：`transformMessages` 在 Responses 转换器运行之前，就会把跨 `api` 的 thinking 转成 assistant 文本，因此丢弃永远不会发生。

**只在当前请求中去掉摘要，让持久签名保持原样。** 否决：之后每次请求都会重新解析已记录的 `summary`。在存储与恢复时都净化，才能让持久项与协议项一致。

**保持压缩指令不变。** 否决：“another model resume” 的措辞已被独立记录为分类器触发因素，且辅助摘要器走同一条 OpenAI 路由。

## Consequences

OpenAI Responses 的工具后续请求会回放加密推理而不带明文摘要。降级回放省略未签名 thinking，而不是把它注入为 assistant 文本。仍然被标记的 prompt 会报告 `INVALID_REQUEST` 而不是 `PI_AI_ERROR`。在 `thinkingSignature` 中存储字段名的 Completions 路由不变。会话可见的检查点前导不变；私有摘要器指令以 Compact-the-conversation-ABOVE 那句开场。

## Testing

`tests/convert.spec.ts` 会存储并恢复一条带 `summary` 的 OpenAI 推理项，并断言签名只保留 `type`／`id`／`encrypted_content`；字段名与非推理签名保持原样；外部历史省略未签名 thinking；`invalid_prompt` 被分类为 `INVALID_REQUEST`。`compaction-loop-repro.spec.ts` 用该 Compact-the-conversation-ABOVE 开场句识别辅助调用。

## Related

本篇不取代仍负责 `COMPACTION_INSTRUCTION` 尾部 user 消息位置的[压缩摘要前缀缓存复用](2026-07-21-compaction-summary-prefix-cache-reuse.zh.md)，也不取代仍负责 `classifyPiAiError` 扁平文本匹配的[pi-ai 传输截断分类](2026-07-22-pi-ai-transport-truncation-classification.zh.md)。
