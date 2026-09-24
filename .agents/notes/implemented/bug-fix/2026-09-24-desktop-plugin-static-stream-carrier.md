# Agent Note: Keep Node stream compatibility in the Desktop HTTP carrier

Status: implemented

English | [中文](2026-09-24-desktop-plugin-static-stream-carrier.zh.md)

## Problem

Desktop dispatches named WebServer routes through a simulated `node:http` response. Third-party plugins commonly serve HTML assets with `createReadStream(file).pipe(res)`. The carrier previously lacked the EventEmitter methods and completion events that Node's `Readable.pipe()` requires, so the document route could return `200` while JavaScript and CSS requests failed with `TypeError: dest.emit is not a function`, leaving the plugin page blank.

## Decision

The Desktop HTTP carrier exposes the minimal EventEmitter lifecycle used by Node streams: listener arguments, `emit()`'s boolean result, `prependListener()`, `once()`, `removeListener()`/`off()`, and `listenerCount()`. Completing `res.end()` emits `finish` before `close`, allowing `Readable.pipe()` to clean up its listeners. The carrier keeps its existing WHATWG stream body and does not bind a socket.

## Alternatives considered

**Buffer static files in each plugin.** This duplicates transport logic in optional plugins and leaves other stream-based routes exposed to the same failure.

**Bypass WebServer for plugin assets.** This would avoid the simulated response but would remove the route owner's path checks, headers, and lifecycle from Desktop dispatch.

**Add only `emit()`.** The first write would succeed, but `pipe()` would still fail while removing `finish`/`close` listeners, or leave stale listeners after completion.

## Consequences

Desktop named routes can stream binary and text assets through the same handlers used by the listening WebServer. The carrier intentionally implements only the stream lifecycle needed by route handlers; it is not a general replacement for `node:http.ServerResponse`.

## Testing

The WebServer carrier test pipes a `Readable` into a `dsh-app://` named route and asserts the complete body. A smoke check against the installed `deepseek-idesign` package's real route returns its JavaScript asset with status `200`, the expected content type, and the full byte count. The API-route carrier behavior remains covered by [the related Desktop API-route note](2026-09-24-desktop-plugin-api-routes.md).
