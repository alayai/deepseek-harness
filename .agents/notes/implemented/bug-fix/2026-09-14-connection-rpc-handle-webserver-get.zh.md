# Agent Note: 独立 RPC 通道从服务表读取 webServer

Status: implemented

[English](2026-09-14-connection-rpc-handle-webserver-get.md) | 中文

## Problem

`ctx.connection.rpc.handle` 会在 `webServer` 上注册物理 HTTP 前缀。Connection 服务把 `this.ctx` 重绑到调用方 fiber，因此 `ctx.webServer` 要求该 fiber inject `webServer`。仓库外插件（例如 `@alayai/dsh-model-hub-pro`）只 inject `connection`，加载时以 `cannot get property "webServer" without inject` 失败。

## Decision

`HostConnectionService.register` 通过 `ctx.get('webServer')` 读取服务，并仍把路由作为调用方 fiber 的 effect 安装。缺少 server 时以 `connection: dedicated RPC channels require an active webServer` 失败。调用方继续 inject `connection`，不必声明 `webServer`。属性代理与 `ctx.get` 的区分见 [ACP inject postmortem](../../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)。

## Alternatives considered

**要求每个 RPC 注册方都 inject `webServer`。** 独立通道是 Connection API。给每个 Host 插件再加一次 inject 会重复 ACP 已经踩过的拓扑。

**把路由挂在 Connection 自己的 fiber 上。** 释放会比注册方活得更久。通道所有权仍归调用方。

## Consequences

inject `connection` 的插件只要进程服务表里有 `webServer`，就可以挂载独立通道。没有该服务时仍在 `handle()` 失败。共享 `/api` interceptor 不变。

## Testing

[Host connection 测试](../../../../packages/client/connection/tests/node-half.host.spec.ts) 覆盖只 inject `connection` 的嵌套插件，以及没有 `webServer` 的进程。
