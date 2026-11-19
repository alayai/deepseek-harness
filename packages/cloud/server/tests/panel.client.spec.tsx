// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CloudPanel, type CloudPanelProps } from '../src/client/CloudPanel.tsx'
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
    t: makeTranslate(zh), useCloud: <T,>(select: (value: CloudSnapshot) => T) => select(snapshot),
    readLocal: vi.fn(async () => ({ kind: 'sessions' as const, items: [], nextOffset: null })), exportLocal: vi.fn(async () => ({ version: 1 as const, exportable: false, reason: 'NOT_READY' as const })), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), call: vi.fn(async () => null),
  }
  return input
}

describe('cloud workspace UI', () => {
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
  it('drains terminal event pages and replaces replayed history on the next prompt', async () => {
    const input = props('cloud')
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), operationId: '10000000-0000-4000-8000-000000000007', createdAt: '2026-11-18T00:00:00.000Z', event: { type: 'assistant/message', data: { text: `event-${i}` } } }))
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/server-info') return { serverId: '10000000-0000-4000-8000-000000000010' }
      if (request.path.endsWith('/binding')) return { schemaVersion: 1, serverId: '10000000-0000-4000-8000-000000000010', tenantId: '10000000-0000-4000-8000-000000000001', workspaceId: '10000000-0000-4000-8000-000000000002', cloudSessionId: '10000000-0000-4000-8000-000000000004', runtimeId: '10000000-0000-4000-8000-000000000003', credentialRef: '10000000-0000-4000-8000-000000000005', desktopId: null, bindingRevision: 7, state: 'active' }
      if (request.path === '/me/tenants') return [{ id: '10000000-0000-4000-8000-000000000001', name: 'Team' }]
      if (request.path === '/tenants/10000000-0000-4000-8000-000000000001/workspaces') return { items: [{ id: '10000000-0000-4000-8000-000000000002', name: 'Workspace' }] }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: '10000000-0000-4000-8000-000000000003', name: 'Sandbox' }, { id: '10000000-0000-4000-8000-000000000006', name: 'Browsing sandbox' }] }
      if (request.path.endsWith('/sessions')) return { items: [{ id: '10000000-0000-4000-8000-000000000004', name: 'Conversation', runtimeId: '10000000-0000-4000-8000-000000000003' }] }
      if (request.path.endsWith('/prompts')) return { id: 'o', runtimeId: '10000000-0000-4000-8000-000000000003', state: 'queued' }
      if (request.path.endsWith('/operations/o')) return { id: 'o', state: 'succeeded' }
      if (request.path.endsWith('/events?after=0')) return { items: firstPage, nextAfter: '100' }
      if (request.path.endsWith('/events?after=100')) return { items: firstPage.map((_, i) => ({ id: String(i + 101), operationId: '10000000-0000-4000-8000-000000000007', createdAt: '2026-11-18T00:00:00.000Z', event: { type: 'assistant/message', data: { text: `event-${i + 100}` } } })), nextAfter: '200' }
      if (request.path.endsWith('/events?after=200')) return { items: [{ id: '201', operationId: '10000000-0000-4000-8000-000000000007', createdAt: '2026-11-18T00:00:00.000Z', event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } }], nextAfter: '201' }
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
    expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '刷新会话绑定' }))
    await screen.findByText('绑定已启用 · 版本 7')
    fireEvent.change(screen.getByRole('combobox', { name: '云端沙箱' }), { target: { value: '10000000-0000-4000-8000-000000000006' } })
    expect(screen.getByText(zh.browsingResource)).toBeTruthy()
    expect(screen.getByRole('region', { name: zh.binding }).textContent).toMatchSnapshot()
    fireEvent.change(screen.getByRole('textbox', { name: '发送给云端 DSH 的消息' }), { target: { value: 'hello' } })
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
      await waitFor(() =>{  expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false) })
      const output = screen.getByLabelText(zh.events)
      expect(output.textContent).toContain('Turn ended: completed')
      expect(output.querySelectorAll('li')).toHaveLength(201)
    }
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ body: { prompt: 'hello', timeoutSeconds: 180, expectedBindingRevision: 7 } }))
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ path: '/tenants/10000000-0000-4000-8000-000000000001/workspaces/10000000-0000-4000-8000-000000000002/runtimes/10000000-0000-4000-8000-000000000003/operations/o' }))
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
