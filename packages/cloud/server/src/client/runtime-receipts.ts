import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { z } from 'zod'
import type { CloudRequest, CloudValue } from '../types.ts'

export type RuntimeAction = 'command' | 'start' | 'stop'
type Read = (request: CloudRequest) => Promise<CloudValue>
interface Reference { scope: string; kind: RuntimeAction; key: string }

async function principal(epoch: number, call: Read) {
  const get = (path: string) => call({ epoch, method: 'GET', path, body: null, idempotencyKey: null })
  const [server, me] = await Promise.all([get('/server-info'), get('/me')])
  return [z.object({ serverId: z.uuid() }).parse(server).serverId, z.object({ id: z.uuid() }).parse(me).id]
}

/** Window-owned unresolved writes. No command, output, credential or token is kept. */
export class RuntimeReceipts {
  readonly entries = createSnapshotStore<readonly Reference[]>([])
  private identity?: { key: string; ids: Promise<string[]> } | undefined
  constructor(private readonly identify = principal) {}

  async scope(origin: string, epoch: number, runtimePath: string, call: Read) {
    const key = JSON.stringify([origin, epoch])
    if (this.identity?.key !== key) this.identity = { key, ids: this.identify(epoch, call) }
    const snapshot = this.identity
    try { return JSON.stringify([origin, ...await snapshot.ids, runtimePath]) }
    catch (error) { if (snapshot === this.identity) this.identity = undefined; throw error }
  }

  reserve(entry: Reference) {
    const entries = this.entries.getSnapshot()
    if (entries.length >= 128) throw Error('PENDING_TASK_LIMIT')
    this.entries.set([...entries, entry])
  }
  forget(key: string) { this.entries.set(this.entries.getSnapshot().filter(entry => entry.key !== key)) }
  clear() { this.entries.set([]); this.identity = undefined }
}
