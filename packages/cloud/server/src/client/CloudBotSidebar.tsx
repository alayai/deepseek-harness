import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconGlobeOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudChatInjected } from './CloudChat.tsx'
import { readSessionPage, readWorkspaceBots, Session, type WorkspaceBot } from './bot-directory.ts'
import { CloudRequestFailure } from './chat-turns.ts'
import css from './CloudPanel.module.css'

// Optional child slot declared by DS Bot inside its own resizable team column.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'bot.sidebar.directory': {
      kind: 'single'
      scope: 'root'
      owner: {
        wide: boolean
        toggleSidebar(): void
        didNavigate(): void
        renderDirectory?(data: BotDirectoryFace): ReactNode
      }
    }
  }
}
type Inputs = Pick<CloudChatInjected, 'hooks' | 'viewSource' | 'cloudSource' | 'call' | 'openResources'> & { openChat(): void }
interface BotDirectoryFace {
  scope: string
  title: string
  bots: WorkspaceBot[]
  selected: string
  busyId: string
  status: string
  error: string
  resourcesLabel: string
  resources(): void
  refresh: (() => void) | undefined
  choose(id: string): void
  create: (() => void) | undefined
}
type SidebarOwner = Pick<PropsRuntime<'bot.sidebar.directory'>, 'wide' | 'toggleSidebar' | 'didNavigate' | 'renderDirectory'>

/** Navigate cloud Bot bindings without starting a local Bot or posting a cloud turn. */
export function CloudBotSidebar({
  wide, toggleSidebar, didNavigate, renderDirectory, t, useCloud, useView,
  viewSource, cloudSource, call, openChat, openResources,
}: SidebarOwner & PropsLocale<'dsh.cloud'> & InjectFace<Inputs>) {
  const { mode, serverUrl, epoch } = useCloud(value => value)
  const { tenant, workspace, session, botFilter, botListVersion } = useView(value => value)
  const key = JSON.stringify([mode, serverUrl, epoch, tenant, workspace, botListVersion])
  const base = `/tenants/${tenant}/workspaces/${workspace}`
  const [directory, setDirectory] = useState<{ key: string; bots?: WorkspaceBot[] }>()
  const [opening, setOpening] = useState<{ key: string; id: string; failed?: 'legacySessions' | 'chatReadFailed' }>()
  const seq = useRef(0)
  const current = () => {
    const host = cloudSource.getSnapshot(), view = viewSource.getSnapshot()
    return host.mode === 'cloud' && host.epoch === epoch && host.serverUrl === serverUrl && view.tenant === tenant &&
      view.workspace === workspace && view.botListVersion === botListVersion
  }
  const get = (path: string) => call({ epoch, path, method: 'GET', body: null, idempotencyKey: null })
  useEffect(() => {
    let live = true
    const valid = () => live && current()
    if (mode === 'cloud' && tenant && workspace) void readWorkspaceBots(base, get, valid).then((bots) => {
      if (valid()) setDirectory({ key, bots })
    }).catch(() => { if (valid()) setDirectory({ key }) })
    return () => { live = false; seq.current++ }
  }, [key, call])
  const sessionKey = JSON.stringify([key, session])
  const [bound, setBound] = useState<{ key: string; id: string }>()
  useEffect(() => {
    if (botFilter || !session || !tenant || !workspace || mode !== 'cloud') return
    let live = true
    void get(base + '/sessions/' + session).then((value) => {
      const row = Session.parse(value)
      if (live && current() && row.id === session && viewSource.getSnapshot().session === session)
        setBound({ key: sessionKey, id: row.bot?.id ?? '' })
    }).catch(() => { if (live) setBound(undefined) })
    return () => { live = false }
  }, [sessionKey, botFilter, call])
  const selectedBot = botFilter || (bound?.key === sessionKey ? bound.id : '')
  const choose = async (id: string) => {
    if (!current()) return
    const ticket = ++seq.current, view = viewSource.getSnapshot()
    const valid = () => current() && ticket === seq.current && viewSource.getSnapshot().session === view.session &&
      viewSource.getSnapshot().botFilter === view.botFilter
    setOpening({ key, id })
    try {
      const page = await readSessionPage(base, get, id), rows = page.items
      if (!valid()) return
      let selected = rows.find(item => item.id === view.session)
      if (!selected && view.session) {
        try {
          selected = Session.parse(await get(base + '/sessions/' + view.session))
          if (selected.id !== view.session) throw Error('SESSION_IDENTITY_MISMATCH')
        } catch (error) {
          if (!(error instanceof CloudRequestFailure && error.message === 'SESSION_NOT_FOUND')) throw error
        }
      }
      if (!valid()) return
      const target = selected?.bot?.id === id ? selected.id : rows.find(item => item.bot?.id === id)?.id ?? ''
      if (!target && page.truncated) { setOpening({ key, id, failed: 'legacySessions' }); return }
      viewSource.actions.openBot(id, target)
      if (target) openChat(); else openResources()
      didNavigate()
    } catch { if (valid()) setOpening({ key, id, failed: 'chatReadFailed' }); return }
    finally { if (ticket === seq.current) setOpening(old => old?.failed ? old : undefined) }
  }
  const data = directory?.key === key ? directory : undefined
  const resources = () => { seq.current++; setOpening(undefined); openResources(); didNavigate() }
  if (renderDirectory) {
    const ready = mode === 'cloud' && !!tenant && !!workspace
    return <>{renderDirectory({ scope: JSON.stringify([mode, serverUrl, epoch, tenant, workspace]), title: t('chatBotList'), bots: ready ? data?.bots ?? [] : [], selected: selectedBot,
      busyId: opening?.key === key && !opening.failed ? opening.id : '',
      status: !ready ? t(mode === 'cloud' ? 'chooseWorkspace' : mode === 'local' ? 'checkingMode' : mode)
        : !data ? t('waiting') : data.bots?.length === 0 ? t('noCloudBots') : '',
      error: ready && data && !data.bots ? t('botDirectoryFailed') : opening?.key === key && opening.failed ? t(opening.failed) : '',
      resourcesLabel: t('chatResources'), resources, refresh: ready ? () => { viewSource.actions.refreshBots() } : undefined,
      create: ready && data?.bots ? () => { if (current()) { viewSource.actions.createBot(); resources() } } : undefined,
      choose: (id) => { void choose(id) },
    })}</>
  }
  return <nav className={css.sidebarBots} aria-label={t('chatBotList')}>
    <div className={css.row}>
      {wide && <strong>{t('chatBotList')}</strong>}
      <Button size="sm" variant="ghost" title={t('toggleBotSidebar')} aria-label={t('toggleBotSidebar')} onClick={toggleSidebar}>{wide ? '‹' : '›'}</Button>
    </div>
    {mode !== 'cloud' || !tenant || !workspace
      ? <>{wide && <p>{t(mode === 'cloud' ? 'chooseWorkspace' : mode === 'local' ? 'checkingMode' : mode)}</p>}
        <Button size="sm" variant="ghost" aria-label={t('chatResources')} onClick={resources}><IconGlobeOutlineRegular size={16} />{wide && t('chatResources')}</Button></>
      : <>
        <Button size="sm" variant="ghost" aria-label={t('refreshBotList')} title={t('refreshBotList')} onClick={() => { viewSource.actions.refreshBots() }}>
          <IconRefreshOutlineRegular size={16} />{wide && t('refreshBotList')}
        </Button>
        {!data ? <p role="status">{t('waiting')}</p> : !data.bots ? <p role="alert">{t('botDirectoryFailed')}</p>
          : data.bots.length === 0 ? <p>{t('noCloudBots')}</p> : data.bots.map(bot =>
            <button key={bot.id} type="button" className={css.sidebarBot} aria-label={bot.name} title={bot.name}
              aria-pressed={selectedBot === bot.id} aria-busy={opening?.key === key && opening.id === bot.id && !opening.failed}
              onClick={() => { void choose(bot.id) }}>
              <span aria-hidden="true">{Array.from(bot.name)[0]}</span>{wide && <><strong>{bot.name}</strong><small>v{bot.latestRevision}</small></>}
            </button>)}
        {opening?.key === key && opening.failed && <p role="alert">{t(opening.failed)}</p>}
        <Button size="sm" variant="outline" aria-label={t('chatResources')} onClick={resources}><IconGlobeOutlineRegular size={16} />{wide && t('chatResources')}</Button>
      </>}
  </nav>
}
