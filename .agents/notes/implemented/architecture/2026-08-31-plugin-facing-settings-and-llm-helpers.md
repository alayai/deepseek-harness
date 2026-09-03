# Agent Note: Keep plugin-facing settings and LLM helpers on package exports

Status: implemented

English | [中文](2026-08-31-plugin-facing-settings-and-llm-helpers.zh.md)

## Problem

Out-of-repository plugins import `settingsNamespace` and `installSettingsSection` from `@deepseek-ai/dsh-settings`, and `assertNever` from `@deepseek-ai/dsh-llm`. Those names are missing from the package public exports: in-repository callers use string literals, `ctx.settings.installSection`, and `@deepseek-ai/dsh-util-values`. ESM named-import evaluation then fails at profile boot. A missing export is a `SyntaxError`, and the loader refuses the whole plugin tree. Installed web-profile plugins (`dsh-at-file`, `@alayai/dsh-elite-lowcode`, `@alayai/dsh-model-hub-pro`) currently fail that way.

## Decision

`@deepseek-ai/dsh-settings` exports `settingsNamespace` (the lowercase-hyphenated namespace brand constructor) and `installSettingsSection` (the optional-settings inject helper that delegates to `SettingsProvider.installSection`). `@deepseek-ai/dsh-llm` re-exports `assertNever` from `@deepseek-ai/dsh-util-values` so a closed-union switch over this package's types can import the helper from the same module as `HarnessError`.

These are current public plugin APIs, not compatibility aliases. In-repository callers may keep using string literals, the method form, and the util-values import; both spellings remain valid.

## Alternatives considered

**Leave the names unexported and update every plugin.** Rejected because the failing plugins live outside this repository. Their installed builds import these names, and this tree cannot change those packages in the same boot.

**Keep only in-repository call sites and tell operators to uninstall the plugins.** Rejected because a profile that already mounted them is a supported composition; missing named exports must not take down the whole plugin tree.

**Re-export `assertNever` only from `dsh-util-values`.** Rejected as the sole path because current plugins import it next to `HarnessError` from `dsh-llm`. The util package remains the implementation home; the LLM package re-exports the same function.

## Consequences

A plugin that brands a settings namespace, wires an optional settings section, or exhausts a closed LLM union can keep importing these names. Removing any of them requires updating those plugins first, the same cutover the [ignorable session-event decision](2026-08-30-retain-ignorable-external-session-events.md) records for envelope fields.
