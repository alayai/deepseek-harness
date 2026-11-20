/** dsh-server integration: Host authentication, cloud API and local admission policy. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-terminal'
import type { IncomingMessage } from 'node:http'
import type {} from '@deepseek-ai/dsh-client-connection'
import { readLocal } from './local-read.ts'
import { exportLocal } from './local-export.ts'
import { CloudConnection } from './connection.ts'
import { CloudApiError } from './transport.ts'
import type { CloudRequest, CloudSnapshot, CloudValue, LocalBotExportResult, LocalReadRequest, LocalReadResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dshCloud: DshCloudService }
}

/** Local display, directory management, and read-only navigation remain available without enabling local execution. */
function allowsLocalManagement(namespace: string, method: string): boolean {
  return (namespace === 'pluginInventory' && method === 'list')
    || (namespace === 'pluginManager' && (method === 'listBundles' || method === 'listPlugins'))
    || (namespace === 'directoryPicker' && (method === 'pick' || method === 'list'))
    || (namespace === 'workspace' && method === 'create')
    || (namespace === 'workspace' && method === 'follow')
    // Creating an empty local session is a UI bookkeeping operation. It is
    // needed after adding a directory, while prompts and tools remain blocked
    // by the cloud admission guard below.
    || (namespace === 'session' && method === 'create')
    || (namespace === 'session' && ['control', 'follow', 'list', 'page', 'projections'].includes(method))
    // Model settings need to read the local provider directory while the Host
    // is connected to dsh-server. These calls only describe mounted providers
    // and their configuration. Settings and credential responses are already
    // redacted; all mutation methods remain blocked.
    || (namespace === 'llm' && (method === 'listProviders' || method === 'listConfigurableProviders'))
    || (namespace === 'settings' && method === 'describe')
    || (namespace === 'credentials' && method === 'describe')
    || (namespace === 'session' && method === 'modelCatalog')
}

/** Own cloud authority separately from DeepSeek platform accounts and local Session controllers. */
export class DshCloudService extends TypertRemoteService {
  static inject = ['agents', 'tools', 'jobs', 'typertGateway']
  private readonly cloud: CloudConnection
  private readonly localReads = new AbortController()
  private readsInFlight = 0
  private readonly localHttp = new Set<{ request: IncomingMessage; done: Promise<void> }>()

  constructor(ctx: Context) {
    super(ctx, 'dshCloud', { namespace: 'dshCloud' })
    this.cloud = new CloudConnection(signal => this.drainLocal(signal))
    ctx.on('connection/request', async (request, response, next) => {
      const path = new URL(request.url ?? '/', 'http://host').pathname
      if (/^\/api\/dshCloud\/(?:state|beginLogin|request|logout|readLocal|exportLocal)$/.test(path)) {  await next(); return }
      // Remote read streams are multiplexed through this endpoint; the
      // Gateway guard below still checks the concrete namespace/method.
      if (path === '/api/remote.mux') { await next(); return }
      const remote = /^\/api\/([^/]+)\/([^/]+)$/.exec(path)
      if (remote?.[1] !== undefined && remote[2] !== undefined && allowsLocalManagement(remote[1], remote[2])) { await next(); return }
      if (this.cloud.snapshot().mode !== 'local') {
        response.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify({ error: { code: 'CLOUD_LOCAL_TARGET_BLOCKED' } }))
        return
      }
      const finished = Promise.withResolvers<void>(), entry = { request, done: finished.promise }
      this.localHttp.add(entry)
      try { await next() }
      finally { this.localHttp.delete(entry); finished.resolve() }
    })
    ctx.typertGateway.guard((request) => {
      if (request.namespace !== 'dshCloud' && !allowsLocalManagement(request.namespace, request.method) && this.cloud.snapshot().mode !== 'local') {
        throw new RemoteError('cloud/blocked', 'Local operations are paused while using dsh-server', { reason: 'LOCAL_TARGET_BLOCKED' })
      }
    })
    ctx.tools.guard(() => this.cloud.snapshot().mode === 'local' ? undefined : 'DSH_CLOUD_LOCAL_EXECUTION_BLOCKED')
    ctx.on('agent/pre-step', async (_payload, next) => this.cloud.snapshot().mode === 'local' ? next() : { kind: 'reject' })
    ctx.effect(() => () => { this.localReads.abort(); return this.cloud.dispose() }, 'dsh-server: cloud authority')
  }

  private assertOwner(): void {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new RemoteError('cloud/blocked', 'Cloud login belongs to the Host owner', { reason: 'OWNER_REQUIRED' })
  }

  private async drainLocal(signal: AbortSignal): Promise<void> {
    const agents = this.ctx.agents.list()
    for (const agent of agents) agent.cancel({ kind: 'user' })
    const terminals = this.ctx.get('terminals')
    const cleanup: Promise<unknown>[] = agents.map(agent => agent.whenIdle())
    for (const entry of this.localHttp) { entry.request.destroy(); cleanup.push(entry.done) }
    if (terminals !== undefined) {
      for (const agent of agents) for (const terminal of terminals.list(agent)) cleanup.push(terminals.kill(agent, terminal.sessionId, 'dsh-server login'))
    }
    for (const job of this.ctx.jobs.list()) {
      if (job.status !== 'running' && job.status !== 'stopping') continue
      this.ctx.jobs.kill(job.id, undefined, 'dsh-server login')
      cleanup.push(this.ctx.jobs.wait(job.id, 30_000, undefined, signal).then((result) => {
        if (result.status === 'running' || result.status === 'stopping') throw new CloudApiError('LOCAL_JOB_NOT_DRAINED', 409)
      }))
    }
    cleanup.push(this.ctx.typertGateway.drain(request => request.namespace !== 'dshCloud', signal))
    const cancelled = Promise.withResolvers<never>()
    const abort = (): void => { cancelled.reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    try { signal.throwIfAborted(); await Promise.race([Promise.all(cleanup), cancelled.promise]) }
    finally { signal.removeEventListener('abort', abort) }
  }

  /**
   * Read the target and pending authorization URL; never returns access or refresh tokens.
   * @returns display-safe target state.
   */
  @Remote
  state(): CloudSnapshot { this.assertOwner(); return this.cloud.snapshot() }

  /**
   * Block local execution before any asynchronous work, then begin native PKCE.
   * @param serverUrl - HTTPS server origin, or an HTTP loopback development origin.
   * @returns reserved authentication state.
   */
  @Remote
  beginLogin(serverUrl: string): CloudSnapshot { this.assertOwner(); return this.cloud.beginLogin(serverUrl) }

  /**
   * Execute one explicit server-v1 request for the displayed generation.
   * @param input - bounded API request with the displayed epoch.
   * @returns bounded server business data; failures retain no credentials.
   */
  @Remote
  async request(input: CloudRequest): Promise<CloudValue> {
    this.assertOwner()
    try { return await this.cloud.request(input) }
    catch (error) {
      throw new RemoteError('cloud/blocked', 'The cloud operation did not complete. Check its operation ID before retrying.',
        { reason: error instanceof CloudApiError ? error.code : 'CONNECTION_LOST' }, { cause: error })
    }
  }

  /**
   * Browse local text history or loaded Bot settings while cloud execution is selected.
   * @param input - explicit page and displayed login epoch; never a cloud API path.
   * @returns owner-only text with no local execution or automatic upload.
   */
  @Remote
  async readLocal(input: LocalReadRequest): Promise<LocalReadResult> {
    this.assertOwner()
    const assertCurrent = (): void => {
      const state = this.cloud.snapshot()
      if (this.localReads.signal.aborted || state.epoch !== input.epoch || !['cloud', 'cloud-suspended'].includes(state.mode)) {
        throw new CloudApiError('STALE_LOCAL_READ', 409)
      }
    }
    if (this.readsInFlight >= 4) throw new RemoteError('cloud/blocked', 'Local history is busy', { reason: 'LOCAL_READ_BUSY' })
    this.readsInFlight++
    try {
      assertCurrent()
      const signal = AbortSignal.any([
        this.localReads.signal, AbortSignal.timeout(15_000),
        ...(this.ctx.invocation ? [this.ctx.invocation.signal] : []),
      ])
      const value = await readLocal(this.ctx, input, signal)
      signal.throwIfAborted()
      assertCurrent()
      return value
    } catch (error) {
      throw new RemoteError('cloud/blocked', 'Local read did not complete', { reason: error instanceof CloudApiError ? error.code : 'LOCAL_READ_FAILED' })
    } finally { this.readsInFlight-- }
  }

  /** Export one complete public Bot definition after an explicit user action. */
  @Remote
  async exportLocal(input: { kind: 'bot'; epoch: number; botId: string }): Promise<LocalBotExportResult> {
    this.assertOwner()
    const assertCurrent = (): void => {
      const state = this.cloud.snapshot()
      if (this.localReads.signal.aborted || state.epoch !== input.epoch || !['cloud', 'cloud-suspended'].includes(state.mode)) {
        throw new CloudApiError('STALE_LOCAL_EXPORT', 409)
      }
    }
    assertCurrent()
    try {
      const signal = AbortSignal.any([
        this.localReads.signal, AbortSignal.timeout(15_000),
        ...(this.ctx.invocation ? [this.ctx.invocation.signal] : []),
      ])
      const value = exportLocal(this.ctx, input, signal)
      signal.throwIfAborted()
      assertCurrent()
      return value
    } catch (error) {
      throw new RemoteError('cloud/blocked', 'Local Bot export did not complete', { reason: error instanceof CloudApiError ? error.code : 'LOCAL_EXPORT_FAILED' })
    }
  }

  /**
   * Revoke cloud login and settle client continuations before enabling local execution.
   * @returns local state after revocation or known expiry; failure keeps local blocked.
   */
  @Remote
  async logout(): Promise<CloudSnapshot> { this.assertOwner(); return await this.cloud.logout() }
}

export default DshCloudService
