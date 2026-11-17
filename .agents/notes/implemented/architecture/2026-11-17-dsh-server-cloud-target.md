# Agent Note: Host-owned dsh-server cloud target

Status: implemented

English | [中文](2026-11-17-dsh-server-cloud-target.zh.md)

## Problem

DSH users need cloud workspaces and isolated remote resources while retaining their existing local workflow before login. Merely forwarding selected tools leaves local APIs, uploads, and already-running tasks able to execute on the client machine. Network failures must not silently move cloud work to local DSH.

## Decision

The [cloud server package](../../../../packages/cloud/server/README.md) owns one execution target per Host. Login reserves the target synchronously, closes local admission, and waits for registered local work to settle before PKCE. Access tokens remain in Host memory. The application-selected generated Remote exposes display state and bounded server requests only to the Host owner.

API Gateway supplies generic fiber-owned `guard` and `drain` operations. The cloud owner applies them alongside connection HTTP admission, tool guards, and the Agent pre-step hook. Stream cleanup and unary continuations must settle; a timeout keeps cloud admission suspended. Epoch changes reject stale replies. Logout serializes revocation, and failure leaves local execution blocked.

The client mounts a cloud resource view through `shell.overlay`. It uses server-owned tenant, workspace, sandbox, session, file, object, and desktop APIs. It does not change Agent-loop semantics or reinterpret server events as local Session records.

## Alternatives considered

**Install the service tarball as a Desktop plugin.** The service package does not supply the native Client composition, and installing it cannot route all existing resource paths. The DSH integration therefore lives in a typed Host/Client package.

**Keep local tools available during cloud use.** This permits accidental local execution after a remote failure. The selected target instead blocks local business entry points until explicit logout.

**Rewrite the existing conversation controller first.** Cloud operations have server-owned identities and durable operation outcomes. A separate view preserves those semantics and permits integration without changing released local Session behavior.

## Consequences

Users get an explicit cloud target and fail-closed recovery. A failed revocation can block return to local until the server is reachable. The target is Host-wide rather than per window. Native conversation bubbles, interactive noVNC, pagination, and persistent login remain outside the current view. The package’s application guards do not confine arbitrary trusted-plugin operating-system access.

## Verification

Focused tests cover target reservation, stale replies, authority revocation, concurrent logout, stream admission, and cleanup ordering. Shipped-profile Client assembly tests exercise the package with the default local-state mock. Actual Web PKCE testing uses an isolated Host profile and the development dsh-server; installed Windows Desktop acceptance remains a separate check.
