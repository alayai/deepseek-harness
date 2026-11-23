// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CloudPanel, type CloudPanelProps } from '../src/client/CloudPanel.tsx'
import { CloudFileState } from '../src/client/CloudFiles.tsx'
import { zh } from '../src/client/locales.ts'
import type { CloudSnapshot, CloudValue } from '../src/types.ts'
import { createCloudViewStore } from '../src/client/view-store.ts'
import { createCloudActivities } from '../src/client/activity.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function props(mode: CloudSnapshot['mode'] = 'local', epoch = 8): CloudPanelProps {
  const snapshot: CloudSnapshot = { mode, epoch, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
  const store = createCloudViewStore(), activities = createCloudActivities()
  const input: CloudPanelProps = {
    useView: bindSnapshotSelector(store), viewActions: store.actions,
    useActivities: bindSnapshotSelector(activities.source), remember: activities.remember, accepted: activities.accepted,
    openChat: vi.fn(), t: makeTranslate(zh), useCloud: <T,>(select: (value: CloudSnapshot) => T) => select(snapshot),
    readLocal: vi.fn(async () => ({ kind: 'sessions' as const, items: [], nextOffset: null })), exportLocal: vi.fn(async () => ({ version: 1 as const, exportable: false, reason: 'NOT_READY' as const })), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), call: vi.fn(async () => null),
  }
  return input
}

describe('cloud workspace UI', () => {
  it('publishes the file selected by the latest read and reconciles a lost save only for its account', async () => {
    const input = props('cloud')
    input.files = new CloudFileState()
    const serverId = '10000000-0000-4000-8000-000000000010', runtime = '10000000-0000-4000-8000-000000000003'
    const account = '10000000-0000-4000-8000-000000000001', otherAccount = '10000000-0000-4000-8000-000000000002'
    let userId = account, originalKey: string | null = null
    const requests: string[] = [], reads = new Map<string, CloudValue>()
    function result(id: string, file: CloudValue) { return { id, runtimeId: runtime, kind: 'files', state: 'succeeded', result: { file } } }
    const saveId = '10000000-0000-4000-8000-000000000099'
    const saved = result(saveId, { path: 'a.txt', revision: 'b'.repeat(64) })
    const legacyId = '10000000-0000-4000-8000-000000000012'
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/me') return { id: userId }
      if (request.path === '/server-info') return { serverId }
      if (request.path.endsWith('/files')) {
        const body = request.body
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('unexpected file request')
        if (body.action === 'replace') {
          requests.push('replace')
          originalKey = request.idempotencyKey
          throw Error('response lost')
        }
        const id = body.path === 'b.txt' ? legacyId : body.action === 'listPage' ? serverId : account
        reads.set(id, result(id, body.action === 'listPage'
          ? { path: '.', entries: [{ name: 'a.txt', type: 'file' }], nextAfter: null }
          : { path: body.path!, content: btoa('original'), revision: 'a'.repeat(64) }))
        return { id, runtimeId: runtime, kind: 'files' }
      }
      if (request.path.includes('/file-receipts?')) {
        expect(request.path.split('?key=')[1]).toBe(originalKey)
        expect(request.epoch).toBe(11)
        requests.push('lookup')
        return saved
      }
      if (request.path.endsWith('/operations/' + saveId)) { requests.push('poll'); return saved }
      if (request.path.includes('/operations/')) return reads.get(request.path.split('/').at(-1)!) ?? null
      if (request.path.endsWith('/artifacts')) {
        expect(request.body).toMatchObject({ operationId: legacyId })
        requests.push('publish B')
        return { id: 'object-b' }
      }
      throw Error('unexpected request')
    })
    input.viewActions.tenant('team'); input.viewActions.workspace('workspace')
    input.viewActions.resource('runtime', runtime); input.viewActions.section('files')
    const view = render(<CloudPanel {...input} />)
    await screen.findByText(zh.fileRoot)
    fireEvent.click((await screen.findAllByRole('button', { name: zh.list }))[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'a.txt' }))
    const editor = await screen.findByRole('textbox', { name: zh.fileEditor })
    await screen.findByText('a.txt', { selector: 'bdi' })
    fireEvent.click(screen.getByText(zh.fileLegacy))
    fireEvent.change(screen.getByLabelText(zh.path), { target: { value: 'b.txt' } })
    fireEvent.click(screen.getByRole('button', { name: zh.read }))
    await screen.findByText('b.txt', { selector: 'bdi' })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.artifactPublish }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.artifactPublish }))
    await screen.findByText(legacyId, { exact: false, selector: 'article p' })
    fireEvent.change(editor, { target: { value: 'unsent draft' } })
    fireEvent.click(screen.getByRole('button', { name: zh.fileSave }))
    await screen.findByText(zh.filePending)
    expect(originalKey).toBeTruthy()
    view.rerender(<CloudPanel {...input} useCloud={props('cloud-suspended', 9).useCloud} />)
    expect(screen.queryByLabelText(zh.fileEditor)).toBeNull()
    userId = otherAccount
    view.rerender(<CloudPanel {...input} useCloud={props('cloud', 10).useCloud} />)
    await screen.findByText(zh.fileRoot)
    expect(screen.queryByLabelText(zh.fileEditor)).toBeNull()
    userId = account
    view.rerender(<CloudPanel {...input} useCloud={props('cloud', 11).useCloud} />)
    expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })).value).toBe('unsent draft')
    fireEvent.click(screen.getByRole('button', { name: zh.fileCheckSave }))
    await screen.findByText(zh.fileSaved)
    expect(requests).toEqual(['publish B', 'replace', 'lookup', 'poll'])
  })

  it('renders session-free login without a modal or local execution controls', () => {
    render(<CloudPanel {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: '登录 dsh-server' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
  })
  it.each(['authenticating', 'cloud-suspended'] as const)('keeps execution paused without covering the application in %s', (mode) => {
    render(<CloudPanel {...props(mode)} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('status')[0]?.textContent).toMatchSnapshot()
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
    expect(screen.getByRole('button', { name: '退出云端并返回本地' })).toBeTruthy()
  })
  it('shows a failed cloud action and keeps it in cloud mode', async () => {
    const input = props('cloud')
    vi.mocked(input.call).mockRejectedValue(new Error('offline'))
    render(<CloudPanel {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新租户' }))
    await waitFor(() =>{  expect(screen.getAllByRole('status')[0]?.textContent).toContain(zh.failure) })
    expect(input.logout).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('polls the accepted runtime and retains the operation when cloud access is suspended', async () => {
    const input = props('cloud')
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/me/tenants') return [{ id: 'tenant-a', name: 'Team A' }]
      if (request.path === '/tenants/tenant-a/workspaces') return { items: [{ id: 'workspace-a', name: 'Workspace A' }] }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: 'runtime-a', name: 'Sandbox A' }] }
      if (request.path.endsWith('/commands')) return { id: 'operation-a', runtimeId: 'runtime-accepted', state: 'queued' }
      if (request.path.endsWith('/operations/operation-a')) return { id: 'operation-a', state: 'succeeded', result: { stdout: 'cloud-only' } }
      return []
    })
    const view = render(<CloudPanel {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新租户' }))
    await screen.findByRole('option', { name: 'Team A' })
    fireEvent.change(screen.getByRole('combobox', { name: '租户' }), { target: { value: 'tenant-a' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新工作空间' }))
    await screen.findByRole('option', { name: 'Workspace A' })
    fireEvent.change(screen.getByRole('combobox', { name: '工作空间' }), { target: { value: 'workspace-a' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新资源' }))
    await screen.findByRole('option', { name: 'Sandbox A' })
    fireEvent.change(screen.getByRole('combobox', { name: '云端沙箱' }), { target: { value: 'runtime-a' } })
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    await waitFor(() =>{  expect(screen.getByLabelText('任务结果').textContent).toContain('cloud-only') })
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ epoch: 8, path: '/tenants/tenant-a/workspaces/workspace-a/runtimes/runtime-a/commands', method: 'POST', body: { command: 'pwd', timeoutSeconds: 30 }, idempotencyKey: expect.any(String) as string }))
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ path: '/tenants/tenant-a/workspaces/workspace-a/runtimes/runtime-accepted/operations/operation-a' }))
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy()
    const suspended = props('cloud-suspended', 9)
    view.rerender(<CloudPanel {...input} useCloud={suspended.useCloud} />)
    await waitFor(() =>{  expect(screen.getByText('operation-a')).toBeTruthy() })
    expect(screen.getByRole('button', { name: '取消任务' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
  })
  it('opens the main chat and pins a selected Bot when creating a cloud session', async () => {
    const input = props('cloud')
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/server-info') return { serverId: '10000000-0000-4000-8000-000000000010', capabilities: { workspaceBots: true } }
      if (request.path.endsWith('/bots?limit=100')) return { items: [
        { id: 'bot-first', state: 'active', latestRevision: 3, name: 'Fixture Bot' },
        { id: 'bot-archived', state: 'archived', latestRevision: 1, name: 'Archived' },
      ] }
      if (request.path.endsWith('/model-credentials')) return [{ id: '10000000-0000-4000-8000-000000000005', name: 'Fixture model' }]
      if (request.path.endsWith('/sessions') && request.method === 'POST') return { id: '10000000-0000-4000-8000-000000000004' }
      if (request.path.endsWith('/binding')) return { schemaVersion: 1, serverId: '10000000-0000-4000-8000-000000000010', tenantId: '10000000-0000-4000-8000-000000000001', workspaceId: '10000000-0000-4000-8000-000000000002', cloudSessionId: '10000000-0000-4000-8000-000000000004', runtimeId: '10000000-0000-4000-8000-000000000003', credentialRef: '10000000-0000-4000-8000-000000000005', desktopId: null, bindingRevision: 7, state: 'active' }
      if (request.path === '/me/tenants') return [{ id: '10000000-0000-4000-8000-000000000001', name: 'Team' }]
      if (request.path === '/tenants/10000000-0000-4000-8000-000000000001/workspaces') return { items: [{ id: '10000000-0000-4000-8000-000000000002', name: 'Workspace' }] }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: '10000000-0000-4000-8000-000000000003', name: 'Sandbox' }, { id: '10000000-0000-4000-8000-000000000006', name: 'Browsing sandbox' }] }
      if (request.path.endsWith('/sessions')) return { items: [{ id: '10000000-0000-4000-8000-000000000004', name: 'Conversation', runtimeId: '10000000-0000-4000-8000-000000000003' }] }
      return []
    })
    render(<CloudPanel {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新租户' }))
    await screen.findByRole('option', { name: 'Team' })
    fireEvent.change(screen.getByRole('combobox', { name: '租户' }), { target: { value: '10000000-0000-4000-8000-000000000001' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新工作空间' }))
    await screen.findByRole('option', { name: 'Workspace' })
    fireEvent.change(screen.getByRole('combobox', { name: '工作空间' }), { target: { value: '10000000-0000-4000-8000-000000000002' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新资源' }))
    fireEvent.click(screen.getByRole('button', { name: '会话' }))
    await screen.findByRole('option', { name: 'Conversation' })
    fireEvent.change(screen.getByRole('combobox', { name: '云端会话' }), { target: { value: '10000000-0000-4000-8000-000000000004' } })
    expect(screen.queryByRole('button', { name: zh.send })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '刷新会话绑定' }))
    await screen.findByText('绑定已启用 · 版本 7')
    fireEvent.change(screen.getByRole('combobox', { name: '云端沙箱' }), { target: { value: '10000000-0000-4000-8000-000000000006' } })
    expect(screen.getByText(zh.browsingResource)).toBeTruthy()
    const bindingSummary = screen.getByRole('region', { name: zh.binding })
    expect(bindingSummary.textContent).toContain('10000000-0000-4000-8000-000000000003')
    expect(bindingSummary.textContent).not.toContain('10000000-0000-4000-8000-000000000006')
    fireEvent.click(screen.getByRole('button', { name: zh.openCloudConversation }))
    expect(input.openChat).toHaveBeenCalledOnce()
    await screen.findByRole('option', { name: 'Fixture Bot · 版本 3' })
    expect(screen.queryByRole('option', { name: /Archived/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: zh.chatBotOptional }), { target: { value: 'bot-first' } })
    fireEvent.change(screen.getByRole('combobox', { name: zh.credential }), { target: { value: '10000000-0000-4000-8000-000000000005' } })
    fireEvent.click(screen.getByRole('button', { name: zh.createSession }))
    await waitFor(() => {
      const request = vi.mocked(input.call).mock.calls.find(([entry]) => entry.method === 'POST' && entry.path.endsWith('/sessions'))
      expect(request?.[0].body).toMatchObject({ bot: { id: 'bot-first', revision: 3 } })
    })
  })
  it('retains late acceptance after closing the panel and queries the original task without resubmitting', async () => {
    const input = props('cloud'), pending = Promise.withResolvers<CloudValue>()
    input.viewActions.tenant('t'); input.viewActions.workspace('w'); input.viewActions.resource('runtime', 'r')
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.method === 'POST') return pending.promise
      return { id: 'retained-operation', state: 'succeeded', result: { stdout: 'original task' } }
    })
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    first.unmount()
    pending.resolve({ id: 'retained-operation', runtimeId: 'accepted-runtime', state: 'queued' })
    await waitFor(() => { expect(input.call).toHaveBeenCalledTimes(1) })
    render(<CloudPanel {...input} />)
    await screen.findByText('retained-operation')
    fireEvent.click(screen.getByRole('button', { name: '查询原任务' }))
    await waitFor(() => { expect(screen.getByLabelText('任务结果').textContent).toContain('original task') })
    expect(vi.mocked(input.call).mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    expect(input.call).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', path: '/tenants/t/workspaces/w/runtimes/accepted-runtime/operations/retained-operation' }))
    expect(input.logout).not.toHaveBeenCalled()
  })

  it('retains an unknown submission across panel closure and isolates its reference from another workspace', async () => {
    const input = props('cloud')
    input.viewActions.tenant('t'); input.viewActions.workspace('w'); input.viewActions.resource('runtime', 'r')
    vi.mocked(input.call).mockRejectedValue(new Error('response lost'))
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    await screen.findByText(zh.unknownResult)
    first.unmount()
    const second = render(<CloudPanel {...input} />)
    expect(screen.getByText(zh.unknownResult)).toBeTruthy()
    expect(input.call).toHaveBeenCalledTimes(1)
    second.unmount()
    input.viewActions.workspace('other')
    render(<CloudPanel {...input} />)
    expect(screen.queryByText(zh.unknownResult)).toBeNull()
    expect(input.call).toHaveBeenCalledTimes(1)
  })

})
