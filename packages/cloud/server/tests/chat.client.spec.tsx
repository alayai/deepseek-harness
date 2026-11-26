// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CloudRequest, CloudSnapshot, CloudValue } from '../src/types.ts'
import { CloudChat } from '../src/client/CloudChat.tsx'
import { CloudBotSidebar } from '../src/client/CloudBotSidebar.tsx'
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
function fixture(handle: (request: CloudRequest) => CloudValue | Promise<CloudValue>, initial = snapshot,
  sessions: CloudValue = [{ id: sessionId, title: 'First' }, { id: other, title: 'Second' }]) {
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
    if (request.path === base + '/sessions?limit=20' || request.path.startsWith(base + '/sessions?limit=20&botId=') && Array.isArray(sessions)) return sessions
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
  it('loads an older conversation on retry without changing the draft or submitting a turn', async () => {
    let reads = 0
    const f = fixture((req) => {
      if (req.path.endsWith('/binding')) return binding(sessionId)
      if (req.path === base + '/sessions?limit=20&cursor=older') {
        if (++reads === 1) throw Error('offline')
        return { items: [{ id: sessionId, title: 'First' }, { id: other, title: 'Older' }], nextCursor: null }
      }
      return { items: [], nextAfter: '0' }
    }, snapshot, { items: [{ id: sessionId, title: 'First' }], nextCursor: 'older' })
    f.mount(); await draft('keep my text')
    const more = screen.getByRole('button', { name: zh.moreSessions })
    fireEvent.click(more); await screen.findByText(zh.sessionPageFailed)
    fireEvent.click(more); await screen.findByRole('option', { name: 'Older' })
    expect(screen.getAllByRole('option', { name: 'First' })).toHaveLength(1)
    expect(screen.queryByText(zh.moreSessions)).toBeNull()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.prompt }).value).toBe('keep my text')
    expect(f.viewSource.getSnapshot().session).toBe(sessionId)
    expect(f.posts()).toEqual([])
  })
  it('opens an older Bot session by querying its binding before offering to create a conversation', async () => {
    const f = fixture((req) => {
      if (req.path.endsWith('/bots?limit=100')) return [{ id, name: 'Writer', state: 'active', latestRevision: 2 }]
      if (req.path === base + '/sessions/' + sessionId) return { id: sessionId }
      if (req.path === base + '/sessions?limit=20&botId=' + id) return { items: [{ id: other, bot: { id, revision: 1 } }], nextCursor: null }
      throw Error('unexpected lookup')
    }, snapshot, { items: [{ id: sessionId }], nextCursor: 'older' })
    const openChat = vi.fn()
    render(<CloudBotSidebar {...f} wide openChat={openChat} didNavigate={vi.fn()} toggleSidebar={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Writer' }))
    await waitFor(() => expect(openChat).toHaveBeenCalledOnce())
    expect(f.viewSource.getSnapshot().session).toBe(other)
    expect(f.openResources).not.toHaveBeenCalled()
    expect(f.posts()).toEqual([])
  })
  it('opens the bound session from the DS Bot sidebar and prepares a new session only on explicit creation', async () => {
    const second = '10000000-0000-4000-8000-000000000010'
    const f = fixture((request) => {
      if (request.path === base + '/sessions/' + sessionId) return { id: sessionId, bot: { id, revision: 1 } }
      if (request.path === base + '/bots?limit=100') return { items: [{ id, name: 'Writer', state: 'active', latestRevision: 3 }], nextCursor: 'p2' }
      if (request.path === base + '/bots?limit=100&cursor=p2') return { items: [{ id: second, name: 'Editor', state: 'active', latestRevision: 1 }], nextCursor: null }
      throw Error('Unexpected request')
    }, snapshot, [{ id: other, bot: { id, revision: 3 } }, { id: sessionId, bot: { id, revision: 1 } }])
    const openChat = vi.fn()
    render(<CloudBotSidebar {...f} wide openChat={openChat} didNavigate={vi.fn()} toggleSidebar={vi.fn()} />)
    const writer = await screen.findByRole('button', { name: 'Writer' })
    await waitFor(() => expect(writer.getAttribute('aria-pressed')).toBe('true'))
    expect(f.viewSource.getSnapshot().botFilter).toBe('')
    fireEvent.click(writer)
    await waitFor(() => { expect(openChat).toHaveBeenCalledOnce() })
    expect(f.viewSource.getSnapshot()).toMatchObject({ botFilter: id, session: sessionId })
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }))
    await waitFor(() => { expect(f.openResources).toHaveBeenCalledOnce() })
    expect(f.viewSource.getSnapshot()).toMatchObject({ session: '', botFilter: second, composeBot: second, section: 'agent' })
    expect(f.posts()).toEqual([])
  })
  it.each(['missing', 'offline', 'wrong-id'] as const)('handles a %s current-session lookup while selecting another Bot', async (reason) => {
    const f = fixture((req) => {
      if (req.path.endsWith('/bots?limit=100')) return [{ id, name: 'Writer', state: 'active', latestRevision: 2 }]
      if (req.path === base + '/sessions/' + sessionId) {
        if (reason === 'missing') throw new CloudRequestFailure('SESSION_NOT_FOUND')
        if (reason === 'offline') throw Error('offline')
        return { id: other }
      }
      throw Error('unexpected lookup')
    }, snapshot, [{ id: other, bot: { id, revision: 1 } }])
    const openChat = vi.fn()
    render(<CloudBotSidebar {...f} wide openChat={openChat} didNavigate={vi.fn()} toggleSidebar={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Writer' }))
    if (reason === 'missing') {
      await waitFor(() => expect(openChat).toHaveBeenCalledOnce())
      expect(f.viewSource.getSnapshot()).toMatchObject({ session: other, botFilter: id })
    } else {
      await screen.findByRole('alert')
      expect(openChat).not.toHaveBeenCalled()
      expect(f.viewSource.getSnapshot()).toMatchObject({ session: sessionId, botFilter: '' })
    }
    expect(f.openResources).not.toHaveBeenCalled()
    expect(f.posts()).toEqual([])
  })
  it('keeps the resource panel open when an earlier sidebar conversation lookup finishes', async () => {
    const lookup = Promise.withResolvers<CloudValue>()
    const f = fixture((req) => {
      if (req.path.endsWith('/bots?limit=100')) return [{ id, name: 'Writer', state: 'active', latestRevision: 1 }]
      if (req.path === base + '/sessions?limit=20&botId=' + id) return lookup.promise
      if (req.path === base + '/sessions/' + sessionId) return { id: sessionId }
      throw Error('unexpected lookup')
    }, snapshot, { items: [], nextCursor: null })
    const openChat = vi.fn(), didNavigate = vi.fn()
    render(<CloudBotSidebar {...f} wide openChat={openChat} didNavigate={didNavigate} toggleSidebar={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Writer' }))
    fireEvent.click(screen.getByRole('button', { name: zh.chatResources }))
    await act(async () => { lookup.resolve({ items: [{ id: other, bot: { id, revision: 1 } }], nextCursor: null }) })
    expect(f.openResources).toHaveBeenCalledOnce()
    expect(didNavigate).toHaveBeenCalledOnce()
    expect(openChat).not.toHaveBeenCalled()
    expect(f.viewSource.getSnapshot().session).toBe(sessionId)
    expect(f.posts()).toEqual([])
  })
  it('does not treat a capped legacy listing as proof that a Bot has no conversations', async () => {
    const f = fixture((req) => {
      if (req.path.endsWith('/bots?limit=100')) return [{ id, name: 'Writer', state: 'active', latestRevision: 1 }]
      if (req.path.endsWith('/sessions/' + sessionId)) return { id: sessionId }
      throw Error('unexpected lookup')
    }, snapshot, Array.from({ length: 100 }, () => ({ id: randomUUID() })))
    const openChat = vi.fn()
    render(<CloudBotSidebar {...f} wide openChat={openChat} didNavigate={vi.fn()} toggleSidebar={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Writer' }))
    await screen.findByText(zh.legacySessions)
    expect(f.viewSource.getSnapshot().session).toBe(sessionId)
    expect(openChat).not.toHaveBeenCalled()
    expect(f.openResources).not.toHaveBeenCalled()
    expect(f.posts()).toEqual([])
  })
  it('reads the pinned Bot first, and only inspects the latest revision on request', async () => {
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return binding(sessionId)
      if (request.path === base + '/bots/' + id) return { id, latestRevision: 4 }
      if (request.path.includes('/revisions/')) {
        const revision = Number(request.path.split('/').at(-1))
        return { botId: id, revision, definition: { schemaVersion: 1, name: 'Writer', role: 'Editing',
          instructions: 'Instructions v' + revision, requiredCapabilities: ['workspace.files'] } }
      }
      return { items: [], nextAfter: '0' }
    }, snapshot, [{ id: sessionId, title: 'First', bot: { id, revision: 2 } }])
    f.mount()
    await draft('keep me')
    expect(f.call.mock.calls.some(([r]) => r.path.includes('/revisions/'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: zh.chatBot + ' · v2' }))
    await screen.findByText('Instructions v2')
    fireEvent.click(screen.getByRole('button', { name: zh.botLatest }))
    await screen.findByText('Instructions v4')
    expect(screen.getByText(zh.botStillPinned + ' v2')).toBeTruthy()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.prompt }).value).toBe('keep me')
    expect(f.posts()).toEqual([])
    expect(f.viewSource.getSnapshot().session).toBe(sessionId)
  })
  it('rejects a mismatched publication and discards a late read after closing the inspector', async () => {
    const late = Promise.withResolvers<CloudValue>()
    let reads = 0
    const def = { schemaVersion: 1, name: 'Writer', role: '', instructions: 'stale definition', requiredCapabilities: [] }
    const f = fixture((request) => {
      if (request.path.endsWith('/binding')) return binding(sessionId)
      if (request.path.endsWith('/revisions/2')) return ++reads === 1 ? { botId: other, revision: 2, definition: def } : late.promise
      return { items: [], nextAfter: '0' }
    }, snapshot, [{ id: sessionId, title: 'First', bot: { id, revision: 2 } }])
    f.mount()
    const toggle = await screen.findByRole('button', { name: zh.chatBot + ' · v2' })
    fireEvent.click(toggle); await screen.findByText(zh.botReadFailed)
    expect(screen.queryByText('stale definition')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.retry })); fireEvent.click(toggle)
    await act(async () => { late.resolve({ botId: id, revision: 2, definition: def }) })
    expect(screen.queryByRole('region', { name: zh.botInspect })).toBeNull()
    expect(f.posts()).toEqual([])
  })
  it('keeps the bound conversation and draft when narrowing or clearing its Bot filter', async () => {
    const secondBot = '10000000-0000-4000-8000-000000000010'
    const f = fixture((request) => {
      if (request.path.endsWith('/bots?limit=100')) return { items: [
        { id, name: 'Research', state: 'active', latestRevision: 3 },
        { id: secondBot, name: 'Editor', state: 'active', latestRevision: 1 },
      ] }
      if (request.path.endsWith('/binding')) return binding(sessionId)
      return { items: [], nextAfter: '0' }
    }, snapshot, [{ id: sessionId, title: 'First', bot: { id, revision: 2 } },
      { id: other, title: 'Second', bot: { id: secondBot, revision: 1 } }])
    f.mount()
    await draft('continue this thread')
    const filter = screen.getByRole('combobox', { name: zh.chatBotList })
    for (const value of [id, '']) {
      fireEvent.change(filter, { target: { value } })
      expect(f.viewSource.getSnapshot().session).toBe(sessionId)
      expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.prompt }).value).toBe('continue this thread')
      expect(screen.getByText(zh.chatBot + ' · v2')).toBeTruthy()
    }
    fireEvent.change(filter, { target: { value: secondBot } })
    expect(f.viewSource.getSnapshot().session).toBe('')
    expect(screen.queryByRole('textbox', { name: zh.prompt })).toBeNull()
    expect(f.posts()).toEqual([])
  })
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
