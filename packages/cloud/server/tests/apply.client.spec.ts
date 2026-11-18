import { describe, expect, it, vi } from 'vitest'
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
    const state = vi.fn(async (): Promise<{ ok: true; value: CloudSnapshot }> => ({
      ok: true, value: { mode: 'local', epoch: 0, serverUrl: 'http://localhost:17800', authorizationUrl: null, error: null },
    }))
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
    const core = new SlotCore() as { register(options: object, component: () => null): () => void }
    core.register({ name: 'root', children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    } }, () => null)
    ctx.provide('slots', {
      inject: (_name: string, register: Parameters<SlotRegistry['inject']>[1]) => ctx.effect(register),
      register: (entry: Entry) => {
        const dispose = core.register(entry, () => null)
        entries.push(entry)
        return () => { dispose(); entries.splice(entries.indexOf(entry), 1) }
      },
    } as never)
    try {
      const fiber = ctx.plugin({ inject, apply })
      await fiber.await()
      await vi.waitFor(() => { expect(entries).toHaveLength(5) })
      const open = entries.find(entry => entry.name === 'sidebar.footer.action')?.inject?.().open
      expect(open).toBeTypeOf('function')
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
      await fiber.dispose()
      expect(entries).toEqual([])
      expect(definitions).toEqual([])
      expect(dictionaries.size).toBe(0)
    } finally { await ctx.fiber.dispose() }
  })
})
