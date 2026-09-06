# Agent Note: OpenAI reasoning models reject accumulated chain-of-thought input

Status: implemented

English | [中文](2026-09-03-openai-reasoning-invalid-prompt.zh.md)

## Problem

A multi-step `gpt-5.5` turn through `dsh-llm-pi-ai` fails after several tool rounds with OpenAI's `invalid_prompt` refusal ("your prompt was flagged as potentially violating our usage policy", linking [advice on prompting](https://platform.openai.com/docs/guides/reasoning#advice-on-prompting)). `classifyPiAiError` mapped that wording to the catch-all `PI_AI_ERROR`. The same session's first steps succeed: the classifier fires only once assistant history has accumulated.

pi-ai's OpenAI Responses converter JSON-parses each thinking block's `thinkingSignature` and sends the stored item as input. That item is the full `output_item` (`JSON.stringify(item)`), including the plaintext `summary`. Unsigned thinking — interrupted turns, degraded replay — is converted to assistant text because foreign history uses `api: 'dsh-foreign'`. Both paths put previous chain-of-thought into later input. The compaction instruction's "lets another model resume the work" wording is the same class of false-positive trigger Codex hit on its compaction prefix.

## Decision

- **`toPiReplayState` and `replayedAssistant` sanitize OpenAI Responses reasoning-item signatures** to `{ type, id?, encrypted_content? }`, dropping `summary` and other display fields. Completions field-name signatures and non-reasoning JSON are unchanged. Restore-time sanitization repairs already-logged items.
- **`foreignAssistant` omits unsigned thinking.** pi-ai would otherwise flatten it to assistant text; omitting it matches the Responses converter's "no signature → drop" wire behavior and stops CoT injection on degraded or interrupted history.
- **`COMPACTION_INSTRUCTION` opens by asking the model to compact the conversation above into a structured checkpoint so this session can continue.** It does not mention another model. The conversation checkpoint preamble is unchanged, so landed `user/message` snapshots stay valid.
- **`classifyPiAiError` maps `invalid_prompt` / usage-policy wording to `INVALID_REQUEST`.** It remains a permanent 400-class refusal rather than the unclassified catch-all.

## Alternatives considered

**Keep summaries and rely on `encrypted_content` alone to satisfy pairing.** Rejected: the classifier scans the whole input, including reasoning-item `summary` text. Encrypted content is required for `store: false` pairing; the summary is display-only and is what accumulates across tool rounds.

**Pass unsigned thinking through as thinking blocks and let pi-ai drop them.** Rejected for foreign history: `transformMessages` converts cross-`api` thinking to assistant text before the Responses converter runs, so the drop never happens.

**Strip summaries only for the current request, leaving durable signatures intact.** Rejected: every later request would re-parse the logged `summary`. Sanitize at store and restore so the durable item and the wire item agree.

**Leave the compaction instruction unchanged.** Rejected: the "another model resume" phrasing is independently documented as a classifier trigger, and the auxiliary summarizer uses the same OpenAI route.

## Consequences

OpenAI Responses tool follow-ups replay encrypted reasoning without plaintext summaries. Degraded replay omits unsigned thinking instead of injecting it as assistant text. A still-flagged prompt reports `INVALID_REQUEST` instead of `PI_AI_ERROR`. Completions routes that store a field name in `thinkingSignature` are unchanged. The conversation-visible checkpoint preamble is unchanged; the private summarizer instruction opens with the Compact-the-conversation-ABOVE sentence.

## Testing

`tests/convert.spec.ts` stores and restores an OpenAI reasoning item that carries a `summary` and asserts the signature keeps only `type`/`id`/`encrypted_content`; field-name and non-reasoning signatures stay verbatim; foreign history omits unsigned thinking; `invalid_prompt` classifies as `INVALID_REQUEST`. `compaction-loop-repro.spec.ts` identifies the auxiliary call by that Compact-the-conversation-ABOVE opening sentence.

## Related

This note does not supersede [compaction summary prefix-cache reuse](2026-07-21-compaction-summary-prefix-cache-reuse.md), which still owns trailing-user-message placement of `COMPACTION_INSTRUCTION`, or [pi-ai transport truncation classification](2026-07-22-pi-ai-transport-truncation-classification.md), which still owns flattened-text matching in `classifyPiAiError`.
