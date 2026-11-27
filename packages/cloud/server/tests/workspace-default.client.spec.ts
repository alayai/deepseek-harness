// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CloudRequest, CloudSnapshot, CloudValue } from '../src/types.ts'
import { CloudRequestFailure } from '../src/client/chat-turns.ts'
import { createCloudViewStore } from '../src/client/view-store.ts'
import { rememberWorkspace } from '../src/client/workspace-default.ts'

const [serverId, user, tenant, workspace, other] = Array.from({ length: 5 }, () => randomUUID()) as [string,string,string,string,string]
const snapshot: CloudSnapshot = { mode: 'cloud', epoch: 1, serverUrl: 'https://example.test', authorizationUrl: null, error: null }
const base = '/tenants/' + tenant
const row = { id: workspace, tenantId: tenant, status: 'active' }
const key = 'dsh.cloud.workspace-default.v1:' + JSON.stringify([snapshot.serverUrl, serverId, user])
const saved = JSON.stringify({ tenant, workspace })
afterEach(() => localStorage.clear())
function fixture(work: () => CloudValue | Promise<CloudValue> = () => row) {
  const store = createCloudViewStore(), host = createSnapshotStore(snapshot)
  let identity = user
  const call = vi.fn(async (req: CloudRequest): Promise<CloudValue> => {
    expect(req.method).toBe('GET')
    if (req.path === '/server-info') return { serverId }
    if (req.path === '/me') return { id: identity }
    if (req.path === base) return { id: tenant, status: 'active' }
    if (req.path === base + '/workspaces/' + workspace) return work()
    throw Error('unexpected path')
  })
  const dispose = rememberWorkspace(host, store, call)
  function login(as: string) {
    host.set({ ...snapshot, mode: 'cloud-suspended', epoch: 2 })
    store.actions.reset()
    identity = as
    host.set({ ...snapshot, epoch: 3 })
  }
  return { store, call, login, dispose }
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

it('remembers only the two navigation IDs across expiry and fresh login', async () => {
  const f = fixture()
  f.store.actions.tenant(tenant); f.store.actions.workspace(workspace); f.store.actions.resource('session', other)
  await flush()
  expect(localStorage.getItem(key)).toBe(saved)
  f.login(user)
  await flush()
  expect(f.store.getSnapshot()).toMatchObject({ tenant, workspace, session: '', credential: '', runtime: '' })
  expect(f.call.mock.calls.map(([r]) => r.path).slice(-2)).toEqual([base, base + '/workspaces/' + workspace])
  f.dispose()
})
it.each(['account', 'manual', 'dispose'] as const)('drops a late workspace read after %s change', async (change) => {
  localStorage.setItem(key, saved)
  const pending = Promise.withResolvers<CloudValue>()
  const f = fixture(() => pending.promise)
  await flush()
  expect(f.call.mock.calls.at(-1)?.[0].path).toBe(base + '/workspaces/' + workspace)
  if (change === 'account') f.login(other)
  else if (change === 'manual') f.store.actions.tenant(other)
  else f.dispose()
  pending.resolve(row)
  await flush()
  expect(f.store.getSnapshot()).toMatchObject({ tenant: change === 'manual' ? other : '', workspace: '' })
  expect(localStorage.getItem(key)).toBe(change === 'manual' ? JSON.stringify({ tenant: other, workspace: '' }) : saved)
  f.dispose()
})
it.each(['missing', 'archived', 'wrong-tenant', 'network'] as const)('handles a %s default without silently replacing it', async (reason) => {
  localStorage.setItem(key, saved)
  const f = fixture(() => {
    if (reason === 'missing') throw new CloudRequestFailure('WORKSPACE_NOT_FOUND')
    if (reason === 'network') throw Error('offline')
    return { ...row, ...(reason === 'archived' ? { status: 'archived' } : { tenantId: other }) }
  })
  await flush()
  expect(f.store.getSnapshot()).toMatchObject({ tenant: ['missing','archived'].includes(reason) ? tenant : '', workspace: '' })
  expect(localStorage.getItem(key)).toBe(saved)
  f.dispose()
})
