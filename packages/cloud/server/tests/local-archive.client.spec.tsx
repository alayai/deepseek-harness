// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocalArchive } from '../src/client/LocalArchive.tsx'
import { zh } from '../src/client/locales.ts'
import type { BotSyncRecord } from '../src/client/bot-sync.ts'
import type { LocalReadRequest, LocalReadResult } from '../src/types.ts'

afterEach(cleanup)
const t = makeTranslate(zh)

it('loads only explicit local reads and renders saved HTML as text', async () => {
  const read = vi.fn(async (input: LocalReadRequest): Promise<LocalReadResult> => input.kind === 'sessions'
    ? { kind: 'sessions', items: [{ id: 'local-a' as SessionId, createdAt: 1 }], nextOffset: null }
    : { kind: 'messages', sessionId: 'local-a' as SessionId, items: [{ seq: 1, role: 'user', text: '<img src=x onerror=alert(1)>', truncated: false }], nextBefore: null })
  const openCloud = vi.fn()
  const view = render(<LocalArchive t={t} epoch={2} read={read} cloudAvailable openCloud={openCloud} />)
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(zh.localArchive))
  fireEvent.click(screen.getByRole('button', { name: zh.localSessions }))
  await screen.findByRole('button', { name: zh.viewLocalText })
  fireEvent.click(screen.getByRole('button', { name: zh.viewLocalText }))
  await screen.findByText('<img src=x onerror=alert(1)>')
  expect(view.container.querySelector('img')).toBeNull()
  expect(read).toHaveBeenLastCalledWith({ kind: 'messages', epoch: 2, sessionId: 'local-a', before: null })
  expect(screen.getByRole('region', { name: zh.localMessages }).textContent).toMatchSnapshot()
  fireEvent.click(screen.getByRole('button', { name: zh.chatChooseConversation }))
  expect(openCloud).toHaveBeenCalledOnce()
})

it('offers read-only Bot previews during cloud pause and distinguishes an absent provider', async () => {
  const read = vi.fn(async (): Promise<LocalReadResult> => ({ kind: 'bots', available: false, ready: false, items: [], nextOffset: null }))
  render(<LocalArchive t={t} epoch={3} read={read} cloudAvailable={false} openCloud={vi.fn()} />)
  fireEvent.click(screen.getByText(zh.localArchive))
  expect(screen.getByRole('button', { name: zh.chatChooseConversation }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.localBots }))
  await screen.findByText(zh.botProviderMissing)
  expect(read).toHaveBeenCalledWith({ kind: 'bots', epoch: 3, offset: 0 })
})

it('exports only a public Bot after an explicit click and keeps private Bots blocked', async () => {
  const read = vi.fn(async (): Promise<LocalReadResult> => ({ kind: 'bots', available: true, ready: true, items: [
    { id: 'public-bot' as never, name: 'Public', role: '', instructions: 'safe', model: 'local/model', private: false, truncated: false },
    { id: 'private-bot' as never, name: 'Private', role: '', instructions: 'secret', model: 'local/model', private: true, truncated: false },
  ], nextOffset: null }))
  const previewBot = vi.fn(async () => ({ scope: { serverUrl: 'https://cloud.test', serverId: 'server-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, status: 'new' as const, definition: { schemaVersion: 1 as const, name: 'Public', role: '', instructions: 'safe', requiredCapabilities: [] as const }, source: { kind: 'local-export' as const, localBotId: 'public-bot', exportVersion: 1 as const, exportedAt: new Date(1).toISOString(), contentSha256: 'a'.repeat(64) } }))
  const exportBot = vi.fn(async (): Promise<BotSyncRecord> => ({ ...((await previewBot()).scope), localBotId: 'public-bot', cloudBotId: 'cloud-a', cloudRevision: 1, cloudVersion: 1, contentSha256: 'a'.repeat(64), syncedAt: new Date(1).toISOString() }))
  render(<LocalArchive t={t} epoch={4} read={read} previewBot={previewBot} exportBot={exportBot} cloudAvailable openCloud={vi.fn()} />)
  fireEvent.click(screen.getByText(zh.localArchive))
  fireEvent.click(screen.getByRole('button', { name: zh.localBots }))
  await screen.findByText('Public')
  fireEvent.click(screen.getByRole('button', { name: zh.exportBot }))
  await screen.findByRole('region', { name: zh.exportPreview })
  expect(exportBot).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.confirmExport }))
  await waitFor(() => { expect(exportBot).toHaveBeenCalledWith('public-bot', expect.objectContaining({ source: expect.objectContaining({ kind: 'local-export' }) })) })
  expect(screen.getByText(zh.privateExportBlocked)).toBeTruthy()
})

it('drops a pending read after the view closes', async () => {
  const pending = Promise.withResolvers<LocalReadResult>()
  const read = vi.fn(() => pending.promise)
  const props = { t, epoch: 2, read, cloudAvailable: true, openCloud: vi.fn() }
  const first = render(<LocalArchive {...props} />)
  fireEvent.click(screen.getByText(zh.localArchive))
  fireEvent.click(screen.getByRole('button', { name: zh.localBots }))
  first.unmount()
  render(<LocalArchive {...props} />)
  pending.resolve({ kind: 'bots', available: false, ready: false, items: [], nextOffset: null })
  await waitFor(() => { expect(read).toHaveBeenCalledOnce() })
  expect(screen.queryByText(zh.botProviderMissing)).toBeNull()
})
