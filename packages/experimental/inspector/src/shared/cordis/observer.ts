/** Lifecycle-driven Cordis tree publication shared by Host and Client plugin faces. */

import type { Context } from '@deepseek-ai/cordis'
import type { CordisTreeSnapshot } from './snapshot.ts'
import { CordisTreeCollector, type CordisTreeLimits } from './collector.ts'

/** Receives one complete semantic snapshot after a coalesced Cordis mutation. */
export type CordisTreeSnapshotListener = (snapshot: CordisTreeSnapshot) => void

/**
 * Observe one Cordis realm and publish immutable tree replacements.
 * @param ctx - Plugin context whose root is inspected and whose effects own listeners.
 * @param listener - Consumer of complete snapshots in the inspected realm.
 * @param limits - Snapshot node and encoded-byte limits.
 * @returns A disposer that unregisters listeners and releases retained objects.
 */
export function observeCordisTree(
  ctx: Context,
  listener: CordisTreeSnapshotListener,
  limits: CordisTreeLimits,
): () => void {
  const collector = new CordisTreeCollector(ctx.root, limits)
  let scheduled = false
  let closed = false
  const publish = (): void => {
    scheduled = false
    if (closed) return
    try {
      listener(collector.snapshot())
    } catch (error) {
      // Publication runs from a microtask. A size rejection must not become an uncaught exception
      // and tear down the host; the previous retained snapshot stays in place.
      ctx.logger.warn('inspector: Cordis tree snapshot was not published', error)
    }
  }
  const schedule = (): void => {
    if (scheduled || closed) return
    scheduled = true
    queueMicrotask(publish)
  }
  const disposers = [
    ctx.on('internal/plugin', schedule, { global: true }),
    ctx.on('internal/status', schedule, { global: true }),
  ]
  publish()
  return () => {
    if (closed) return
    closed = true
    for (const dispose of disposers) dispose()
    collector.close()
  }
}
