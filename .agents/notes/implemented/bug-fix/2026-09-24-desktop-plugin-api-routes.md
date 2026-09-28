# Agent Note: Preserve plugin API routes in the Desktop carrier

Status: implemented

English | [中文](2026-09-24-desktop-plugin-api-routes.zh.md)

## Problem

The Desktop Host forwards renderer requests through a framed `dsh-app://` carrier instead of a listening HTTP server. Its dispatcher originally sent every `/api/*` request directly to the core Connection handler, so a plugin route registered on `ctx.webServer` under `/api/<plugin>` was never considered. The first route-order fix sent `/api/*` through WebServer first, but that also hit the browser-authenticated core `/api` prefix and returned 401 for every Desktop RPC, so history and workspace data appeared empty.

## Decision

Desktop dispatches the core `/api` handler first, bypassing the browser-only authentication fence. Only a core 404 falls through to `webServer.fetchNamed()` for a plugin-owned `/api/*` route. Other named routes still use WebServer before static assets, and asset bundle paths plus the internal remote stream keep their dedicated handlers. The HTTP carrier represents `dsh-app://` named-route requests as an in-process loopback: it supplies a loopback Host and socket address and removes browser Origin markers that have no meaning across the pipe. This keeps plugin routes reachable without routing core RPCs through browser authentication.

## Alternatives considered

**Keep `/api/*` exclusive to Connection.** This preserves the old dispatch shortcut but makes any plugin-owned API route unreachable in Desktop, even though the same route works in the listening Web composition.

**Always dispatch WebServer first.** Rejected because the core Connection prefix is itself a WebServer route and requires browser authentication; an internal `dsh-app://` request must bypass that fence.

**Move the skill-explorer routes into the core Connection registry.** The route owner is the plugin and its raw HTTP handlers include filesystem-specific security and binary-compatible responses; moving them would couple the core API to one optional plugin and would not repair other WebServer plugins.

**Disable the plugin's loopback guard for Desktop.** This would make the feature work by weakening its network protection. The carrier instead supplies the same loopback facts that a local HTTP request has, while remote requests continue to require the plugin's existing fence.

## Consequences

Desktop supports optional plugins that register exact `/api/*` routes while preserving core RPC access. Core API handling owns every non-404 API response; named plugin dispatch is the fallback for paths without a core endpoint. The custom carrier's loopback metadata is limited to `dsh-app://` named-route dispatch and is not exposed on a network socket. Static-resource stream compatibility is recorded separately in [the Desktop Node-stream carrier note](2026-09-24-desktop-plugin-static-stream-carrier.md).

## Testing

The WebServer carrier regression checks that a `dsh-app://` named route observes loopback Host and socket metadata. The Desktop Host routing regression checks that core API responses bypass WebServer authentication and that a core 404 reaches a plugin API route.
