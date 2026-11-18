---
description: "Sign in to dsh-server and use cloud workspaces, sandboxes, conversations, RustFS objects, and private desktops from DSH."
kind: "package-reference"
---

# @deepseek-ai/dsh-cloud-server

English | [中文](README.zh.md)

## Summary

Sign in to dsh-server from the DSH cloud entry to work with cloud resources. Local mode preserves the existing DSH workflow. Starting sign-in stops local tasks and blocks new local business calls. Cloud failures pause execution until you reconnect or explicitly sign out; they never select local execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web composition mounts this package for Web and Desktop clients. Run `pnpm run dev:web` or `pnpm run dev:desktop` from the repository root, then open **DSH cloud**. With a Session on screen, the sidebar footer status entry opens the existing right sidebar; without a Session, it opens the cloud management page. The left navigation also provides that management page. Closing or hiding either view does not sign out or restore local execution. Enter the dsh-server origin, such as `http://localhost:17800`, and finish the identity-provider login in the browser window. The server must expose the native PKCE discovery endpoint for the `dsh-desktop` public client.

Use HTTPS for a remote server; HTTP is accepted only for loopback development. The browser that completes login must reach the Host machine’s loopback callback. A remotely hosted DSH Host and a browser on another machine need a different callback transport.

Refresh and choose a tenant and workspace, then refresh resources. The Sandbox, Conversation, Files, Private desktop, Tasks, and Settings sections keep operations separate. Allocate a sandbox, start it, and submit a cloud command. Settings saves cloud model credentials; Conversation creates cloud sessions. File actions use relative paths inside the selected sandbox. RustFS upload transfers only the file you select. Desktop actions allocate and control cloud desktops through screenshot, typing, and offline browser requests.

Cloud conversations have server-owned bindings for their sandbox, model credential and optional desktop. Refresh the binding before sending from an existing conversation. The resource summary shows the bound target; browsing resources does not change it. Send carries the displayed binding revision. Disable binding cancels its tasks and blocks new turns; enable it after those tasks settle. Create a new conversation to change resources. An unknown task outcome blocks further turns in that conversation until reconciled. The server must apply the binding migration and update both API and Worker.

Expand **Local history and Bots · read only** to request Host-local previews. Conversation pages expose IDs and creation dates; an explicit selection reads user and assistant text, newest page first. Tool payloads, reasoning, request headers, attachments and working directories are excluded. DS Bot supplies `ctx.botReadOnly` v1 from its already loaded roster: names, roles, bounded instructions and model references, including private settings only for the Host owner. An absent or uninitialized provider is shown explicitly; reading never loads or refreshes the roster. Text you previously entered can contain sensitive information. Nothing in this preview is uploaded, copied into a cloud prompt, or continued locally. Cloud pause still permits these owner-only reads; generation changes discard pending results. Use **Go to cloud conversations** to select resources and create a separate conversation.

Select **Sign out and return to local** to restore local use. A failed local drain or unconfirmed server revocation keeps local execution blocked; retry after the reported service becomes available. The Client retains the latest submitted task reference per workspace in memory while views close and reopen. Query original task reads the same operation; it never resubmits it. A lost acceptance response retains its idempotency key and path. Sign-in, sign-out, Client reload, and plugin unload clear this temporary index. Server task history remains authoritative; tasks are not replayed or copied to local DSH.

RustFS must allow the exact DSH page origin in its bucket CORS rules before direct uploads. Add that origin to dsh-server’s `CORS_ORIGINS`, then run `pnpm storage:init` in the server repository. A different DSH port is a different origin; no wildcard is required.

### Composition

This package has no plugin configuration fields. The application selects its generated Remote through API Remotes and mounts its Host and Client halves with the following row. It does not declare a profile-layer bundle; the dsh-server service tarball is not a Desktop plugin to install.

```yaml
- name: "@deepseek-ai/dsh-cloud-server"
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host owns PKCE, the temporary callback listener, access tokens, login epochs, and upstream requests. The Renderer receives display state and bounded JSON only. API Gateway guards, the connection request waterfall, tool guards, and the Agent pre-step hook stop local admission while the cloud target is reserved. Login waits for active Agents, terminals, Jobs, admitted Remote calls, and tracked HTTP handlers to settle.

Each business request carries the displayed epoch and workspace path. A changed epoch rejects late results. Network errors, authentication rejection, and expiry suspend the cloud target. Logout is serialized and waits for client continuations and server revocation or known token expiry before restoring local admission. Reconnection revokes the prior authority before issuing a replacement.

These are application admission controls, not an operating-system sandbox for trusted Host plugins. Server-side tenant authorization and runtime isolation remain the responsibility of dsh-server.

| File | Responsibility |
|---|---|
| [connection.ts](src/connection.ts) | Target lifecycle and authority ownership |
| [index.ts](src/index.ts) | Host Remote and local admission |
| [local-read.ts](src/local-read.ts) | Owner-only, bounded local display data without Agent activation |
| [CloudPanel.tsx](src/client/CloudPanel.tsx) | Cloud resource controls |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloud group](../README.md) — package ownership.
- [API Gateway](../../api/gateway/README.md) — invocation admission and drain.
- [Cloud target decision](../../../.agents/notes/implemented/architecture/2026-11-17-dsh-server-cloud-target.md) — ownership and tradeoffs.

-----

<a id="model-experience"></a>
## Model Experience

### Cloud prompts

#### What the model sees

The user submits `prompt` text to the selected cloud session. dsh-server owns that session’s model context and tools. This package adds no local model prompt or tool schema.

#### Token effect

Submitted text contributes to the cloud request; the server controls history and truncation. Status polling and resource controls add no local model tokens.

#### KV Cache effect

Cloud sessions are independent of local sessions. dsh-server and the selected provider own cache reuse; changing cloud sessions changes the request context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The cloud view has the following constraints.

- Cloud conversations display event text rather than the existing local conversation bubbles; history is replayed for each submitted prompt and the view retains the latest 2,000 events.
- Navigation and latest-task references survive tab closure within one Client lifetime, but not reload or a new sign-in. Closing a view cancels local upload/polling work, not accepted cloud tasks. Different windows have separate view state.
- Resource selectors read the first server page. Full pagination and persisted event cursors are absent.
- Desktop bindings are metadata; Agent computer/browser tools and local Bot-to-cloud adaptation remain separate work.
- The desktop view supports screenshot and text actions, not an interactive noVNC stream. The browser provider accepts offline URLs according to server policy.
- Access tokens live in Host memory without refresh-token persistence. Restarting the Host starts a new local session; it does not restore cloud authority. Existing Clients must reload to establish the new state.
- Admission controls cover registered application paths; trusted plugins that access the operating system directly require separate confinement. Windows installed-Desktop acceptance remains separate from Web verification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
