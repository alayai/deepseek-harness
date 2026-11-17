# Cloud execution targets

English | [中文](cloud.zh.md)

The [cloud server package](../../packages/cloud/server/README.md) owns authentication and target lifecycle. These display-safe types cross the generated Host Remote; no access token is part of them.

```ts type-equiv
/** Display-safe cloud state. Credentials never cross the Host boundary. */
interface CloudSnapshot {
  readonly mode: 'local' | 'authenticating' | 'cloud' | 'cloud-suspended'
  readonly epoch: number
  readonly serverUrl: string
  readonly authorizationUrl: string | null
  readonly error: string | null
}
```

```ts type-equiv
/** Cloud API values are JSON, including field-level encoded binary results. */
type CloudValue = null | boolean | number | string | CloudValue[] | { [key: string]: CloudValue }
```

```ts type-equiv
/** One explicit server operation, scoped to the displayed login generation. */
interface CloudRequest {
  readonly epoch: number
  readonly path: string
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body: CloudValue
  readonly idempotencyKey: string | null
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdshcloud--dshcloudservice"></a>

### `ctx.dshCloud` — `DshCloudService`

Own cloud authority separately from DeepSeek platform accounts and local Session controllers.

```ts cordis-catalog
/**
 * Read the target and pending authorization URL; never returns access or refresh tokens.
 * @returns display-safe target state.
 */
@Remote state(): CloudSnapshot

/**
 * Block local execution before any asynchronous work, then begin native PKCE.
 * @param serverUrl - HTTPS server origin, or an HTTP loopback development origin.
 * @returns reserved authentication state.
 */
@Remote beginLogin(serverUrl: string): CloudSnapshot

/**
 * Execute one explicit server-v1 request for the displayed generation.
 * @param input - bounded API request with the displayed epoch.
 * @returns bounded server business data; failures retain no credentials.
 */
@Remote async request(input: CloudRequest): Promise<CloudValue>

/**
 * Revoke cloud login and settle client continuations before enabling local execution.
 * @returns local state after revocation or known expiry; failure keeps local blocked.
 */
@Remote async logout(): Promise<CloudSnapshot>
```

Source: [`packages/cloud/server/src/index.ts`](../../packages/cloud/server/src/index.ts)
<!-- END GENERATED cordis-surface -->
