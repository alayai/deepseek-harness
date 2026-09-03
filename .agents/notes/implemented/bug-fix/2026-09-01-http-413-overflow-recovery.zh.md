# Agent Note: HTTP 413 is overflow recovery, not INVALID_REQUEST

Status: implemented

[English](2026-09-01-http-413-overflow-recovery.md) | 中文

## 问题

长会话组装出的 chat-completions 请求体，可能在模型看到之前就被网关 nginx 以 HTTP 413 拒绝。两个 DeepSeek 适配器都把该状态——以及 pi-ai 的 “payload too large” / “request body too large” 措辞——分类为 `INVALID_REQUEST`。压缩溢出恢复只监听 `CONTEXT_WINDOW_EXCEEDED`，因此循环保留提供方失败，Chat 把 nginx HTML 页面渲染为本轮错误，随后 `/compact` 再发送同一过大请求体，并记录 “could not produce a useful summary.”

token 窗口压力对这条路径可能触发过晚：1,000,000 token 模型的阈值约在估算 800,000 token 附近，而 1–10 MiB 的 `client_max_body_size` 在远少于此的 JSON 上就已经超出。图片字节水位线不覆盖文本、工具或信封语法（[pi-ai 限制](../../../../packages/llm/llm-pi-ai/README.zh.md#known-limitations-and-deferred-work)）。

## 决策

两个 DeepSeek 适配器都将 HTTP 413 与 payload-too-large 措辞映射为 `CONTEXT_WINDOW_EXCEEDED`。`isPayloadTooLargeError` 是共享分类器；`sanitizeProviderErrorMessage` 把 HTML 错误页替换为其 `<title>`（或去掉标签后的文本），因此 Chat 从不保留网关 markup。通用重试仍不会重发同一请求体：`CONTEXT_WINDOW_EXCEEDED` 不在默认可重试集合中。溢出恢复随后剪枝过大的工具结果并尝试一次缩小摘要，仅在 `replaceGeneration` 前进后重试，由[调用后溢出恢复](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md)规定。

## 备选方案

**独立的 `REQUEST_TOO_LARGE` code。** 比把字节上限折进 token 窗口 code 更精确，但恢复、重试排除与每个适配器都要再学一个规范溢出。恢复动作仍是同一条先缩小再重试的路径。

**提高或文档化网关 `client_max_body_size`。** 部署仍然可以这样做；harness 并不拥有该代理，而真正过大的会话仍会 413。

**在分发前做字节预算压力检查。** 可以在请求失败前拦住一部分 413，但需要 token meter 并不拥有的权威请求字节账本。分类首先打通现有恢复路径。

**摘要器自身 413 时改送截断视图。** 与 cache 对齐的摘要几乎回放完整请求，因此它也可能 413。先剪枝的溢出路径已经能缩小带文本的工具结果；若仅剪枝无法证明进展，截断摘要器仍可作为后续手段。

## 后果

一轮中的 413 现在会得到一次溢出恢复尝试，而不再卡在 `INVALID_REQUEST`。用户看到的是 `413 Request Entity Too Large`，而不是 nginx markup。若最新不可分单元单独就超过网关上限，恢复无法缩小它，有界尝试之后仍会呈现已净化的 413。

## 测试

`packages/llm/llm/tests/service.spec.ts` 覆盖 payload-too-large 识别、HTML title 投影，以及 length-limit 误报。`packages/llm/llm-deepseek/tests/adapter.spec.ts` 覆盖带 nginx HTML 体的 HTTP 413 与 `httpErrorCode(413)`。`packages/llm/llm-pi-ai/tests/convert.spec.ts` 覆盖经 `mapStopReason` 的 `HTTP 413: Payload Too Large`、buffering-limit 短语，以及 HTML 413 页面。
