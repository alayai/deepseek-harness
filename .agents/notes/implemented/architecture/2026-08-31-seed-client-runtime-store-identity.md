# Agent Note: Seed plugin-facing client-runtime specifiers as the store identity

Status: implemented

English | [中文](2026-08-31-seed-client-runtime-store-identity.zh.md)

## Problem

Installed web-profile client bundles `require("@deepseek-ai/dsh-client-runtime/client")` for `createSnapshotStore`. That specifier is not a platform seed word, not a boot-graph row, and not a registered factory: `packages/client/runtime` is gone, and `createSnapshotStore` lives on `@deepseek-ai/dsh-client-store`, which the shell already seeds under its own exact key. Seed matching is exact, including a trailing `/client`, so the store seed does not answer the runtime specifier. The loader then throws `missed the module table` while importing the `dsh-at-file` entry, and the boot page stays on "Failed to load plugins". `dsh.client.inject` of the runtime package name is informational and cannot invent a missing graph row.

## Decision

`PLATFORM_MODULES` and `getStaticModules()` seed `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-runtime/client` as the same object as `@deepseek-ai/dsh-client-store`. They are extra exact static-table keys, not a general `dsh.client.provide` alias protocol and not a restored runtime package. A synchronous `require` of either specifier receives `createSnapshotStore` from that identity. In-repository client source keeps importing `@deepseek-ai/dsh-client-store`.

This is the module-table counterpart of keeping plugin-facing names on package exports ([settings and LLM helpers](2026-08-31-plugin-facing-settings-and-llm-helpers.md)). The [client shells decision](2026-08-15-client-shells-and-dynamic-packages.md) still rejects a general module-provider declaration; these two keys are additional exact suppliers of the store identity already in the table.

## Alternatives considered

**Leave the specifiers unseeded and rebuild every plugin against `dsh-client-store`.** Rejected because the failing bundles live outside this repository. Their installed `lib/client.js` already externalizes the runtime specifier, and this tree cannot change those artifacts in the same boot.

**Restore `packages/client/runtime` as a dynamic graph row that re-exports the store.** Rejected because a graph row would reintroduce a Loader entry and a client bundle for a package that no longer exists as an owner. The value these bundles need is already a static seed; a second arrival path would split identity or duplicate the store.

**Strip `/client` when looking up seed words.** Rejected because seed keys are exact on purpose: `react-dom` and `react-dom/client` are distinct identities. Suffix stripping remains the graph-row alias only.

**Tell operators to uninstall `dsh-at-file`.** Rejected because a profile that already mounted it is a supported composition; a missing seed word must not take down the whole client plugin tree.

## Consequences

A client bundle that requires the runtime specifiers for `createSnapshotStore` loads. A bundle that required other runtime-only values from that former package still fails at the call site, not at module-table lookup. Removing the extra keys requires updating those installed bundles first.
