/** The main conversation slot for the Host-selected cloud target. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import {
  Button, ComposerSurface, IconChevronDownOutlineRegular, IconGlobeOutlineRegular, IconRefreshOutlineRegular,
  IconSendOutlineRegular, IconStopFillRegular, observeComposition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudSource } from './source.ts'
import type { CloudPanelInjected } from './CloudPanel.tsx'
import type { CloudViewStore } from './view-store.ts'
import type { CloudSessionReplay } from './session-replay.ts'
import { CloudSessionTimeline } from './CloudSessionTimeline.tsx'
import { CloudBotRevision } from './CloudBotRevision.tsx'
import type { BotIdentity, BotPresentation } from './bot-presentation.ts'
import { readSessionPage, readWorkspaceBots, Session, type SessionDirectory, type WorkspaceBot } from './bot-directory.ts'
import { CloudSessionAdapter } from './cloud-session-adapter.ts'
import type { CloudBinding } from './binding.ts'
import { settled, type CloudChatTurns } from './chat-turns.ts'
import { projectCloudSessionEvents } from './session-events.ts'
import css from './CloudChat.module.css'
import type {} from './locales.ts'

export interface CloudChatInjected {
  hooks: { cloud: CloudSource; view: CloudViewStore }
  cloudSource: CloudSource
  viewSource: CloudViewStore
  replay: CloudSessionReplay
  turns: CloudChatTurns
  openResources(): void
  openFiles?(runtime: string): void
  call: CloudPanelInjected['call']
}

type CloudChatProps = PropsLocale<'dsh.cloud'> & InjectFace<CloudChatInjected> & BotPresentation
const Identity = z.object({ id: z.uuid() })
const Deployment = z.object({ serverId: z.uuid() })
const Workspace = z.object({ id: z.uuid(), name: z.string() })
type Directory = {
  serverId: string
  userId: string
  workspaceName: string
  page: SessionDirectory
  extra?: z.infer<typeof Session> | undefined
  bots: WorkspaceBot[]
}
type Request = (path: string) => ReturnType<CloudChatInjected['call']>

/** Route around the local Session provider while preserving the native main panel. */
export function CloudChat({
  t, useCloud, useView, cloudSource, viewSource, replay, turns, call, openResources, openFiles, renderSlot,
}: CloudChatProps) {
  const snapshot = useCloud(value => value)
  const { tenant, workspace, session, botFilter, botListVersion } = useView(value => value)
  const active = snapshot.mode === 'cloud'
  const base = `/tenants/${tenant}/workspaces/${workspace}`
  const authorityKey = JSON.stringify([snapshot.serverUrl, snapshot.epoch, tenant, workspace])
  const directoryKey = JSON.stringify([authorityKey, botFilter])
  const [directory, setDirectory] = useState<{ key: string; version: string; data: Directory }>()
  const [paging, setPaging] = useState<'loading' | 'failed'>()
  const sequence = useRef(0)
  const [failed, setFailed] = useState<string>()
  const [native, setNative] = useState(true)
  const [revision, refresh] = useState(0)
  const version = JSON.stringify([directoryKey, revision, botListVersion])
  const request: Request = path => call({ epoch: snapshot.epoch, path, method: 'GET', body: null, idempotencyKey: null })
  const current = (sessionId?: string) => {
    const host = cloudSource.getSnapshot(), view = viewSource.getSnapshot()
    return host.mode === 'cloud' && host.serverUrl === snapshot.serverUrl && host.epoch === snapshot.epoch
      && view.tenant === tenant && view.workspace === workspace && (sessionId === undefined || view.session === sessionId)
  }

  useEffect(() => {
    if (!active || !tenant || !workspace) return
    let live = true
    const valid = () => live && current(session) && viewSource.getSnapshot().botFilter === botFilter
    setPaging(undefined)
    setFailed(undefined)
    void (async () => {
      try {
        const [server, user, list, bots, meta] = await Promise.all([
          request('/server-info'), request('/me'), directory?.version === version ? directory.data.page : readSessionPage(base, request, botFilter),
          readWorkspaceBots(base, request, valid).catch(() => []), request(base).catch(() => null),
        ])
        const { serverId } = Deployment.parse(server), { id: userId } = Identity.parse(user)
        let extra: z.infer<typeof Session> | undefined
        if (session && !list.items.some(item => item.id === session) && valid()) {
          extra = Session.parse(await request(base + '/sessions/' + session))
          if (extra.id !== session) throw new Error('SESSION_IDENTITY_MISMATCH')
        }
        const parsed = Workspace.safeParse(meta)
        const workspaceName = parsed.success && parsed.data.id === workspace ? parsed.data.name : ''
        if (valid()) setDirectory({ key: authorityKey, version, data: { serverId, userId, page: list, extra, workspaceName, bots } })
      } catch {
        if (valid()) setFailed(authorityKey)
      }
    })()
    return () => { live = false; sequence.current++ }
  }, [active, version, session])

  const data = directory?.key === authorityKey ? directory.data : undefined
  const sessions = data?.page.items ?? []
  const selected = sessions.find(item => item.id === session) ?? (data?.extra?.id === session ? data.extra : undefined)
  const filteredSessions = (selected && !sessions.includes(selected) ? [...sessions, selected] : sessions)
    .filter(row => !botFilter || row.bot?.id === botFilter)
  const more = async () => {
    if (!data?.page.nextCursor || paging === 'loading' || directory?.version !== version) return
    const ticket = ++sequence.current
    const valid = () => sequence.current === ticket && current(session) && viewSource.getSnapshot().botFilter === botFilter
    setPaging('loading')
    try {
      const page = await readSessionPage(base, request, botFilter, data.page)
      if (valid()) {
        setDirectory(old => old?.data.page === data.page ? { ...old, data: { ...old.data, page } } : old)
        setPaging(undefined)
      }
    } catch { if (valid()) setPaging('failed') }
  }
  const cacheKey = JSON.stringify([authorityKey, data?.serverId, data?.userId, selected?.id])
  const reload = () => { refresh(value => value + 1) }
  const needsResources = !active || !tenant || !workspace || (data !== undefined && !selected)
  const speaker = selected?.bot ? { id: selected.bot.id, name: data?.bots.find(row => row.id === selected.bot?.id)?.name || t('chatBot') } : undefined
  const controls = <>
    <div className={css.context}>
      <span className={css.contextIcon}><IconGlobeOutlineRegular size={18} /></span>
      <div className={css.contextText}>
        <p title={data?.workspaceName || undefined}>{data?.workspaceName || t('title')}</p>
        {active && data && filteredSessions.length > 0
          ? <div className={css.sessionSelect}>
            <select aria-label={t('session')} value={selected?.id ?? ''} onChange={(event) => {
              viewSource.actions.resource('session', event.target.value)
            }}>
              <option value="">{t('chatChooseConversation')}</option>
              {filteredSessions.map(item => <option key={item.id} value={item.id}>{item.title || t('session')}</option>)}
            </select>
            <IconChevronDownOutlineRegular size={12} />
          </div>
          : <h2>{t('session')}</h2>}
      </div>
    </div>
    <div className={css.topActions}>
      {active && data?.page.nextCursor && <Button size="sm" disabled={paging === 'loading' || directory?.version !== version} onClick={() => { void more() }}>{t('moreSessions')}</Button>}
      {active && paging === 'failed' && <span role="alert">{t('sessionPageFailed')}</span>}
      {active && data?.page.truncated && <span>{t('legacySessions')}</span>}
      {active && data && data.bots.length > 0 && <label className={css.botSelect}>{t('chatBotList')}<select aria-label={t('chatBotList')} value={botFilter} onChange={(event) => {
        const id = event.target.value
        viewSource.actions.filterBot(id, id && selected?.bot?.id !== id ? '' : session)
      }}>
        <option value="">{t('choose')}</option>
        {data.bots.filter(item => item.state === 'active').map(item => <option key={item.id} value={item.id}>{item.name} · v{item.latestRevision}</option>)}
      </select></label>}
      {active && tenant && workspace && <Button size="sm" className={css.iconButton} aria-label={t('chatRefresh')} title={t('chatRefresh')} onClick={reload}>
        <IconRefreshOutlineRegular size={16} />
      </Button>}
      <Button size="sm" variant="outline" onClick={openResources}>{t('chatResources')}</Button>
    </div>
  </>
  const header = <header className={css.topBar}>{controls}
    {active && selected && <Button size="sm" variant="ghost" aria-pressed={native} onClick={() => { setNative(value => !value) }}>{t('chatNativeView')}</Button>}
  </header>
  return <section className={css.chat} data-cloud-conversation aria-label={t('session')}>
    {renderSlot?.('dsh.cloud.bot.header', { bot: speaker, title: selected?.title || data?.workspaceName || t('session'),
      controls, resourcesLabel: t('chatResources'), openResources }, { fallback: header }) ?? header}
    {active && tenant && workspace && failed === authorityKey && !data
      ? <ChatEmpty title={t('chatReadFailed')} action={t('retry')} onAction={reload} alert />
      : needsResources
        ? <ChatEmpty
          title={t(!active ? snapshot.mode === 'local' ? 'checkingMode' : snapshot.mode : 'chatChooseConversation')}
          description={t(!active ? 'localBlocked' : !workspace ? 'chooseWorkspace' : 'chatSelectSession')}
          action={t(!active ? 'connection' : 'chatResources')} onAction={openResources}
        />
        : !data && <div className={css.loading} role="status"><span aria-hidden="true" className={css.spinner} />{t('chatLoading')}</div>}
    {active && data && failed === authorityKey && <div className={css.directoryFailure} role="alert">
      {t('chatReadFailed')} <Button size="sm" onClick={reload}>{t('retry')}</Button>
    </div>}
    {active && data && selected && <Conversation key={cacheKey} t={t}
      scope={JSON.stringify([snapshot.serverUrl, data.serverId, data.userId, tenant, workspace, selected.id])}
      openFiles={openFiles} cacheKey={cacheKey} revision={revision} base={base} epoch={snapshot.epoch}
      replay={replay} turns={turns}
      current={() => current(session)} call={call} request={request} bot={selected.bot} native={native}
      speaker={speaker} presentation={renderSlot}
      identity={{ serverId: data.serverId, tenantId: tenant, workspaceId: workspace, sessionId: selected.id }} />}
  </section>
}

function ChatEmpty({ title, description, action, onAction, alert = false }: {
  title: string
  description?: string
  action?: string
  onAction?: () => void
  alert?: boolean
}) {
  return <div className={css.empty}>
    <div className={css.emptyIcon}><IconGlobeOutlineRegular size={24} /></div>
    <h2 role={alert ? 'alert' : undefined}>{title}</h2>
    {description && <p>{description}</p>}
    {action && <Button variant="outline" onClick={onAction}>{action}</Button>}
  </div>
}

interface ConversationProps extends PropsLocale<'dsh.cloud'> {
  openFiles: ((runtime: string) => void) | undefined
  scope: string
  cacheKey: string
  revision: number
  base: string
  epoch: number
  replay: CloudSessionReplay
  turns: CloudChatTurns
  current: () => boolean
  call: CloudChatInjected['call']
  request: Request
  bot: z.infer<typeof Session>['bot']
  identity: { serverId: string; tenantId: string; workspaceId: string; sessionId: string }
  native: boolean
  speaker: BotIdentity | undefined
  presentation: BotPresentation['renderSlot']
}

function Conversation({
  t, scope, cacheKey, revision, base, epoch, replay, turns, current: selected, call, request, bot, identity,
  openFiles, native, speaker, presentation,
}: ConversationProps) {
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const current = () => mounted.current && selected()
  const adapter = useMemo(() => new CloudSessionAdapter({ ...identity, scope, cacheKey, epoch, current, call }, replay, turns),
    [cacheKey, scope, epoch, call, replay, turns])
  useSyncExternalStore(turns.subscribe, turns.getVersion)
  const [events, setEvents] = useState(() => adapter.snapshot().events)
  const items = useMemo(() => projectCloudSessionEvents(events), [events])
  const [draft, setDraft] = useState('')
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  const [binding, setBinding] = useState<CloudBinding>()
  const [readFailed, setReadFailed] = useState(false), [actionFailed, setActionFailed] = useState(false)
  const [checkingHistory, setCheckingHistory] = useState(true)
  const scroll = useRef<HTMLDivElement>(null), follow = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const composition = useRef<ReturnType<typeof observeComposition>>()
  useEffect(() => {
    if (!input.current) return
    const guard = observeComposition(input.current.ownerDocument)
    composition.current = guard
    return () => { guard.dispose(); composition.current = undefined }
  }, [])
  const attempt = adapter.attempt()
  const state = attempt?.operation?.state ?? attempt?.receipt?.state
  const busy = attempt?.state === 'checking' || attempt?.state === 'sending' || state === 'queued' || state === 'running'

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined
    const valid = () => live && current()
    let verifyTail = true
    const readEvents = async () => {
      for (let page = 0; page < 12 && valid(); page++) {
        const result = await adapter.next(valid, verifyTail)
        if (!result) return false
        verifyTail = false
        if (result.restarting) setCheckingHistory(true)
        const next = result.snapshot
        setEvents(previous => next.events.length === previous.length && next.events.at(-1) === previous.at(-1) ? previous : next.events)
        if (!result.full) return true
      }
      return false
    }
    let lastBindingRead = -Infinity
    const tick = async () => {
      if (!valid()) return
      try {
        // Read terminal state first, then drain committed events, including the final reply.
        if (Date.now() - lastBindingRead >= 8000) {
          const target = await adapter.binding()
          if (!valid()) return
          setBinding(target)
          lastBindingRead = Date.now()
        }
        // Keep the history visible even if an individual operation read fails.
        const operation = await adapter.poll().then(() => true, () => false)
        const drained = await readEvents()
        if (valid()) {
          setCheckingHistory(!drained)
          setReadFailed(!operation)
        }
      } catch {
        verifyTail = true
        if (valid()) setReadFailed(true)
      } finally {
        if (valid()) {
          const state = adapter.attempt()?.operation?.state
          timer = setTimeout(() => { void tick() }, settled(adapter.attempt()) || state === 'unknown' ? 2400 : 1100)
        }
      }
    }
    void tick()
    return () => { live = false; if (timer !== undefined) clearTimeout(timer) }
  }, [adapter, revision])

  useLayoutEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [events])

  const action = (run: () => Promise<void>) => {
    setActionFailed(false)
    void run().catch(() => { if (current()) setActionFailed(true) })
  }
  const send = () => {
    if (readFailed || checkingHistory || binding?.state !== 'active' || !draft.trim() || !settled(adapter.attempt())) return
    const message = draft
    action(async () => {
      await adapter.send(message, setBinding)
      const saved = adapter.attempt()
      if (current() && (saved?.state === 'accepted' && saved.submitted || saved?.state === 'unconfirmed')) {
        setDraft(value => value === message ? '' : value)
      }
    })
  }
  const busyText = t(attempt?.operation?.cancelRequested ? 'chatCancelling'
    : attempt?.cancelUnconfirmed ? 'chatCancelUnconfirmed' : 'chatRunning')
  const canSend = !!draft.trim() && settled(attempt) && !readFailed && !checkingHistory && binding?.state === 'active'
  const canCancel = state === 'queued' || state === 'running'
  const rejected = attempt?.state === 'rejected'
  const unknown = state === 'unknown' || (rejected && attempt.error === 'SESSION_OUTCOME_UNKNOWN')
  const unconfirmed = attempt?.state === 'unconfirmed'
  const replayShowsFailure = items.some(item => item.kind === 'error' && item.operationId === attempt?.receipt?.id)
  const notice = unknown ? t('chatUnknown')
    : unconfirmed ? t(attempt.receiptMissing ? 'chatReceiptMissing' : 'chatUnconfirmed')
      : readFailed || actionFailed || (rejected && attempt.error === 'BINDING_READ_FAILED') ? t('chatReadFailed')
        : binding?.state === 'disabled' ? t('chatPausedBinding')
          : rejected ? t('chatRejected')
            : state === 'failed' && !replayShowsFailure ? t('chatTurnError')
              : state === 'cancelled' ? t('chatCancelled') : state === 'timed_out' ? t('chatTimedOut') : ''
  return <>
    <div className={css.transcript}>
      <div className={css.scroll} ref={scroll} onScroll={(event) => {
        const el = event.currentTarget
        follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48
        setAwayFromLatest(!follow.current)
      }}>
        <div className={css.thread}>
          {adapter.snapshot().trimmed && <p role="status">{t('chatHistoryWindow')}</p>}
          {items.length ? <CloudSessionTimeline t={t} items={items} native={native} speaker={speaker} presentation={presentation} />
            : checkingHistory && !readFailed
              ? <div className={css.loading} role="status"><span aria-hidden="true" className={css.spinner} />{t('chatLoading')}</div>
              : readFailed
                ? <ChatEmpty title={t('chatReadFailed')} />
                : <ChatEmpty title={t('chatEmptyTitle')} description={t('chatEmpty')} />}
        </div>
      </div>
      {awayFromLatest && <Button size="sm" variant="outline" className={css.latest} onClick={() => {
        follow.current = true
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
        setAwayFromLatest(false)
      }} icon={<IconChevronDownOutlineRegular size={14} />}>{t('chatLatest')}</Button>}
    </div>
    <div className={css.dock}>
      {notice && <div className={css.notice} role={unknown || rejected || readFailed || actionFailed ? 'alert' : 'status'}>
        <span>{notice}</span>
        {(unknown || unconfirmed) && (attempt?.reference?.key || attempt?.receipt?.id) && <details>
          <summary>{t('chatReference')}</summary>
          <code>{attempt.reference?.key || attempt.receipt?.id}</code>
        </details>}
        {unconfirmed && <Button size="sm" variant="outline" disabled={attempt.recovering}
          onClick={() => { action(() => adapter.recover()) }}>{t('chatRecover')}</Button>}
      </div>}
      {bot && <CloudBotRevision key={bot.id + ':' + bot.revision} t={t} bot={bot} base={base} current={current} request={request} />}
      <form onSubmit={(event) => { event.preventDefault(); send() }}>
        <ComposerSurface data-cloud-composer className={native ? `${css.composer} ${css.nativeComposer}` : css.composer}>
          <textarea ref={input} aria-label={t('prompt')} placeholder={t('chatPlaceholder')} rows={2}
            value={draft} maxLength={16000} onChange={(event) => { setDraft(event.target.value) }} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !(composition.current?.guards(event.nativeEvent) ?? event.nativeEvent.isComposing)) { event.preventDefault(); send() }
            }} />
          <div className={css.composerBar}>
            <div className={css.composerContext}>
              {busy ? <span role="status"><span aria-hidden="true" className={css.spinner} />{busyText}</span>
                : <span title={t('chatExecutionHint')}><IconGlobeOutlineRegular size={14} />{t('cloud')}</span>}
              {binding && openFiles && <Button size="sm" variant="ghost"
                onClick={() => { if (current()) openFiles(binding.runtimeId) }}>{t('chatFiles')}</Button>}
            </div>
            {canCancel
              ? <Button size="sm" variant="outline" className={css.actionButton} aria-label={t('cancel')} title={t('cancel')}
                disabled={attempt?.cancelling || attempt?.operation?.cancelRequested || attempt?.cancelUnconfirmed}
                onClick={() => { if (current()) action(() => adapter.poll(true)) }}>
                <IconStopFillRegular size={16} />
              </Button>
              : <Button size="sm" variant="primary" className={css.actionButton} type="submit"
                aria-label={t('send')} title={t('send')} disabled={!canSend}><IconSendOutlineRegular size={16} /></Button>}
          </div>
        </ComposerSurface>
      </form>
      <p className={css.keys}>{t('chatKeyboard')}</p>
    </div>
  </>
}
