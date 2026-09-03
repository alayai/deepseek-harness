# Agent Note: 将 conversationEvents 与 conversationViews 作为 Cordis 服务提供

Status: implemented

[English](2026-08-31-plugin-facing-conversation-registry-services.md) | 中文

## 问题

已安装的 web profile 客户端插件会 inject Cordis 服务 `conversationEvents` 与 `conversationViews`，再调用 `ctx.conversationEvents.register` 和 `ctx.conversationViews.register`。当前归属方是 `ctx.uiConversation`；它的 `events` 与 `views` registry 并没有以这些服务名提供。Boot 会等待每个客户端 fiber 进入 ACTIVE，随后报告 `@alayai/dsh-elite-lowcode: pending (waiting for services: conversationEvents, conversationViews)`，启动页停在 “Failed to load plugins”。

## 决定

`UiConversation` 将 `conversationEvents` 与 `conversationViews` 提供为与 `this.events`、`this.views` 相同的对象。仓库内的包继续 inject `uiConversation` 并调用 `ctx.uiConversation.events` / `ctx.uiConversation.views`。两种写法都有效。这是在包导出上保留面向插件名字（[settings 与 LLM 辅助函数](2026-08-31-plugin-facing-settings-and-llm-helpers.zh.md)）以及播种面向插件的 store specifier（[runtime store 身份](2026-08-31-seed-client-runtime-store-identity.zh.md)）在 Cordis 服务上的对应物。

## 曾考虑的替代方案

**不提供这些名字，并让每个插件按 `uiConversation` 重建。** 不予采用，因为失败的 bundle 位于本仓库之外。它们已安装的 `lib/client.js` inject 旧服务名，本树无法在同一次启动中改动那些产物。

**用恢复的 `dsh-client-runtime` 插件包装这些 registry 并提供这些名字。** 不予采用，因为 registry 已经在 `UiConversation` 上；第二个插件会分裂归属或复制对象。

**让运维卸载 `@alayai/dsh-elite-lowcode`。** 不予采用，因为已经挂载它的 profile 是受支持的组合；缺失的 inject 服务不得拖垮整棵客户端插件树。

## 影响

inject `conversationEvents` 与 `conversationViews` 的客户端插件会在 `ui-conversation` 构造完 `UiConversation` 后激活。删除其中任何一个名字都需要先更新那些已安装的插件。
