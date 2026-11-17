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
import { CloudConnection } from './connection.ts'
import { CloudApiError } from './transport.ts'
import type { CloudRequest, CloudSnapshot, CloudValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { dshCloud: DshCloudService }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'cloud/blocked': { readonly reason: string } }
}

/** Own cloud authority separately from DeepSeek platform accounts and local Session controllers. */
export class DshCloudService extends TypertRemoteService {
  static inject = ['agents', 'tools', 'jobs', 'typertGateway']
  private readonly cloud: CloudConnection
  private readonly localHttp = new Set<{ request: IncomingMessage; done: Promise<void> }>()

  constructor(ctx: Context) {
    super(ctx, 'dshCloud', { namespace: 'dshCloud' })
    this.cloud = new CloudConnection(signal => this.drainLocal(signal))
    ctx.on('connection/request', async (request, response, next) => {
      const path = new URL(request.url ?? '/', 'http://host').pathname
      if (/^\/api\/dshCloud\/(?:state|beginLogin|request|logout)$/.test(path)) {  await next(); return }
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
      if (request.namespace !== 'dshCloud' && this.cloud.snapshot().mode !== 'local') {
        throw new RemoteError('cloud/blocked', 'Local operations are paused while using dsh-server', { reason: 'LOCAL_TARGET_BLOCKED' })
      }
    })
    ctx.tools.guard(() => this.cloud.snapshot().mode === 'local' ? undefined : 'DSH_CLOUD_LOCAL_EXECUTION_BLOCKED')
    ctx.on('agent/pre-step', async (_payload, next) => this.cloud.snapshot().mode === 'local' ? next() : { kind: 'reject' })
    ctx.effect(() => () => this.cloud.dispose(), 'dsh-server: cloud authority')
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
   * Revoke cloud login and settle client continuations before enabling local execution.
   * @returns local state after revocation or known expiry; failure keeps local blocked.
   */
  @Remote
  async logout(): Promise<CloudSnapshot> { this.assertOwner(); return await this.cloud.logout() }
}

export default DshCloudService
