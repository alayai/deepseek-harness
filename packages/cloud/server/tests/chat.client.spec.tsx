// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CloudRequest, CloudSnapshot, CloudValue } from '../src/types.ts'
import { CloudChat } from '../src/client/CloudChat.tsx'
import { CloudChatTurns, CloudRequestFailure } from '../src/client/chat-turns.ts'
import { CloudSessionReplay } from '../src/client/session-replay.ts'
import { createCloudViewStore } from '../src/client/view-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const serverId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const tenantId = '10000000-0000-4000-8000-000000000003'
const workspaceId = '10000000-0000-4000-8000-000000000004'
const sessionId = '10000000-0000-4000-8000-000000000005'
const other = '10000000-0000-4000-8000-000000000006'
const runtimeId = '10000000-0000-4000-8000-000000000007'
const credentialRef = '10000000-0000-4000-8000-000000000008'
const id = '10000000-0000-4000-8000-000000000009'
const snapshot: CloudSnapshot = { mode: 'cloud', epoch: 1, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
const base = `/tenants/${tenantId}/workspaces/${workspaceId}`
const turn = { id, runtimeId, bindingRevision: 7, state: 'queued' }
const operation = (state: string, cancelRequested = false) => ({ ...turn, kind: 'agent', state, cancelRequested, errorCode: null })
const binding = (session: string, state = 'active') => ({
  schemaVersion: 1, serverId, tenantId, workspaceId, cloudSessionId: session,
  runtimeId, credentialRef, desktopId: null, bindingRevision: 7, state,
})
const event = (seq: number, type: string, data: CloudValue) => ({
  id: String(seq), operationId: id, event: { type, data }, createdAt: '2026-11-20T00:00:00.000Z',
})
function fixture(handle: (request: CloudRequest) => CloudValue | Promise<CloudValue>, initial = snapshot) {
  const cloudSource = createSnapshotStore(initial), viewSource = createCloudViewStore()
  const initView = () => {
    viewSource.actions.tenant(tenantId)
    viewSource.actions.workspace(workspaceId)
    viewSource.actions.resource('session', sessionId)
    viewSource.actions.resource('runtime', 'different-browsing-runtime')
  }
  initView()
  const call = vi.fn(async (request: CloudRequest): Promise<CloudValue> => {
    if (request.path === '/server-info') return { serverId }
    if (request.path === '/me') return { id: userId }
    if (request.path === base + '/sessions') return [{ id: sessionId, title: 'First' }, { id: other, title: 'Second' }]
    return handle(request)
  })
  const props = {
    t: makeTranslate(zh), call, cloudSource, viewSource,
    useCloud: bindSnapshotSelector(cloudSource), useView: bindSnapshotSelector(viewSource),
    replay: new CloudSessionReplay(), turns: new CloudChatTurns(), openResources: vi.fn(),
  }
  return { ...props, mount: () => render(<CloudChat {...props} />),
    posts: () => call.mock.calls.map(([request]) => request).filter(request => request.method === 'POST'),
  }
}
const submit = () => screen.getByRole('button', { name: zh.send })
const draft = async (value: string) => {
  fireEvent.change(await screen.findByRole('textbox', { name: zh.prompt }), { target: { value } })
  await waitFor(() => { expect(submit().hasAttribute('disabled')).toBe(false) }, { timeout: 3500 })
}

describe('cloud main conversation', () => {
  it('sends once to the fixed binding, streams deltas, cancels the known task and drains terminal events', async () => {
    const response = Promise.withResolvers<CloudValue>()
    let stage = 'empty'
    let checked = false
    const rows = Array.from({ length: 100 }, (_, i) => event(i + 1, 'status', { message: `old-${i}` }))
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return binding(sessionId)
      if (request.path.endsWith('/prompts')) { stage = 'running'; return response.promise }
      if (request.path.endsWith('/cancel')) { stage = 'cancelling'; return operation('running', true) }
      if (request.path.endsWith('/operations/' + id)) {
        checked = true
        return operation(stage === 'terminal' ? 'cancelled' : 'running', stage !== 'running')
      }
      if (request.path.endsWith('?after=0')) return { items: rows, nextAfter: '100' }
      if (request.path.endsWith('?after=100') && stage === 'running' && checked) return { items: [event(101, 'cloud/assistant-delta', { streamId: 's1', text: 'Partial reply' })], nextAfter: '101' }
      if (request.path.endsWith('?after=101') && stage === 'terminal') return { items: [event(102, 'assistant/message', { text: 'Final cloud reply' })], nextAfter: '102' }
      return { items: [], nextAfter: request.path.split('=').at(-1)! }
    })
    f.mount()
    await draft('hello cloud')
    fireEvent.click(submit()); fireEvent.click(submit())
    await waitFor(() => { expect(f.posts()).toHaveLength(1) })
    expect(f.posts()[0]).toMatchObject({ epoch: 1, path: base + '/sessions/' + sessionId + '/prompts',
      body: { prompt: 'hello cloud', timeoutSeconds: 180, expectedBindingRevision: 7 },
      idempotencyKey: expect.any(String) as string,
    })
    await act(async () => { response.resolve(turn) })
    await screen.findByText('Partial reply', {}, { timeout: 3500 })
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    await screen.findByText(zh.chatCancelling)
    expect(f.posts()[1]?.path).toBe(base + '/runtimes/' + runtimeId + '/operations/' + id + '/cancel')
    stage = 'terminal'
    await screen.findByText('Final cloud reply', {}, { timeout: 3500 })
    expect(screen.queryByText('Partial reply')).toBeNull()
    expect(screen.getByText(zh.chatCancelled)).toBeTruthy()
    expect(f.call).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('?after=100') as string }))
  })

  it('does not post after the Workspace changes during the binding check', async () => {
    const deferred = Promise.withResolvers<CloudValue>()
    let reads = 0
    const f = fixture(request => request.path.endsWith('/binding')
      ? (++reads === 1 ? binding(sessionId) : deferred.promise) : { items: [], nextAfter: '0' })
    f.mount()
    await draft('stale Workspace')
    fireEvent.click(submit())
    await waitFor(() => { expect(reads).toBe(2) })
    await act(async () => { f.viewSource.actions.workspace(''); deferred.resolve(binding(sessionId)) })
    expect(f.posts()).toEqual([])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('recovers a lost reply using a read-only key lookup after a new login epoch', async () => {
    const pending = Promise.withResolvers<CloudValue>()
    let available = false
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return binding(sessionId)
      if (request.path.endsWith('/prompts')) return pending.promise
      if (request.path.includes('/prompt-receipts?key=')) return available ? turn : null
      if (request.path.includes('/operations/')) return operation('succeeded')
      return { items: [], nextAfter: '0' }
    })
    const ui = f.mount()
    await draft('process one time')
    fireEvent.click(submit())
    await waitFor(() => { expect(f.posts()).toHaveLength(1) })
    await act(async () => {
      f.cloudSource.set({ ...snapshot, mode: 'cloud-suspended', epoch: 2 })
      pending.reject(Error('lost response'))
    })
    expect(screen.queryByRole('textbox')).toBeNull()
    ui.unmount()
    f.cloudSource.set({ ...snapshot, epoch: 3 })
    f.mount()
    const recover = await screen.findByRole('button', { name: zh.chatRecover })
    fireEvent.click(recover)
    await waitFor(() => { expect(recover.hasAttribute('disabled')).toBe(false) })
    expect(f.call).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', epoch: 3,
      path: base + '/sessions/' + sessionId + '/prompt-receipts?key=' + (f.posts()[0]?.idempotencyKey ?? '') }))
    expect(f.posts()).toHaveLength(1)
    expect(submit().hasAttribute('disabled')).toBe(true)
    available = true
    fireEvent.click(recover)
    await waitFor(() => { expect(screen.queryByRole('button', { name: zh.chatRecover })).toBeNull() })
    await draft('next authorized message')
    expect(f.posts()).toHaveLength(1)
  })

  it('discovers a queued task in a fresh Client and handles server timeout', async () => {
    let timedOut = false
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return { ...binding(sessionId), pendingOperation: turn }
      if (request.path.includes('/operations/')) return operation(timedOut ? 'timed_out' : 'queued')
      return { items: [], nextAfter: '0' }
    })
    f.mount()
    await screen.findByRole('button', { name: zh.cancel })
    expect(screen.queryByRole('button', { name: zh.send })).toBeNull()
    timedOut = true
    await screen.findByText(zh.chatTimedOut, {}, { timeout: 3500 })
    await draft('ready after timeout')
    expect(f.posts()).toEqual([])
  })

  it('discards a late event page after a different conversation is selected', async () => {
    const pending = Promise.withResolvers<CloudValue>()
    const f = fixture((request) => {
      const first = request.path.includes(sessionId)
      if (request.path.endsWith('/binding')) return binding(first ? sessionId : other)
      return first ? pending.promise : { items: [event(2, 'assistant/message', { text: 'Other reply' })], nextAfter: '2' }
    })
    f.mount()
    await waitFor(() => { expect(f.call.mock.calls.some(([request]) => request.path.includes(sessionId + '/events'))).toBe(true) })
    fireEvent.change(screen.getByRole('combobox', { name: zh.session }), { target: { value: other } })
    await screen.findByText('Other reply')
    await act(async () => { pending.resolve({ items: [event(1, 'assistant/message', { text: 'Previous reply' })], nextAfter: '1' }) })
    expect(screen.queryByText('Previous reply')).toBeNull()
  })

  it('preserves the draft on a definitive revision conflict', async () => {
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return binding(sessionId)
      if (request.path.endsWith('/prompts')) throw new CloudRequestFailure('BINDING_VERSION_CONFLICT')
      return { items: [], nextAfter: '0' }
    })
    f.mount()
    await draft('keep this text')
    fireEvent.click(submit())
    await screen.findByText(zh.chatRejected)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.prompt }).value).toBe('keep this text')
    expect(screen.queryByRole('button', { name: zh.chatRecover })).toBeNull()
  })
})
