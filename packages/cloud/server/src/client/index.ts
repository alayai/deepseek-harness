/** Register Host-owned cloud resources in the native sidebar and a session-free main page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cloud-server/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LocalBotExportResult } from '../types.ts'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { CloudChat } from './CloudChat.tsx'
import { CloudBotSidebar } from './CloudBotSidebar.tsx'
import { RuntimeReceipts } from './runtime-receipts.ts'
import { CloudModels } from './CloudModels.tsx'
import { CloudChatTurns, CloudRequestFailure } from './chat-turns.ts'
import { CloudPanel, type CloudPanelInjected } from './CloudPanel.tsx'
import { createCloudSource } from './source.ts'
import { createCloudViewStore } from './view-store.ts'
import { rememberWorkspace } from './workspace-default.ts'
import { CloudArtifactReceipts } from './CloudArtifacts.tsx'
import { CloudFileState } from './CloudFiles.tsx'
import { CloudSessionReplay } from './session-replay.ts'
import { createCloudActivities } from './activity.ts'
import { CloudComposer, CloudEntry, CloudIcon, CloudTabTitle } from './CloudEntry.tsx'
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
  const taskReceipts = new RuntimeReceipts()
  const replay = new CloudSessionReplay()
  const artifacts = new CloudArtifactReceipts()
  const files = new CloudFileState()
  const turns = new CloudChatTurns()
  let popup: Window | null = null
  const source = createCloudSource(async () => {
    const result = await ctx.remote.dshCloud.state()
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  })
  ctx.effect(() => () => { source.dispose(); popup?.close(); activities.clear(); taskReceipts.clear(); replay.clear(); artifacts.clear(); files.clear(); turns.clear() }, 'cloud: client lifetime')
  let previous = source.source.getSnapshot()
  ctx.effect(() => source.source.subscribe(() => {
    const snapshot = source.source.getSnapshot(), mode = snapshot.mode
    if (snapshot.authorizationUrl !== null && popup !== null) {
      popup.location.href = snapshot.authorizationUrl
      popup = null
    }
    if (((mode === 'local' || mode === 'authenticating') && mode !== previous.mode) ||
      (mode === 'cloud' && (previous.mode !== 'cloud' || snapshot.epoch !== previous.epoch))) {
      store.actions.reset()
      activities.clear(); replay.clear(); artifacts.clear()
    }
    if (mode === 'local' || snapshot.serverUrl !== previous.serverUrl) taskReceipts.clear()
    if (mode === 'local') { turns.clear(); files.clear() }
    if (snapshot.serverUrl !== previous.serverUrl || snapshot.epoch !== previous.epoch) {
      replay.clear(); activities.clear(); artifacts.clear()
    }
    if (snapshot.serverUrl !== previous.serverUrl) { store.actions.reset(); files.clear(); turns.clear() }
    if (mode === 'local' && previous.mode !== 'local') connection.reconnect()
    previous = snapshot
  }), 'cloud: resume local subscriptions')
  const call: CloudPanelInjected['call'] = async (input) => {
    const result = await ctx.remote.dshCloud.request(input)
    if (!result.ok) {
      void source.refresh()
      throw new CloudRequestFailure(result.error.code === 'cloud/blocked' ? result.error.details.reason : result.error.code)
    }
    return result.value
  }
  ctx.effect(() => rememberWorkspace(source.source, store, call), 'cloud: remember verified workspace')
  const goToChat = () => { ctx.layout.selectPanel(null) }
  const injectPanel = (): CloudPanelInjected => ({
    artifacts, files, taskReceipts, openChat: goToChat,
    hooks: { cloud: source.source, activities: activities.source, view: store },
    viewActions: store.actions,
    remember: activities.remember,
    accepted: activities.accepted,
    rejected: activities.rejected,
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
      return result.value
    },
    call,
  })
  const open = (): void => {
    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.openTab(TAB_KIND)
    else ctx.layout.selectPanel(PANEL_ID)
  }
  const openResources = () => {
    store.actions.section('agent')
    open()
  }
  const openFiles = (runtime: string): void => {
    store.actions.resource('runtime', runtime)
    store.actions.section('files')
    open()
  }
  const override = (register: () => () => void) => {
    let release: (() => void) | undefined
    const sync = () => {
      if (source.observed && source.source.getSnapshot().mode === 'local') {
        release?.()
        release = undefined
      } else {
        release ??= register()
      }
    }
    sync()
    const unsubscribe = source.source.subscribe(sync)
    return () => { unsubscribe(); release?.() }
  }
  ctx.effect(() => ctx.slots.inject('bot.sidebar.directory', () => override(() => ctx.slots.register({
    name: 'bot.sidebar.directory', locale: 'dsh.cloud',
    inject: () => ({ hooks: { cloud: source.source, view: store }, cloudSource: source.source, viewSource: store,
      call, openChat: goToChat, openResources }),
  }, CloudBotSidebar))), 'cloud: DS Bot workspace roster')
  ctx.effect(() => ctx.slots.inject('settings.section', () => override(() => ctx.slots.register({
    name: 'settings.section', id: 'dsh-cloud-models', locale: 'dsh.cloud', order: 11, label: () => t('workspaceModels'),
    inject: () => ({ hooks: { cloud: source.source, view: store }, call, manage: () => { store.actions.section('settings'); open() } }),
  }, CloudModels))), 'cloud: workspace model settings')
  ctx.effect(() => ctx.slots.inject('main.conversation', () => override(() => ctx.slots.register({
    name: 'main.conversation', priority: -1, locale: 'dsh.cloud',
    children: { 'dsh.cloud.bot.header': { kind: 'single', scope: 'root' }, 'dsh.cloud.bot.message': { kind: 'single', scope: 'root' } },
    inject: () => ({
      hooks: { cloud: source.source, view: store },
      cloudSource: source.source, viewSource: store, turns, replay, openResources, openFiles, call,
    }),
  }, CloudChat))), 'cloud: main conversation')
  ctx.effect(() => ctx.slots.inject('conversation.composer.bar', () => override(() => ctx.slots.register({
    name: 'conversation.composer.bar', priority: -1, locale: 'dsh.cloud',
    inject: () => ({
      hooks: { cloud: source.source },
      open: () => { if (source.source.getSnapshot().mode === 'cloud') goToChat(); else open() },
    }),
  }, CloudComposer))), 'cloud: local composer admission')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID, kind: TAB_KIND, priority: 'builtin', keepMounted: true,
    title: () => t('title'),
    guide: [{ id: TAB_KIND, order: 35, title: () => t('title'), description: () => t('guide'), icon: IconGlobeOutlineRegular }],
  }), 'cloud: resource tab type')
  for (const name of ['sidebar.footer.action', 'bot.sidebar.action'] as const) ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({
    name, id: 'dsh-cloud', locale: 'dsh.cloud',
    inject: () => ({ hooks: { cloud: source.source }, open }),
  }, CloudEntry)), `cloud: ${name}`)
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
