import { Context } from '@deepseek-ai/cordis'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
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
  const ctx = new Context(), guard = vi.fn(), toolGuard = vi.fn(), drain = vi.fn(async () => {})
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('jobs', { list: () => [] } as never)
  ctx.provide('tools', { guard: toolGuard } as never)
  ctx.provide('typertGateway', { guard, drain } as never)
  await ctx.plugin(DshCloudService)
  return { ctx, owner: caller(ctx, { kind: 'owner' }), guard, toolGuard, drain }
}

describe('local read admission in cloud mode', () => {
  it.each(['authenticating', 'cloud', 'cloud-suspended'] as const)('allows plugin display and directory selection over HTTP and RPC while %s', async (mode) => {
    const { ctx, owner, guard, toolGuard, drain } = await fixture()
    try {
      if (mode === 'cloud-suspended') drain.mockRejectedValueOnce(new Error('local drain failed'))
      owner.beginLogin('http://localhost:17800')
      if (mode !== 'authenticating') await vi.waitFor(() => { expect(owner.state().mode).toBe(mode) })
      else expect(owner.state().mode).toBe(mode)
      const gateway = guard.mock.calls[0]?.[0] as (r: { namespace: string; method: string }) => void
      const allowed = [
        ['pluginInventory', 'list'], ['pluginManager', 'listBundles'], ['pluginManager', 'listPlugins'],
        ['directoryPicker', 'pick'], ['directoryPicker', 'list'], ['workspace', 'create'], ['workspace', 'follow'], ['dshCloud', 'state'],
        ['llm', 'listProviders'], ['llm', 'listConfigurableProviders'], ['session', 'create'],
        ['session', 'control'], ['session', 'follow'], ['session', 'list'], ['session', 'page'], ['session', 'projections'],
        ['settings', 'describe'], ['credentials', 'describe'], ['session', 'modelCatalog'],
      ] as const
      const blocked = [
        ['pluginManager', 'installBundle'], ['pluginManager', 'removeBundle'], ['pluginManager', 'updateBundle'],
        ['pluginManager', 'setBundleEnabled'], ['pluginManager', 'setPluginEnabled'],
        ['directoryPicker', 'createDirectory'], ['workspace', 'rename'], ['session', 'prompt'],
        ['credentials', 'set'], ['credentials', 'unset'], ['settings', 'mutate'], ['llm', 'discoverModels'],
      ] as const
      for (const [namespace, method] of allowed) expect(() => { gateway({ namespace, method }) }).not.toThrow()
      for (const [namespace, method] of blocked) {
        expect(() => { gateway({ namespace, method }) }).toThrow(expect.objectContaining({ details: { reason: 'LOCAL_TARGET_BLOCKED' } }))
      }
      for (const [path, admitted] of [
        ...allowed.map(parts => [`/api/${parts.join('/')}`, true] as const),
        ...blocked.map(parts => [`/api/${parts.join('/')}`, false] as const),
        ['/api/pluginInventory/list/extra', false], ['/api/directoryPicker/pick/extra', false],
        ['/api/remote.mux', true],
        ['/api/pluginManager/listPlugins?refresh=1', true],
      ] as const) {
        const request = new IncomingMessage(new Socket())
        request.url = path
        const response = new ServerResponse(request)
        const writeHead = vi.spyOn(response, 'writeHead').mockReturnValue(response)
        const end = vi.spyOn(response, 'end').mockReturnValue(response)
        const next = vi.fn(async () => {})
        await ctx.waterfall('connection/request', request, response, next)
        expect(next).toHaveBeenCalledTimes(admitted ? 1 : 0)
        if (admitted) expect(writeHead).not.toHaveBeenCalled()
        else {
          expect(writeHead).toHaveBeenCalledWith(409, expect.any(Object))
          expect(end).toHaveBeenCalledWith(JSON.stringify({ error: { code: 'CLOUD_LOCAL_TARGET_BLOCKED' } }))
        }
      }
      const tool = toolGuard.mock.calls[0]?.[0] as () => string | undefined
      expect(tool()).toBe('DSH_CLOUD_LOCAL_EXECUTION_BLOCKED')
      const nextStep = vi.fn()
      expect(await ctx.waterfall('agent/pre-step', {} as never, nextStep)).toEqual({ kind: 'reject' })
      expect(nextStep).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
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
