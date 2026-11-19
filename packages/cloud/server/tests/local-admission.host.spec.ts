import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import DshCloudService from '../src/index.ts'
import type { LocalReadRequest } from '../src/types.ts'

vi.mock('../src/login.ts', async () => {
  const { ServerTransport } = await import('../src/transport.ts')
  return { nativeLogin: async () => ({ expiresAt: Date.now() + 60_000, transport: new ServerTransport('http://localhost:17800', 'test-only', async () => new Response(JSON.stringify({ data: { compatibility: { protocol: 1, client: { min: 1, max: 1 } }, execution: { authenticatedMode: 'cloud', localFallback: false } } }))) }) }
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap { 'cloud-test-guest': { kind: 'cloud-test-guest' } }
}

function caller(ctx: Context, principal: Principal) {
  const invocation: RemoteInvocation = {
    request: { namespace: 'dshCloud', method: 'readLocal', args: {} }, service: 'dshCloud',
    peer: new Peer(ctx, { principal }), signal: new AbortController().signal,
    uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
  }
  return ctx.extend({ invocation }).dshCloud
}
async function fixture() {
  const ctx = new Context(), guard = vi.fn(), toolGuard = vi.fn()
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('jobs', { list: () => [] } as never)
  ctx.provide('tools', { guard: toolGuard } as never)
  ctx.provide('typertGateway', { guard, drain: async () => {} } as never)
  await ctx.plugin(DshCloudService)
  return { ctx, owner: caller(ctx, { kind: 'owner' }), guard, toolGuard }
}

describe('local read admission in cloud mode', () => {
  it('requires the Host owner and a cloud target; old epochs are rejected', async () => {
    const { ctx, owner } = await fixture()
    try {
      const input: LocalReadRequest = { kind: 'bots', epoch: 0, offset: 0 }
      await expect(owner.readLocal(input)).rejects.toMatchObject({ details: { reason: 'STALE_LOCAL_READ' } })
      const guest = caller(ctx, { kind: 'cloud-test-guest' })
      await expect(guest.readLocal(input)).rejects.toMatchObject({ details: { reason: 'OWNER_REQUIRED' } })
      owner.beginLogin('http://localhost:17800')
      await vi.waitFor(() => { expect(owner.state().mode).toBe('cloud') })
      await expect(owner.readLocal({ ...input, epoch: owner.state().epoch })).resolves.toMatchObject({ kind: 'bots', available: false })
      await expect(owner.readLocal(input)).rejects.toMatchObject({ details: { reason: 'STALE_LOCAL_READ' } })
      await owner.logout()
      await expect(owner.readLocal({ ...input, epoch: owner.state().epoch })).rejects.toMatchObject({ details: { reason: 'STALE_LOCAL_READ' } })
    } finally { await ctx.fiber.dispose() }
  })
  it('discards a late local result after sign-out, while other namespaces and tools stay blocked', async () => {
    const { ctx, owner, guard, toolGuard } = await fixture()
    try {
      const pending = Promise.withResolvers<never[]>()
      ctx.provide('sessionQuery', { listSessions: () => pending.promise } as never)
      owner.beginLogin('http://localhost:17800')
      await vi.waitFor(() => { expect(owner.state().mode).toBe('cloud') })
      const gateway = guard.mock.calls[0]?.[0] as (r: { namespace: string }) => void
      const tool = toolGuard.mock.calls[0]?.[0] as () => string | undefined
      expect(() => { gateway({ namespace: 'session' }) }).toThrow()
      expect(tool()).toBe('DSH_CLOUD_LOCAL_EXECUTION_BLOCKED')
      const read = owner.readLocal({ kind: 'sessions', epoch: owner.state().epoch, offset: 0 })
      const rejected = expect(read).rejects.toMatchObject({ details: { reason: 'STALE_LOCAL_READ' } })
      await owner.logout()
      pending.resolve([])
      await rejected
      expect(tool()).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
})
