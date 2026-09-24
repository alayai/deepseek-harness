# Agent Note: Preserve plugin API routes in the Desktop carrier

Status: implemented

English | [中文](2026-09-24-desktop-plugin-api-routes.zh.md)

## Problem

The Desktop Host forwards renderer requests through a framed `dsh-app://` carrier instead of a listening HTTP server. Its dispatcher sent every `/api/*` request directly to the core Connection handler, so a plugin route registered on `ctx.webServer` under `/api/<plugin>` was never considered. The Client half could render its panel, but its first data request returned HTTP 404.

## Decision

Desktop dispatches every request through `webServer.fetchNamed()` before falling back to the core `/api` handler. Asset bundle paths and the internal remote stream keep their dedicated handlers. The HTTP carrier represents `dsh-app://` named-route requests as an in-process loopback: it supplies a loopback Host and socket address and removes browser Origin markers that have no meaning across the pipe. This lets loopback-protected plugin routes accept Desktop requests without weakening network access rules.

## Alternatives considered

**Keep `/api/*` exclusive to Connection.** This preserves the old dispatch shortcut but makes any plugin-owned API route unreachable in Desktop, even though the same route works in the listening Web composition.

**Move the skill-explorer routes into the core Connection registry.** The route owner is the plugin and its raw HTTP handlers include filesystem-specific security and binary-compatible responses; moving them would couple the core API to one optional plugin and would not repair other WebServer plugins.

**Disable the plugin's loopback guard for Desktop.** This would make the feature work by weakening its network protection. The carrier instead supplies the same loopback facts that a local HTTP request has, while remote requests continue to require the plugin's existing fence.

## Consequences

Desktop supports optional plugins that register exact `/api/*` routes, with core API handling remaining the fallback for paths without a named route. The custom carrier's loopback metadata is limited to `dsh-app://` named-route dispatch and is not exposed on a network socket. Static-resource stream compatibility is recorded separately in [the Desktop Node-stream carrier note](2026-09-24-desktop-plugin-static-stream-carrier.md).

## Testing

The WebServer carrier regression checks that a `dsh-app://` named route observes loopback Host and socket metadata. The Desktop Host dispatcher now exercises the same named-route-first ordering for plugin API paths before invoking the core API fallback.
