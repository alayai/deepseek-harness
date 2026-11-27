// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { CloudChat } from '../src/client/CloudChat.tsx'
import { CloudComposer } from '../src/client/CloudEntry.tsx'
import { zh } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CloudPanelInjected } from '../src/client/CloudPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { CloudSnapshot } from '../src/types.ts'

interface Entry {
  name: string
  id?: string
  key?: string
  inject?: () => Partial<CloudPanelInjected> & { open?: () => void }
}

describe('cloud UI composition and disposal', () => {
  it('opens the native tab only for an existing Session and disposes every contribution', async () => {
    const ctx = new Context(), entries: Entry[] = [], definitions: SidebarRightTabDefinition[] = []
    const dictionaries = new Set<string>(), mounted = createSnapshotStore<SessionId | undefined>(undefined)
    const openTab = vi.fn(), selectPanel = vi.fn()
    const first = Promise.withResolvers<{ ok: true; value: CloudSnapshot }>()
    let snapshot: CloudSnapshot = { mode: 'local', epoch: 0, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null }
    const state = vi.fn(async (): Promise<{ ok: true; value: CloudSnapshot }> => ({ ok: true, value: snapshot }))
      .mockReturnValueOnce(first.promise)
    ctx.provide('remote', { dshCloud: { state } } as never)
    ctx.provide('remote.dshCloud', {} as never)
    ctx.provide('connection', { reconnect: vi.fn() } as never)
    ctx.provide('layout', { selectPanel } as never)
    ctx.provide('sidebarRight', { mounted, openTab } as never)
    ctx.provide('sidebarRightTabs', { register: (definition: SidebarRightTabDefinition) => {
      definitions.push(definition)
      return () => { definitions.splice(definitions.indexOf(definition), 1) }
    } } as never)
    ctx.provide('locale', {
      bind: () => (key: string) => key,
      register: (namespace: string) => { dictionaries.add(namespace); return () => { dictionaries.delete(namespace) } },
    } as never)
    // Exercise the core's runtime scope checks with the same erased registration used by the renderer.
    const ledger = new SlotCore()
    const core = ledger as { register(options: object, component: () => null): () => void }
    core.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'bot.sidebar.directory': { kind: 'single', scope: 'root' },
      'bot.sidebar.action': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'main.conversation': { kind: 'single', scope: 'session-maybe' },
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    } }, () => null)
    const localComposer = () => null
    const bar = 'conversation.composer.bar'
    core.register({ name: bar }, localComposer)
    const mainSlot = 'main.conversation'
    const localConversation = () => null
    core.register({ name: mainSlot }, localConversation)
    const mainWinner = () => ledger.entriesOfSlot(mainSlot)[0]?.component
    const winner = () => ledger.entriesOfSlot(bar)[0]?.component
    ctx.provide('slots', {
      inject: (_name: string, register: Parameters<SlotRegistry['inject']>[1]) => ctx.effect(register),
      register: (entry: Entry, component: () => null) => {
        const dispose = core.register(entry, component)
        entries.push(entry)
        return () => { dispose(); entries.splice(entries.indexOf(entry), 1) }
      },
    } as never)
    try {
      const fiber = ctx.plugin({ inject, apply })
      await fiber.await()
      expect(winner()).toBe(CloudComposer)
      expect(mainWinner()).toBe(CloudChat)
      first.resolve({ ok: true, value: snapshot })
      await vi.waitFor(() => { expect(winner()).toBe(localComposer) })
      expect(mainWinner()).toBe(localConversation)
      expect(entries).toHaveLength(6)
      const open = entries.find(entry => entry.name === 'sidebar.footer.action')?.inject?.().open
      expect(open).toBeTypeOf('function')
      expect(entries.find(entry => entry.name === 'bot.sidebar.action')?.inject?.().open).toBe(open)
      open?.()
      expect(selectPanel).toHaveBeenCalledWith('dsh-cloud')
      expect(openTab).not.toHaveBeenCalled()
      mounted.set('existing-session' as SessionId)
      open?.()
      expect(openTab).toHaveBeenCalledWith('dshCloud')
      expect(definitions).toHaveLength(1)
      const main = entries.find(entry => entry.name === 'main')?.inject?.()
      const tab = entries.find(entry => entry.name === 'sidebar.right.pane.tab')?.inject?.()
      expect(main?.hooks?.view).toBeDefined()
      expect(main?.hooks?.view).toBe(tab?.hooks?.view)
      main?.viewActions?.workspace('selected-workspace')
      expect(tab?.hooks?.view.getSnapshot().workspace).toBe('selected-workspace')
      for (const mode of ['authenticating', 'cloud', 'cloud-suspended', 'local'] as const) {
        snapshot = { ...snapshot, mode, epoch: snapshot.epoch + 1 }
        await vi.waitFor(() => { expect(main?.hooks?.cloud.getSnapshot().mode).toBe(mode) }, { timeout: 2500 })
        expect(winner()).toBe(mode === 'local' ? localComposer : CloudComposer)
        expect(mainWinner()).toBe(mode === 'local' ? localConversation : CloudChat)
        expect(entries.some(entry => entry.id === 'dsh-cloud-models')).toBe(mode !== 'local')
        expect(entries.some(entry => entry.name === 'bot.sidebar.directory')).toBe(mode !== 'local')
        if (mode === 'cloud') {
          const go = entries.find(entry => entry.name === bar)?.inject?.().open
          if (go === undefined) throw new Error('Missing cloud conversation action')
          const ui = render(createElement(CloudComposer, { t: makeTranslate(zh), open: go, useCloud: select => select(snapshot) }))
          try {
            expect(ui.queryByRole('textbox')).toBeNull()
            expect(ui.queryByRole('button', { name: '发送' })).toBeNull()
            fireEvent.click(ui.getByRole('button', { name: '前往云端会话' }))
            expect(selectPanel).toHaveBeenLastCalledWith(null)
            expect(openTab).toHaveBeenCalledTimes(1)
          } finally { ui.unmount() }
        }
      }
      await fiber.dispose()
      expect(entries).toEqual([])
      expect(definitions).toEqual([])
      expect(dictionaries.size).toBe(0)
    } finally { await ctx.fiber.dispose() }
  })
})
