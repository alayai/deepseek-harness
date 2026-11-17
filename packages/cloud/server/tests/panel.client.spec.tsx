// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CloudPanel, type CloudPanelProps } from '../src/client/CloudPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { CloudSnapshot } from '../src/types.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function props(mode: CloudSnapshot['mode'] = 'local', epoch = 8): CloudPanelProps {
  const snapshot: CloudSnapshot = { mode, epoch, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
  const input: Pick<CloudPanelProps, 't' | 'useCloud' | 'login' | 'logout' | 'call'> = {
    t: makeTranslate(zh), useCloud: <T,>(select: (value: CloudSnapshot) => T) => select(snapshot),
    login: vi.fn(async () => {}), logout: vi.fn(async () => {}), call: vi.fn(async () => null),
  }
  return input as CloudPanelProps
}

describe('cloud workspace UI', () => {
  it('leaves the local application usable until the user opens cloud login', () => {
    render(<CloudPanel {...props()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /DSH 云端/ }))
    expect(screen.getByRole('button', { name: '登录 dsh-server' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each(['authenticating', 'cloud-suspended'] as const)('keeps the local UI blocked in %s', (mode) => {
    render(<CloudPanel {...props(mode)} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatchSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
    expect(screen.getByRole('button', { name: '退出云端并返回本地' })).toBeTruthy()
  })
  it('shows a failed cloud action and keeps it in cloud mode', async () => {
    const input = props('cloud')
    vi.mocked(input.call).mockRejectedValue(new Error('offline'))
    render(<CloudPanel {...input} />)
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]!)
    await waitFor(() =>{  expect(screen.getByRole('status').textContent).toContain(zh.failure) })
    expect(input.logout).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
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
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]!)
    await screen.findByRole('option', { name: 'Team A' })
    fireEvent.change(screen.getByRole('combobox', { name: '租户' }), { target: { value: 'tenant-a' } })
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[1]!)
    await screen.findByRole('option', { name: 'Workspace A' })
    fireEvent.change(screen.getByRole('combobox', { name: '工作空间' }), { target: { value: 'workspace-a' } })
    const sandbox = screen.getByRole('heading', { name: '云端沙箱' }).closest('section')!
    fireEvent.click(within(sandbox).getByRole('button', { name: '刷新' }))
    await screen.findByRole('option', { name: 'Sandbox A' })
    fireEvent.change(screen.getByRole('combobox', { name: '云端沙箱' }), { target: { value: 'runtime-a' } })
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    await waitFor(() =>{  expect(screen.getByLabelText('任务结果').textContent).toContain('cloud-only') })
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ epoch: 8, path: '/tenants/tenant-a/workspaces/workspace-a/runtimes/runtime-a/commands', method: 'POST', body: { command: 'pwd', timeoutSeconds: 30 }, idempotencyKey: expect.any(String) as string }))
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ path: '/tenants/tenant-a/workspaces/workspace-a/runtimes/runtime-accepted/operations/operation-a' }))
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy()
    const suspended = props('cloud-suspended', 9)
    view.rerender(<CloudPanel {...suspended} />)
    await waitFor(() =>{  expect(screen.getByLabelText('任务结果').textContent).toContain('operation-a') })
    expect(screen.getByRole('button', { name: '取消任务' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
  })
  it('drains terminal event pages and replaces replayed history on the next prompt', async () => {
    const input = props('cloud')
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ event: `event-${i}` }))
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/me/tenants') return [{ id: 't', name: 'Team' }]
      if (request.path === '/tenants/t/workspaces') return { items: [{ id: 'w', name: 'Workspace' }] }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: 'r', name: 'Sandbox' }] }
      if (request.path.endsWith('/sessions')) return { items: [{ id: 's', name: 'Conversation', runtimeId: 'r' }] }
      if (request.path.endsWith('/prompts')) return { id: 'o', runtimeId: 'r', state: 'queued' }
      if (request.path.endsWith('/operations/o')) return { id: 'o', state: 'succeeded' }
      if (request.path.endsWith('/events?after=0')) return { items: firstPage, nextAfter: '100' }
      if (request.path.endsWith('/events?after=100')) return { items: firstPage.map((_, i) => ({ event: `event-${i + 100}` })), nextAfter: '200' }
      if (request.path.endsWith('/events?after=200')) return { items: [{ event: 'terminal-event' }], nextAfter: '201' }
      return []
    })
    render(<CloudPanel {...input} />)
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]!)
    await screen.findByRole('option', { name: 'Team' })
    fireEvent.change(screen.getByRole('combobox', { name: '租户' }), { target: { value: 't' } })
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[1]!)
    await screen.findByRole('option', { name: 'Workspace' })
    fireEvent.change(screen.getByRole('combobox', { name: '工作空间' }), { target: { value: 'w' } })
    fireEvent.click(within(screen.getByRole('heading', { name: '云端沙箱' }).closest('section')!).getByRole('button', { name: '刷新' }))
    await screen.findByRole('option', { name: 'Conversation' })
    fireEvent.change(screen.getByRole('combobox', { name: '云端会话' }), { target: { value: 's' } })
    fireEvent.change(screen.getByRole('textbox', { name: '发送给云端 DSH 的消息' }), { target: { value: 'hello' } })
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
      await waitFor(() =>{  expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false) })
      const output = screen.getByLabelText('云端会话事件').textContent
      expect(output).toContain('terminal-event')
      expect(output.split('\n')).toHaveLength(201)
    }
  })
})
