// Production CloudPanel, a synthetic Host and backend. This is not Desktop acceptance.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CloudPanel, type CloudPanelProps } from '../../src/client/CloudPanel.tsx'
import { CloudSessionReplay } from '../../src/client/session-replay.ts'
import { CloudArtifactReceipts } from '../../src/client/CloudArtifacts.tsx'
import { createCloudViewStore } from '../../src/client/view-store.ts'
import { createCloudActivities } from '../../src/client/activity.ts'
import { zh } from '../../src/client/locales.ts'
import { bindSnapshotSelector } from '../../../../client/ui-renderer/src/client/bind.ts'

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`)
const [serverId, tenantId, workspaceId, sessionId, runtimeId, credentialRef] = ids
const store = createCloudViewStore(), activities = createCloudActivities()
const replay = new CloudSessionReplay(), artifacts = new CloudArtifactReceipts()
store.actions.tenant(tenantId); store.actions.workspace(workspaceId); store.actions.resource('runtime', runtimeId); store.actions.resource('session', sessionId); store.actions.section('agent')
const events = [
  { type: 'user/message', data: { content: [{ type: 'text', text: '请读取云端报告' }] } },
  { type: 'tool/call', data: { callId: 'read-1', name: 'read', arguments: '{"path":"report.txt"}' } },
  { type: 'tool/result', data: { message: { callId: 'read-1', content: [{ type: 'text', text: '报告读取成功：' + '长内容'.repeat(200) }] } } },
  { type: 'cloud/assistant-delta', data: { streamId: 's1', text: '云端增量消息 <script>window.injected=true</script>' } },
].map((event, index) => ({ id: String(index + 1), operationId: 'op1', createdAt: '2026-11-19T00:00:00Z', event }))
let attempts = 0
const publications: unknown[] = []
const input: CloudPanelProps = {
  replay, artifacts, t: key => zh[key] ?? key,
  useView: bindSnapshotSelector(store), viewActions: store.actions,
  useActivities: bindSnapshotSelector(activities.source), remember: activities.remember, accepted: activities.accepted,
  useCloud: select => select({ mode: 'cloud', epoch: 1, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }),
  login: async () => {}, logout: async () => {}, readLocal: async () => ({ kind: 'sessions', items: [], nextOffset: null }),
  call: async (request) => {
    if (request.path === '/server-info') return { serverId, version: '0.4.2', compatibility: { protocol: 1, client: { min: 1, max: 1 }, requiredSchema: 9, worker: { state: 'legacy', version: '0.4.0', protocol: null, features: null } } }
    if (request.path.endsWith('/binding')) return { schemaVersion: 1, serverId, tenantId, workspaceId, cloudSessionId: sessionId, runtimeId, credentialRef, desktopId: null, bindingRevision: 1, state: 'active' }
    if (request.path.includes('/events?after=')) { const after = BigInt(request.path.split('after=')[1]); return { items: events.filter(row => BigInt(row.id) > after), nextAfter: '4' } }
    if (request.path.endsWith('/files')) return { id: 'file-op', runtimeId, state: 'queued' }
    if (request.path.includes('/operations/')) return { id: 'file-op', runtimeId, state: 'succeeded', kind: 'files', result: { file: { content: 'cmVwb3J0' } } }
    if (request.path.endsWith('/artifacts')) {
      publications.push({ key: request.idempotencyKey, body: request.body })
      if (++attempts === 1) throw Error('RESPONSE_LOST')
      return { id: 'object1' }
    }
    if (request.path.endsWith('/download')) return { downloadUrl: 'data:invalid' }
    return { items: [] }
  },
}
Object.assign(window, { cloudFixture: { publications } })
function Fixture() {
  const [shown, show] = useState(true), [unsupported, setUnsupported] = useState(false)
  return <><p>测试夹具：生产 CloudPanel，模拟 Host/服务端。非真实 Desktop 验收。</p><button onClick={() =>{  show(value => !value) }}>切换挂载</button><button onClick={() =>{  setUnsupported(value => !value) }}>模拟协议不兼容</button><main style={{ height: 'calc(100vh - 100px)' }}>{shown && <CloudPanel {...input} {...(unsupported ? { useCloud: select => select({ mode: 'cloud-suspended', epoch: 2, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: 'CLOUD_PROTOCOL_UNSUPPORTED' }) } : {})} />}</main></>
}
const css = document.createElement('style')
css.textContent = ':root{font-family:system-ui;--dsw-alias-label-primary:#172536;--dsw-alias-label-secondary:#536376;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#edf2f7;--dsw-alias-border-l4:#bcc7d3;--dsw-alias-state-error-primary:#bd3434}body{margin:12px}body.dark{--dsw-alias-label-primary:#e9eff7;--dsw-alias-label-secondary:#a4b4c7;--dsw-alias-bg-layer-1:#172536;--dsw-alias-bg-layer-2:#24374d;--dsw-alias-border-l4:#50647c;background:#172536;color:#e9eff7}'
document.head.append(css)
createRoot(document.getElementById('root')!).render(<Fixture />)
