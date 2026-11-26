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

Refresh and choose a tenant and workspace, then refresh resources. The Sandbox, Conversation, Files, Private desktop, Tasks, and Settings sections keep operations separate. Allocate a sandbox, start it, and submit a cloud command. Settings saves cloud model credentials and offers Aiconvert and DeepSeek demo templates for allowed origins; choosing one fills the endpoint and model, while you enter the key separately. Workspace models are read separately from sandboxes and desktops. A failed request offers a retry; an empty catalog links to cloud model settings. Conversation creates cloud sessions. File actions use relative paths inside the selected sandbox. RustFS upload transfers only the file you select. Desktop actions allocate and control cloud desktops through screenshot, typing, and offline browser requests.

In **Files**, edit UTF-8 text up to 16 KiB. If a save response is lost, reconnect with the same account and reopen the same sandbox. **Check original save** checks the receipt without sending another write. Drafts stay in this Client until logout or reload. After cancellation, timeout, or a version conflict, copy the draft before reopening the file to compare it. Before publishing to RustFS, check the displayed source path; publication uses the bytes from that read.

In cloud mode, open **Cloud resources → Conversation** to create or select a session, then choose **Go to cloud conversations**. The main panel lists the selected Workspace’s cloud sessions and sends text directly to dsh-server. Enter sends and Shift+Enter adds a line. Cloud resources continue to open from the main panel.

The main conversation uses the shared DSH composer, user message bubbles, Markdown and expandable tool rows. The cloud Bot filter groups existing conversations without changing their pinned revisions. With DS Bot active, its sidebar and chat components display the cloud conversation. Creating a Bot selects it for a new conversation and leaves existing bindings unchanged. In Conversation, select a running sandbox and a model credential. If the workspace has no sandbox, use **Allocate sandbox** there. If the selected sandbox is stopped, choose **Start**. A private desktop is optional. Without its presentation plugin, **Native chat layout** switches the fallback layout. The Tasks tab pages through the selected sandbox’s history; its newest page refreshes automatically.

The server fixes each session’s sandbox, model credential, optional desktop and optional published Workspace Bot revision. The main chat checks the binding and submits its revision; browsing resources cannot redirect a turn. Create a new session to change resources. Cancel requests a stop and tracks the original task until the server confirms the outcome. The Client can look up a lost acceptance receipt by its original key after reconnecting to the same server and account. A missing receipt does not prove the task was never queued, and lookup never resends the message. Restarting the Client clears its request key; an updated API reports queued, running or unknown work on the selected binding. Unknown work blocks another turn until reconciled or you start a separate conversation.

Expand **Local history and Bots · read only** to request Host-local previews. Conversation pages expose IDs and creation dates; an explicit selection reads user and assistant text, newest page first. Tool payloads, reasoning, request headers, attachments and working directories are excluded. DS Bot supplies `ctx.botReadOnly` v1 from its already loaded roster: names, roles, bounded instructions and model references, including private settings only for the Host owner. Public Bots also expose a separate `dshCloud/exportLocal` action: only an explicit user click can copy a complete name, role and instruction definition to the selected Workspace. Private Bots, local model credentials, folders, skills, connectors, memory and history are never exported. The client persists only server/user/tenant/Workspace identities, Bot IDs, revision/version numbers, digests and timestamps, so it can detect local changes after a reload without storing instructions, credentials, files, history or tokens. An absent or uninitialized provider is shown explicitly; reading never loads or refreshes the roster. Text you previously entered can contain sensitive information. Nothing in this preview is uploaded, copied into a cloud prompt, or continued locally. Cloud pause still permits these owner-only reads; generation changes discard pending results. Use **Go to cloud conversations** to select resources and create a separate conversation.

Local plugin lists, directory selection, and registering a selected existing directory as a workspace remain available during sign-in, cloud use, and cloud pause. Selecting a directory does not create a local workspace until you explicitly submit the workspace action, and it never transfers files to the server. Local plugin installation, removal, updates, enablement changes, directory creation, workspace renaming or deletion, and Agent or tool execution remain blocked until you sign out and return to local mode.

Select **Sign out and return to local** to restore local use. A failed local drain or unconfirmed server revocation keeps local execution blocked; retry after the reported service becomes available. The Client retains the latest submitted task reference per workspace in memory while views close and reopen. Query original task reads the same operation; it never resubmits it. A lost acceptance response retains its idempotency key and path. Sign-in, sign-out, Client reload, and plugin unload clear this temporary index. Server task history remains authoritative; tasks are not replayed or copied to local DSH.

RustFS must allow the exact DSH page origin in its bucket CORS rules before direct uploads. Add that origin to dsh-server’s `CORS_ORIGINS`, then run `pnpm storage:init` in the server repository. A different DSH port is a different origin; no wildcard is required.

Files above 8 MiB use RustFS multipart. The Client stores only a bounded, browser-local upload receipt: server/user/tenant/Workspace scope, object ID, filename, size, expiry and a SHA-256 fingerprint built from fixed-size block digests. It never stores presigned URLs, bearer tokens or file bytes. If parts are missing after a reload, select the same file to validate the fingerprint and resume the transfer. A different file is rejected before a server session is queried; expired receipts can be cleared from the panel.

The Client uploads up to three missing parts at a time. A network error, timeout or temporary HTTP failure on a part PUT gives that part up to two retries, each with a fresh signed URL. Pausing cancels active PUTs and scheduled retries. If a part cannot be uploaded, the session remains available for resume, and the Client does not request completion.

With the default synchronous upload, the server verifies the file before publication. If scanning is busy or unavailable, or the completion response is lost, use **Retry publishing** to send completion for the same object without another upload. A blocked upload cannot be published from the panel. Discard the multipart session or clear the small-file selection. This completion shortcut lasts only in the open panel; resuming a synchronous multipart upload after a reload requires the original file.

For files above 8 MiB and within the limit advertised by the server, select **Scan in the background before publishing** to queue the file after transfer. This is off by default; older servers keep the synchronous path. With a saved, unexpired receipt, reopen the same folder in the same browser under the original server, account, tenant and workspace. **Check publication status** reads the original object without selecting or uploading the file again. If all parts were sent but the server still reports an unsubmitted upload, use **Submit uploaded parts for scanning**. Only a published object can be downloaded.

In **Cloud files → Workspace files**, browse folders, upload into the selected folder and download published objects. With Workspace write access you can create folders, rename or move items, remove empty folders, and send files to the recycle bin or restore them. If a write conflicts with a newer revision or its outcome is unclear, check the refreshed list before trying again.

Sign-in requires server-info cloud protocol 1 and a client range containing 1. Missing or incompatible contracts pause the cloud target while retaining issued authority for explicit logout. Settings → Version diagnostics reads the API and Worker report without modifying resources. Worker readiness controls execution features independently; unavailable features do not restore local execution. Upgrade API, Worker and DSH Host/Client together in maintenance; this login check does not make mixed old API nodes safe.

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
| [CloudChat.tsx](src/client/CloudChat.tsx) | Main cloud conversation, history and message entry |
| [CloudPanel.tsx](src/client/CloudPanel.tsx) | Cloud resource controls |
| [CloudObjectBrowser.tsx](src/client/CloudObjectBrowser.tsx) | Workspace folders, published objects and recycle bin |
| [upload-resume.ts](src/client/upload-resume.ts) | Bounded browser-local multipart receipts and block fingerprints |
| [multipart-transfer.ts](src/client/multipart-transfer.ts) | Concurrent part uploads, bounded retries and cancellation |

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

- Cloud conversations display persisted provider SSE text deltas, replaced by the final assistant message. Tool calls/results pair by operation and call ID with collapsible details. Events and cursor commit atomically in Client memory across conversation remounts; reloading the Client starts server replay again. The cache holds up to four sessions, 2,000 events and about two million JSON characters per session. Cloud history stays separate from local Sessions.
- Navigation and latest-task references survive tab closure within one Client lifetime, but not reload or a new sign-in. Closing a view cancels local upload/polling work, not accepted cloud tasks. Different windows have separate view state.
- If a Sandbox command, start or stop loses its submission response, use **Query original task** in the original workspace and Sandbox. This reads the receipt by the original key, then reads the task status; it never submits the action again. An empty lookup does not prove the operation failed. The same window can recover after reconnecting to the same server and account. Leaving cloud mode, changing server or reloading the client clears these in-memory references. This requires the server API with the runtime task receipt endpoint.
- Use **Load more workspaces** to extend the workspace list. In chat and the resource panel, **Load older conversations** adds the next 20 sessions without switching conversations. Choosing a Bot keeps its selected session or opens its newest visible session, even if it predates the latest 100 workspace conversations. This requires the paginated sessions API; older servers return at most 100 and cannot confirm an older Bot conversation is absent. Cloud events remain separate from local Session history.
- If the API confirms that the previously selected session is no longer visible, choosing a Bot can still open its newest visible conversation. If the lookup fails or returns a different session ID, the selection stays unchanged. Opening resources from the sidebar while the lookup is pending keeps you in resources.
- The workspace models settings page and the new conversation form both support **Load more models**. Each request adds up to 20 of your credential references. If the request fails, the current list and selection remain available; use the same button to retry. An older API can still return its latest 100 credentials, but cannot list anything beyond them.
- The files view explicitly publishes successful Sandbox file reads to RustFS, with source-operation receipts and download controls. Unknown responses retain the original idempotency key for an explicit retry. Receipts live in Client memory. The 16 KiB limit and the server's publication policy apply.
- Multipart receipts are saved in browser-local storage. Resuming the transfer requires the original file; checking an asynchronous publication does not. Validation reads one 8 MiB block at a time, but a browser without Web Crypto cannot resume a stored receipt. Real network performance, capacity and installed Windows Desktop acceptance remain open.
- The desktop view opens an interactive noVNC window through a Host-owned loopback WebSocket bridge. Upstream bearer tokens and tickets stay in the Host. The viewer URL carries a short-lived random capability and works only on the Host machine; suspension/logout closes the bridge. Video is not embedded in the sidebar.
- Changing the browsing sandbox clears the private desktop selection. Select a desktop in the new sandbox; the panel checks its runtime and state before enabling controls. A stopped desktop can be started; connecting, taking a screenshot, typing and browsing require a confirmed running desktop. Use **Recheck desktop** if its state changes elsewhere. Switching targets while a request is in flight discards its late viewer or screenshot response; it does not cancel accepted server work.
- Updated API/Worker and `dsh-agent:0.4.2` register restricted `cloud_computer`/`cloud_browser` tools only for desktop-bound sessions. Browsing remains offline. Model screenshot attachments and real vision-task acceptance remain open, as does complete local Bot adaptation.
- Access tokens live in Host memory without refresh-token persistence. Restarting the Host starts a new local session; it does not restore cloud authority. Existing Clients must reload to establish the new state.
- Admission controls cover registered application paths; trusted plugins that access the operating system directly require separate confinement. Windows installed-Desktop acceptance remains separate from Web verification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
