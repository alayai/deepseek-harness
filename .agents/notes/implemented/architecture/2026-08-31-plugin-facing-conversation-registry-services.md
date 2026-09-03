# Agent Note: Provide conversationEvents and conversationViews as Cordis services

Status: implemented

English | [中文](2026-08-31-plugin-facing-conversation-registry-services.zh.md)

## Problem

Installed web-profile client plugins inject Cordis services `conversationEvents` and `conversationViews`, then call `ctx.conversationEvents.register` and `ctx.conversationViews.register`. The current owner is `ctx.uiConversation`; its `events` and `views` registries are not provided under those service names. Boot waits for every client fiber to be ACTIVE, then reports `@alayai/dsh-elite-lowcode: pending (waiting for services: conversationEvents, conversationViews)` and keeps the boot page on "Failed to load plugins".

## Decision

`UiConversation` provides `conversationEvents` and `conversationViews` as the same objects as `this.events` and `this.views`. In-repository packages keep injecting `uiConversation` and calling `ctx.uiConversation.events` / `ctx.uiConversation.views`. Both spellings remain valid. This is the Cordis-service counterpart of keeping plugin-facing names on package exports ([settings and LLM helpers](2026-08-31-plugin-facing-settings-and-llm-helpers.md)) and of seeding plugin-facing store specifiers ([runtime store identity](2026-08-31-seed-client-runtime-store-identity.md)).

## Alternatives considered

**Leave the names unprovided and rebuild every plugin against `uiConversation`.** Rejected because the failing bundles live outside this repository. Their installed `lib/client.js` injects the old service names, and this tree cannot change those artifacts in the same boot.

**Wrap the registries in a restored `dsh-client-runtime` plugin that provides the names.** Rejected because the registries already exist on `UiConversation`; a second plugin would split ownership or duplicate the objects.

**Tell operators to uninstall `@alayai/dsh-elite-lowcode`.** Rejected because a profile that already mounted it is a supported composition; missing injected services must not take down the whole client plugin tree.

## Consequences

A client plugin that injects `conversationEvents` and `conversationViews` activates once `ui-conversation` has constructed `UiConversation`. Removing either name requires updating those installed plugins first.
