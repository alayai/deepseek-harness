/** Browse and edit text inside one cloud sandbox through the Host connection. */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudRequest, CloudValue } from '../types.ts'
import { CloudRequestFailure } from './chat-turns.ts'
import css from './CloudFiles.module.css'
import type {} from './locales.ts'

const revision = z.string().regex(/^[a-f0-9]{64}$/)
const name = z.string().min(1).max(255).refine(value => !/[\/\u0000]/u.test(value) && value !== '.' && value !== '..')
const pageResult = z.object({
  path: z.string(),
  entries: z.array(z.object({ name, type: z.enum(['directory', 'file', 'symlink', 'other']) })).max(40),
  nextAfter: name.nullable(),
})
const readResult = z.object({ path: z.string(), content: z.string().max(21848), revision })
const receipt = z.object({ id: z.uuid(), runtimeId: z.uuid(), kind: z.literal('files') })
const operation = receipt.extend({
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'unknown']),
  errorCode: z.string().nullish(), result: z.object({ file: z.unknown().optional() }).loose().nullish(),
})
const rejected = new Set([
  'VALIDATION_ERROR', 'WORKER_UNAVAILABLE', 'SERVICE_NOT_ENABLED', 'RUNTIME_NOT_READY', 'QUEUE_FULL',
  'RUNTIME_NOT_FOUND', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_ARCHIVED', 'WORKSPACE_WRITE_REQUIRED',
])
type FilePage = z.infer<typeof pageResult>
type Document = { path: string; from: string; draft: string; revision: string; crlf: boolean }
type Pending = { key: string; id?: string; text: string }
type FileNotice = 'fileReadError' | 'fileUnsupported' | 'fileConflict' | 'filePending'
  | 'fileSaved' | 'fileSaveError' | 'fileTextOnly' | 'fileStopped'
type StoredFile = { document?: Document; pending?: Pending; notice?: FileNotice }

/** Editor state shared by the two cloud panels for this Client lifetime. */
export class CloudFileState {
  private readonly entries = new Map<string, StoredFile>()
  private readonly listeners = new Set<() => void>()

  /** Subscribe to editor changes.
   * @param listener - notify a mounted panel.
   * @returns the subscription disposer.
   */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read the immutable snapshot for one authenticated sandbox.
   * @param scope - deployment, account and runtime identity.
   * @returns the open document and pending save, when present.
   */
  read(scope: string): StoredFile | undefined { return this.entries.get(scope) }

  /** Publish a snapshot before issuing a save, or remove it when the editor closes.
   * @param scope - authenticated sandbox identity.
   * @param value - next editor state.
   */
  write(scope: string, value?: StoredFile): void {
    if (value === undefined) this.entries.delete(scope)
    else this.entries.set(scope, value)
    for (const listener of this.listeners) listener()
  }

  /** Release drafts on explicit logout or plugin unload. */
  clear(): void { this.entries.clear(); for (const listener of this.listeners) listener() }
}
type Props = PropsLocale<'dsh.cloud'> & {
  runtime: string
  runtimePath: string
  epoch: number
  scope: string
  state: CloudFileState
  enabled: boolean
  call: (request: CloudRequest) => Promise<CloudValue>
  beginRead: (path: string) => (result: CloudValue) => void
}

/** Resolve the current deployment and account before showing retained drafts.
 * @param props - selected runtime and epoch-bound cloud transport.
 * @returns the verified editor or its loading and retry controls.
 */
export function AuthenticatedCloudFiles(props: Props) {
  const { scope, epoch, call, t } = props
  const [identity, setIdentity] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [retry, refresh] = useState(0)
  useEffect(() => {
    let live = true
    const get = (path: string) => call({ epoch, path, method: 'GET', body: null, idempotencyKey: null })
    void Promise.all([get('/server-info'), get('/me')]).then(([info, me]) => {
      const { serverId } = z.object({ serverId: z.uuid() }).parse(info)
      const { id } = z.object({ id: z.uuid() }).parse(me)
      if (live) setIdentity(JSON.stringify([scope, serverId, id]))
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [scope, epoch, call, retry])
  if (identity) return <CloudFiles {...props} scope={identity} />
  return failed ? <div role="alert">{t('fileReadError')} <Button onClick={() => { setFailed(false); refresh(i => i + 1) }}>{t('retry')}</Button></div>
    : <p role="status">{t('waiting')}</p>
}

/** Browse files and reconcile explicit saves without repeating the write.
 * @param props - verified sandbox identity, Host RPC and publication source.
 * @returns the file navigation and editing controls.
 */
export function CloudFiles({ t, runtime, runtimePath, epoch, enabled, scope, state, call, beginRead }: Props) {
  const stored = useSyncExternalStore(state.subscribe, () => state.read(scope))
  const { document, pending } = stored ?? {}
  const [directory, setDirectory] = useState<FilePage>()
  const [readNotice, setNotice] = useState<FileNotice>()
  const notice = document ? stored?.notice ?? (pending ? 'filePending' : readNotice) : readNotice
  const [busy, setBusy] = useState(false)
  const [discard, confirmDiscard] = useState(false)
  const live = useRef(false), running = useRef(false)
  const dirty = document !== undefined && document.draft !== document.from
  const path = directory?.path ?? '.'
  const bytes = document === undefined ? new Uint8Array()
    : new TextEncoder().encode(document.crlf ? document.draft.replaceAll('\n', '\r\n') : document.draft)
  const tooLarge = bytes.length > 16384
  useLayoutEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const request = (path: string, method: 'POST' | 'GET', body: CloudValue = null, key: string | null = null) =>
    call({ epoch, path, method, body, idempotencyKey: key })
  const accept = (value: CloudValue) => {
    const parsed = receipt.parse(value)
    if (parsed.runtimeId !== runtime) throw Error('FILE_OPERATION_SCOPE_MISMATCH')
    return parsed.id
  }
  const submit = async (input: CloudValue, key: string) => accept(await request(runtimePath + '/files', 'POST', input, key))
  const readOperation = async (id: string) => {
    for (let index = 0; index < 30 && live.current; index++) {
      const raw = await request(runtimePath + '/operations/' + id, 'GET')
      const result = operation.parse(raw)
      if (result.id !== id || result.runtimeId !== runtime) throw Error('FILE_OPERATION_SCOPE_MISMATCH')
      if (result.state !== 'queued' && result.state !== 'running') return { raw, result }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw Error('FILE_OPERATION_PENDING')
  }

  const run = (work: () => Promise<void>, fallback: FileNotice) => {
    if (!enabled || running.current) return
    running.current = true
    setBusy(true)
    setNotice(undefined)
    void work().catch((error: unknown) => {
      if (!live.current) return
      const code = error instanceof CloudRequestFailure ? error.message : undefined
      setNotice(code === 'VALIDATION_ERROR' || code === 'INVALID_ACTION' ? 'fileUnsupported' : fallback)
    }).finally(() => {
      running.current = false
      if (live.current) setBusy(false)
    })
  }

  const list = (target: string, after: string | null = null) => {
    run(async () => {
      const id = await submit({ action: 'listPage', path: target, after }, randomUUID())
      const { result } = await readOperation(id)
      if (result.state !== 'succeeded') throw new CloudRequestFailure(result.errorCode ?? 'FILE_LIST_FAILED')
      const page = pageResult.parse(result.result?.file)
      if (page.path !== target || (page.nextAfter !== null && page.nextAfter !== page.entries.at(-1)?.name)) {
        throw Error('INVALID_FILE_PAGE')
      }
      if (live.current) setDirectory(page)
    }, 'fileReadError')
  }

  const open = (target: string) => {
    run(async () => {
      const onRead = beginRead(target)
      const id = await submit({ action: 'read', path: target }, randomUUID())
      const { raw, result } = await readOperation(id)
      if (result.state !== 'succeeded') throw new CloudRequestFailure(result.errorCode ?? 'FILE_READ_FAILED')
      if (!live.current) return
      z.object({ path: z.literal(target), content: z.string().max(21848) }).parse(result.result?.file)
      onRead(raw)
      const parsed = readResult.safeParse(result.result?.file)
      if (!parsed.success) { setNotice('fileUnsupported'); return }
      let text: string
      try {
        const bytes = Uint8Array.from(atob(parsed.data.content), char => char.charCodeAt(0))
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      } catch { setNotice('fileTextOnly'); return }
      const crlf = text.includes('\r\n')
      const source = text.replaceAll('\r\n', '\n')
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\r]/u.test(source)
        || (crlf && /(?<!\r)\n/u.test(text))) {
        setNotice('fileTextOnly')
        return
      }
      state.write(scope, { document: { path: target, from: source, draft: source, revision: parsed.data.revision, crlf } })
    }, 'fileReadError')
  }

  const settleSave = async (current: Document, attempt: Pending, id: string) => {
    const { result } = await readOperation(id)
    if (!live.current) return
    if (state.read(scope)?.pending?.key !== attempt.key) return
    if (result.state === 'unknown') { setNotice('filePending'); return }
    if (result.state === 'timed_out' || result.state === 'cancelled') {
      state.write(scope, { document: current, notice: 'fileStopped' })
      return
    }
    if (result.state === 'failed') {
      state.write(scope, { document: current, notice: result.errorCode === 'FILE_REVISION_CONFLICT' ? 'fileConflict'
        : result.errorCode === 'INVALID_ACTION' ? 'fileUnsupported' : 'fileSaveError' })
      return
    }
    const updated = z.object({ path: z.literal(current.path), revision }).parse(result.result?.file)
    state.write(scope, { document: { ...current, from: attempt.text, revision: updated.revision }, notice: 'fileSaved' })
  }

  const save = () => {
    if (!document || !dirty || tooLarge || state.read(scope)?.pending || notice === 'fileConflict' || notice === 'fileStopped') return
    run(async () => {
      const attempt = { key: randomUUID(), text: document.draft }
      confirmDiscard(false)
      state.write(scope, { document, pending: attempt })
      let id: string
      try {
        id = await submit({ action: 'replace', path: document.path, expectedRevision: document.revision,
          content: btoa(String.fromCharCode(...bytes)) }, attempt.key)
      } catch (error) {
        if (state.read(scope)?.pending?.key === attempt.key && error instanceof CloudRequestFailure && rejected.has(error.message)) {
          state.write(scope, { document, notice: error.message === 'VALIDATION_ERROR' ? 'fileUnsupported' : 'fileSaveError' })
          return
        }
        throw error
      }
      if (state.read(scope)?.pending?.key !== attempt.key) return
      state.write(scope, { document, pending: { ...attempt, id } })
      if (live.current) await settleSave(document, attempt, id)
    }, 'filePending')
  }

  const recover = () => {
    if (!document || !pending) return
    run(async () => {
      const raw = pending.id === undefined
        ? await request(runtimePath + '/file-receipts?key=' + pending.key, 'GET') : undefined
      if (!live.current || state.read(scope)?.pending?.key !== pending.key) return
      if (raw === null) { setNotice('filePending'); return }
      const id = pending.id ?? accept(raw ?? null)
      state.write(scope, { document, pending: { ...pending, id } })
      await settleSave(document, pending, id)
    }, 'filePending')
  }

  const close = () => {
    state.write(scope)
    setNotice(undefined)
    confirmDiscard(false)
  }

  return <div className={css.files} aria-busy={busy}>
    {document === undefined
      ? <>
        <div className={css.bar}>
          <span className={css.path} title={path}>{path === '.' ? t('fileRoot') : path}</span>
          {path !== '.' && <Button variant="ghost" size="sm" disabled={!enabled || busy}
            onClick={() => { list(path.split('/').slice(0, -1).join('/') || '.') }}>{t('fileParent')}</Button>}
          <Button size="sm" variant="outline" disabled={!enabled || busy}
            onClick={() => { list(path) }}>{t(directory ? 'fileRefresh' : 'list')}</Button>
        </div>
        {directory?.entries.length === 0 && <p className={css.note}>{t('fileEmpty')}</p>}
        {directory && directory.entries.length > 0 && <ul className={css.entries}>
          {directory.entries.map((entry) => {
            const target = path === '.' ? entry.name : path + '/' + entry.name
            return <li key={entry.name}>
              <Button size="sm" variant="ghost" className={css.entry}
                disabled={!enabled || busy || target.length > 512 || entry.name.includes('\\')
                  || (entry.type !== 'file' && entry.type !== 'directory')}
                onClick={() => { if (entry.type === 'directory') list(target); else open(target) }}>
                <span title={entry.name}>{entry.name}{entry.type === 'directory' && '/'}</span>
              </Button>
            </li>
          })}
        </ul>}
        {directory?.nextAfter && <Button size="sm" variant="outline" disabled={!enabled || busy}
          onClick={() => { list(path, directory.nextAfter) }}>{t('nextPage')}</Button>}
      </>
      : <>
        <div className={css.bar}>
          <span className={css.path} title={document.path}>{document.path}</span>
          <Button size="sm" variant="ghost" disabled={busy || pending !== undefined}
            onClick={() => { if (dirty) confirmDiscard(true); else close() }}>{t('fileBack')}</Button>
          <Button size="sm" variant="primary"
            disabled={!enabled || busy || !dirty || tooLarge || pending !== undefined || notice === 'fileConflict' || notice === 'fileStopped'}
            onClick={save}>{t('fileSave')}</Button>
        </div>
        <textarea className={css.editor} aria-label={t('fileEditor')} spellCheck={false}
          value={document.draft} readOnly={!enabled || busy || pending !== undefined} maxLength={16384}
          onChange={(event) => { state.write(scope, { ...stored, document: { ...document, draft: event.target.value } }) }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              save()
            }
          }} />
        {tooLarge && <p className={css.note} role="alert">{t('fileTooLarge')}</p>}
        {discard && !busy && !pending && <div className={css.note} role="group" aria-label={t('fileDiscard')}>
          <Button size="sm" variant="outline" onClick={close}>{t('fileDiscard')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { confirmDiscard(false) }}>{t('cancel')}</Button>
        </div>}
      </>}
    {busy && <p className={css.note} role="status">{t('waiting')}</p>}
    {notice && <p className={css.note} role={notice === 'fileSaved' ? 'status' : 'alert'}>{t(notice)}</p>}
    {pending && !busy && <div className={css.bar}>
      <code className={css.path} title={pending.id ?? pending.key}>{pending.id ?? pending.key}</code>
      <Button size="sm" variant="outline" disabled={!enabled} onClick={recover}>{t('fileCheckSave')}</Button>
    </div>}
  </div>
}
