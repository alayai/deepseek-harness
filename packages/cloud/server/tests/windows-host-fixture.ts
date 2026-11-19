/** Native Windows Host fixture. Real loopback transport; synthetic login and API, no Desktop UI. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { CloudConnection } from '../src/connection.ts'
import { ServerTransport } from '../src/transport.ts'

let protocol = 2, writes = 0, revocations = 0
const token = randomUUID()
const server = createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${token}`)
  response.setHeader('content-type', 'application/json')
  if (request.url === '/api/v1/server-info') response.end(JSON.stringify({ data: { compatibility: { protocol, client: { min: 1, max: 1 } }, execution: { authenticatedMode: 'cloud', localFallback: false } } }))
  else if (request.url === '/api/v1/auth/logout') { revocations++; response.end('{}') }
  else if (request.url === '/api/v1/tenants') { writes++; response.end(JSON.stringify({ data: { id: 'accepted-fixture-operation' } })) }
  else response.end(JSON.stringify({ data: { id: 'fixture-user' } }))
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (address === null || typeof address === 'string') throw Error('FIXTURE_LISTENER_FAILED')
const origin = `http://127.0.0.1:${String(address.port)}`
const cloud = new CloudConnection(async () => {}, async () => ({
  transport: new ServerTransport(origin, token), expiresAt: Date.now() + 60_000,
}))
async function settled(): Promise<void> {
  const deadline = Date.now() + 5000
  while (cloud.snapshot().mode === 'authenticating') {
    if (Date.now() > deadline) throw Error('FIXTURE_LOGIN_TIMEOUT')
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}
try {
  cloud.beginLogin(origin); await settled()
  assert.equal(cloud.snapshot().error, 'CLOUD_PROTOCOL_UNSUPPORTED')
  assert.equal(cloud.snapshot().mode, 'cloud-suspended')
  await assert.rejects(cloud.request({ epoch: cloud.snapshot().epoch, path: '/tenants', method: 'POST', body: {}, idempotencyKey: 'denied' }))
  assert.equal(writes, 0)
  protocol = 1
  cloud.beginLogin(origin); await settled()
  assert.equal(cloud.snapshot().mode, 'cloud')
  assert.equal(revocations, 1)
  const epoch = cloud.snapshot().epoch
  await cloud.request({ epoch, path: '/tenants', method: 'POST', body: {}, idempotencyKey: 'fixture-key' })
  assert.equal(writes, 1)
  cloud.suspend('CONNECTION_LOST')
  await assert.rejects(cloud.request({ epoch, path: '/tenants', method: 'POST', body: {}, idempotencyKey: 'fixture-key' }))
  assert.equal(writes, 1)
  assert.equal(cloud.snapshot().mode, 'cloud-suspended')
  await cloud.logout()
  assert.equal(cloud.snapshot().mode, 'local')
  assert.equal(revocations, 2)
  console.log(JSON.stringify({ fixture: true, desktopUiAccepted: false, platform: process.platform, node: process.versions.node,
    loopback: true, unsupportedProtocolBlocked: true, reconnectRevokesPriorAuthority: true,
    staleWindowBlocked: true, noAutomaticReplay: true, explicitLogoutRestoresLocal: true }))
} finally {
  await cloud.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() =>{  resolve() }))
}
