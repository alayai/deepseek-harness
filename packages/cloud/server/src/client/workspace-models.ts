import { z } from 'zod'
import { useEffect, useRef, useState } from 'react'
import type { CloudRequest, CloudValue } from '../types.ts'

/** Public credential metadata shared by settings and the session form. */
export const workspaceModels = z.array(z.object({ id: z.uuid(), model: z.string().min(1), endpoint: z.string() }))

const pageSchema = z.object({ items: workspaceModels.max(100), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable() })
type Page = z.infer<typeof pageSchema> & { cursors: Set<string>; truncated: boolean }
type Call = (request: CloudRequest) => Promise<CloudValue>
async function read(call: Call, epoch: number, path: string, previous?: Page): Promise<Page> {
  const cursor = previous?.nextCursor
  const raw = await call({ epoch, path: path + '?limit=20' + (cursor ? '&cursor=' + cursor : ''), method: 'GET', body: null, idempotencyKey: null })
  const legacy = Array.isArray(raw)
  if (cursor && legacy) throw Error('MODEL_PAGING_UNAVAILABLE')
  const data = pageSchema.parse(legacy ? { items: raw, nextCursor: null } : raw)
  const cursors = new Set(previous?.cursors)
  if (data.nextCursor && cursors.has(data.nextCursor)) throw Error('REPEATED_MODEL_CURSOR')
  if (data.nextCursor) cursors.add(data.nextCursor)
  const items = new Map(previous?.items.map(row => [row.id, row]))
  for (const row of data.items) items.set(row.id, row)
  return { items: [...items.values()], nextCursor: data.nextCursor, cursors, truncated: legacy && data.items.length === 100 }
}

/** Share paging and failure semantics between the settings catalog and the new-session form. */
export function useWorkspaceModels(call: Call, epoch: number, path: string, scope: string, enabled: boolean) {
  const [revision, bump] = useState(0)
  const key = JSON.stringify([scope, epoch, path, enabled, revision])
  const [state, setState] = useState<{ key: string; page?: Page; status: 'ready' | 'loadingMore' | 'error' }>()
  const generation = useRef(0), pending = useRef(false)
  useEffect(() => {
    const ticket = ++generation.current
    pending.current = false
    setState(undefined)
    if (enabled) void read(call, epoch, path).then((page) => {
      if (generation.current === ticket) setState({ key, page, status: 'ready' })
    }).catch(() => { if (generation.current === ticket) setState({ key, status: 'error' }) })
    return () => { generation.current++ }
  }, [key, call])
  const current = state?.key === key ? state : undefined
  const more = async () => {
    if (!current?.page?.nextCursor || pending.current) return
    const ticket = generation.current
    pending.current = true; setState({ ...current, status: 'loadingMore' })
    try {
      const page = await read(call, epoch, path, current.page)
      if (ticket === generation.current) setState({ key, page, status: 'ready' })
    } catch { if (ticket === generation.current) setState({ ...current, status: 'error' }) }
    finally { if (ticket === generation.current) pending.current = false }
  }
  return { page: current?.page, status: current?.status ?? 'loading', more, refresh: () => bump(n => n + 1) }
}
