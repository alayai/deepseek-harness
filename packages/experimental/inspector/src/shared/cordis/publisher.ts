/** Shared Host/Client publication of browser-safe Cordis snapshots. */

import type { Context } from '@deepseek-ai/cordis'
import { CORDIS_TREE_TOPIC } from '../bridge/messages/cordis.ts'
import { maxRetainedPayloadBytes } from '../bridge/buffer.ts'
import type { InspectorStatePublisher } from '../bridge/publisher.ts'
import type { InspectorJsonValue } from '../json.ts'
import type { CordisTreeLimits } from './collector.ts'
import { observeCordisTree } from './observer.ts'

/**
 * Largest Cordis snapshot that still fits in one retained source frame.
 * @param maxFrameBytes - Encoded limit of one source frame.
 * @returns The snapshot byte budget passed to the collector.
 */
export function cordisTreeStateBudget(maxFrameBytes: number): number {
  return maxRetainedPayloadBytes(maxFrameBytes, CORDIS_TREE_TOPIC)
}

/**
 * Observe one Cordis runtime and retain its latest source snapshot.
 * @param ctx - Plugin context whose root is inspected.
 * @param publisher - Active Host or Client source publisher.
 * @param limits - Snapshot node and encoded-byte limits.
 * @returns A disposer that stops observation and releases retained objects.
 */
export function publishCordisTree(
  ctx: Context,
  publisher: InspectorStatePublisher,
  limits: CordisTreeLimits,
): () => void {
  return observeCordisTree(ctx, (snapshot) => {
    publisher.setState(CORDIS_TREE_TOPIC, snapshot as unknown as InspectorJsonValue)
  }, limits)
}
