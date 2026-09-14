# Agent Note: Dedicated RPC channels read webServer from the service store

Status: implemented

English | [中文](2026-09-14-connection-rpc-handle-webserver-get.zh.md)

## Problem

`ctx.connection.rpc.handle` registers a physical HTTP prefix on `webServer`. The Connection service rebinds `this.ctx` to the caller fiber, so `ctx.webServer` required that fiber to inject `webServer`. Out-of-repo plugins such as `@alayai/dsh-model-hub-pro` inject only `connection` and failed at load with `cannot get property "webServer" without inject`.

## Decision

`HostConnectionService.register` reads `webServer` through `ctx.get('webServer')` and still installs the route as an effect on the caller fiber. A missing server fails with `connection: dedicated RPC channels require an active webServer`. Callers keep injecting `connection`; they do not declare `webServer`. The [ACP inject postmortem](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) owns the property-proxy versus `ctx.get` distinction.

## Alternatives considered

**Require every RPC registrant to inject `webServer`.** Dedicated channels are a Connection API. Forcing a second inject on every Host plugin repeats the topology that already broke ACP.

**Register the route on Connection's own fiber.** Disposal would outlive the registrant. Channel ownership stays with the caller.

## Consequences

A plugin that injects `connection` can mount a dedicated channel whenever a `webServer` is in the process store. Absence of that server still fails at `handle()`. Shared `/api` interceptors are unchanged.

## Testing

[Host connection tests](../../../../packages/client/connection/tests/node-half.host.spec.ts) cover a nested plugin that injects only `connection`, and a process with no `webServer`.
