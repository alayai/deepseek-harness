import { z } from 'zod'
import type { CloudRequest, CloudValue } from '../types.ts'
import { CloudRequestFailure } from './chat-turns.ts'
import type { CloudSource } from './source.ts'
import type { CloudViewStore } from './view-store.ts'

const uuid = z.uuid()
const preference = z.object({ tenant: uuid, workspace: z.union([uuid, z.literal('')]) })
const keyPrefix = 'dsh.cloud.workspace-default.v1:'

/** Remember navigation only. Every new login must prove its own identity and resource visibility. */
export function rememberWorkspace(source: CloudSource, store: CloudViewStore, call: (r: CloudRequest) => Promise<CloudValue>) {
  let context = '', key = '', generation = 0, last = '', selectionVersion = 0
  let restoring = false
  const observeSelection = () => {
    const { tenant, workspace } = store.getSnapshot()
    const text = JSON.stringify({ tenant, workspace })
    if (last === text) return
    last = text; selectionVersion++
    const host = source.getSnapshot()
    if (restoring || !key || host.mode !== 'cloud' || context !== JSON.stringify([host.epoch, host.serverUrl])) return
    try {
      if (!tenant) localStorage.removeItem(key)
      else if (preference.safeParse({ tenant, workspace }).success) localStorage.setItem(key, text)
    } catch { /* local storage is optional */ }
  }
  const connect = () => {
    const { mode, epoch, serverUrl } = source.getSnapshot()
    const next = mode === 'cloud' ? JSON.stringify([epoch, serverUrl]) : ''
    if (context === next) return
    const ticket = ++generation
    key = ''; context = next
    if (!next) return
    const start = selectionVersion
    const valid = () => ticket === generation && source.getSnapshot().mode === 'cloud' &&
      source.getSnapshot().epoch === epoch && source.getSnapshot().serverUrl === serverUrl
    const get = (path: string) => call({ epoch, path, method: 'GET', body: null, idempotencyKey: null })
    void (async () => {
      const [info, me] = await Promise.all([get('/server-info'), get('/me')])
      if (!valid()) return
      const sid = z.object({ serverId: uuid }).parse(info).serverId, uid = z.object({ id: uuid }).parse(me).id
      key = keyPrefix + JSON.stringify([serverUrl, sid, uid])
      if (selectionVersion !== start || store.getSnapshot().tenant) { last = ''; observeSelection(); return }
      const raw = localStorage.getItem(key)
      if (!raw) return
      const saved = preference.parse(JSON.parse(raw))
      const base = '/tenants/' + saved.tenant
      const tenant = z.object({ id: uuid, status: z.literal('active') }).parse(await get(base))
      if (tenant.id !== saved.tenant || !valid() || selectionVersion !== start) return
      let workspace = ''
      if (saved.workspace) {
        try {
          const row = z.object({ id: uuid, tenantId: uuid, status: z.enum(['active', 'archived']) }).parse(await get(base + '/workspaces/' + saved.workspace))
          if (row.id !== saved.workspace || row.tenantId !== saved.tenant) return
          if (row.status === 'active') workspace = row.id
        } catch (error) {
          if (!(error instanceof CloudRequestFailure && error.message === 'WORKSPACE_NOT_FOUND')) throw error
        }
      }
      if (!valid() || selectionVersion !== start) return
      restoring = true
      try { store.actions.restoreSelection(tenant.id, workspace) }
      finally { restoring = false }
    })().catch(() => { /* unavailable, revoked or stale defaults never grant access */ })
  }
  last = JSON.stringify({ tenant: store.getSnapshot().tenant, workspace: store.getSnapshot().workspace })
  const unview = store.subscribe(observeSelection), unhost = source.subscribe(connect)
  connect()
  return () => { generation++; key = ''; unview(); unhost() }
}
