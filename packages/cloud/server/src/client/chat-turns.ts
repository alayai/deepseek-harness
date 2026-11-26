/** Tracks one explicit prompt per cloud session, independently of view and resource tasks. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { z } from 'zod'
import type { CloudRequest, CloudValue } from '../types.ts'
import type { CloudBinding } from './binding.ts'

const OperationState = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'unknown'])
const Receipt = z.object({ id: z.uuid(), runtimeId: z.uuid(), bindingRevision: z.number().int().positive(), state: OperationState })
const Operation = z.object({
  id: z.uuid(), runtimeId: z.uuid(), kind: z.literal('agent'), state: OperationState,
  cancelRequested: z.boolean(), errorCode: z.string().nullable(),
})
type Call = (request: CloudRequest) => Promise<CloudValue>
type ReceiptValue = z.infer<typeof Receipt>
type OperationValue = z.infer<typeof Operation>
type Attempt = {
  state: 'checking' | 'sending' | 'unconfirmed' | 'accepted' | 'rejected'
  reference?: { key: string; runtimeId: string; revision: number }
  receiptMissing?: boolean
  recovering?: boolean
  submitted?: boolean
  receipt?: ReceiptValue
  operation?: OperationValue
  error?: string
  cancelling?: boolean
  cancelUnconfirmed?: boolean
}
const rejected = new Set([
  'BINDING_DISABLED', 'BINDING_VERSION_CONFLICT', 'RUNTIME_NOT_READY', 'QUEUE_FULL', 'SESSION_BUSY',
  'SESSION_OUTCOME_UNKNOWN', 'SESSION_NOT_FOUND', 'BOT_ARCHIVED', 'BOT_REVISION_NOT_FOUND', 'BOT_INCOMPATIBLE',
  'AGENT_UNAVAILABLE', 'DESKTOP_UNAVAILABLE', 'WORKSPACE_ARCHIVED', 'WORKSPACE_NOT_FOUND', 'FORBIDDEN',
])

/** Carries only the stable server failure code from the Host envelope. */
export class CloudRequestFailure extends Error {}

/** Whether a receipt has settled in a way that permits a new message. */
export function settled(attempt: Attempt | undefined): boolean {
  if (!attempt) return true
  if (attempt.state === 'rejected') return attempt.error !== 'SESSION_OUTCOME_UNKNOWN'
  const state = attempt.operation?.state
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'timed_out'
}

function isActive(state: string | undefined): boolean { return state === 'queued' || state === 'running' }

/** In-memory owner; no prompt or idempotency key is written to local disk. */
export class CloudChatTurns {
  private readonly entries = new Map<string, Attempt>()
  private version = 0
  private readonly listeners = new Set<() => void>()
  /** Subscribe to receipts and state changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Read the current snapshot for an authority and session scope. */
  read(scope: string): Attempt | undefined { return this.entries.get(scope) }

  /** Snapshot version for external-store consumers. */
  getVersion = (): number => this.version

  private notify(): void { this.version++; for (const listener of this.listeners) listener() }

  /** Forget information after the Host changes authority. */
  clear(): void { this.entries.clear(); this.notify() }

  /** Adopt pending work reported by the selected session after a reload or another window's send. */
  observe(scope: string, target: CloudBinding): void {
    const pending = target.pendingOperation, attempt = this.read(scope)
    if (!pending || pending.id === attempt?.receipt?.id || (attempt && !settled(attempt) && attempt.state !== 'rejected')) return
    if (!this.reserve(scope)) return
    this.entries.set(scope, { state: 'accepted', receipt: pending })
    this.notify()
  }

  private reserve(scope: string): boolean {
    if (this.entries.has(scope) || this.entries.size < 128) return true
    // Never evict an unsettled request to make room for a new one.
    for (const [key, value] of this.entries) if (settled(value)) this.entries.delete(key)
    return this.entries.size < 128
  }

  /** Reserve synchronously, check the pinned binding, then submit once. */
  async send(
    scope: string, epoch: number, path: string, prompt: string, current: () => boolean,
    binding: () => Promise<CloudBinding>, call: Call,
  ): Promise<void> {
    if (!current() || !settled(this.read(scope)) || !prompt.trim() || prompt.length > 16000) return
    if (!this.reserve(scope)) throw new Error('CHAT_ATTEMPT_LIMIT')
    const attempt: Attempt = { state: 'checking' }
    this.entries.set(scope, attempt); this.notify()
    try {
      const target = await binding()
      if (this.read(scope) !== attempt) return
      if (!current()) { this.entries.delete(scope); this.notify(); return }
      if (target.pendingOperation) {
        this.entries.delete(scope)
        this.observe(scope, target)
        return
      }
      if (target.state !== 'active') throw new CloudRequestFailure('BINDING_DISABLED')
      const key = randomUUID()
      attempt.reference = { key, runtimeId: target.runtimeId, revision: target.bindingRevision }
      attempt.state = 'sending'; attempt.submitted = true; this.notify()
      try {
        const receipt = await call({
          epoch, path: path + '/prompts', method: 'POST', idempotencyKey: key,
          body: { prompt, timeoutSeconds: 180, expectedBindingRevision: target.bindingRevision },
        })
        if (this.read(scope) === attempt) this.accept(attempt, receipt)
      } catch (error) {
        if (this.read(scope) !== attempt) return
        const code = error instanceof CloudRequestFailure ? error.message : ''
        if (rejected.has(code)) {
          attempt.state = 'rejected'
          attempt.error = code
          delete attempt.reference
        } else attempt.state = 'unconfirmed'
      }
      this.notify()
    } catch (error) {
      if (this.read(scope) !== attempt) return
      attempt.state = 'rejected'
      attempt.error = error instanceof CloudRequestFailure && error.message === 'BINDING_DISABLED' ? error.message : 'BINDING_READ_FAILED'
      this.notify()
    }
  }

  private accept(attempt: Attempt, value: CloudValue): void {
    const receipt = Receipt.parse(value)
    if (receipt.runtimeId !== attempt.reference?.runtimeId || receipt.bindingRevision !== attempt.reference.revision) throw new Error('RECEIPT_MISMATCH')
    attempt.receipt = receipt
    delete attempt.reference
    attempt.state = 'accepted'
  }

  /** Look up the original request by key without replaying the POST. */
  async recover(scope: string, epoch: number, path: string, current: () => boolean, call: Call): Promise<void> {
    const attempt = this.read(scope), key = attempt?.reference?.key
    if (!attempt || !key || attempt.recovering || attempt.state !== 'unconfirmed' || !current()) return
    attempt.recovering = true; this.notify()
    try {
      const result = await call({ epoch, path: path + '/prompt-receipts?key=' + key, method: 'GET', body: null, idempotencyKey: null })
      if (this.read(scope) !== attempt) return
      if (result === null) attempt.receiptMissing = true
      else this.accept(attempt, result)
    } finally {
      if (this.read(scope) === attempt) { attempt.recovering = false; this.notify() }
    }
  }

  /** Read the original accepted operation. Cancellation is a request, not a terminal result. */
  async poll(scope: string, base: string, epoch: number, call: Call, cancel = false): Promise<void> {
    const attempt = this.read(scope), receipt = attempt?.receipt
    if (!attempt || !receipt || settled(attempt)) return
    const cancelPending = attempt.cancelling || attempt.operation?.cancelRequested || attempt.cancelUnconfirmed
    if (cancel && (!isActive(attempt.operation?.state ?? receipt.state) || cancelPending)) return
    const confirmingCancellation = !cancel && attempt.cancelUnconfirmed === true
    if (cancel) { attempt.cancelling = true; this.notify() }
    const path = `${base}/runtimes/${receipt.runtimeId}/operations/${receipt.id}`
    try {
      const operation = Operation.parse(await call({
        epoch, path: path + (cancel ? '/cancel' : ''), method: cancel ? 'POST' : 'GET', body: null, idempotencyKey: null,
      }))
      if (this.read(scope) !== attempt) return
      if (operation.id !== receipt.id || operation.runtimeId !== receipt.runtimeId) throw new Error('OPERATION_MISMATCH')
      if (confirmingCancellation && (operation.cancelRequested || !isActive(operation.state))) delete attempt.cancelUnconfirmed
      const previous = attempt.operation
      // A GET already in flight when cancellation was requested cannot erase its result.
      if (!previous || (isActive(previous.state) && (operation.state !== 'queued' || previous.state === 'queued'))
        || (previous.state === 'unknown' && !isActive(operation.state))) {
        attempt.operation = { ...operation, cancelRequested: operation.cancelRequested || previous?.cancelRequested === true }
      }
    } catch (error) {
      if (cancel && this.read(scope) === attempt) attempt.cancelUnconfirmed = true
      throw error
    } finally {
      if (this.read(scope) === attempt) {
        if (cancel) attempt.cancelling = false
        this.notify()
      }
    }
  }
}
