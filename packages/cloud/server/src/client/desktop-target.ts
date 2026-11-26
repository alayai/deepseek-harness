import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import type { CloudRequest, CloudValue } from '../types.ts'

const info = z.object({ id: z.uuid(), runtimeId: z.uuid(), location: z.literal('cloud'), state: z.enum(['running', 'stopped', 'unknown']) })
export type DesktopOperationKind = 'desktop_start' | 'desktop_stop' | 'computer' | 'browser'
export function checkDesktopOperation(row: CloudValue, id: string, runtime: string, kind: DesktopOperationKind) {
  if (row === null || typeof row !== 'object' || Array.isArray(row) || row.id !== id || row.runtimeId !== runtime || row.kind !== kind)
    throw Error('DESKTOP_STATUS_MISMATCH')
}
export function readDesktop(value: CloudValue, runtime: string, expected?: string) {
  const row = info.parse(value)
  if (row.runtimeId !== runtime || (expected !== undefined && row.id !== expected)) throw Error('DESKTOP_TARGET_MISMATCH')
  return row
}

/** Verify the selected desktop independently of the list and invalidate late reads even after an A-B-A switch. */
export function useDesktopTarget(call: (request: CloudRequest) => Promise<CloudValue>, epoch: number, base: string,
  runtime: string, desktop: string, scope: string, open: boolean) {
  const [version, reload] = useState(0)
  const key = useMemo(() => ({ scope, open, version }), [scope, open, version])
  const [status, setStatus] = useState<{ key: typeof key; state: 'running' | 'stopped' | 'unknown' | 'error' }>()
  const generation = useRef(0)
  useLayoutEffect(() => () => { generation.current++ }, [scope, open])
  useEffect(() => {
    let live = true
    if (open && runtime && desktop) void call({ epoch, path: base + '/desktops/' + desktop, method: 'GET', body: null, idempotencyKey: null })
      .then((value) => { const row = readDesktop(value, runtime, desktop); if (live) setStatus({ key, state: row.state }) })
      .catch(() => { if (live) setStatus({ key, state: 'error' }) })
    return () => { live = false }
  }, [key, call])
  return { state: status?.key === key ? status.state : undefined, reload: () => reload(v => v + 1), generation }
}
