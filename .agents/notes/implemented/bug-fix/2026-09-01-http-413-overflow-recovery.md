# Agent Note: HTTP 413 is overflow recovery, not INVALID_REQUEST

Status: implemented

English | [中文](2026-09-01-http-413-overflow-recovery.zh.md)

## Problem

A long session can assemble a chat-completions body that a gateway nginx rejects with HTTP 413 before the model sees it. Both DeepSeek adapters classified that status — and pi-ai's "payload too large" / "request body too large" wording — as `INVALID_REQUEST`. Compaction overflow recovery listens only for `CONTEXT_WINDOW_EXCEEDED`, so the loop preserved the provider failure, Chat rendered the nginx HTML page as the turn error, and `/compact` then sent the same oversized body and recorded "could not produce a useful summary."

Token-window pressure can fire too late for this path: a 1,000,000-token model thresholds near 800,000 estimated tokens, while a 1–10 MiB `client_max_body_size` is already exceeded by far less JSON. Image byte watermarks do not cover text, tools, or envelope syntax ([pi-ai limitation](../../../../packages/llm/llm-pi-ai/README.md#known-limitations-and-deferred-work)).

## Decision

Both DeepSeek adapters map HTTP 413 and payload-too-large wording to `CONTEXT_WINDOW_EXCEEDED`. `isPayloadTooLargeError` is the shared classifier; `sanitizeProviderErrorMessage` replaces an HTML error page with its `<title>` (or tag-stripped text) so Chat never retains gateway markup. Generic retry still does not resend the identical body: `CONTEXT_WINDOW_EXCEEDED` is outside the default retryable set. Overflow recovery then prunes oversized tool results and attempts one shrinking summary, retrying only after `replaceGeneration` advances, as owned by [after-call overflow recovery](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md).

## Alternatives considered

**A distinct `REQUEST_TOO_LARGE` code.** More precise than folding a byte cap into the token-window code, but recovery, retry exclusion, and every adapter would have to learn a second canonical overflow. The recovery action is the same shrink-then-retry path.

**Raise or document a gateway `client_max_body_size`.** Deployments can still do that; the harness does not own the proxy, and a session that is actually huge still 413s.

**Byte-budget pressure before dispatch.** Would catch some 413s without a failed request, but needs an authoritative request-byte ledger the token meter does not own. Classification unblocks the existing recovery path first.

**Feed the summarizer a truncated view when it 413s.** Cache-aligned summarization replays almost the full request, so it can 413 too. Prune-first overflow already shrinks text-bearing tool results; a truncated summarizer remains available if prune-only progress is not enough.

## Consequences

A 413 during a turn now receives one overflow recovery attempt instead of a stuck `INVALID_REQUEST`. Users see `413 Request Entity Too Large` rather than nginx markup. If the newest indivisible unit alone exceeds the gateway cap, recovery cannot shrink it and the sanitized 413 still surfaces after the bounded attempt.

## Testing

`packages/llm/llm/tests/service.spec.ts` covers payload-too-large recognition, the HTML-title projection, and the length-limit false positive. `packages/llm/llm-deepseek/tests/adapter.spec.ts` covers HTTP 413 with a nginx HTML body and `httpErrorCode(413)`. `packages/llm/llm-pi-ai/tests/convert.spec.ts` covers `HTTP 413: Payload Too Large`, the buffering-limit phrase, and an HTML 413 page through `mapStopReason`.
