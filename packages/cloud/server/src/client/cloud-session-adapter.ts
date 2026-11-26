/** One verified cloud Conversation, with no local Session or executor dependency. */
import type { CloudRequest, CloudValue } from '../types.ts'
import { readBinding, type CloudBinding } from './binding.ts'
import { settled, type CloudChatTurns } from './chat-turns.ts'
import type { CloudSessionReplay } from './session-replay.ts'

interface Target {
  serverId: string
  tenantId: string
  workspaceId: string
  sessionId: string
  epoch: number
  scope: string
  cacheKey: string
  current: () => boolean
  call: (request: CloudRequest) => Promise<CloudValue>
}

/** Read remote Conversation state and dispatch commands against the same authenticated target. */
export class CloudSessionAdapter {
  private readonly base: string
  private readonly path: string
  constructor(private readonly target: Target, readonly replay: CloudSessionReplay, readonly turns: CloudChatTurns) {
    this.base = `/tenants/${target.tenantId}/workspaces/${target.workspaceId}`
    this.path = `${this.base}/sessions/${target.sessionId}`
  }

  /** Read the in-memory, authority-scoped transcript and cursor. */
  snapshot() { return this.replay.read(this.target.cacheKey) }

  /** Read the original turn receipt for this Conversation. */
  attempt() { return this.turns.read(this.target.scope) }

  /** Refresh the pinned binding and adopt server-owned pending work. */
  async binding() {
    const binding = readBinding(await this.read(`${this.path}/binding`), this.target)
    if (this.target.current()) this.turns.observe(this.target.scope, binding)
    return binding
  }

  /** Append one validated page only while the Conversation still owns the view.
   * @param visible - whether this particular polling loop is still attached.
   * @returns the accepted snapshot and page status, or no update after detachment.
   */
  async next(visible: () => boolean, verifyTail = false) {
    if (!visible() || !this.target.current()) return undefined
    const previous = this.snapshot(), verify = verifyTail && previous.events.length > 0
    const after = verify ? String(BigInt(previous.after) - 1n) : previous.after
    const wire = await this.read(`${this.path}/events?after=${after}`)
    if (!visible() || !this.target.current()) return undefined
    if (verify && !this.replay.resume(this.target.cacheKey, previous, wire))
      return { snapshot: this.snapshot(), full: true, restarting: true }
    const snapshot = this.replay.accept(this.target.cacheKey, after, wire)
    const full = !!wire && typeof wire === 'object' && !Array.isArray(wire) && Array.isArray(wire.items) && wire.items.length >= 100
    return { snapshot, full }
  }

  /** Admit exactly one explicit prompt against a fresh verified binding.
   * @param text - the controlled draft, sent as plain text.
   * @param onBinding - refresh the view with the binding read for this send.
   */
  async send(text: string, onBinding: (binding: CloudBinding) => void) {
    const { scope, epoch, current } = this.target
    if (!current() || !settled(this.attempt())) return
    await this.turns.send(scope, epoch, this.path, text, current, async () => {
      const binding = readBinding(await this.read(`${this.path}/binding`), this.target)
      if (current()) onBinding(binding)
      return binding
    }, this.call)
  }

  /** Poll the original operation or lookup of an unconfirmed submission. */
  async recover() { await this.turns.recover(this.target.scope, this.target.epoch, this.path, this.target.current, this.call) }

  /** Observe the original operation, or explicitly request its cancellation.
   * @param cancel - issue a cancellation request instead of a status read.
   */
  async poll(cancel = false) {
    if (this.target.current()) await this.turns.poll(this.target.scope, this.base, this.target.epoch, this.call, cancel)
  }

  private read(path: string) { return this.call({ path, epoch: this.target.epoch, method: 'GET', body: null, idempotencyKey: null }) }

  private call = (request: CloudRequest) => {
    if (!this.target.current()) return Promise.reject(new Error('CLOUD_CONVERSATION_CHANGED'))
    return this.target.call(request)
  }
}
