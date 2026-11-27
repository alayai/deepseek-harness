// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { CloudPanel, type CloudPanelProps } from '../src/client/CloudPanel.tsx'
import { CloudModels } from '../src/client/CloudModels.tsx'
import { RuntimeReceipts } from '../src/client/runtime-receipts.ts'
import { CloudFileState } from '../src/client/CloudFiles.tsx'
import { zh } from '../src/client/locales.ts'
import type { CloudSnapshot, CloudValue } from '../src/types.ts'
import { createCloudViewStore } from '../src/client/view-store.ts'
import { createCloudActivities } from '../src/client/activity.ts'
import { CloudRequestFailure } from '../src/client/chat-turns.ts'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const unusedHook = (() => { throw new Error('unused by CloudModels') }) as never
const globalSeat = {
  useSessions: unusedHook, useSessionStatus: unusedHook, usePanelInfo,
  useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
  ...allowAllAccess, useContextMenu: contextMenuHook(),
}
function props(mode: CloudSnapshot['mode'] = 'local', epoch = 8): CloudPanelProps {
  const snapshot: CloudSnapshot = { mode, epoch, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
  const store = createCloudViewStore(), activities = createCloudActivities()
  const input: CloudPanelProps = {
    taskReceipts: new RuntimeReceipts(async () => ['server', 'alice']),
    useView: bindSnapshotSelector(store), viewActions: store.actions,
    useActivities: bindSnapshotSelector(activities.source), remember: activities.remember,
    accepted: activities.accepted, rejected: activities.rejected,
    openChat: vi.fn(), t: makeTranslate(zh), useCloud: <T,>(select: (value: CloudSnapshot) => T) => select(snapshot),
    readLocal: vi.fn(async () => ({ kind: 'sessions' as const, items: [], nextOffset: null })), exportLocal: vi.fn(async () => ({ version: 1 as const, exportable: false, reason: 'NOT_READY' as const })), login: vi.fn(async () => {}), logout: vi.fn(async () => {}), call: vi.fn(async () => null),
  }
  return input
}

describe('cloud workspace UI', () => {
  const deskA = '31000000-0000-4000-8000-000000000001', runA = '31000000-0000-4000-8000-000000000002'
  const runB = '31000000-0000-4000-8000-000000000003', op = '31000000-0000-4000-8000-000000000004'
  const deskBase = '/tenants/t/workspaces/w', deskPath = deskBase + '/desktops/' + deskA
  function desktopFixture(handle: (path: string) => Promise<CloudValue> | CloudValue) {
    const f = props('cloud')
    f.viewActions.tenant('t'); f.viewActions.workspace('w'); f.viewActions.resource('runtime', runA)
    f.viewActions.resource('desktop', deskA); f.viewActions.section('desktop')
    vi.mocked(f.call).mockImplementation(async (req) => {
      if (req.path === deskBase + '/runtimes') return { resources: [runA, runB].map(id => ({ id, state: 'ready' })) }
      if (req.path === deskBase + '/desktops') return { resources: [{ id: deskA, runtimeId: runA, state: 'running' }] }
      return handle(req.path)
    })
    return f
  }
  const desktopInfo = (state: string, runtimeId = runA) => ({ id: deskA, runtimeId, state, location: 'cloud' })
  it('verifies a desktop independently of the list and rechecks its state after starting it', async () => {
    let state = 'stopped', owner = runB
    const f = desktopFixture((path) => {
      if (path === deskPath) return desktopInfo(state, owner)
      if (path === deskPath + '/lifecycle') return { id: op, runtimeId: runA, state: 'queued' }
      if (path.endsWith('/operations/' + op)) { state = 'running'; return { id: op, runtimeId: runA, state: 'succeeded', kind: 'desktop_start' } }
      throw Error('unexpected request')
    })
    render(<CloudPanel {...f} />)
    await screen.findByText(zh.deskReadFailed)
    const connect = screen.getByRole<HTMLButtonElement>('button', { name: zh.connectDesktop })
    expect(connect.disabled).toBe(true)
    owner = runA; fireEvent.click(screen.getByRole('button', { name: zh.deskRefresh }))
    await screen.findByText(zh.deskStopped); expect(connect.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.desktopStart }))
    await screen.findByText(zh.deskRunning); expect(connect.disabled).toBe(false)
    expect(vi.mocked(f.call).mock.calls.filter(([r]) => r.method === 'POST').map(([r]) => r.path)).toEqual([deskPath + '/lifecycle'])
  })
  it('refuses a desktop receipt from another sandbox and does not render a mismatched operation', async () => {
    let wrong = true
    const f = desktopFixture((path) => {
      if (path === deskPath) return desktopInfo('running')
      if (path === deskPath + '/computer') return { id: op, runtimeId: wrong ? runB : runA }
      if (path.endsWith('/operations/' + op)) return { id: op, kind: 'browser', runtimeId: runA, state: 'succeeded', result: { mimeType: 'image/png', data: 'foreign-result' } }
      throw Error('unexpected request')
    })
    render(<CloudPanel {...f} />)
    await screen.findByText(zh.deskRunning)
    const shot = screen.getByRole('button', { name: zh.screenshot })
    fireEvent.click(shot); await screen.findByText(zh.failure)
    expect(vi.mocked(f.call).mock.calls.some(([r]) => r.path.includes('/operations/'))).toBe(false)
    wrong = false; fireEvent.click(shot)
    await waitFor(() => expect(vi.mocked(f.call).mock.calls.some(([r]) => r.path.includes('/operations/'))).toBe(true))
    await screen.findByText(zh.failure)
    expect(screen.queryByRole('img', { name: zh.desktopAlt })).toBeNull()
    expect(screen.getByLabelText(zh.result).textContent).not.toContain('foreign-result')
    fireEvent.click(screen.getByRole('button', { name: zh.queryTask }))
    await waitFor(() => expect(vi.mocked(f.call).mock.calls.filter(([r]) => r.path.endsWith('/operations/' + op))).toHaveLength(2))
    await screen.findByText(zh.failure)
    expect(screen.getByLabelText(zh.result).textContent).not.toContain('foreign-result')
  })
  it.each(['viewer', 'screenshot'])('discards a late %s response when the sandbox changes', async (scenario) => {
    const late = Promise.withResolvers<CloudValue>(), popup = { opener: {}, location: { href: 'about:blank' }, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => popup))
    const f = desktopFixture((path) => {
      if (path === deskPath) return desktopInfo('running')
      if (path === deskPath + '/computer') return { id: op, runtimeId: runA }
      if (path.endsWith('/operations/' + op) || path === deskPath + '/viewer') return late.promise
      throw Error('unexpected request')
    })
    render(<CloudPanel {...f} />)
    await screen.findByText(zh.deskRunning)
    fireEvent.click(screen.getByRole('button', { name: scenario === 'viewer' ? zh.connectDesktop : zh.screenshot }))
    const end = scenario === 'viewer' ? '/viewer' : '/operations/' + op
    await waitFor(() => expect(vi.mocked(f.call).mock.calls.some(([r]) => r.path.endsWith(end))).toBe(true))
    act(() => { f.viewActions.resource('runtime', runB) })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.desktop }).value).toBe('')
    await act(async () => { late.resolve(scenario === 'viewer' ? { viewerUrl: 'http://127.0.0.1:8000/' + 'a'.repeat(64) + '/' } :
      { id: op, kind: 'computer', runtimeId: runA, state: 'succeeded', result: { mimeType: 'image/png', data: 'old-screenshot' } }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.connectDesktop }).disabled).toBe(true)
    expect(screen.queryByRole('img', { name: zh.desktopAlt })).toBeNull()
    expect(screen.getByLabelText(zh.result).textContent).not.toContain('old-screenshot')
    if (scenario === 'viewer') { expect(popup.close).toHaveBeenCalledOnce(); expect(popup.location.href).toBe('about:blank') }
  })
  it('loads workspaces beyond the first 20, retaining selection and retrying the same cursor', async () => {
    const f = props('cloud')
    f.viewActions.tenant('team')
    const row = (i: number) => ({ id: String(i), name: 'Project ' + i, tenantId: 'team' })
    const first = { items: Array.from({ length: 20 }, (_, i) => row(i + 1)), nextCursor: 'more_20' }
    const api = vi.mocked(f.call)
    api.mockResolvedValueOnce(first).mockRejectedValueOnce(Error('offline'))
      .mockResolvedValueOnce({ items: [row(20), row(21)], nextCursor: null })
    render(<CloudPanel {...f} />)
    fireEvent.click(screen.getByRole('button', { name: zh.refreshWorkspaces }))
    await screen.findByRole('option', { name: 'Project 20' })
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: zh.workspace })
    fireEvent.change(select, { target: { value: '20' } })
    const more = screen.getByRole('button', { name: zh.moreWorkspaces })
    fireEvent.click(more); await screen.findByText(zh.workspacePageFailed)
    expect(select.value).toBe('20')
    fireEvent.click(more); await screen.findByRole('option', { name: 'Project 21' })
    expect(select.value).toBe('20')
    expect(select.options).toHaveLength(22)
    expect(screen.queryByRole('button', { name: zh.moreWorkspaces })).toBeNull()
    fireEvent.change(select, { target: { value: '21' } })
    expect(select.value).toBe('21')
    expect(api.mock.calls.map(([r]) => [r.method, r.path])).toEqual([
      ['GET', '/tenants/team/workspaces'], ['GET', '/tenants/team/workspaces?cursor=more_20'], ['GET', '/tenants/team/workspaces?cursor=more_20'],
    ])
  })
  it('drops late workspace pages on tenant switch and rejects a page belonging to another tenant', async () => {
    const f = props('cloud'), slow = Promise.withResolvers<CloudValue>()
    f.viewActions.tenant('a')
    const api = vi.mocked(f.call)
    api.mockResolvedValueOnce({ items: [{ id: 'a1', name: 'Old workspace', tenantId: 'a' }], nextCursor: 'page2' })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [{ id: 'x', name: 'Wrong workspace', tenantId: 'a' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'b1', name: 'Current workspace', tenantId: 'b' }], nextCursor: null })
    const ui = render(<CloudPanel {...f} />)
    fireEvent.click(screen.getByRole('button', { name: zh.refreshWorkspaces }))
    fireEvent.click(await screen.findByRole('button', { name: zh.moreWorkspaces }))
    f.viewActions.tenant('b'); ui.rerender(<CloudPanel {...f} />)
    expect(screen.queryByRole('option', { name: 'Old workspace' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.refreshWorkspaces }))
    await screen.findByText(zh.workspacePageFailed)
    expect(screen.queryByRole('option', { name: 'Wrong workspace' })).toBeNull()
    slow.resolve({ items: [{ id: 'a2', name: 'Late workspace', tenantId: 'a' }], nextCursor: null })
    fireEvent.click(screen.getByRole('button', { name: zh.refreshWorkspaces }))
    await screen.findByRole('option', { name: 'Current workspace' })
    expect(screen.queryByRole('option', { name: 'Late workspace' })).toBeNull()
  })
  const uploadServer = '10000000-0000-4000-8000-000000000010'
  const uploadUser = '10000000-0000-4000-8000-000000000001'
  const uploadObject = '10000000-0000-4000-8000-000000000019'
  const expiresAt = '2099-01-01T00:00:00.000Z'
  const partSize = 8 * 1024 * 1024
  const storageKey = 'dsh.cloud.multipart.v1'
  const sessionInfo = (uploaded: number[] = []) => ({
    objectId: uploadObject, partSize, size: partSize + 1, partCount: 2, uploaded, expiresAt, state: 'pending',
  })

  function filesFixture() {
    const input = props('cloud')
    input.viewActions.tenant('tenant-a')
    input.viewActions.workspace('workspace-a')
    input.viewActions.section('files')
    return input
  }

  function largeFile() {
    return new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.bin', { type: 'application/octet-stream' })
  }

  it('recovers a lost async scan submission by checking the original object without resending the file', async () => {
    const input = filesFixture(), states = [
      { objectId: uploadServer, state: 'published' }, { objectId: uploadObject, state: 'queued' },
      { objectId: uploadObject, state: 'scanning' }, { objectId: uploadObject, state: 'published' },
    ]
    const publication = '/multipart/' + uploadObject + '/publication'
    const late = Promise.withResolvers<CloudValue>()
    let user = uploadUser
    vi.mocked(input.call).mockImplementation(async (r) => {
      if (r.path === '/server-info') return { serverId: uploadServer, multipartScan: { maxBytes: partSize * 2 } }
      if (r.path === '/me') return { id: user }
      if (r.path.endsWith('/multipart')) { expect(r.body).toMatchObject({ asyncScan: true }); return sessionInfo() }
      if (r.path.includes('/parts/')) return { uploadUrl: 'https://rustfs.test/part', size: r.path.endsWith('/1') ? partSize : 1 }
      if (r.path.endsWith(publication)) {
        if (r.method === 'POST') return late.promise
        return states.shift()!
      }
      return []
    })
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', put)
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    const opt = await screen.findByRole<HTMLInputElement>('checkbox', { name: zh.asyncOptIn })
    expect(opt.checked).toBe(false); fireEvent.click(opt)
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await waitFor(() => expect(vi.mocked(input.call).mock.calls.some(([r]) => r.path.endsWith(publication))).toBe(true))
    act(() => { input.viewActions.section('settings') })
    act(() => { input.viewActions.section('files') })
    await screen.findByText(zh.asyncUnconfirmed)
    await act(async () => { late.reject(Error('lost response')) })
    expect(screen.getByLabelText<HTMLInputElement>(zh.files).disabled).toBe(true)
    expect(localStorage.getItem(storageKey)).toContain('"publicationReady":true')
    first.unmount()
    user = uploadServer
    const other = render(<CloudPanel {...input} useCloud={props('cloud', 9).useCloud} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await screen.findByRole('checkbox', { name: zh.asyncOptIn })
    expect(screen.queryByRole('button', { name: zh.asyncCheck })).toBeNull()
    other.unmount(); user = uploadUser
    render(<CloudPanel {...input} useCloud={props('cloud', 10).useCloud} />)
    const check = await screen.findByRole('button', { name: zh.asyncCheck })
    fireEvent.click(check)
    await waitFor(() => expect(states).toHaveLength(3))
    expect(screen.queryByText(zh.uploadCompleted)).toBeNull()
    expect(localStorage.getItem(storageKey)).toContain(uploadObject)
    for (const label of [zh.asyncQueued, zh.asyncScanning, zh.uploadCompleted]) {
      await waitFor(() => expect(check.hasAttribute('disabled')).toBe(false))
      fireEvent.click(check); await screen.findByText(label)
    }
    const calls = vi.mocked(input.call).mock.calls.map(([r]) => r)
    expect(calls.filter(r => r.path.endsWith(publication)).map(r => r.method)).toEqual(['POST', 'GET', 'GET', 'GET', 'GET'])
    expect(calls.filter(r => r.path.endsWith('/multipart'))).toHaveLength(1)
    expect(calls.some(r => r.path.endsWith('/complete'))).toBe(false)
    expect(put).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(storageKey)).toBeNull()
  })
  it.each(['failed', 'blocked'] as const)('handles async publication %s without falling back to synchronous completion', async (state) => {
    const input = filesFixture()
    localStorage.setItem(storageKey, JSON.stringify([{ scope: JSON.stringify(['http://localhost:17800', uploadServer, uploadUser, 'tenant-a', 'workspace-a']),
      objectId: uploadObject, filename: 'large.bin', size: partSize + 1, contentType: 'application/octet-stream', expires: Date.parse(expiresAt),
      fingerprint: '0'.repeat(64), asyncScan: true, publicationReady: true }]))
    vi.mocked(input.call).mockImplementation(async (r) => {
      if (r.path === '/server-info') return { serverId: uploadServer }
      if (r.path === '/me') return { id: uploadUser }
      if (r.path.endsWith('/publication')) return { objectId: uploadObject, state: r.method === 'GET' ? 'uploading' : state }
      return []
    })
    render(<CloudPanel {...input} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.asyncCheck }))
    await screen.findByText(zh.asyncReady)
    expect(vi.mocked(input.call).mock.calls.some(([r]) => r.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: zh.asyncSubmit }))
    await screen.findByText(state === 'blocked' ? zh.uploadScanBlocked : zh.asyncFailed)
    expect(screen.queryByText(zh.uploadCompleted)).toBeNull()
    expect(screen.queryByRole('button', { name: zh.asyncSubmit })).toBeNull()
    expect(screen.getByRole('button', { name: zh.uploadDiscard })).toBeTruthy()
    expect(vi.mocked(input.call).mock.calls.filter(([r]) => r.method === 'POST').map(([r]) => r.path)).toEqual([
      '/tenants/tenant-a/workspaces/workspace-a/multipart/' + uploadObject + '/publication',
    ])
  })

  it('uploads a large file with RustFS multipart and refreshes the object list', async () => {
    const input = filesFixture()
    const requests: Array<{ method: string; path: string }> = []
    let published = false
    vi.mocked(input.call).mockImplementation(async (request) => {
      requests.push({ method: request.method, path: request.path })
      if (request.path.endsWith('/multipart') && request.method === 'POST') {
        return sessionInfo()
      }
      if (request.path.endsWith('/parts/1')) return { uploadUrl: 'https://rustfs.test/part-1', size: partSize }
      if (request.path.endsWith('/parts/2')) return { uploadUrl: 'https://rustfs.test/part-2', size: 1 }
      if (request.path.endsWith('/complete')) { published = true; return { id: uploadObject, status: 'available' } }
      if (request.path.endsWith('/access')) return { contentWrite: true }
      if (request.path.includes('/objects?') && request.method === 'GET') {
        return { items: published ? [{ id: uploadObject, filename: 'large.bin', folderId: null, version: 1 }] : [], nextCursor: null }
      }
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: uploadUser }
      return []
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PUT')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(zh.uploadCompleted)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([, init]) => (init?.body as Blob).size)).toEqual([partSize, 1])
    expect(requests.filter(item => item.path.includes('/multipart/')).map(item => item.path)).toEqual([
      `/tenants/tenant-a/workspaces/workspace-a/multipart/${uploadObject}/parts/1`,
      `/tenants/tenant-a/workspaces/workspace-a/multipart/${uploadObject}/parts/2`,
      `/tenants/tenant-a/workspaces/workspace-a/multipart/${uploadObject}/complete`,
    ])
    await screen.findByText('large.bin', { selector: 'bdi' })
  })

  it('re-signs only the part that encountered a temporary PUT failure', async () => {
    const input = filesFixture()
    let creates = 0, signs = 0, completes = 0
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path.endsWith('/multipart') && request.method === 'POST') {
        creates++
        return sessionInfo()
      }
      if (request.path.endsWith('/parts/1')) return { uploadUrl: 'https://rustfs.test/resume-1', size: partSize }
      if (request.path.endsWith('/parts/2')) return { uploadUrl: `https://rustfs.test/resume-2?sign=${++signs}`, size: 1 }
      if (request.path.endsWith('/complete')) { completes++; return { id: uploadObject, status: 'available' } }
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: uploadUser }
      return []
    })
    const fetchMock = vi.fn(async (target: URL) => new Response(null, { status: target.search === '?sign=1' ? 500 : 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(zh.uploadCompleted)
    expect(creates).toBe(1)
    expect(completes).toBe(1)
    expect(fetchMock.mock.calls.map(([target]) => target.pathname + target.search)).toEqual(['/resume-1', '/resume-2?sign=1', '/resume-2?sign=2'])
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('keeps at most three parts in flight and waits for the last unsettled part before completing', async () => {
    const input = filesFixture()
    const size = partSize * 3 + 1
    const parts = Array.from({ length: 4 }, () => Promise.withResolvers<Response>())
    let completes = 0
    vi.mocked(input.call).mockImplementation(async ({ path, method }) => {
      if (path === '/server-info') return { serverId: uploadServer }
      if (path === '/me') return { id: uploadUser }
      if (path.endsWith('/multipart') && method === 'POST') return { ...sessionInfo(), size, partCount: 4 }
      const part = Number(path.match(/\/parts\/(\d+)$/)?.[1])
      if (part) return { uploadUrl: `https://rustfs.test/${part}`, size: part === 4 ? 1 : partSize }
      if (path.endsWith('/complete')) { completes++; return { id: uploadObject, status: 'available' } }
      return []
    })
    const fetchMock = vi.fn((target: URL) => parts[Number(target.pathname.slice(1)) - 1]!.promise)
    vi.stubGlobal('fetch', fetchMock)
    render(<CloudPanel {...input} />)
    const source = new File([new Uint8Array(size)], 'four-parts.bin')
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [source] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(3) })
    expect(completes).toBe(0)

    const success = new Response(null, { status: 200 })
    parts[2]!.resolve(success)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(4) })
    parts[3]!.resolve(success)
    parts[1]!.resolve(success)
    await waitFor(() => { expect(screen.getByRole('progressbar').getAttribute('value')).toBe(String(partSize * 2 + 1)) })
    expect(completes).toBe(0)
    parts[0]!.resolve(success)
    await screen.findByText(zh.uploadCompleted)
    expect(completes).toBe(1)
  })

  it('pauses an active multipart upload and discards the retained session', async () => {
    const input = filesFixture()
    let deleted = false, aborted = 0, completes = 0
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path.endsWith('/multipart') && request.method === 'POST') {
        return sessionInfo()
      }
      if (request.path.endsWith('/parts/1')) return { uploadUrl: 'https://rustfs.test/cancel-1', size: partSize }
      if (request.path.endsWith('/parts/2')) return { uploadUrl: 'https://rustfs.test/cancel-2', size: 1 }
      if (request.path.endsWith('/complete')) completes++
      if (request.method === 'DELETE' && request.path.endsWith(`/multipart/${uploadObject}`)) { deleted = true; return null }
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: uploadUser }
      return []
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => { aborted++; reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: zh.uploadCancel }))
    await screen.findByText(zh.uploadCancelled)
    expect(aborted).toBe(2)
    expect(completes).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: zh.uploadDiscard }))
    await waitFor(() => { expect(deleted).toBe(true) })
    expect(screen.queryByText(zh.uploadCancelled)).toBeNull()
  })

  it('treats a failed single PUT as a retryable upload instead of a multipart session', async () => {
    const input = filesFixture()
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path.endsWith('/uploads') && request.method === 'POST') {
        return { object: { id: 'single-object' }, uploadUrl: 'https://rustfs.test/single' }
      }
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: uploadUser }
      return []
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [new File(['small'], 'small.txt', { type: 'text/plain' })] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(zh.uploadTransferFailed)
    expect(screen.queryByRole('button', { name: zh.uploadDiscard })).toBeNull()
    expect(screen.getByRole('button', { name: zh.upload })).toBeTruthy()
  })

  it.each([
    [new CloudRequestFailure('STORAGE_SCAN_UNAVAILABLE'), zh.uploadScanUnavailable],
    [new Error('completion response lost'), zh.uploadUnconfirmed],
    [null, zh.uploadUnconfirmed],
  ])('retries the same single-upload completion after %s without re-uploading', async (failure, notice) => {
    const input = filesFixture()
    const path = '/tenants/tenant-a/workspaces/workspace-a'
    const completePaths: string[] = []
    let creates = 0
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === path + '/uploads' && request.method === 'POST') {
        creates++
        return { object: { id: uploadObject }, uploadUrl: 'https://rustfs.test/retry-publish' }
      }
      if (request.path.endsWith('/complete')) {
        completePaths.push(request.path)
        if (completePaths.length === 1) {
          if (failure) throw failure
          return { id: uploadServer, status: 'available' }
        }
        return { id: uploadObject, status: 'available', scanStatus: 'clean' }
      }
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: uploadUser }
      return []
    })
    const transfer = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', transfer)
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [new File(['clean'], 'clean.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(notice)
    expect(completePaths).toEqual([`${path}/uploads/${uploadObject}/complete`])
    expect(localStorage.getItem(storageKey)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.uploadRetryPublication }))
    await screen.findByText(zh.uploadCompleted)
    expect(completePaths).toEqual(Array<string>(2).fill(`${path}/uploads/${uploadObject}/complete`))
    expect(creates).toBe(1)
    expect(transfer).toHaveBeenCalledOnce()
  })

  it('retries only multipart completion after an unavailable scanner and allows discard after a definitive block', async () => {
    const input = filesFixture()
    const requests: string[] = []
    let completed = 0
    vi.mocked(input.call).mockImplementation(async ({ path, method }) => {
      if (path === '/server-info') return { serverId: uploadServer }
      if (path === '/me') return { id: uploadUser }
      if (path.includes('/multipart')) requests.push(`${method} ${path.split('/multipart')[1]}`)
      if (path.endsWith('/multipart')) return sessionInfo()
      if (path.endsWith('/parts/1')) return { uploadUrl: 'https://rustfs.test/scan-1', size: partSize }
      if (path.endsWith('/parts/2')) return { uploadUrl: 'https://rustfs.test/scan-2', size: 1 }
      if (path.endsWith('/complete')) throw new CloudRequestFailure(++completed === 1 ? 'STORAGE_SCAN_BUSY' : 'OBJECT_SCAN_BLOCKED')
      return []
    })
    const transfer = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', transfer)
    render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    const start = screen.getByRole<HTMLButtonElement>('button', { name: zh.upload })
    await waitFor(() => { expect(start.disabled).toBe(false) })
    fireEvent.click(start)
    await screen.findByText(zh.uploadScanUnavailable)
    fireEvent.click(screen.getByRole('button', { name: zh.uploadRetryPublication }))
    await screen.findByText(zh.uploadScanBlocked)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.uploadResume }).disabled).toBe(true)
    expect(screen.queryByText(zh.uploadCompleted)).toBeNull()
    expect(localStorage.getItem(storageKey)).toContain(uploadObject)
    fireEvent.click(screen.getByRole('button', { name: zh.uploadDiscard }))
    await waitFor(() => { expect(screen.queryByText(zh.uploadScanBlocked)).toBeNull() })
    expect(requests).toEqual(['POST ', ...['parts/1', 'parts/2', 'complete', 'complete'].map(route => `POST /${uploadObject}/${route}`),
      `DELETE /${uploadObject}`])
    expect(transfer).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('does not carry a single-upload completion into another login epoch', async () => {
    const input = filesFixture()
    vi.mocked(input.call).mockImplementation(async ({ path }) => {
      if (path.endsWith('/uploads')) return { object: { id: uploadObject }, uploadUrl: 'https://rustfs.test/scope' }
      if (path.endsWith('/complete')) throw new CloudRequestFailure('STORAGE_SCAN_BUSY')
      if (path === '/server-info') return { serverId: uploadServer }
      if (path === '/me') return { id: uploadUser }
      return []
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const first = render(<CloudPanel {...input} />)
    const source = new File(['a'], 'scope.txt')
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [source] } })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(zh.uploadScanUnavailable)
    first.rerender(<CloudPanel {...input} useCloud={props('cloud', 9).useCloud} />)
    await waitFor(() => { expect(screen.queryByRole('button', { name: zh.uploadRetryPublication })).toBeNull() })
    expect(screen.queryByText(zh.uploadScanUnavailable)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(true)
    expect(vi.mocked(input.call).mock.calls.filter(([request]) => request.path.endsWith('/complete')).map(([request]) => request.epoch)).toEqual([8])
  })

  it('restores a multipart session after remount, checks the whole file and hides it from another account', async () => {
    const input = filesFixture()
    let userId = uploadUser, creates = 0, queries = 0, completed = false
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/server-info') return { serverId: uploadServer }
      if (request.path === '/me') return { id: userId }
      if (request.path.endsWith('/multipart') && request.method === 'POST') { creates++; return sessionInfo() }
      if (request.path.endsWith(`/multipart/${uploadObject}`) && request.method === 'GET') { queries++; return sessionInfo([1]) }
      if (request.path.endsWith('/parts/1')) return { uploadUrl: 'https://rustfs.test/part-1', size: partSize }
      if (request.path.endsWith('/parts/2')) return { uploadUrl: 'https://rustfs.test/part-2', size: 1 }
      if (request.path.endsWith('/complete')) { completed = true; return { id: uploadObject, status: 'available' } }
      return []
    })
    const transfer = vi.fn(async (target: URL) => new Response(null, { status: target.pathname === '/part-2' ? 503 : 200 }))
    vi.stubGlobal('fetch', transfer)
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: zh.upload }))
    await screen.findByText(zh.uploadFailed)
    expect(localStorage.getItem(storageKey)).toContain(uploadObject)
    expect(localStorage.getItem(storageKey)).not.toContain('rustfs.test')
    first.unmount()

    userId = '10000000-0000-4000-8000-000000000002'
    const other = render(<CloudPanel {...input} useCloud={props('cloud', 9).useCloud} />)
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.upload }).disabled).toBe(false) })
    expect(screen.queryByText(zh.uploadReselect)).toBeNull()
    expect(screen.queryByRole('button', { name: zh.uploadDiscard })).toBeNull()
    other.unmount()

    userId = uploadUser
    render(<CloudPanel {...input} useCloud={props('cloud', 10).useCloud} />)
    await screen.findByText(zh.uploadReselect)
    const resume = screen.getByRole<HTMLButtonElement>('button', { name: zh.uploadResume })
    expect(resume.disabled).toBe(true)
    const different = new File([new Uint8Array(partSize), new Uint8Array([7])], 'large.bin', { type: 'application/octet-stream' })
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [different] } })
    fireEvent.click(resume)
    await screen.findByText(zh.uploadDifferent)
    expect(queries).toBe(0)
    expect(transfer.mock.calls.map(([target]) => target.pathname)).toEqual(['/part-1', '/part-2', '/part-2', '/part-2'])
    expect(completed).toBe(false)

    transfer.mockImplementation(async () => new Response(null, { status: 200 }))
    fireEvent.change(screen.getByLabelText(zh.files), { target: { files: [largeFile()] } })
    fireEvent.click(resume)
    await screen.findByText(zh.uploadCompleted)
    expect(transfer.mock.calls.map(([target]) => target.pathname)).toEqual(['/part-1', '/part-2', '/part-2', '/part-2', '/part-2'])
    expect(creates).toBe(1)
    expect(queries).toBe(1)
    expect(completed).toBe(true)
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

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
      if (request.path === '/tenants/tenant-a/workspaces') return { items: [{ id: 'workspace-a', name: 'Workspace A', tenantId: 'tenant-a' }], nextCursor: null }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: 'runtime-a', name: 'Sandbox A' }] }
      if (request.path.endsWith('/commands')) return { id: '11000000-0000-4000-8000-000000000001', runtimeId: 'runtime-a', state: 'queued', kind: 'command' }
      if (request.path.endsWith('/operations/11000000-0000-4000-8000-000000000001')) return { id: '11000000-0000-4000-8000-000000000001', runtimeId: 'runtime-a', kind: 'command', state: 'succeeded', result: { stdout: 'cloud-only' } }
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
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ path: '/tenants/tenant-a/workspaces/workspace-a/runtimes/runtime-a/operations/11000000-0000-4000-8000-000000000001' }))
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy()
    const suspended = props('cloud-suspended', 9)
    view.rerender(<CloudPanel {...input} useCloud={suspended.useCloud} />)
    await waitFor(() =>{  expect(screen.getByText('11000000-0000-4000-8000-000000000001')).toBeTruthy() })
    expect(screen.getByRole('button', { name: '取消任务' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('textbox', { name: '云端命令' })).toBeNull()
  })
  it('opens the main chat and pins a selected Bot when creating a cloud session', async () => {
    const input = props('cloud')
    let reads = 0
    const recent = { id: '10000000-0000-4000-8000-000000000025', model: 'Recent model', endpoint: 'https://model.example' }
    const older = { id: '10000000-0000-4000-8000-000000000005', model: 'Earlier model', endpoint: 'https://model.example' }
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/server-info') return { serverId: '10000000-0000-4000-8000-000000000010', capabilities: { workspaceBots: true } }
      if (request.path.endsWith('/bots?limit=100')) return { items: [
        { id: '10000000-0000-4000-8000-000000000020', state: 'active', latestRevision: 3, name: 'Fixture Bot' },
        { id: '10000000-0000-4000-8000-000000000021', state: 'archived', latestRevision: 1, name: 'Archived' },
      ] }
      if (request.path.endsWith('/model-credentials?limit=20')) return { items: [recent], nextCursor: 'older' }
      if (request.path.endsWith('/model-credentials?limit=20&cursor=older')) {
        if (++reads === 1) throw Error('offline')
        return { items: [recent, older], nextCursor: null }
      }
      if (request.path.endsWith('/sessions') && request.method === 'POST') return { id: '10000000-0000-4000-8000-000000000004' }
      if (request.path.endsWith('/binding')) return { schemaVersion: 1, serverId: '10000000-0000-4000-8000-000000000010', tenantId: '10000000-0000-4000-8000-000000000001', workspaceId: '10000000-0000-4000-8000-000000000002', cloudSessionId: '10000000-0000-4000-8000-000000000004', runtimeId: '10000000-0000-4000-8000-000000000003', credentialRef: '10000000-0000-4000-8000-000000000005', desktopId: null, bindingRevision: 7, state: 'active' }
      if (request.path === '/me/tenants') return [{ id: '10000000-0000-4000-8000-000000000001', name: 'Team' }]
      if (request.path === '/tenants/10000000-0000-4000-8000-000000000001/workspaces') return { items: [{ id: '10000000-0000-4000-8000-000000000002', name: 'Workspace', tenantId: '10000000-0000-4000-8000-000000000001' }], nextCursor: null }
      if (request.path.endsWith('/runtimes')) return { resources: [{ id: '10000000-0000-4000-8000-000000000003', name: 'Sandbox', state: 'ready' }, { id: '10000000-0000-4000-8000-000000000006', name: 'Browsing sandbox', state: 'ready' }] }
      if (request.path.endsWith('/sessions?limit=20')) return { items: [], nextCursor: 'older' }
      if (request.path.endsWith('/sessions?limit=20&cursor=older')) return { items: [{ id: '10000000-0000-4000-8000-000000000004', title: 'Conversation' }], nextCursor: null }
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
    fireEvent.click(await screen.findByRole('button', { name: zh.moreSessions }))
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
    fireEvent.change(screen.getByRole('combobox', { name: zh.chatBotOptional }), { target: { value: '10000000-0000-4000-8000-000000000020' } })
    const selectModel = screen.getByRole<HTMLSelectElement>('combobox', { name: zh.credential })
    fireEvent.change(selectModel, { target: { value: recent.id } })
    const more = screen.getByRole('button', { name: zh.moreModels })
    fireEvent.click(more); await screen.findByText(zh.modelPageFailed)
    expect(selectModel.value).toBe(recent.id)
    fireEvent.click(more); await screen.findByRole('option', { name: older.model })
    expect(selectModel.value).toBe(recent.id)
    expect(screen.getAllByRole('option', { name: recent.model })).toHaveLength(1)
    fireEvent.change(selectModel, { target: { value: older.id } })
    fireEvent.click(screen.getByRole('button', { name: zh.createSession }))
    await waitFor(() => {
      const request = vi.mocked(input.call).mock.calls.find(([entry]) => entry.method === 'POST' && entry.path.endsWith('/sessions'))
      expect(request?.[0].body).toMatchObject({ credentialId: older.id, bot: { id: '10000000-0000-4000-8000-000000000020', revision: 3 } })
    })
  })
  it('shows a model failure separately from an empty catalog and retries only the current workspace', async () => {
    const f = props('cloud')
    f.viewActions.tenant('tenant'); f.viewActions.workspace('a'); f.viewActions.section('agent')
    const late = Promise.withResolvers<CloudValue>()
    let retry = false
    vi.mocked(f.call).mockImplementation(async (req) => {
      if (req.path.endsWith('/a/model-credentials?limit=20')) return late.promise
      if (!retry) throw Error('offline')
      return []
    })
    const ui = render(<CloudPanel {...f} />)
    f.viewActions.workspace('b'); ui.rerender(<CloudPanel {...f} />)
    await screen.findByText(zh.modelsReadFailed)
    late.resolve([{ id: '10000000-0000-4000-8000-000000000011', model: 'old-model', endpoint: 'https://old.example' }])
    retry = true; fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    await screen.findByText(zh.noWorkspaceModels)
    expect(screen.queryByText('old-model')).toBeNull()
  })
  it('drops late model pages in settings and explains the 100-credential limit of an older API', async () => {
    const f = props('cloud'), delayed = Promise.withResolvers<CloudValue>()
    f.viewActions.tenant('team'); f.viewActions.workspace('one')
    const row = (model: string) => ({ id: randomUUID(), model, endpoint: 'https://model.example' })
    vi.mocked(f.call).mockImplementation(async (req) => {
      if (req.path.endsWith('?limit=20&cursor=old')) return delayed.promise
      if (req.path.includes('/two/')) return Array.from({ length: 100 }, (_, i) => row('Legacy ' + i))
      return { items: [row('First model')], nextCursor: 'old' }
    })
    const settings = <CloudModels {...f} {...globalSeat} close={vi.fn()} manage={vi.fn()} />
    const ui = render(settings)
    fireEvent.click(await screen.findByRole('button', { name: zh.moreModels }))
    f.viewActions.workspace('two'); ui.rerender(<CloudModels {...f} {...globalSeat} close={vi.fn()} manage={vi.fn()} />)
    await screen.findByText(zh.legacyModels)
    delayed.resolve({ items: [row('Wrong workspace')], nextCursor: null })
    await waitFor(() => expect(screen.getByText('Legacy 99')).toBeTruthy())
    expect(screen.queryByText('First model')).toBeNull()
    expect(screen.queryByText('Wrong workspace')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.moreModels })).toBeNull()
    expect(vi.mocked(f.call).mock.calls.every(([req]) => req.method === 'GET')).toBe(true)
  })

  it('prepares the sandbox and creates a conversation for a newly created Bot', async () => {
    const input = props('cloud')
    const tenantId = '10000000-0000-4000-8000-000000000001', workspaceId = '10000000-0000-4000-8000-000000000002'
    const serverId = '10000000-0000-4000-8000-000000000010', botId = '10000000-0000-4000-8000-000000000011'
    const runtimeId = '10000000-0000-4000-8000-000000000003', credentialRef = '10000000-0000-4000-8000-000000000005'
    const cloudSessionId = '10000000-0000-4000-8000-000000000004', base = `/tenants/${tenantId}/workspaces/${workspaceId}`
    const bot = { id: botId, name: 'Cloud Writer', state: 'active', latestRevision: 1, version: 1 }
    let created = false, allocated = false, allocationDisabled = true
    input.viewActions.tenant(tenantId)
    input.viewActions.workspace(workspaceId)
    input.viewActions.section('agent')
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === '/server-info') return { serverId, capabilities: { workspaceBots: true } }
      if (request.path === base + '/bots?limit=100') return { items: created ? [bot] : [] }
      if (request.path === base + '/bots' && request.method === 'POST') { created = true; return bot }
      const sandbox = { id: runtimeId, name: 'Sandbox', state: 'ready' }
      if (request.path === base + '/runtimes') {
        if (request.method !== 'POST') return { resources: allocated ? [sandbox] : [] }
        if (allocationDisabled) throw new CloudRequestFailure('SERVICE_NOT_ENABLED')
        allocated = true; return sandbox
      }
      if (request.path === base + '/model-credentials?limit=20') return [{ id: credentialRef, model: 'Fixture model', endpoint: 'https://model.example' }]
      if (request.path === base + '/sessions') return request.method === 'POST' ? { id: cloudSessionId } : []
      if (request.path === `${base}/sessions/${cloudSessionId}/binding`) return { schemaVersion: 1, serverId, tenantId, workspaceId, cloudSessionId, runtimeId, credentialRef, desktopId: null, bindingRevision: 1, state: 'active' }
      return []
    })
    render(<CloudPanel {...input} />)
    await screen.findByRole('option', { name: 'Fixture model' })
    fireEvent.change(screen.getByRole('combobox', { name: zh.credential }), { target: { value: credentialRef } })
    await screen.findAllByText(zh.chatBotCreate)
    fireEvent.click(screen.getAllByText(zh.chatBotCreate)[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: zh.chatBotName }), { target: { value: 'Cloud Writer' } })
    fireEvent.change(screen.getByRole('textbox', { name: zh.chatBotRole }), { target: { value: '交付助手' } })
    fireEvent.change(screen.getByRole('textbox', { name: zh.chatBotInstructions }), { target: { value: '整理工作空间文件并汇总结果。' } })
    fireEvent.click(screen.getByRole('button', { name: zh.chatBotCreate }))
    await screen.findByText(zh.chatBotCreated)
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: base + '/bots', body: {
      definition: { schemaVersion: 1, name: 'Cloud Writer', role: '交付助手', instructions: '整理工作空间文件并汇总结果。', requiredCapabilities: [] }, source: { kind: 'manual' },
    } }))
    await screen.findByRole('option', { name: 'Cloud Writer · 版本 1' })
    expect((screen.getByRole('combobox', { name: zh.chatBotOptional }) as HTMLSelectElement).value).toBe(botId)
    expect(screen.getByText(zh.sessionAllocateSandbox)).toBeTruthy()
    const create = screen.getByRole<HTMLButtonElement>('button', { name: zh.createSession })
    const allocate = screen.getByRole<HTMLButtonElement>('button', { name: zh.allocate })
    expect(create.disabled).toBe(true)
    expect(input.call).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: base + '/runtimes' }))
    fireEvent.click(allocate)
    await screen.findByText(zh.sandboxDisabled)
    expect(create.disabled).toBe(true)
    allocationDisabled = false
    fireEvent.click(allocate)
    await waitFor(() => expect(create.disabled).toBe(false))
    expect((screen.getByRole('combobox', { name: zh.runtime }) as HTMLSelectElement).value).toBe(runtimeId)
    expect(screen.queryByText(zh.sandboxDisabled)).toBeNull()
    fireEvent.click(create)
    await screen.findByText('绑定已启用 · 版本 1')
    expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: base + '/sessions', body: {
      runtimeId, credentialId: credentialRef, bot: { id: botId, revision: 1 }, title: zh.session,
    } }))
  })
  it('waits for a stopped sandbox to become ready before enabling a new conversation', async () => {
    const input = props('cloud'), base = '/tenants/t/workspaces/w', runtimePath = base + '/runtimes/r'
    const credential = '10000000-0000-4000-8000-000000000005', operation = Promise.withResolvers<CloudValue>()
    input.viewActions.tenant('t'); input.viewActions.workspace('w'); input.viewActions.section('agent')
    input.viewActions.resource('credential', credential)
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.path === base + '/model-credentials?limit=20') return [{ id: credential, model: 'Fixture model', endpoint: 'https://model.example' }]
      if (request.path === base + '/runtimes') return { resources: [{ id: 'r', name: 'Stopped sandbox', state: 'stopped' }] }
      if (request.path === runtimePath + '/lifecycle') return { id: '11000000-0000-4000-8000-000000000002', runtimeId: 'r', state: 'queued', kind: 'start' }
      if (request.path === runtimePath + '/operations/11000000-0000-4000-8000-000000000002') return operation.promise
      if (request.path === runtimePath) return { id: 'r', name: 'Sandbox', state: 'ready' }
      return []
    })
    render(<CloudPanel {...input} />)
    await screen.findByRole('option', { name: 'Stopped sandbox' })
    fireEvent.change(screen.getByRole('combobox', { name: zh.runtime }), { target: { value: 'r' } })
    expect(screen.getByText(zh.sessionStartSandbox)).toBeTruthy()
    const create = screen.getByRole<HTMLButtonElement>('button', { name: zh.createSession })
    expect(create.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.start }))
    await waitFor(() => expect(input.call).toHaveBeenCalledWith(expect.objectContaining({ path: runtimePath + '/operations/11000000-0000-4000-8000-000000000002' })))
    expect(create.disabled).toBe(true)
    operation.resolve({ id: '11000000-0000-4000-8000-000000000002', runtimeId: 'r', kind: 'start', state: 'succeeded' })
    await waitFor(() => expect(create.disabled).toBe(false))
  })
  it('paginates only the selected runtime and ignores old history when it changes', async () => {
    const f = props('cloud'), old = Promise.withResolvers<CloudValue>()
    const runtime = '10000000-0000-4000-8000-000000000010', other = '10000000-0000-4000-8000-000000000011'
    f.viewActions.tenant('t'); f.viewActions.workspace('w'); f.viewActions.section('tasks'); f.viewActions.resource('runtime', runtime)
    const row = (id: string) => ({ id, kind: 'files', state: 'succeeded', errorCode: null, runtimeId: id, createdAt: '2026-11-24T00:00:00Z' })
    vi.mocked(f.call).mockImplementation(async (req) => {
      if (req.path.endsWith('&cursor=second')) return old.promise
      if (req.path.includes('/' + runtime + '/operations?')) return { items: [row(runtime)], nextCursor: 'second' }
      return { items: [row(other)], nextCursor: null }
    })
    const ui = render(<CloudPanel {...f} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.nextPage }))
    f.viewActions.resource('runtime', other); ui.rerender(<CloudPanel {...f} />)
    await screen.findByText(other, { selector: 'code' })
    old.resolve({ items: [row(runtime)], nextCursor: null })
    await waitFor(() => expect(screen.queryByText(runtime, { selector: 'code' })).toBeNull())
    expect(vi.mocked(f.call).mock.calls.every(([r]) => r.method === 'GET')).toBe(true)
  })

  it('retains late acceptance after closing the panel and queries the original task without resubmitting', async () => {
    const input = props('cloud'), pending = Promise.withResolvers<CloudValue>()
    input.viewActions.tenant('t'); input.viewActions.workspace('w'); input.viewActions.resource('runtime', 'r')
    vi.mocked(input.call).mockImplementation(async (request) => {
      if (request.method === 'POST') return pending.promise
      return { id: '11000000-0000-4000-8000-000000000003', state: 'succeeded', result: { stdout: 'original task' } }
    })
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    await waitFor(() => expect(input.call).toHaveBeenCalledTimes(1))
    first.unmount()
    pending.resolve({ id: '11000000-0000-4000-8000-000000000003', runtimeId: 'r', state: 'queued', kind: 'command' })
    await waitFor(() => { expect(input.call).toHaveBeenCalledTimes(1) })
    render(<CloudPanel {...input} />)
    await screen.findByText('11000000-0000-4000-8000-000000000003')
    fireEvent.click(screen.getByRole('button', { name: '查询原任务' }))
    await waitFor(() => { expect(screen.getByLabelText('任务结果').textContent).toContain('original task') })
    expect(vi.mocked(input.call).mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    expect(input.call).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', path: '/tenants/t/workspaces/w/runtimes/r/operations/11000000-0000-4000-8000-000000000003' }))
    expect(input.logout).not.toHaveBeenCalled()
  })

  it.each(['command', 'start', 'stop'] as const)('recovers %s after reauthentication without replaying the original POST', async (kind) => {
    let user = 'alice', found = false
    const f = props('cloud')
    const receipts = new RuntimeReceipts(async () => ['deployment', user])
    const id = '11000000-0000-4000-8000-000000000009', runtimeId = 'r'
    const base = '/tenants/t/workspaces/w/runtimes/r', key = randomUUID()
    const scope = await receipts.scope('http://localhost:17800', 8, base, f.call)
    f.viewActions.tenant('t'); f.viewActions.workspace('w'); f.viewActions.resource('runtime', runtimeId)
    vi.mocked(f.call).mockImplementation(async (req) => {
      if (req.method === 'POST') throw Error('lost response')
      if (req.path === base + '/task-receipts?kind=' + kind + '&key=' + key) return found ? { id, runtimeId, kind } : null
      if (req.path === base + '/operations/' + id) return { id, runtimeId, kind, state: 'succeeded' }
      throw Error('unexpected request')
    })
    receipts.reserve({ scope, key, kind })
    user = 'bob'
    const ui = render(<CloudPanel {...f} taskReceipts={receipts} useCloud={props('cloud', 9).useCloud} />)
    expect(screen.queryByRole('button', { name: zh.queryTask })).toBeNull()
    user = 'alice'
    ui.rerender(<CloudPanel {...f} taskReceipts={receipts} useCloud={props('cloud', 10).useCloud} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.queryTask }))
    await screen.findByText(zh.taskNotConfirmed)
    found = true; fireEvent.click(screen.getByRole('button', { name: zh.queryTask }))
    await waitFor(() => expect(screen.getByLabelText(zh.result).textContent).toContain('succeeded'))
    expect(receipts.entries.getSnapshot()).toHaveLength(0)
    expect(vi.mocked(f.call).mock.calls.map(([req]) => req.method)).toEqual(['GET', 'GET', 'GET'])
  })
  it('retains an unknown submission across panel closure and isolates its reference from another workspace', async () => {
    const input = props('cloud')
    input.viewActions.tenant('t'); input.viewActions.workspace('w'); input.viewActions.resource('runtime', 'r')
    const base = '/tenants/t/workspaces/w/runtimes/r', id = '11000000-0000-4000-8000-000000000010'
    let key: string | null = null, lookups = 0, polls = 0
    vi.mocked(input.call).mockImplementation(async (req) => {
      if (req.method === 'POST' && req.path === base + '/commands') {
        key = req.idempotencyKey
        throw Error('response lost')
      }
      if (req.method === 'GET' && req.path === base + '/task-receipts?kind=command&key=' + key) {
        return { id, kind: 'command', runtimeId: ++lookups === 1 ? 'other' : 'r' }
      }
      if (req.method === 'GET' && req.path === base + '/operations/' + id) {
        if (++polls === 1) throw Error('status unavailable')
        return { id, kind: 'command', runtimeId: 'r', state: 'succeeded' }
      }
      throw Error('unexpected request')
    })
    const first = render(<CloudPanel {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '云端命令' }), { target: { value: 'pwd' } })
    fireEvent.click(screen.getByRole('button', { name: '在云端执行' }))
    await screen.findByText(zh.unknownResult)
    first.unmount()
    const second = render(<CloudPanel {...input} />)
    await screen.findByText(zh.unknownResult)
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(input.call).toHaveBeenCalledTimes(1)
    second.unmount()
    input.viewActions.workspace('other')
    const other = render(<CloudPanel {...input} />)
    expect(screen.queryByText(zh.unknownResult)).toBeNull()
    expect(input.call).toHaveBeenCalledTimes(1)
    other.unmount()
    input.viewActions.workspace('w'); input.viewActions.resource('runtime', 'r')
    render(<CloudPanel {...input} />)
    const query = await screen.findByRole('button', { name: zh.queryTask })
    fireEvent.click(query)
    await screen.findByText(zh.taskLookupFailed)
    expect(polls).toBe(0)
    fireEvent.click(query)
    await waitFor(() => expect(polls).toBe(1))
    await waitFor(() => expect(query.hasAttribute('disabled')).toBe(false))
    fireEvent.click(query)
    await waitFor(() => expect(screen.getByLabelText(zh.result).textContent).toContain('succeeded'))
    expect(input.taskReceipts!.entries.getSnapshot()).toHaveLength(0)
    expect(vi.mocked(input.call).mock.calls.map(([req]) => req.method)).toEqual(['POST', 'GET', 'GET', 'GET', 'GET', 'GET'])
  })

})
