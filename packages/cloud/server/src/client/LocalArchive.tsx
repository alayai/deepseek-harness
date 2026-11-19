/** Explicit Host-local reads, independent of cloud workspace and execution controls. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalReadRequest, LocalReadResult } from '../types.ts'
import css from './CloudPanel.module.css'
import type { BotExportPreview, BotSyncRecord, BotSyncStatus } from './bot-sync.ts'
import type { CloudKey } from './locales.ts'

interface LocalArchiveProps extends PropsLocale<'dsh.cloud'> {
  epoch: number
  cloudAvailable: boolean
  read(this: void, input: LocalReadRequest): Promise<LocalReadResult>
  previewBot?(this: void, botId: string): Promise<BotExportPreview>
  exportBot?(this: void, botId: string, preview: BotExportPreview): Promise<BotSyncRecord>
  openCloud(this: void): void
}
const statusKey = {
  synced: 'exportedBot', 'local-updated': 'localUpdateDetected', 'cloud-updated': 'cloudBotUpdated',
  archived: 'cloudBotArchived', unknown: 'cloudBotUnknown', pending: 'botExportPending',
} as const satisfies Record<Exclude<BotSyncStatus, 'new'>, CloudKey>

/** Read text on demand; closing the view or changing epoch discards pending results. */
export function LocalArchive({ t, epoch, read, previewBot, exportBot, openCloud, cloudAvailable }: LocalArchiveProps) {
  const [sessions, setSessions] = useState<Extract<LocalReadResult, { kind: 'sessions' }> | null>(null)
  const [messages, setMessages] = useState<Extract<LocalReadResult, { kind: 'messages' }> | null>(null)
  const [bots, setBots] = useState<Extract<LocalReadResult, { kind: 'bots' }> | null>(null)
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [exportFailed, setExportFailed] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<Map<string, BotSyncStatus>>(new Map())
  const [preview, setPreview] = useState<{ botId: string; value: BotExportPreview } | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const reconcile = async (items: Extract<LocalReadResult, { kind: 'bots' }>['items'], id: number) => {
    if (previewBot === undefined) return
    // Sequential full-definition reads keep a large roster from flooding the Host or server.
    for (const bot of items) {
      if (generation.current !== id) return
      if (bot.private) continue
      try {
        const value = await previewBot(bot.id)
        if (generation.current !== id) return
        setSyncState(previous => new Map(previous).set(bot.id, value.status))
      } catch { if (generation.current === id) setSyncState(previous => new Map(previous).set(bot.id, 'unknown')) }
    }
  }
  const load = (input: LocalReadRequest) => () => {
    if (busy || exporting !== null) return
    const id = ++generation.current
    if (input.kind === 'messages') setMessages(null)
    setBusy(true); setFailed(false); setExportFailed(false)
    void read(input).then((value) => {
      if (generation.current !== id) return
      switch (value.kind) {
        case 'sessions': setSessions(value); setMessages(null); break
        case 'messages': setMessages(value); break
        case 'bots': setBots(value); setPreview(null); setSyncState(new Map()); void reconcile(value.items, id); break
      }
    }).catch(() => { if (generation.current === id) setFailed(true) })
      .finally(() => { if (generation.current === id) setBusy(false) })
  }
  const previewOne = (botId: string) => () => {
    if (previewBot === undefined || exporting !== null) return
    const id = ++generation.current
    setExporting(botId); setFailed(false); setExportFailed(false)
    void previewBot(botId).then((value) => {
      if (generation.current !== id) return
      setSyncState(previous => new Map(previous).set(botId, value.status))
      setPreview({ botId, value })
    }).catch(() => { if (generation.current === id) setExportFailed(true) })
      .finally(() => { if (generation.current === id) setExporting(null) })
  }
  const confirmExport = () => {
    if (preview === null || exportBot === undefined || exporting !== null || !cloudAvailable || !['new', 'local-updated', 'pending'].includes(preview.value.status)) return
    const { botId, value } = preview
    const id = ++generation.current
    setExporting(botId); setExportFailed(false)
    void exportBot(botId, value).then(() => {
      if (generation.current !== id) return
      setSyncState(previous => new Map(previous).set(botId, 'synced'))
      setPreview(null)
    }).catch(() => { if (generation.current === id) setExportFailed(true) })
      .finally(() => { if (generation.current === id) setExporting(null) })
  }
  return <details className={css.section} data-local-archive>
    <summary>{t('localArchive')}</summary>
    <p className={css.notice}>{t('localReadHint')}</p>
    <div className={css.group}>
      <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'sessions', epoch, offset: 0 })}>{t('localSessions')}</Button>
      <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'bots', epoch, offset: 0 })}>{t('localBots')}</Button>
      <Button variant="outline" disabled={!cloudAvailable} onClick={openCloud}>{t('openCloudConversation')}</Button>
    </div>
    <p role="status" className={failed || exportFailed ? css.error : css.notice}>{exportFailed ? t('exportFailed') : failed ? t('localReadFailed') : busy ? t('waiting') : t('readOnly')}</p>
    {preview !== null && <section className={css.notice} aria-label={t('exportPreview')}>
      <div><strong>{t('exportPreview')}</strong><p>{preview.value.definition.name} · {preview.value.definition.role}</p>
        <p className={css.notice}>{
          `${preview.value.source.localBotId} · export v${preview.value.source.exportVersion} · ${preview.value.source.exportedAt} · ${preview.value.source.contentSha256.slice(0, 16)}…`
        }</p>
        {preview.value.sync !== undefined && <p>{preview.value.sync.cloudBotId} · r{preview.value.sync.cloudRevision}</p>}
        {preview.value.status !== 'new' && <p className={css.notice}>{t(statusKey[preview.value.status])}</p>}
        <pre className={css.output}>{preview.value.definition.instructions}</pre><p>{t('exportPreviewBoundary')}</p></div>
      <div className={css.group}><Button variant="primary" disabled={exporting !== null || !cloudAvailable || !['new', 'local-updated', 'pending'].includes(preview.value.status)} onClick={confirmExport}>{exporting === preview.botId ? t('waiting') : preview.value.status === 'pending' ? t('retryBotExport') : preview.value.sync === undefined ? t('confirmExport') : t('confirmRevision')}</Button><Button variant="outline" disabled={exporting !== null} onClick={() => setPreview(null)}>{t('cancelExport')}</Button></div>
    </section>}
    {sessions !== null && <section aria-label={t('localSessions')}>
      {sessions.items.length === 0 && <p>{t('empty')}</p>}
      {sessions.items.map(item => <div className={css.row} key={item.id}>
        <span>{item.id} · {new Date(item.createdAt).toLocaleString()}</span>
        <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'messages', epoch, sessionId: item.id, before: null })}>{t('viewLocalText')}</Button>
      </div>)}
      {sessions.nextOffset !== null && <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'sessions', epoch, offset: sessions.nextOffset })}>{t('nextPage')}</Button>}
    </section>}
    {messages !== null && <section aria-label={t('localMessages')}>
      <h3>{messages.sessionId}</h3>
      {messages.items.length === 0 && <p>{t('empty')}</p>}
      {messages.items.map(item => <article key={item.seq}>
        <h4>{t(item.role === 'user' ? 'localUser' : 'localAssistant')}</h4>
        <pre className={css.output}>{item.text}</pre>
        {item.truncated && <p className={css.notice}>{t('textTruncated')}</p>}
      </article>)}
      {messages.nextBefore !== null && <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'messages', epoch, sessionId: messages.sessionId, before: messages.nextBefore })}>{t('olderMessages')}</Button>}
    </section>}
    {bots !== null && <section aria-label={t('localBots')}>
      <p className={css.notice}>{t('exportHint')}</p>
      {!bots.available ? <p>{t('botProviderMissing')}</p> : !bots.ready ? <p>{t('botProviderLoading')}</p> : bots.items.length === 0 ? <p>{t('empty')}</p> : bots.items.map(bot => <article key={bot.id}>
        <h3>{bot.name}</h3><p className={css.notice}>{bot.role} · {bot.id}</p>
        {bot.private && <p className={css.notice}>{t('privateBot')}</p>}
        <details><summary>{t('localBotSettings')}</summary>
          <p className={css.notice}>{bot.model}</p><pre className={css.output}>{bot.instructions}</pre>
          {bot.truncated && <p className={css.notice}>{t('textTruncated')}</p>}
        </details>
        {bot.private ? <p className={css.notice}>{t('privateExportBlocked')}</p> : previewBot === undefined || exportBot === undefined ? <p className={css.notice}>{t('exportUnavailable')}</p> : <>
          {syncState.get(bot.id) !== undefined && syncState.get(bot.id) !== 'new' && <p className={css.notice}>{t(statusKey[syncState.get(bot.id) as Exclude<BotSyncStatus, 'new'>])}</p>}
          <Button variant="outline" disabled={exporting !== null || busy || !cloudAvailable} onClick={previewOne(bot.id)}>{exporting === bot.id ? t('waiting') : syncState.get(bot.id) === 'local-updated' ? t('publishRevision') : t('exportBot')}</Button>
        </>}
      </article>)}
      {bots.nextOffset !== null && <Button variant="outline" disabled={busy || exporting !== null} onClick={load({ kind: 'bots', epoch, offset: bots.nextOffset })}>{t('nextPage')}</Button>}
    </section>}
  </details>
}
