// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { CloudRequest, CloudValue } from '../src/types.ts'
import { CloudFileState, CloudFiles } from '../src/client/CloudFiles.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh)
const runtime = '10000000-0000-4000-8000-000000000007'
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']
const receipt = (id: string) => ({ id, runtimeId: runtime, kind: 'files' })
const operation = (id: string, result: CloudValue, errorCode: string | null = null, state = 'succeeded') => ({
  id, runtimeId: runtime, kind: 'files', state, cancelRequested: false, result, errorCode,
})
function fixture(mode: 'save' | 'conflict' | 'cancelled' | 'timed_out' | 'unsafe-name' = 'save') {
  let count = 0
  const state = new CloudFileState()
  const call = vi.fn(async (request: CloudRequest): Promise<CloudValue> => {
    if (request.path.endsWith('/files')) { count++; return receipt(ids[count - 1] ?? ids[2]!) }
    if (request.path.includes('/operations/')) {
      const id = request.path.split('/').at(-1)!
      if (id === ids[0]) return operation(id, { file: { path: '.', entries: [{ name: 'notes.txt', type: 'file' }, ...(mode === 'unsafe-name' ? [{ name: 'odd\\name.txt', type: 'file' }] : [])], nextAfter: null } })
      if (id === ids[1]) return operation(id, { file: { path: 'notes.txt', content: btoa('before'), revision: 'a'.repeat(64) } })
      return mode === 'conflict' ? operation(id, null, 'FILE_REVISION_CONFLICT', 'failed')
        : mode === 'cancelled' || mode === 'timed_out' ? operation(id, null, null, mode)
          : operation(id, { file: { path: 'notes.txt', size: 5, revision: 'b'.repeat(64) } })
    }
    return null
  })
  const runtimePath = '/tenants/t/workspaces/w/runtimes/' + runtime
  const element = (epoch: number) => <CloudFiles key={epoch} t={t} runtime={runtime} runtimePath={runtimePath}
    scope={runtimePath} state={state} epoch={epoch} enabled call={call} beginRead={() => vi.fn()} />
  const mount = (epoch = 1) => render(element(epoch))
  return { call, mount, element }
}
type Fixture = ReturnType<typeof fixture>
async function openFile(fixture: Fixture) {
  const view = fixture.mount()
  fireEvent.click(screen.getByRole('button', { name: zh.list }))
  await screen.findByRole('button', { name: 'notes.txt' })
  fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }))
  await screen.findByRole('textbox', { name: zh.fileEditor })
  return view
}
describe('cloud sandbox file editor', () => {
  it('pages a directory, opens UTF-8 text and saves a revision', async () => {
    const f = fixture()
    await openFile(f)
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })
    fireEvent.change(editor, { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: zh.fileSave }))
    await screen.findByText(zh.fileSaved)
    const replace = f.call.mock.calls
      .map(([request]) => request)
      .find(request => request.method === 'POST' && request.body !== null
        && typeof request.body === 'object' && !Array.isArray(request.body)
        && request.body.action === 'replace')
    expect(replace).toMatchObject({ body: { action: 'replace', expectedRevision: 'a'.repeat(64), path: 'notes.txt' } })
  })
  it('keeps the draft when the cloud revision changed', async () => {
    const f = fixture('conflict')
    await openFile(f)
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })
    fireEvent.change(editor, { target: { value: 'keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: zh.fileSave }))
    await screen.findByText(zh.fileConflict)
    expect(editor.value).toBe('keep this draft')
  })

  it('keeps a draft when the file view remounts', async () => {
    const f = fixture()
    const view = await openFile(f)
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })
    fireEvent.change(editor, { target: { value: 'keep across reconnect' } })
    view.rerender(f.element(2))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor }).value).toBe('keep across reconnect')
    view.unmount()
  })

  it.each(['cancelled', 'timed_out'] as const)('allows leaving the editor after a %s save', async (terminal) => {
    const f = fixture(terminal)
    await openFile(f)
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })
    fireEvent.change(editor, { target: { value: 'cancelled draft' } })
    fireEvent.click(screen.getByRole('button', { name: zh.fileSave }))
    await screen.findByText(zh.fileStopped)
    expect(screen.queryByRole('button', { name: zh.fileCheckSave })).toBeNull()
    const back = screen.getByRole('button', { name: zh.fileBack })
    expect((back as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(back)
    fireEvent.click(screen.getByRole('button', { name: zh.fileDiscard }))
    expect(screen.queryByRole('textbox', { name: zh.fileEditor })).toBeNull()
  })

  it('shows unsafe names without trying to submit them', async () => {
    const f = fixture('unsafe-name')
    f.mount()
    fireEvent.click(screen.getByRole('button', { name: zh.list }))
    const entry = await screen.findByRole('button', { name: 'odd\\name.txt' })
    expect((entry as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }))
    expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: zh.fileEditor })).value).toBe('before')
  })
})
