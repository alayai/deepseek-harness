/** A single Client owner polls the Host target; loss of the Host keeps the cloud surface locked. */
import type { CloudSnapshot } from '../types.ts'

/** Read-only UI subscription supplied to the slot renderer. */
export interface CloudSource {
  getSnapshot(): CloudSnapshot
  subscribe(listener: () => void): () => void
}

/** The owner of a read-only cloud state source and its polling lifetime. */
export interface CloudSourceOwner {
  readonly source: CloudSource
  publish(next: CloudSnapshot): void
  refresh(): Promise<void>
  dispose(): void
}

/** Poll only target state. Business operations are never automatically replayed.
 * @param read - display-state read from the Host Remote.
 * @returns source owner; dispose stops publication and subsequent polling.
 */
export function createCloudSource(read: () => Promise<CloudSnapshot>): CloudSourceOwner {
  let snapshot: CloudSnapshot = { mode: 'local', epoch: 0, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
  const listeners = new Set<() => void>()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: CloudSnapshot): void => {
    if (closed || next.epoch < snapshot.epoch || JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const refresh = async (): Promise<void> => {
    try { publish(await read()) }
    catch {
      if (snapshot.mode !== 'local') publish({ ...snapshot, mode: 'cloud-suspended', authorizationUrl: null, error: 'HOST_DISCONNECTED' })
    }
  }
  const poll = async (): Promise<void> => {
    await refresh()
    if (!closed) timer = setTimeout(() => { void poll() }, 750)
  }
  void poll()
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    publish, refresh,
    dispose: () => { closed = true; if (timer !== undefined) clearTimeout(timer); listeners.clear() },
  }
}
