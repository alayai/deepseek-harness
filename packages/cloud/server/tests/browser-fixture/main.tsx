// Production CloudChat and CloudPanel, a synthetic Host and backend. This is not Desktop acceptance.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CloudPanel, type CloudPanelProps } from '../../src/client/CloudPanel.tsx'
import { CloudChat } from '../../src/client/CloudChat.tsx'
import { CloudChatTurns } from '../../src/client/chat-turns.ts'
import { ICON_SYMBOLS } from '@deepseek-ai/dsh-client-ui-primitives'
import '../../../../client/ui-theme/src/styles/design-platform.css'
import '../../../../client/ui-theme/src/styles/base.css'
import '../../../../client/ui-theme/src/styles/focus.css'
import '../../../../client/ui-theme/src/styles/gradient-shadow-text.css'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CloudSnapshot } from '../../src/types.ts'
import { CloudSessionReplay } from '../../src/client/session-replay.ts'
import { CloudArtifactReceipts } from '../../src/client/CloudArtifacts.tsx'
import { createCloudViewStore } from '../../src/client/view-store.ts'
import { createCloudActivities } from '../../src/client/activity.ts'
import { zh } from '../../src/client/locales.ts'
import { bindSnapshotSelector } from '../../../../client/ui-renderer/src/client/bind.ts'

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`)
const [serverId, tenantId, workspaceId, sessionId, runtimeId, credentialRef] = ids
const emptySessionId = '00000000-0000-4000-8000-000000000007'
const store = createCloudViewStore(), activities = createCloudActivities()
const source = createSnapshotStore<CloudSnapshot>({ mode: 'cloud', epoch: 1, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null })
const replay = new CloudSessionReplay(), turns = new CloudChatTurns(), artifacts = new CloudArtifactReceipts()
store.actions.tenant(tenantId); store.actions.workspace(workspaceId); store.actions.resource('runtime', runtimeId); store.actions.resource('session', sessionId); store.actions.section('agent')
const userMessage = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请读取云端报告，整理本周交付情况和下一步建议。' }] }
const answer = '### 本周交付概览\n\n已在云端工作空间读取报告，整理出以下两项：\n\n- **已完成**：上传与检索链路已通过联调。\n- **待验证**：补齐跨工作空间的访问检查。\n\n下一步建议先复核访问权限，再发布本周归档。'
const events = [
  { type: 'initialized', data: {} },
  { type: 'agent/inbox/spliced', data: { inserted: [userMessage] } },
  { type: 'session.status', data: { state: 'running' } },
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: { message: userMessage } },
  { type: 'tool/call', data: { callId: 'read-1', name: 'read', arguments: '{"path":"report.txt"}' } },
  { type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'read-1' }, content: [{ type: 'tool-result', toolCallId: 'read-1', content: [{ type: 'text', text: '报告读取成功：' + '长内容'.repeat(200) }] }] } } },
  { type: 'cloud/assistant-delta', data: { streamId: 's1', text: '正在整理报告' } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: answer }] } } },
  { type: 'turn/end', data: { reason: { kind: 'completed' } } },
].map((event, index) => ({ id: String(index + 1), operationId: 'op1', createdAt: '2026-11-19T00:00:00Z', event: { type: 'notification', params: { event } } }))
let attempts = 0
const publications: unknown[] = []
const prompts: unknown[] = []
let fileAction: 'listPage' | 'read' | 'replace' = 'listPage'
let fileConflict = false
const fileRevision = 'a'.repeat(64)
const fileNextRevision = 'b'.repeat(64)
const operationId = '00000000-0000-4000-8000-000000000020'
const fileOperationId = '00000000-0000-4000-8000-000000000021'
const input: Omit<CloudPanelProps, 'openChat'> = {
  artifacts, t: key => zh[key] ?? key,
  useView: bindSnapshotSelector(store), viewActions: store.actions,
  useActivities: bindSnapshotSelector(activities.source), remember: activities.remember, accepted: activities.accepted,
  useCloud: bindSnapshotSelector(source),
  login: async () => {}, logout: async () => {}, readLocal: async () => ({ kind: 'sessions', items: [], nextOffset: null }),
  call: async (request) => {
    if (request.path === '/server-info') return { serverId, version: '0.4.2', compatibility: { protocol: 1, client: { min: 1, max: 1 }, requiredSchema: 9, worker: { state: 'legacy', version: '0.4.0', protocol: null, features: null } } }
    if (request.path === '/me') return { id: credentialRef }
    if (request.path.endsWith('/workspaces/' + workspaceId)) return { id: workspaceId, name: '研发工作空间' }
    if (request.path.endsWith('/sessions')) return [{ id: sessionId, title: '交付周报与行动项' }, { id: emptySessionId, title: '新建会话' }]
    if (request.path.endsWith('/prompts')) {
      prompts.push(request.body)
      events.push({
        id: String(events.length + 1), operationId, createdAt: '2026-11-19T00:00:10Z',
        event: { type: 'notification', params: { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '浏览器夹具云端回复\n\n<script>window.injected=true</script>' }] } } } } },
      })
      return { id: operationId, runtimeId, bindingRevision: 1, state: 'queued' }
    }
    if (request.path.endsWith('/operations/' + operationId)) {
      return { id: operationId, runtimeId, kind: 'agent', state: 'succeeded', cancelRequested: false, errorCode: null }
    }
    if (request.path.endsWith('/binding')) return { schemaVersion: 1, serverId, tenantId, workspaceId, cloudSessionId: request.path.includes(emptySessionId) ? emptySessionId : sessionId, runtimeId, credentialRef, desktopId: null, bindingRevision: 1, state: 'active' }
    if (request.path.includes(emptySessionId + '/events?after=')) return { items: [], nextAfter: '0' }
    if (request.path.includes('/events?after=')) { const after = BigInt(request.path.split('after=')[1]); return { items: events.filter(row => BigInt(row.id) > after), nextAfter: String(events.length) } }
    if (request.path.endsWith('/files')) {
      const body = request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {}
      if (body.action === 'listPage' || body.action === 'read' || body.action === 'replace') fileAction = body.action
      return { id: fileOperationId, runtimeId, state: 'queued', kind: 'files' }
    }
    if (request.path.includes('/operations/' + fileOperationId)) {
      if (fileAction === 'listPage') return { id: fileOperationId, runtimeId, state: 'succeeded', kind: 'files', result: { file: { path: '.', entries: [{ name: 'notes.txt', type: 'file' }], nextAfter: null } } }
      if (fileAction === 'read') return { id: fileOperationId, runtimeId, state: 'succeeded', kind: 'files', result: { file: { path: 'notes.txt', content: btoa('before'), revision: fileRevision } } }
      return fileConflict
        ? { id: fileOperationId, runtimeId, state: 'failed', kind: 'files', errorCode: 'FILE_REVISION_CONFLICT', result: null }
        : { id: fileOperationId, runtimeId, state: 'succeeded', kind: 'files', result: { file: { path: 'notes.txt', revision: fileNextRevision } } }
    }
    if (request.path.endsWith('/artifacts')) {
      publications.push({ key: request.idempotencyKey, body: request.body })
      if (++attempts === 1) throw Error('RESPONSE_LOST')
      return { id: 'object1' }
    }
    if (request.path.endsWith('/download')) return { downloadUrl: 'data:invalid' }
    return { items: [] }
  },
}
Object.assign(window, { cloudFixture: { publications, prompts, setFileConflict: (value: boolean) => { fileConflict = value } } })
function Fixture() {
  const [shown, show] = useState(true), [resources, setResources] = useState(false)
  return <>
    <div className="fixture-controls">
      <small>界面预览 · 模拟服务端</small>
      <button onClick={() => { show(value => !value) }}>切换挂载</button>
      <button onClick={() => {
        source.set({ ...source.getSnapshot(), mode: 'cloud-suspended', epoch: 2, error: 'CLOUD_PROTOCOL_UNSUPPORTED' })
      }}>模拟协议不兼容</button>
    </div>
    <main style={{ height: 'calc(100dvh - 38px)' }}>{shown && (resources
      ? <CloudPanel {...input} openChat={() => { setResources(false) }} />
      : <CloudChat t={input.t} cloudSource={source} useCloud={input.useCloud} viewSource={store} useView={input.useView}
        turns={turns} replay={replay} call={input.call} openResources={() => { setResources(true) }} />)}</main>
  </>
}
const css = document.createElement('style')
css.textContent = `
  body { margin: 0; --dsh-content-font-delta: 0px; font-family: var(--dsw-font-family); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
  body[data-ds-dark-theme] { color-scheme: dark; }
  .fixture-controls { box-sizing: border-box; height: 38px; padding: 0 10px; display: flex; gap: 6px; align-items: center;
    font-size: 11px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
  .fixture-controls small { white-space: nowrap; }
  .fixture-controls button { font: inherit; }
`
const ns = 'http://www.w3.org/2000/svg'
const icons = document.createElementNS(ns, 'svg')
icons.setAttribute('aria-hidden', 'true')
icons.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
for (const [id, markup] of Object.entries(ICON_SYMBOLS)) {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const symbol = document.createElementNS(ns, 'symbol')
  symbol.id = id
  for (const { name, value } of svg.attributes) {
    if (!['width', 'height', 'xmlns', 'class', 'aria-hidden'].includes(name)) symbol.setAttribute(name, value)
  }
  symbol.append(...[...svg.childNodes].map(node => document.importNode(node, true)))
  icons.append(symbol)
}
document.body.prepend(icons)
document.head.append(css)
createRoot(document.getElementById('root')!).render(<Fixture />)
