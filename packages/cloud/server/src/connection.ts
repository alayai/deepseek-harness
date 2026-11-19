/** Host execution target and all asynchronous login/request ownership. */
import { requireCloudProtocol } from './compatibility.ts'
import { nativeLogin } from './login.ts'
import { CloudApiError, serverOrigin, type ServerTransport } from './transport.ts'
import type { CloudRequest, CloudSnapshot, CloudValue } from './types.ts'

/** One Host instance owns cloud authority; local is never a network-error recovery state. */
export class CloudConnection {
  private state: CloudSnapshot = { mode: 'local', epoch: 0, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
  private transport: ServerTransport | undefined
  private expiresAt = 0
  private login: { controller: AbortController; done: Promise<void> } | undefined
  private lifetime = new AbortController()
  private expiry: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private leaving: Promise<CloudSnapshot> | undefined
  private viewers = 0
  private readonly pending = new Set<Promise<CloudValue>>()

  constructor(private readonly drain: (signal: AbortSignal) => Promise<void>, private readonly authenticate = nativeLogin) {}

  /** Return a stable display snapshot with no secrets.
   * @returns display-safe target state.
   */
  snapshot(): CloudSnapshot { return this.state }

  /** Reserve the cloud target synchronously, before draining or opening the authorization page.
   * @param input - configured server origin.
   * @returns the reserved authentication state.
   */
  beginLogin(input: string): CloudSnapshot {
    if (this.closed || this.leaving !== undefined || this.login !== undefined || this.state.mode === 'cloud') throw new CloudApiError('CLOUD_BUSY', 409)
    const serverUrl = serverOrigin(input)
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    this.lifetime.abort(); this.viewers = 0
    this.lifetime = new AbortController()
    const controller = new AbortController(), epoch = this.state.epoch + 1
    this.state = { mode: 'authenticating', epoch, serverUrl, authorizationUrl: null, error: null }
    const done = this.performLogin(controller, epoch).finally(() => { if (this.login?.controller === controller) this.login = undefined })
    this.login = { controller, done }
    return this.state
  }

  private async performLogin(controller: AbortController, epoch: number): Promise<void> {
    try {
      await this.drain(AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]))
      controller.signal.throwIfAborted()
      await Promise.allSettled([...this.pending])
      if (this.transport !== undefined) {
        if (Date.now() < this.expiresAt) await this.transport.logout()
        this.transport = undefined
      }
      controller.signal.throwIfAborted()
      const result = await this.authenticate(this.state.serverUrl, (url) => {
        if (this.current(epoch)) this.state = { ...this.state, authorizationUrl: url }
      }, controller.signal)
      // Retain issued authority even if cancellation or policy verification fails.
      this.transport = result.transport
      this.expiresAt = result.expiresAt
      await result.transport.request({ path: '/me', method: 'GET', body: null, idempotencyKey: null }, controller.signal)
      const info = await result.transport.request({ path: '/server-info', method: 'GET', body: null, idempotencyKey: null }, controller.signal)
      const execution = info !== null && typeof info === 'object' && !Array.isArray(info) ? info.execution : null
      if (execution === null || typeof execution !== 'object' || Array.isArray(execution)
        || execution.authenticatedMode !== 'cloud' || execution.localFallback !== false) throw new CloudApiError('UNSAFE_SERVER_POLICY', 409)
      requireCloudProtocol(info)
      if (!this.current(epoch) || controller.signal.aborted) return
      this.transport = result.transport
      this.state = { ...this.state, mode: 'cloud', authorizationUrl: null }
      if (this.expiry !== undefined) clearTimeout(this.expiry)
      this.expiry = setTimeout(() => { this.suspend('SESSION_EXPIRED') }, Math.max(0, result.expiresAt - Date.now()))
      this.expiry.unref()
    } catch (error) {
      if (this.current(epoch)) this.suspend(error instanceof CloudApiError ? error.code : 'LOGIN_FAILED')
    }
  }

  private current(epoch: number): boolean { return !this.closed && this.state.epoch === epoch }

  /** Permanently invalidate in-flight results for this connection generation.
   * @param code - safe diagnostic code shown to the target owner.
   */
  suspend(code: string): void {
    if (this.state.mode === 'local') return
    this.lifetime.abort(); this.viewers = 0
    this.state = { ...this.state, mode: 'cloud-suspended', epoch: this.state.epoch + 1, authorizationUrl: null, error: code }
  }

  /** Never retries a write. A lost response retains the caller's idempotency key for reconciliation.
   * @param request - server business request with the displayed login epoch.
   * @returns bounded upstream data for the same epoch.
   */
  async request(request: CloudRequest): Promise<CloudValue> {
    if (!this.current(request.epoch) || this.state.mode !== 'cloud' || this.transport === undefined) throw new CloudApiError('CLOUD_TARGET_BLOCKED', 409)
    const viewer = request.method === 'POST' && request.path.endsWith('/viewer')
    if (viewer && this.viewers >= 4) throw new CloudApiError('DESKTOP_VIEWER_LIMIT', 409)
    if (viewer) this.viewers++
    const lifetime = this.lifetime
    let released = false
    const releaseViewer = () => {
      if (!released && lifetime === this.lifetime) { this.viewers = Math.max(0, this.viewers - 1); released = true }
    }
    const pending = viewer ? this.transport.desktopViewer(request.path.slice(0, -7), this.lifetime.signal, releaseViewer)
      .catch((error: unknown) => { releaseViewer(); throw error })
      : this.transport.request(request, this.lifetime.signal)
    this.pending.add(pending)
    try {
      const value = await pending
      if (!this.current(request.epoch) || this.snapshot().mode !== 'cloud') throw new CloudApiError('STALE_CLOUD_RESULT', 409)
      return value
    } catch (error) {
      if (this.current(request.epoch)
        && (!(error instanceof CloudApiError) || error.status === 401 || error.status === 403 || error.status >= 500)) {
        this.suspend(error instanceof CloudApiError ? error.code : 'CONNECTION_LOST')
      }
      throw error
    } finally { this.pending.delete(pending) }
  }

  /** Explicit logout cancels client work, settles it, and revokes authority before returning local.
   * @returns local state after confirmed revocation or known token expiry.
   */
  logout(): Promise<CloudSnapshot> {
    if (this.closed) return Promise.reject(new CloudApiError('CLOUD_CLOSED', 409))
    if (this.leaving !== undefined) return this.leaving
    const done = this.performLogout().finally(() => { if (this.leaving === done) this.leaving = undefined })
    this.leaving = done
    return done
  }

  private async performLogout(): Promise<CloudSnapshot> {
    this.suspend('LOGGING_OUT')
    this.login?.controller.abort()
    await this.login?.done
    await Promise.allSettled([...this.pending])
    try { await this.drain(AbortSignal.timeout(30_000)) }
    catch (error) { this.suspend('LOCAL_DRAIN_FAILED'); throw error }
    if (this.transport !== undefined) {
      // No refresh token is held; a known-expired access token grants no remaining authority.
      try { if (Date.now() < this.expiresAt) await this.transport.logout() }
      catch (error) { this.suspend('LOGOUT_FAILED'); throw error }
    }
    this.transport = undefined
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    this.state = { ...this.state, mode: 'local', epoch: this.state.epoch + 1, error: null, authorizationUrl: null }
    return this.state
  }

  /** Withdraw listeners only after all owned continuations have settled. */
  async dispose(): Promise<void> {
    this.closed = true
    this.lifetime.abort(); this.viewers = 0
    this.login?.controller.abort()
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    await this.login?.done
    await this.leaving?.catch((_error: unknown) => { /* Disposal drops the remaining authority after a failed remote revocation. */ })
    await Promise.allSettled([...this.pending])
    this.transport = undefined
  }
}
