# DSH Cloud Native Conversation Bridge: Development Plan III

Status: Proposed; implementation has not started.

Scope: `@deepseek-ai/dsh-cloud-server`, DSH Host/Client, dsh-server conversation and event APIs, and DS-Bot Workspace Bot integration.

Prerequisite: close and accept the current cloud development plan before starting this plan.

## 1. Objective

The current cloud chat can show Workspace conversations, Bots, streaming text, tool cards, and task status inside the DSH layout. It still has an independent cloud state model: the client reads cloud events from the server, replays them in memory, and renders them through `CloudSessionTimeline`. Cloud events do not enter the local DSH Session read, observe, append, or UI subscription path.

Plan III adds `CloudSessionAdapter`. The adapter presents cloud conversations through the same source contract used by the native conversation UI while preserving server authority and local execution isolation. The cloud mode should reuse the DSH/DS-Bot conversation surface, message rendering, streaming state, tool cards, cancellation, recovery, and Bot selection experience. Execution remains owned by dsh-server and must never be redirected to a local Agent or local tool.

This plan connects cloud data to the local UI protocol. It does not move cloud execution into the Host. Cloud conversations, Bots, tools, and events remain server-owned; the client performs validated adaptation, display, and explicit action forwarding.

## 2. Current and target state

### 2.1 Current state

- Cloud mode overrides the main conversation slot with `CloudChat` while retaining the DSH layout, sidebar, and navigation shell.
- Cloud conversations use `/sessions`, `/sessions/{id}/events`, `/prompts`, binding, receipt, and operation APIs.
- `CloudChatTurns` keeps one prompt's submission, receipt, polling, cancellation, and recovery state in client memory.
- `projectCloudSessionEvents` projects cloud events into user, assistant, tool, and error display items.
- `CloudSessionTimeline` renders cloud messages and tool cards through a cloud-specific component.
- Workspace Bots are selected by cloud Bot id and revision; local Bots currently support explicit export to cloud.
- Cloud history is not written into local DSH Sessions, and cloud events do not enter the local Session observation stream.
- Host admission guards block local Agents, tools, jobs, and other local business calls while cloud mode is active.

### 2.2 Target state

1. The native UI depends on a unified conversation source for reading, observing, sending, and controlling conversations.
2. `CloudSessionAdapter` maps cloud APIs, cursors, receipts, operations, and events into that source contract and validates authority, epoch, revision, and permissions.
3. User messages, assistant deltas, final messages, tool calls, tool results, errors, cancellation, and recovery use one canonical rendering model.
4. Bot selection has one UI contract but clearly labels `local`, `cloud`, and `linked` sources; a cloud revision remains fixed for the lifetime of a bound conversation.

## 3. Gate: finish the current development plan first

Plan III must not be implemented or merged together with unfinished baseline cloud work. Close the following current-plan items and retain reviewable evidence for each item.

| ID | Baseline workstream | Done means | Required evidence |
| --- | --- | --- | --- |
| C-01 | Cloud target lifecycle | Login, suspend, logout, reconnect, epoch changes, and local admission blocking are stable. | Host/Client lifecycle tests, stale-epoch tests, logout-failure tests. |
| C-02 | Cloud resource panel | Tenant, Workspace, sandbox, credentials, conversations, files, objects, desktop, tasks, and settings work under the existing protocol. | Panel tests, server contract tests, error-state evidence. |
| C-03 | Basic cloud chat | Conversation creation, binding, prompt submission, operation polling, cancellation, lost-receipt recovery, and unknown outcomes work. | `chat-turns` tests and a real development-server record. |
| C-04 | Basic cloud Bot support | Workspace Bot list, revision display, Bot creation, conversation binding, and explicit local-Bot export work. | Bot API tests, panel tests, real Workspace verification. |
| C-05 | Cloud event replay | Cursor paging, duplicate removal, assistant deltas, tool call/result merging, terminal failures, and refresh recovery are stable. | Event and timeline tests plus replay evidence. |
| C-06 | Files and upload | Small-file actions, multipart upload above 8 MiB, receipt recovery, cancellation, and failure messages match the current protocol. | File tests, weak-network/refresh evidence, object receipt checks. |
| C-07 | Desktop relay | Host ownership, short-lived capabilities, suspension/logout cleanup, and errors are stable. | Relay tests and development desktop acceptance. |
| C-08 | Web acceptance | Web login, resources, conversation chat, Bot creation, and failure paths are accepted. | Browser record with version, server URL, and result. |
| C-09 | Windows Desktop acceptance | Installed Desktop startup, login, cloud chat, logout to local, and post-update reload are accepted. | Independent Windows acceptance record; Web acceptance is not a substitute. |
| C-10 | Documentation and versioning | API/Worker/Agent/Host/Client compatibility, upgrade order, limitations, and rollback steps are accurate. | README, protocol notes, and version diagnostics. |

### 3.1 Explicitly deferred to Plan III

The following are not baseline completion evidence and must remain recorded as deferred to this plan:

- Writing cloud events into local Session history.
- Reusing the local native Session controller for cloud conversations.
- Reusing local tool instances or local execution permission for cloud tools.
- Automatically turning a cloud Bot into a local Bot, or allowing a local Bot to silently replace a cloud revision.
- Model screenshot attachments and real visual-task acceptance.
- Complete cross-window event synchronization and offline cloud conversation caching.

### 3.2 Baseline exit gate

Move from the baseline plan to III-00 only when C-01 through C-10 have owners, commits, and evidence; TypeScript, Vitest, documentation, Web, and required Windows Desktop checks pass; limitations match actual behavior; uncommitted changes are recorded and preserved; the API/Worker/Agent/Host/Client compatibility matrix is frozen; and protocol failure still suspends cloud mode without silently enabling local execution.

## 4. Non-goals

- Persist cloud credentials, remote tool tokens, or private Bot instructions in local storage.
- Enable local Agent, shell, filesystem, connector, memory, or browser execution in cloud mode.
- Pretend that cloud events are local events to bypass Session ownership, permission, or audit boundaries.
- Re-submit a prompt to hide an unknown result.
- Let a local Bot definition overwrite a bound cloud revision.
- Hide an API, Worker, or Agent incompatibility behind a client compatibility shim.
- Claim full acceptance without real server and Desktop evidence.

## 5. Design principles

### 5.1 Server authority

The server owns cloud conversation history, operation state, tool results, Bot revisions, and permissions. The adapter maintains only bounded display cache, event projection, and unfinished-operation indexes.

### 5.2 Shared UI protocol, separate execution permission

Local and cloud sources may share message, streaming, tool-card, and status components. They must not share executors. UI shares data and rendering; actions go through the selected source adapter and Host admission checks.

### 5.3 Identity and revision on every request

Every operation carries the current cloud epoch, server, tenant, Workspace, conversation, and binding revision. Any mismatch discards the result and returns a stable error instead of updating the current view with stale data.

### 5.4 Replayable incremental events

Disconnects, refreshes, duplicate events, reordering, and client crashes are normal. The adapter must support cursor recovery, deduplication, terminal convergence, and unknown-operation reconciliation.

### 5.5 Separate read and write permission

Reading cloud history, Bot summaries, or tool state does not grant tool execution. Tool cards are read-only by default. A remote action requires an explicit server capability and explicit user action.

## 6. Target architecture

```text
                    +---------------------------+
                    | Native Conversation UI    |
                    | messages / stream / tools |
                    | Bot selection / composer  |
                    +-------------+-------------+
                                  |
                     UnifiedConversationSource
                  +---------------+---------------+
                  |                               |
          LocalSessionAdapter              CloudSessionAdapter
                  |                               |
           local Session API                 dsh-server API
           local Agent/tools                 sessions/events
                                             prompts/operations
                                             Bot binding/revision
```

`CloudSessionAdapter` is a cloud source adapter. It does not invoke the local Agent, append cloud events to the local Session, or register remote tools in the local tool registry.

### 6.1 Proposed source contract

The final types must be reconciled with the real DSH Session and UI slot types. The following is a design target, not a drop-in production signature.

```ts
type ConversationSourceKind = 'local' | 'cloud'

interface UnifiedConversationSource {
  readonly kind: ConversationSourceKind
  readonly authority: ConversationAuthority
  listSessions(input: ListSessionsInput): Promise<SessionSummaryPage>
  openSession(input: OpenSessionInput): Promise<ConversationHandle>
}

interface ConversationHandle {
  readonly identity: ConversationIdentity
  readonly bot: BotBinding | null
  read(input: ReadConversationInput): Promise<ConversationSnapshot>
  subscribe(listener: (change: ConversationChange) => void): () => void
  send(input: SendMessageInput): Promise<OperationReceipt>
  cancel(input: CancelOperationInput): Promise<CancelRequestResult>
  recover(input: RecoverOperationInput): Promise<RecoveryResult>
  close(): Promise<void>
}

interface ConversationChange {
  readonly cursor: string | number | null
  readonly events: readonly CanonicalConversationEvent[]
  readonly operation: OperationState | null
}
```

The contract must distinguish reading committed history, subscribing to replayable changes, sending one idempotent user message, requesting cancellation without fabricating a terminal result, recovering a receipt without resubmitting, and closing a client handle without cancelling an accepted server operation.

### 6.2 Adapter modules

| Module | Responsibility |
| --- | --- |
| `cloud-session-adapter.ts` | Unified source implementation and lifecycle orchestration. |
| `cloud-session-identity.ts` | Server, tenant, Workspace, session, epoch, and binding-revision checks. |
| `cloud-session-cursor.ts` | Event cursor, paging, deduplication, gap detection, and limits. |
| `cloud-session-events.ts` | Server event to canonical event conversion. |
| `cloud-session-operations.ts` | Receipt, operation, cancel, unknown, and recovery state. |
| `cloud-session-bot.ts` | Bot summary, revision binding, and source capabilities. |
| `cloud-session-tool.ts` | Safe tool-card projection and explicitly allowed remote actions. |
| `cloud-conversation-source.ts` | Adapter injection and local/cloud switching. |
| `cloud-session-test-fixtures.ts` | Deterministic events, paging, reordering, and failure fixtures. |

## 7. Canonical event model

### 7.1 Event types

```ts
type CanonicalConversationEvent =
  | { type: 'user/message'; id: string; operationId: string; message: UserMessage }
  | { type: 'assistant/delta'; id: string; operationId: string; streamId: string; text: string }
  | { type: 'assistant/message'; id: string; operationId: string; message: AssistantMessage }
  | { type: 'tool/call'; id: string; operationId: string; callId: string; name: string; arguments: SafeJson }
  | { type: 'tool/result'; id: string; operationId: string; callId: string; result: SafeToolResult }
  | { type: 'operation/state'; id: string; operationId: string; state: OperationState; errorCode?: string }
  | { type: 'error'; id: string; operationId: string; code: string }
```

Canonical events must exclude access tokens, full request headers, private paths, unfiltered binary data, and unauthorized remote-control parameters.

### 7.2 Mapping table

| Cloud event | Canonical event | Rule |
| --- | --- | --- |
| `user/message` | `user/message` | Accept user-origin messages and deduplicate by message id. |
| `agent/inbox/spliced` | `user/message` | Keep inserted user messages; a removal is not a new message. |
| `cloud/assistant-delta` | `assistant/delta` | Accumulate by operation id and stream id; retain the last cursor. |
| `assistant/message` | `assistant/message` | Replace the matching delta and close its stream state. |
| `assistant/attempt` | `operation/state` | Mark interrupted or incomplete; never guess success. |
| `tool/call` | `tool/call` | Apply size, type, and sensitive-field filtering. |
| `tool/result` | `tool/result` | Apply result-size, HTML/link, and binary policies. |
| `turn/end` | `operation/state` | Converge from the server reason to succeeded, failed, or interrupted. |
| `error` or `*/error` | `error` | Expose a stable code, not an internal stack trace. |

### 7.3 Convergence rules

- Process each event id once.
- Preserve server order for assistant deltas; fill a cursor gap before appending new text.
- When the final assistant message arrives, turn the displayed delta into a terminal item and do not duplicate the final text.
- Pair tool calls and results by operation id and call id; missing results remain running or unknown.
- Server terminal state wins over client timers.
- Event projection must not execute scripts, auto-download remote resources, or invoke local file resolvers.

## 8. Implementation phases

### III-00: Close the baseline and freeze the contract

Complete C-01 through C-10, freeze API fields, error codes, binding revision and receipt semantics, record the current `CloudChat`, `CloudChatTurns`, and `CloudSessionReplay` behavior as regression baselines, and freeze the current cloud UI scope. Exit only after Web and Windows Desktop can reproduce the baseline flow.

### III-01: Introduce the unified conversation source

Inventory the real local Session, Conversation UI, Composer, tool-card, and Bot-selector inputs. Define the source interfaces and capability declarations. Add a thin `LocalSessionAdapter` without changing local behavior. Move CloudChat directory, binding, turns, and replay access behind the source interface while preserving slot priorities and mode switching.

Exit condition: local regression tests pass and CloudChat no longer calls cloud API paths directly.

### III-02: Implement cloud reads, cursors, and subscriptions

Implement conversation list/open with identity checks. Move event paging out of React effects. Add cursor recovery, page limits, duplicate removal, gap detection, cancellation, and stable error categories. Implement a cancellable polling or future SSE/WebSocket transport behind `subscribe`. Closing a handle stops client work but does not cancel the server operation.

Exit condition: refresh, duplicate events, page boundaries, gaps, network recovery, and view closing have deterministic tests.

### III-03: Connect messages and streaming to native UI

Convert canonical events into the existing message ViewModel. Reuse native Markdown, code, copy, timestamp, and scroll-following components while keeping cloud remote-image and file-resolution restrictions. Map deltas to native streaming state, converge once on the final message, and show syncing/unknown when events are incomplete. Keep cloud source, Workspace, and Bot revision labels visible.

Exit condition: local and cloud sources satisfy the same message UI assertions; the cloud-specific timeline is only a fallback.

### III-04: Unify tool cards without local execution

Map cloud tool calls/results to the native card states. Provide safe summaries of names, arguments, results, errors, timestamps, operation ids, and call ids. Do not register cloud tools locally. Disable parameter editing, retry, and 鈥渞un locally鈥?by default. Add a remote action only when the server capability and explicit user action both pass. Filter large results, binaries, HTML, URLs, sensitive fields, and paths.

Exit condition: native card behavior is consistent and security tests prove that a cloud card cannot invoke a local tool.

### III-05: Unify send, cancel, recovery, and unknown outcomes

Move `CloudChatTurns` submission into `CloudSessionAdapter.send`. Generate exactly one idempotency key per send. On a lost response, query by the original key and never resubmit. Cancellation sends a stop request and continues polling the original operation. Unknown outcomes block another send in that conversation until reconciled or a new conversation is selected. Handle logout, epoch changes, window close, and Host restart.

Exit condition: send, lost response, double click, cancel races, refresh recovery, server rejection, and unknown outcomes are covered.

### III-06: Add BotAdapter and unified Bot selection

Define `BotSummary`, `BotBinding`, `BotSource`, and capability declarations. Map Workspace Bots to read-only summaries with id, name, role summary, revision, state, and capabilities. Fix the Bot revision when creating a cloud conversation. Distinguish local, cloud, and linked Bots by source. Keep the explicit local export preview, digest, confirmation, and conflict flow. A Bot update requires a new conversation or explicit rebinding; it must not mutate history. Add paging, archived state, missing revision, and forbidden-state handling.

Exit condition: Bot list, create, bind, refresh, archive, revision conflict, and local export have contract and UI tests.

### III-07: Security, audit, and isolation review

Audit every adapter call to prove cloud mode cannot enter local Agent, tools, jobs, HTTP, or file-write paths. Define which fields may cross into Renderer. Require capability, binding revision, user action, and idempotency key for remote tool actions. Apply size limits, redaction, URL policy, and stable error codes. Add an adapter drain during suspend/logout: stop new calls and settle or invalidate in-flight work.

Exit condition: security review passes, including local admission, credential boundaries, tenant/workspace isolation, and stale-epoch cases.

### III-08: Cache, refresh, and multi-window behavior

Move event cache ownership from component lifetime to adapter/source lifetime. Define cache limits, truncation, session switching, and logout cleanup. Choose an explicit multi-window policy. Refresh must recover from the server cursor rather than trusting old memory. Handle server history trimming, expired cursors, and revision changes. Store only display data; never store tokens, private Bot definitions, or file bytes.

Exit condition: refresh, reconnect, multi-window, full cache, server trimming, and logout cleanup are tested and documented.

### III-09: Test, acceptance, and performance baseline

Add unit tests for identity, mapping, cursors, deduplication, terminal convergence, Bot revisions, and filtering. Add adapter integration tests for success, failure, disconnect, recovery, reordering, duplicates, and expiry. Use identical UI assertions for local and cloud sources. Keep Host admission tests for blocked local execution. Add browser and installed Windows Desktop acceptance. Add performance and fault-injection tests for event throughput, long conversations, large tool results, polling, multi-window use, packet loss, server restart, incompatible versions, and revoked permission.

Exit condition: all blocking tests pass, performance stays within the agreed budget, and Web and Windows Desktop have independent evidence.

### III-10: Gradual rollout, migration, and rollback

Add a controlled flag such as `cloudSessionAdapterV1`. Keep the old cloud timeline as the default until the rollout gate passes. Enable by server capability, Workspace, user, or conversation rather than guessing from client version. On adapter failure, fall back only to the old cloud timeline, never to local execution. Log adapter version, protocol version, mapping version, and stable failure cause. Rollback disables the flag, clears adapter memory, preserves server tasks, and never replays a prompt.

Exit condition: no high-priority data mismatch, duplicate submission, or local-execution escape occurs during rollout; rollback has been rehearsed.

## 9. State machines

### 9.1 Source state

```text
local
  -> begin cloud login -> authenticating
       -> success -> cloud
       -> failure -> local (or cloud-suspended when authority remains)

cloud
  -> network/protocol failure -> cloud-suspended
  -> explicit logout + drain + revoke -> local
  -> epoch change -> discard old adapter handles and create new handles
```

The adapter must not forward a cloud prompt to the local Agent after a cloud failure. `cloud-suspended` permits only the documented reads, recovery, and logout operations.

### 9.2 Message state

```text
idle -> checking-binding -> submitting -> accepted
accepted -> queued/running -> succeeded | failed | cancelled | timed_out
submitting -> unknown
unknown -> recovering -> accepted | unknown
```

Client timers may trigger a query but cannot turn running into success or failure. A terminal state must come from a receipt, operation response, or committed server event.

## 10. Version and protocol requirements

Before III starts, freeze `server-info` protocol and capability fields; session, binding, event, prompt, receipt, and operation schemas; event id, cursor, timestamp, operation id, and call id semantics; Bot list, revision, archive, and conflict behavior; cloud-tool capability and size limits; and minimum compatible API, Worker, `dsh-agent`, Host, and Client versions.

Missing or incompatible protocol must return a stable `CLOUD_ADAPTER_UNSUPPORTED`-class error and keep the local admission block active.

## 11. Acceptance matrix

| Scenario | Expected result | Evidence |
| --- | --- | --- |
| Local send | Existing behavior is unchanged. | Local regression tests. |
| Cloud conversation selection | Unified conversation UI opens with Workspace and Bot revision. | UI test and Web acceptance. |
| Cloud send | Only cloud `/prompts` is called; local Agent is untouched. | Network/Host logs and admission tests. |
| Cloud streaming | Native streaming component is used and final text appears once. | Event mapping tests. |
| Cloud tool call | Native tool card is shown but cannot run a local tool by default. | Tool security tests. |
| Missing tool result | Running/unknown remains visible and the adapter continues reading. | Fault injection. |
| Cancellation | Server cancellation is requested and the original operation is tracked. | Operation tests. |
| Lost prompt response | Original idempotency key is queried; prompt is not resent. | Receipt recovery test. |
| Bot refresh | Current conversation binding does not change. | Bot binding test. |
| Bot revision update | New conversation or explicit rebind is required; history remains unchanged. | Revision conflict test. |
| Page refresh | Events recover from the server cursor. | Browser refresh test. |
| Cloud logout | Drain and revoke complete before local admission resumes. | Host lifecycle test. |
| Cloud outage | Cloud is suspended; local execution is not selected. | Failure acceptance. |
| Windows Desktop | Installed Desktop matches Web behavior and has independent evidence. | Windows acceptance record. |

## 12. Milestones

### M0: Baseline closure

Complete C-01 through C-10, freeze the protocol and behavior baseline, and publish current limitations.

### M1: Source abstraction

Complete III-01. Both local and cloud paths use the unified source contract while the old cloud UI remains the default.

### M2: Native cloud messages

Complete III-02 and III-03. Cloud messages, deltas, and terminal states use the unified message renderer; the old timeline remains the fallback.

### M3: Tools and operation lifecycle

Complete III-04 and III-05. Tool cards, cancellation, recovery, and unknown outcomes are unified. Do not expand remote tool interaction before security review.

### M4: Bot experience

Complete III-06. Local, cloud, and linked Bots are distinguishable and revision binding is stable.

### M5: Rollout

Complete III-07 through III-10. Web, installed Windows Desktop, real dsh-server, and compatibility matrix are accepted before enabling the adapter by default.

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Local Session cannot express cloud cursors or unknown outcomes. | Incorrect display or lost task state. | Use the source contract and canonical events; do not force cloud writes into local Session. |
| Cloud and local event semantics differ. | Duplicate messages or mismatched cards. | Freeze the mapping table and test convergence with fixtures. |
| Native cards expose remote execution. | Local privilege escape. | Keep display and execution separate; default to read-only. |
| Bot names or revisions collide. | Conversation target drift. | Bind by cloud Bot id and revision; names are display-only. |
| Partial protocol upgrade. | Runtime adapter failure. | Capability negotiation, minimum versions, and explicit suspension. |
| Multiple windows poll independently. | Resource use or inconsistent state. | Choose and document a window strategy before implementation. |
| Adapter cache grows without bound. | Browser memory growth. | Enforce per-session event and JSON-size limits and reclaim terminal data. |
| Fallback accidentally returns to local execution. | Cloud outage causes wrong execution. | Fallback only to the old cloud timeline. |

## 14. Deliverables

Code deliverables include `CloudSessionAdapter` and its identity, cursor, event, operation, Bot, and tool modules; the unified source contract and local adapter; native message, streaming, tool-card, Composer, and Bot-selector integration; feature flag and capability negotiation; rollback support; and unit, integration, browser, Host-admission, and Windows Desktop acceptance assets.

Documentation deliverables include the cloud conversation adapter protocol, event mapping, Bot source and revision rules, API/Worker/Agent/Host/Client compatibility matrix, rollout and rollback procedures, troubleshooting guidance, and the default feature-flag state in the package README.

## 15. Development rules

- Do not mix III implementation into the baseline cloud delivery before C-01 through C-10 are closed.
- Write protocol and tests before changing the UI; screenshots cannot replace event or security tests.
- Record the worktree before implementation and preserve existing uncommitted changes.
- Do not change versions, commit, or publish without explicit release authorization.
- After each change run targeted TypeScript, Vitest, and `git diff --check`; UI phases require Web or Desktop evidence.
- Every unknown outcome must remain traceable to an operation id or idempotency key; never hide uncertainty by resubmitting.

## 16. Current decision

Finish the existing cloud development plan, its tests, Web/Desktop acceptance, and documentation first. After M0, start III-01 and implement `CloudSessionAdapter`. Until Plan III is complete, the independent cloud timeline remains a supported fallback and must not be described as cloud events being supported by local Session history.
