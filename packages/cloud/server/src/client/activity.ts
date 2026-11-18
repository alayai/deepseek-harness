/** Retain task references independently of the lifetime of a resource panel. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** A submitted cloud write; missing id means the acceptance result is unknown. */
export interface CloudActivity {
  readonly scope: string
  readonly path: string
  readonly key: string
  readonly operation?: { readonly path: string; readonly id: string }
}

/** Connection-owned task index; it contains references, never prompt bodies or tokens. */
export interface CloudActivities {
  readonly source: ObservableSnapshot<Readonly<Record<string, CloudActivity | undefined>>>
  readonly remember: (activity: CloudActivity) => void
  readonly accepted: (scope: string, key: string, operation: NonNullable<CloudActivity['operation']>) => void
  readonly clear: () => void
}

/**
 * Create the task-reference owner. A cleared or superseded submission cannot publish late acceptance.
 * @returns the source and its mutation callbacks.
 */
export function createCloudActivities(): CloudActivities {
  const source = createSnapshotStore<Readonly<Record<string, CloudActivity | undefined>>>({})
  return {
    source,
    remember: (activity) => { source.set({ ...source.getSnapshot(), [activity.scope]: activity }) },
    accepted: (scope, key, operation) => {
      const entry = source.getSnapshot()[scope]
      if (entry?.key === key) source.set({ ...source.getSnapshot(), [scope]: { ...entry, operation } })
    },
    clear: () => { source.set({}) },
  }
}
