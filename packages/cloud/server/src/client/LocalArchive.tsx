/** Explicit Host-local reads, independent of cloud workspace and execution controls. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalReadRequest, LocalReadResult } from '../types.ts'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'

interface LocalArchiveProps extends PropsLocale<'dsh.cloud'> {
  epoch: number
  cloudAvailable: boolean
  read(this: void, input: LocalReadRequest): Promise<LocalReadResult>
  openCloud(this: void): void
}

/** Read text on demand; closing the view or changing epoch discards pending results. */
export function LocalArchive({ t, epoch, read, openCloud, cloudAvailable }: LocalArchiveProps) {
  const [sessions, setSessions] = useState<Extract<LocalReadResult, { kind: 'sessions' }> | null>(null)
  const [messages, setMessages] = useState<Extract<LocalReadResult, { kind: 'messages' }> | null>(null)
  const [bots, setBots] = useState<Extract<LocalReadResult, { kind: 'bots' }> | null>(null)
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const load = (input: LocalReadRequest) => () => {
    const id = ++generation.current
    if (input.kind === 'messages') setMessages(null)
    setBusy(true); setFailed(false)
    void read(input).then((value) => {
      if (generation.current !== id) return
      switch (value.kind) {
        case 'sessions': setSessions(value); setMessages(null); break
        case 'messages': setMessages(value); break
        case 'bots': setBots(value); break
      }
    }).catch(() => { if (generation.current === id) setFailed(true) })
      .finally(() => { if (generation.current === id) setBusy(false) })
  }
  return <details className={css.section} data-local-archive>
    <summary>{t('localArchive')}</summary>
    <p className={css.notice}>{t('localReadHint')}</p>
    <div className={css.group}>
      <Button variant="outline" disabled={busy} onClick={load({ kind: 'sessions', epoch, offset: 0 })}>{t('localSessions')}</Button>
      <Button variant="outline" disabled={busy} onClick={load({ kind: 'bots', epoch, offset: 0 })}>{t('localBots')}</Button>
      <Button variant="outline" disabled={!cloudAvailable} onClick={openCloud}>{t('openCloudConversation')}</Button>
    </div>
    <p role="status" className={failed ? css.error : css.notice}>{failed ? t('localReadFailed') : busy ? t('waiting') : t('readOnly')}</p>
    {sessions !== null && <section aria-label={t('localSessions')}>
      {sessions.items.length === 0 && <p>{t('empty')}</p>}
      {sessions.items.map(item => <div className={css.row} key={item.id}>
        <span>{item.id} · {new Date(item.createdAt).toLocaleString()}</span>
        <Button variant="outline" disabled={busy} onClick={load({ kind: 'messages', epoch, sessionId: item.id, before: null })}>{t('viewLocalText')}</Button>
      </div>)}
      {sessions.nextOffset !== null && <Button variant="outline" disabled={busy} onClick={load({ kind: 'sessions', epoch, offset: sessions.nextOffset })}>{t('nextPage')}</Button>}
    </section>}
    {messages !== null && <section aria-label={t('localMessages')}>
      <h3>{messages.sessionId}</h3>
      {messages.items.length === 0 && <p>{t('empty')}</p>}
      {messages.items.map(item => <article key={item.seq}>
        <h4>{t(item.role === 'user' ? 'localUser' : 'localAssistant')}</h4>
        <pre className={css.output}>{item.text}</pre>
        {item.truncated && <p className={css.notice}>{t('textTruncated')}</p>}
      </article>)}
      {messages.nextBefore !== null && <Button variant="outline" disabled={busy} onClick={load({ kind: 'messages', epoch, sessionId: messages.sessionId, before: messages.nextBefore })}>{t('olderMessages')}</Button>}
    </section>}
    {bots !== null && <section aria-label={t('localBots')}>
      {!bots.available ? <p>{t('botProviderMissing')}</p> : !bots.ready ? <p>{t('botProviderLoading')}</p> : bots.items.length === 0 ? <p>{t('empty')}</p> : bots.items.map(bot => <article key={bot.id}>
        <h3>{bot.name}</h3><p className={css.notice}>{bot.role} · {bot.id}</p>
        {bot.private && <p className={css.notice}>{t('privateBot')}</p>}
        <details><summary>{t('localBotSettings')}</summary>
          <p className={css.notice}>{bot.model}</p><pre className={css.output}>{bot.instructions}</pre>
          {bot.truncated && <p className={css.notice}>{t('textTruncated')}</p>}
        </details>
      </article>)}
      {bots.nextOffset !== null && <Button variant="outline" disabled={busy} onClick={load({ kind: 'bots', epoch, offset: bots.nextOffset })}>{t('nextPage')}</Button>}
    </section>}
  </details>
}
