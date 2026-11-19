import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudValue } from '../types.ts'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'

type Attempt = { scope: string; operationId: string; runtimeId: string; filename: string; key: string; objectId?: string }
/** Client-lifetime publication receipts and unresolved request identities, without file bytes. */
export class CloudArtifactReceipts {
  readonly attempts: Attempt[] = []
  clear(): void { this.attempts.length = 0 }
}
function object(value: CloudValue): { [key: string]: CloudValue } { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
/** Explicit cloud file publication; unknown writes retain the same key for a user-directed retry. */
export function CloudArtifacts({ t, scope, result, receipts, enabled, call }: PropsLocale<'dsh.cloud'> & {
  scope: string
  result: CloudValue
  receipts: CloudArtifactReceipts
  enabled: boolean
  call(path: string, method: 'GET' | 'POST', body: CloudValue, key: string | null): Promise<CloudValue>
}) {
  const [filename, setFilename] = useState('report.txt'), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [, update] = useState(0)
  const active = useRef(scope); active.current = scope
  useEffect(() => () => { active.current = '' }, [])
  const op = object(result), file = object(object(op.result ?? null).file ?? null)
  const publishable = op.kind === 'files' && op.state === 'succeeded' && typeof file.content === 'string' && typeof op.id === 'string' && typeof op.runtimeId === 'string'
  const entries = receipts.attempts.filter(item => item.scope === scope)
  const pending = entries.find(item => !item.objectId)
  const run = async (attempt: Attempt) => {
    setBusy(true); setFailed(false)
    try {
      const answer = object(await call(`${scope}/runtimes/${attempt.runtimeId}/artifacts`, 'POST', { operationId: attempt.operationId, filename: attempt.filename, contentType: 'application/octet-stream' }, attempt.key))
      if (typeof answer.id !== 'string') throw Error('INVALID_ARTIFACT_RECEIPT')
      attempt.objectId = answer.id
      if (active.current === scope) update(value => value + 1)
    } catch { if (active.current === scope) setFailed(true) }
    finally { if (active.current === scope) setBusy(false) }
  }
  return <section className={css.section} aria-label={t('artifactTitle')}>
    <h3>{t('artifactTitle')}</h3><p className={css.notice}>{t('artifactHint')}</p>
    {failed && <p role="alert">{t('artifactFailed')}</p>}
    {publishable && !pending && !entries.some(item => item.operationId === op.id && item.objectId) && <div className={css.group}>
      <label className={css.field}>{t('artifactFilename')}<input value={filename} disabled={!enabled || busy} onChange={(event) => { setFilename(event.target.value) }} maxLength={255} /></label>
      <Button variant="outline" disabled={!enabled || busy || !filename || /[/\\\x00-\x1f\x7f]/.test(filename)} onClick={() => {
        if (receipts.attempts.length >= 50) { setFailed(true); return }
        const attempt = { scope, operationId: String(op.id), runtimeId: String(op.runtimeId), filename, key: randomUUID() }
        receipts.attempts.push(attempt); void run(attempt)
      }}>{t('artifactPublish')}</Button>
    </div>}
    {entries.map(attempt => <article className={css.artifact} key={attempt.key}>
      <p>{attempt.filename}</p><p className={css.notice}>{t('artifactSource')}: {attempt.operationId}</p>
      {!attempt.objectId ? <><p>{t('artifactUnknown')}</p><Button variant="outline" disabled={!enabled || busy} onClick={() => { void run(attempt) }}>{t('artifactRetry')}</Button></> : <Button variant="outline" disabled={!enabled || busy} onClick={() => {
        const popup = window.open('about:blank', '_blank')
        if (!popup) { setFailed(true); return }
        popup.opener = null
        setBusy(true); setFailed(false)
        void call(`${scope}/objects/${attempt.objectId}/download`, 'POST', null, null).then((data) => {
          const value = object(data); if (typeof value.downloadUrl !== 'string') throw Error('INVALID_DOWNLOAD_URL')
          const url = new URL(value.downloadUrl)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('INVALID_DOWNLOAD_URL')
          if (active.current === scope) popup.location.href = url.href
          else popup.close()
        }).catch(() => {
          popup.close()
          if (active.current === scope) setFailed(true)
        }).finally(() => { if (active.current === scope) setBusy(false) })
      }}>{t('download')}</Button>}
    </article>)}
  </section>
}
