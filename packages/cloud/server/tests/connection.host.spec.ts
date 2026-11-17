import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudConnection } from '../src/connection.ts'
import { apiPath, CloudApiError, serverOrigin, ServerTransport } from '../src/transport.ts'

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

const connections: CloudConnection[] = []
afterEach(async () => { await Promise.all(connections.splice(0).map(connection => connection.dispose())) })
const policy = { execution: { authenticatedMode: 'cloud', localFallback: false } }
function fixture(options: { drain?: (signal: AbortSignal) => Promise<void>; fetcher?: typeof fetch } = {}) {
  const fetcher = options.fetcher ?? vi.fn<typeof fetch>(async input => new Response(JSON.stringify({ data: inputUrl(input).endsWith('/server-info') ? policy : { id: 'cloud-user' } })))
  const transport = new ServerTransport('http://localhost:17800', 'host-secret', fetcher)
  const authenticate = vi.fn(async (_origin: string, authorize: (url: string) => void, _signal: AbortSignal) => {
    authorize('https://identity.example/authorize?state=test')
    return { transport, expiresAt: Date.now() + 60_000 }
  })
  const cloud = new CloudConnection(options.drain ?? (async () => {}), authenticate)
  connections.push(cloud)
  return { cloud, authenticate, fetcher }
}
async function connected(cloud: CloudConnection) { cloud.beginLogin('http://localhost:17800'); await vi.waitFor(() =>{  expect(cloud.snapshot().mode).toBe('cloud') }) }
const request = (cloud: CloudConnection) => ({ epoch: cloud.snapshot().epoch, path: '/me/tenants', method: 'GET' as const, body: null, idempotencyKey: null })

describe('Host-owned cloud target', () => {
  it('blocks the local target before drain and authenticates only after drain settles', async () => {
    const drain = Promise.withResolvers<undefined>()
    const { cloud, authenticate } = fixture({ drain: () => drain.promise })
    expect(cloud.snapshot().mode).toBe('local')
    cloud.beginLogin('http://localhost:17800')
    expect(cloud.snapshot().mode).toBe('authenticating')
    expect(authenticate).not.toHaveBeenCalled()
    await expect(cloud.request(request(cloud))).rejects.toMatchObject({ code: 'CLOUD_TARGET_BLOCKED' })
    drain.resolve(undefined)
    await vi.waitFor(() =>{  expect(cloud.snapshot().mode).toBe('cloud') })
    expect(JSON.stringify(cloud.snapshot())).not.toContain('host-secret')
  })
  it('keeps local blocked when drain fails, and requires explicit logout', async () => {
    const drain = vi.fn<() => Promise<void>>(async () => { throw new Error('busy local process') })
    const { cloud, authenticate } = fixture({ drain })
    cloud.beginLogin('http://localhost:17800')
    await vi.waitFor(() =>{  expect(cloud.snapshot().mode).toBe('cloud-suspended') })
    expect(authenticate).not.toHaveBeenCalled()
    drain.mockImplementation(async () => {})
    await cloud.logout()
    expect(cloud.snapshot().mode).toBe('local')
  })
  it('suspends on 401 and never replays a write or selects local', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => (inputUrl(input).endsWith('/server-info') || inputUrl(input).endsWith('/me'))
      ? new Response(JSON.stringify({ data: policy }))
      : new Response(JSON.stringify({ error: { code: 'SESSION_REVOKED' } }), { status: 401 }))
    const { cloud } = fixture({ fetcher })
    await connected(cloud)
    await expect(cloud.request({ ...request(cloud), method: 'POST', path: '/tenants', body: { name: 'test' }, idempotencyKey: 'retained-key' })).rejects.toMatchObject({ code: 'SESSION_REVOKED' })
    expect(cloud.snapshot().mode).toBe('cloud-suspended')
    expect(fetcher).toHaveBeenCalledTimes(3)
    await expect(cloud.request(request(cloud))).rejects.toMatchObject({ code: 'CLOUD_TARGET_BLOCKED' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('discards late replies from an invalidated login generation', async () => {
    const reply = Promise.withResolvers<Response>()
    const { cloud } = fixture({ fetcher: async input => (inputUrl(input).endsWith('/server-info') || inputUrl(input).endsWith('/me')) ? new Response(JSON.stringify({ data: policy })) : reply.promise })
    await connected(cloud)
    const pending = cloud.request(request(cloud))
    cloud.suspend('DISCONNECTED')
    reply.resolve(new Response(JSON.stringify({ data: { stale: true } })))
    await expect(pending).rejects.toMatchObject({ code: 'STALE_CLOUD_RESULT' })
    expect(cloud.snapshot().mode).toBe('cloud-suspended')
  })
  it('does not turn ordinary validation rejection into a login reset', async () => {
    const { cloud } = fixture({ fetcher: async input => (inputUrl(input).endsWith('/server-info') || inputUrl(input).endsWith('/me')) ? new Response(JSON.stringify({ data: policy })) : new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT' } }), { status: 409 }) })
    await connected(cloud)
    await expect(cloud.request(request(cloud))).rejects.toMatchObject({ status: 409 })
    expect(cloud.snapshot().mode).toBe('cloud')
  })
  it('keeps local blocked when logout revocation cannot be confirmed', async () => {
    const { cloud } = fixture({ fetcher: async input => inputUrl(input).endsWith('/auth/logout') ? new Response('', { status: 503 }) : new Response(JSON.stringify({ data: policy })) })
    await connected(cloud)
    await expect(cloud.logout()).rejects.toMatchObject({ code: 'LOGOUT_FAILED' })
    expect(cloud.snapshot().mode).toBe('cloud-suspended')
  })
  it('accepts server-confirmed prior revocation when explicitly returning local', async () => {
    const { cloud } = fixture({ fetcher: async input => inputUrl(input).endsWith('/auth/logout')
      ? new Response(JSON.stringify({ error: { code: 'SESSION_REVOKED' } }), { status: 401 })
      : new Response(JSON.stringify({ data: policy })) })
    await connected(cloud)
    await cloud.logout()
    expect(cloud.snapshot().mode).toBe('local')
  })
  it('allows explicit logout after known token expiry without needing a dead server', async () => {
    const { cloud } = fixture()
    await connected(cloud)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 65_000)
      await cloud.logout()
      expect(cloud.snapshot().mode).toBe('local')
    } finally { vi.useRealTimers() }
  })
  it('serializes concurrent logout and refuses login while revocation is pending', async () => {
    const revoke = Promise.withResolvers<Response>()
    const fetcher = vi.fn<typeof fetch>(async input => inputUrl(input).endsWith('/auth/logout') ? revoke.promise : new Response(JSON.stringify({ data: policy })))
    const { cloud } = fixture({ fetcher })
    await connected(cloud)
    const first = cloud.logout(), second = cloud.logout()
    expect(first).toBe(second)
    expect(() => cloud.beginLogin('http://localhost:17800')).toThrow('CLOUD_BUSY')
    revoke.resolve(new Response('{}'))
    await first
    expect(fetcher.mock.calls.filter(([input]) => inputUrl(input).endsWith('/auth/logout'))).toHaveLength(1)
    expect(cloud.snapshot().mode).toBe('local')
  })
  it('revokes the prior suspended login before issuing replacement authority', async () => {
    const { cloud, authenticate, fetcher } = fixture()
    await connected(cloud)
    cloud.suspend('DISCONNECTED')
    cloud.beginLogin('http://localhost:17800')
    await vi.waitFor(() =>{  expect(cloud.snapshot().mode).toBe('cloud') })
    expect(authenticate).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetcher).mock.calls.some(([input]) => inputUrl(input).endsWith('/auth/logout'))).toBe(true)
  })
  it('refuses servers advertising local fallback', async () => {
    const { cloud } = fixture({ fetcher: async () => new Response(JSON.stringify({ data: { execution: { authenticatedMode: 'cloud', localFallback: true } } })) })
    cloud.beginLogin('http://localhost:17800')
    await vi.waitFor(() =>{  expect(cloud.snapshot().error).toBe('UNSAFE_SERVER_POLICY') })
    expect(cloud.snapshot().mode).toBe('cloud-suspended')
  })
})

describe('cloud request boundary', () => {
  it.each(['http://remote.example', 'https://user:secret@server.example', 'https://server.example/path', 'https://server.example/?secret=x'])('refuses unsafe origins: %s', (origin) => {
    expect(() => serverOrigin(origin)).toThrow(CloudApiError)
  })
  it.each(['//evil.example', '/auth/logout', '/tenants/../me', '/tenants/%2e%2e/me', '/tenants/x//workspaces'])('refuses path escapes or auth commands: %s', (path) => {
    expect(() => apiPath(path)).toThrow(CloudApiError)
  })
  it('sends bearer only from Host, refuses redirects, and preserves the write key', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { id: 'operation' } })))
    const transport = new ServerTransport('https://server.example', 'host-secret', fetcher)
    await transport.request({ path: '/tenants', method: 'POST', body: { name: 'test' }, idempotencyKey: 'stable-key' })
    expect(fetcher).toHaveBeenCalledWith('https://server.example/api/v1/tenants', expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer host-secret', 'Idempotency-Key': 'stable-key', Accept: 'application/json', 'Content-Type': 'application/json' } }))
  })
})
