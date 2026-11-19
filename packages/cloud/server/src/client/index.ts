/** Register Host-owned cloud resources in the native sidebar and a session-free main page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cloud-server/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LocalBotExportResult } from '../types.ts'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { CloudPanel, type CloudPanelInjected } from './CloudPanel.tsx'
import { createCloudSource } from './source.ts'
import { createCloudViewStore } from './view-store.ts'
import { CloudArtifactReceipts } from './CloudArtifacts.tsx'
import { CloudSessionReplay } from './session-replay.ts'
import { createCloudActivities } from './activity.ts'
import { CloudEntry, CloudIcon, CloudTabTitle } from './CloudEntry.tsx'
import { en, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale', 'connection', 'layout', 'sidebarRight', 'sidebarRightTabs']

type DshCloudRemote = {
  exportLocal(input: { kind: 'bot'; epoch: number; botId: string }): Promise<{ ok: true; value: LocalBotExportResult } | { ok: false; error: { code: string } }>
}

const PANEL_ID = 'dsh-cloud' as MainPanelId
const TAB_ID = '@deepseek-ai/dsh-cloud-server/resources'
const TAB_KIND = 'dshCloud'

/** Mount cloud UI with generated Remote types; no Renderer fetch receives a bearer token. */
function registerUi(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register('dsh.cloud', { en, zh }), 'cloud: dictionaries')
  const t = ctx.locale.bind('dsh.cloud')
  const store = createCloudViewStore()
  const activities = createCloudActivities()
  const replay = new CloudSessionReplay()
  const artifacts = new CloudArtifactReceipts()
  let popup: Window | null = null
  const source = createCloudSource(async () => {
    const result = await ctx.remote.dshCloud.state()
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  })
  ctx.effect(() => () => { source.dispose(); popup?.close(); activities.clear(); replay.clear(); artifacts.clear() }, 'cloud: client lifetime')
  let previous = source.source.getSnapshot().mode
  ctx.effect(() => source.source.subscribe(() => {
    const snapshot = source.source.getSnapshot(), mode = snapshot.mode
    if (snapshot.authorizationUrl !== null && popup !== null) {
      popup.location.href = snapshot.authorizationUrl
      popup = null
    }
    if ((mode === 'local' || mode === 'authenticating') && mode !== previous) {
      store.actions.reset()
      activities.clear(); replay.clear(); artifacts.clear()
    }
    if (mode === 'local' && previous !== 'local') connection.reconnect()
    previous = mode
  }), 'cloud: resume local subscriptions')
  const injectPanel = (): CloudPanelInjected => ({
    replay, artifacts,
    hooks: { cloud: source.source, activities: activities.source, view: store },
    viewActions: store.actions,
    remember: activities.remember,
    accepted: activities.accepted,
    login: async (server) => {
      popup?.close()
      popup = window.open('about:blank', '_blank')
      if (popup !== null) popup.opener = null
      try {
        const result = await ctx.remote.dshCloud.beginLogin(server)
        if (!result.ok) throw new Error(result.error.code)
        source.publish(result.value)
      } catch (error) { popup?.close(); popup = null; throw error }
    },
    logout: async () => {
      const result = await ctx.remote.dshCloud.logout()
      if (!result.ok) throw new Error(result.error.code)
      source.publish(result.value)
    },
    readLocal: async (input) => {
      const result = await ctx.remote.dshCloud.readLocal(input)
      if (!result.ok) throw new Error(result.error.code)
      return result.value
    },
    exportLocal: async (input) => {
      const result = await (ctx.remote.dshCloud as typeof ctx.remote.dshCloud & DshCloudRemote).exportLocal(input)
      if (!result.ok) throw new Error(result.error.code)
      return result.value as LocalBotExportResult
    },
    call: async (input) => {
      const result = await ctx.remote.dshCloud.request(input)
      if (!result.ok) { await source.refresh(); throw new Error(result.error.code) }
      return result.value
    },
  })
  const open = (): void => {
    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.openTab(TAB_KIND)
    else ctx.layout.selectPanel(PANEL_ID)
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID, kind: TAB_KIND, priority: 'builtin', keepMounted: true,
    title: () => t('title'),
    guide: [{ id: TAB_KIND, order: 35, title: () => t('title'), description: () => t('guide'), icon: IconGlobeOutlineRegular }],
  }), 'cloud: resource tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'dsh-cloud', locale: 'dsh.cloud',
    inject: () => ({ hooks: { cloud: source.source }, open }),
  }, CloudEntry)), 'cloud: sidebar.footer.action')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: 'dsh.cloud', inject: injectPanel,
  }, CloudPanel)), 'cloud: main')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 15, locale: 'dsh.cloud', label: () => t('title'),
  }, CloudIcon)), 'cloud: sidebar.panellist')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TAB_ID, locale: 'dsh.cloud', inject: injectPanel,
  }, CloudPanel)), 'cloud: sidebar.right.pane.tab')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: TAB_ID,
  }, CloudTabTitle)), 'cloud: sidebar.right.pane.tab.title')
}

/** Register after the application-selected cloud Remote becomes available. */
export function apply(ctx: Context): void {
  ctx.inject(['remote.dshCloud', 'slots', 'locale', 'connection', 'layout', 'sidebarRight', 'sidebarRightTabs'], registerUi)
}
