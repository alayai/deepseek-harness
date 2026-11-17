/** Versioned dsh-server v1 transport. Never follows redirects with credentials. */
import { z } from 'zod'
import type { CloudRequest, CloudValue } from './types.ts'

const value: z.ZodType<CloudValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number(), z.string(), z.array(value), z.record(z.string(), value),
]))

async function responseText(response: Response): Promise<string> {
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    if (reader !== undefined) for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 8_388_608) throw new CloudApiError('RESPONSE_TOO_LARGE', 502)
      chunks.push(chunk.value)
    }
  } finally { await reader?.cancel() }
  return Buffer.concat(chunks).toString('utf8')
}

/** Stable upstream failure, containing no provider credentials or response body. */
export class CloudApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

/** Validate a configured origin before any credential-bearing fetch.
 * @param input - configured URL with no path, userinfo, query, or fragment.
 * @returns a normalized HTTPS or development-loopback origin.
 */
export function serverOrigin(input: string): string {
  const url = new URL(input)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new CloudApiError('INVALID_SERVER_ORIGIN', 400)
  return url.origin
}

/** No arbitrary origin, authentication endpoint, path escape, or token forwarding from the Renderer.
 * @param input - relative server-v1 business path.
 * @returns the validated path, including permitted query fields.
 */
export function apiPath(input: string): string {
  if (input.length > 2048 || !/^\/(?:server-info|me(?:\/tenants)?|tenants(?:\/[a-zA-Z0-9/?=&_.-]+)?)$/.test(input)
    || input.includes('..') || input.includes('//')) throw new CloudApiError('INVALID_API_PATH', 400)
  return input
}

/** Host-owned token transport; callers receive only bounded JSON business results. */
export class ServerTransport {
  /** Normalized server origin for every credential-bearing request. */
  readonly origin: string
  constructor(origin: string, private readonly token: string, private readonly fetcher = globalThis.fetch) {
    this.origin = serverOrigin(origin)
  }

  /** Send one bounded business request without retries or credential-bearing redirects.
   * @param request - relative business path and JSON input.
   * @param signal - optional caller cancellation.
   * @returns bounded server data; upstream failures contain only a safe code and status.
   */
  async request(request: Omit<CloudRequest, 'epoch'>, signal?: AbortSignal): Promise<CloudValue> {
    const path = apiPath(request.path)
    const encoded = request.body === null ? undefined : JSON.stringify(request.body)
    if (encoded !== undefined && Buffer.byteLength(encoded) > 1_048_576) throw new CloudApiError('REQUEST_TOO_LARGE', 413)
    const response = await this.fetcher(`${this.origin}/api/v1${path}`, {
      method: request.method, redirect: 'error',
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}`,
        ...encoded === undefined ? {} : { 'Content-Type': 'application/json' },
        ...request.idempotencyKey === null ? {} : { 'Idempotency-Key': request.idempotencyKey } },
      ...encoded === undefined ? {} : { body: encoded },
      signal: signal === undefined ? AbortSignal.timeout(15_000) : AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    })
    const raw = await responseText(response)
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string().max(100) }) }).safeParse(JSON.parse(raw))
      throw new CloudApiError(error.success ? error.data.error.code : 'UPSTREAM_FAILURE', response.status)
    }
    return z.object({ data: value }).parse(JSON.parse(raw)).data
  }

  /** Revoke the server login before local execution is re-enabled. */
  async logout(): Promise<void> {
    const response = await this.fetcher(`${this.origin}/api/v1/auth/logout`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401) {
      const rejected = z.object({ error: z.object({ code: z.literal('SESSION_REVOKED') }) }).safeParse(JSON.parse(await responseText(response)))
      if (rejected.success) return
    }
    if (!response.ok) throw new CloudApiError('LOGOUT_FAILED', response.status)
  }
}
