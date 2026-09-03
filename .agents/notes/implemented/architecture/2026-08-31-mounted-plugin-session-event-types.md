# Agent Note: Treat mounted plugin SessionEventMap keys as known

Status: implemented

English | [中文](2026-08-31-mounted-plugin-session-event-types.zh.md)

## Problem

Plugins declaration-merge `SessionEventMap` and append those events without `ignorable: true`, because the events are required to reconstruct plugin-owned UI. The persistence read path only consulted the repository-generated `KNOWN_SESSION_EVENT_TYPES` set, so a stored session containing `lowcode/surface-open` (and the rest of `@alayai/dsh-elite-lowcode`'s map) was refused as a newer harness log even when that plugin was mounted.

[Retain ignorable](2026-08-30-retain-ignorable-external-session-events.md) keeps `ignorable` as the omission-safety marker and rejected using event-name registration as a *replacement* for that marker. It did not give declaration merging a runtime counterpart, so required plugin events already on disk could not reload.

## Decision

`validateStoredEvents` treats a type as known when it is in `KNOWN_SESSION_EVENT_TYPES` or harvested from a currently mounted out-of-repo plugin's published `.d.ts` `SessionEventMap` members. Harvest runs from the `SessionPersistence` constructor on the backend's Loader: an activation scan plus each later `internal/plugin` fiber, resolved through `ctx.baseUrl`. First-party `@deepseek-ai/` packages are skipped. Plugin unload decrements the process-wide extra-type refcount. Unknown types still refuse unless the stored envelope carries `ignorable: true`.

This is the runtime counterpart of TypeScript declaration merging. It does not classify whether omitting an event is safe, and it does not replace `ignorable`.

## Alternatives considered

**Mark every `lowcode/*` event `ignorable` in the plugin and rewrite stored logs.** Rejected because those events are required for the Elite-Lowcode tab, the installed plugin does not set the marker, and existing jsonl lines have no `ignorable` field.

**Hard-code `lowcode/*` into the generated known set.** Rejected because that set is this repository's `SessionEventMap` catalog; out-of-repo names do not belong there.

**Treat every unknown event as ignorable.** Rejected by [retain ignorable](2026-08-30-retain-ignorable-external-session-events.md): a reader cannot infer that an unrecognized durable event is informational.

**Require each plugin to call a new registration API.** Rejected because installed builds such as `@alayai/dsh-elite-lowcode@0.1.0` do not call it, and harvest of the published `SessionEventMap` already names the same keys.

## Consequences

A session that contains required out-of-repo events reloads when the declaring plugin is mounted in that process. The same log still refuses if the plugin is absent. `ignorable` remains required for informational events whose writers are not mounted and whose types are not in the generated set.
