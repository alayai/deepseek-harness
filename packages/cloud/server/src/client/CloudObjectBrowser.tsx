import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { z } from 'zod'
import type { CloudRequest, CloudValue } from '../types.ts'
import { CloudRequestFailure } from './chat-turns.ts'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'

const id = z.uuid(), version = z.number().int().positive()
const folderRow = z.object({ id, name: z.string(), parentId: id.nullable(), version })
const objectRow = z.object({ id, filename: z.string(), folderId: id.nullable(), version })
const page = z.object({ items: z.array(objectRow), nextCursor: z.string().nullable() })
const fileName = z.string().trim().min(1).max(255).refine(s => !s.includes('/') && !s.includes('\\') && [...s].every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127))
type Folder = z.infer<typeof folderRow>
type Entry = { kind: 'folder' | 'object'; id: string; name: string; version: number }
type Edit = { action: 'create' | 'rename' | 'move' | 'remove' | 'restore'; row?: Entry }
type Notice = 'objectReadFailed' | 'objectChanged' | 'objectWriteUnknown' | 'objectWriteRejected' | 'objectNameInvalid' | 'objectSaved'
type Request = (path: string, method?: CloudRequest['method'], body?: CloudValue) => Promise<CloudValue>

interface Props extends PropsLocale<'dsh.cloud'> {
  base: string
  enabled: boolean
  revision: number
  selectFolder: (id: string | null) => void
  request: Request
  current: () => boolean
}

/** Browse Workspace storage and apply revision-bound file and folder changes. Remount on authority change. */
export function CloudObjectBrowser({ t, base, enabled, request, current, revision, selectFolder }: Props) {
  const [trail, setTrail] = useState<Folder[]>([]), [trash, setTrash] = useState(false)
  const parent = trail.at(-1)?.id ?? null
  const [folders, setFolders] = useState<Folder[]>([]), [objects, setObjects] = useState<z.infer<typeof objectRow>[]>([])
  const [cursor, setCursor] = useState<string | null>(null), [reload, refresh] = useState(0)
  const [pending, setPending] = useState(true), [write, setWrite] = useState(false), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(), [edit, setEdit] = useState<Edit>(), [name, setName] = useState('')
  const [destination, setDestination] = useState<Folder[]>([]), [choices, setChoices] = useState<Folder[]>([])
  const [picker, setPicker] = useState<'loading' | 'ready' | 'error'>('loading')
  const alive = useRef(false), action = useRef(false), generation = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const valid = () => alive.current && current()
  const listFolders = async (parentId: string | null) => {
    const rows = z.array(folderRow).parse(await request(`${base}/folders${parentId ? '?parentId=' + parentId : ''}`))
    if (rows.some(row => row.parentId !== parentId)) throw new Error('FOLDER_SCOPE_MISMATCH')
    return rows
  }
  const listObjects = async (after?: string) => {
    const params = new URLSearchParams({ status: trash ? 'deleted' : 'available', limit: '50' })
    if (!trash && parent) params.set('folderId', parent)
    if (!trash && !parent) params.set('rootOnly', 'true')
    if (after) params.set('cursor', after)
    const data = page.parse(await request(`${base}/objects?${params}`))
    if (after && data.nextCursor === after) throw new Error('OBJECT_CURSOR_REPEATED')
    return { items: trash ? data.items : data.items.filter(row => row.folderId === parent), nextCursor: data.nextCursor }
  }
  useEffect(() => {
    const sequence = ++generation.current
    const accepted = () => valid() && generation.current === sequence
    setPending(true); setCursor(null); setFolders([]); setObjects([]); setWrite(false)
    void Promise.all([trash ? Promise.resolve([]) : listFolders(parent), listObjects(), request(`${base}/access`)]).then(([folders, page, access]) => {
      if (!accepted()) return
      setWrite(z.object({ contentWrite: z.boolean() }).parse(access).contentWrite)
      setFolders(folders); setObjects(page.items); setCursor(page.nextCursor)
    }).catch(() => { if (accepted()) setNotice('objectReadFailed') })
      .finally(() => { if (accepted()) setPending(false) })
    return () => { generation.current++ }
  }, [parent, trash, reload, revision])

  const move = edit?.action === 'move', destinationId = destination.at(-1)?.id ?? null
  useEffect(() => {
    if (!move) return
    let live = true
    setPicker('loading'); setChoices([])
    void listFolders(destinationId).then((rows) => {
      if (live && valid()) { setChoices(rows.filter(row => !(edit?.row?.kind === 'folder' && row.id === edit.row.id))); setPicker('ready') }
    }).catch(() => { if (live && valid()) setPicker('error') })
    return () => { live = false }
  }, [move, destinationId, reload])

  const available = enabled && !pending && !busy, canWrite = available && write
  const browse = (next: Folder[], recycle = false) => {
    setEdit(undefined); setNotice(undefined); setTrail(next); setTrash(recycle); selectFolder(recycle ? null : next.at(-1)?.id ?? null)
  }
  const choose = (next: Edit) => {
    setNotice(undefined); setName(next.row?.name ?? ''); setDestination([]); setEdit(next)
  }
  const run = async (work: () => Promise<void>) => {
    if (!available || !valid() || action.current) return
    const sequence = generation.current
    action.current = true; setBusy(true); setNotice(undefined)
    try { await work() }
    finally { action.current = false; if (alive.current) setBusy(false) }
    return sequence
  }
  const submit = () => {
    if (!canWrite || !edit) return
    const { action, row } = edit
    const parsed = fileName.safeParse(name)
    if ((action === 'rename' || action === 'create') && !parsed.success) { setNotice('objectNameInvalid'); return }
    void run(async () => {
      const sequence = generation.current
      const path = row ? `${base}/${row.kind === 'folder' ? 'folders' : 'objects'}/${row.id}` : `${base}/folders`
      try {
        if (action === 'create' && parsed.success) await request(path, 'POST', { name: parsed.data, parentId: parent })
        if (row) {
          const expectedVersion = row.version
          if (action === 'rename' && parsed.success) await request(path, 'PATCH', { expectedVersion, [row.kind === 'folder' ? 'name' : 'filename']: parsed.data })
          if (action === 'move') await request(path, 'PATCH', { expectedVersion, [row.kind === 'folder' ? 'parentId' : 'folderId']: destinationId })
          if (action === 'remove') await request(path, 'DELETE', { expectedVersion })
          if (action === 'restore') await request(path + '/restore', 'POST', { expectedVersion })
        }
        if (valid() && generation.current === sequence) setNotice('objectSaved')
      } catch (e) {
        const code = e instanceof CloudRequestFailure ? e.message : ''
        const rejected = ['FOLDER_NOT_EMPTY', 'FOLDER_CYCLE', 'FOLDER_NOT_FOUND', 'OBJECT_NOT_FOUND', 'FORBIDDEN', 'WORKSPACE_ARCHIVED'].includes(code)
        if (valid() && generation.current === sequence) setNotice(code.endsWith('_VERSION_CONFLICT') ? 'objectChanged' : rejected ? 'objectWriteRejected' : 'objectWriteUnknown')
      }
      if (valid() && generation.current === sequence) { setEdit(undefined); refresh(n => n + 1) }
    })
  }
  const download = (object: Entry) => {
    void run(async () => {
      try {
        const { downloadUrl } = z.object({ downloadUrl: z.url() }).parse(await request(`${base}/objects/${object.id}/download`, 'POST'))
        const url = new URL(downloadUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_DOWNLOAD_URL')
        if (valid()) window.open(url.href, '_blank', 'noopener,noreferrer')
      } catch { if (valid()) setNotice('objectReadFailed') }
    })
  }
  const more = () => {
    if (!cursor) return
    void run(async () => {
      const sequence = generation.current
      try {
        const next = await listObjects(cursor)
        if (!valid() || generation.current !== sequence) return
        setCursor(next.nextCursor)
        setObjects(previous => [...new Map([...previous, ...next.items].map(item => [item.id, item])).values()])
      } catch { if (valid() && generation.current === sequence) setNotice('objectReadFailed') }
    })
  }
  const rows: Entry[] = [...folders.map(row => ({ kind: 'folder' as const, ...row })),
    ...objects.map(row => ({ kind: 'object' as const, id: row.id, name: row.filename, version: row.version }))]
  return <div className={css.objectBrowser}>
    <div className={css.group}>
      <Button size="sm" variant="outline" disabled={!enabled || busy} onClick={() => { browse([]) }}>{t('objectRoot')}</Button>
      <Button size="sm" variant="outline" disabled={!enabled || busy} onClick={() => { browse([], true) }}>{t('objectTrash')}</Button>
      <Button size="sm" variant="ghost" disabled={!enabled || busy} onClick={() => { setNotice(undefined); refresh(n => n + 1) }}>{t('retry')}</Button>
    </div>
    <nav aria-label={t('objectLocation')} className={css.group}>
      <bdi>{t(trash ? 'objectTrash' : 'objectRoot')}</bdi>
      {trail.map((folder, i) => <Button key={folder.id} size="sm" variant="ghost" disabled={!enabled || busy || i === trail.length - 1}
        onClick={() => { browse(trail.slice(0, i + 1)) }}>{folder.name}</Button>)}
      {!trash && canWrite && <Button size="sm" variant="outline" onClick={() => { choose({ action: 'create' }) }}>{t('objectCreateFolder')}</Button>}
    </nav>
    {notice && <div role={notice === 'objectSaved' ? 'status' : 'alert'}>{t(notice)}</div>}
    {pending ? <p role="status">{t('waiting')}</p> : !rows.length && !cursor && !notice && <p>{t('objectEmpty')}</p>}
    <ul className={css.objectRows}>{rows.map(row => <li key={`${row.kind}:${row.id}`}>
      {row.kind === 'folder' ? <Button size="sm" variant="ghost" disabled={!available} onClick={() => {
        const found = folders.find(folder => folder.id === row.id)
        if (found) browse([...trail, found])
      }}>{row.name}</Button> : <bdi>{row.name}</bdi>}
      <div className={css.group}>
        {!trash && row.kind === 'object' && <Button size="sm" variant="ghost" disabled={!available} onClick={() => { download(row) }}>{t('download')}</Button>}
        {canWrite && !trash && <>
          <Button size="sm" variant="ghost" onClick={() => { choose({ row, action: 'rename' }) }}>{t('objectRename')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { choose({ row, action: 'move' }) }}>{t('objectMove')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { choose({ row, action: 'remove' }) }}>{t(row.kind === 'folder' ? 'objectRemoveFolder' : 'objectToTrash')}</Button>
        </>}
        {canWrite && trash && <Button size="sm" variant="outline" onClick={() => { choose({ row, action: 'restore' }) }}>{t('objectRestore')}</Button>}
      </div>
    </li>)}</ul>
    {cursor && <Button variant="outline" size="sm" disabled={!available} onClick={more}>{t('objectMore')}</Button>}
    {edit && <form className={css.objectEdit} onSubmit={(event) => { event.preventDefault(); submit() }}>
      {edit.row && <bdi>{edit.row.name}</bdi>}
      {(edit.action === 'create' || edit.action === 'rename') && <label>{t('objectName')}
        <input value={name} maxLength={255} disabled={!canWrite} onChange={(event) => { setName(event.currentTarget.value) }} />
      </label>}
      {move && <div className={css.group}>
        <Button type="button" variant="outline" size="sm" disabled={!available || !destination.length} onClick={() => { setDestination(destination.slice(0, -1)) }}>{t('objectParent')}</Button>
        <bdi>{destination.at(-1)?.name ?? t('objectRoot')}</bdi>
        {picker === 'loading' && <span role="status">{t('waiting')}</span>}
        {picker === 'error' && <span role="alert">{t('objectReadFailed')}</span>}
        {choices.map(folder => <Button key={folder.id} size="sm" type="button" variant="ghost" disabled={!available}
          onClick={() => { setDestination([...destination, folder]) }}>{folder.name}</Button>)}
      </div>}
      <div className={css.group}>
        <Button type="submit" size="sm" variant="primary" disabled={!canWrite || (move && picker !== 'ready')}>{t('objectConfirm')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEdit(undefined) }}>{t('cancel')}</Button>
      </div>
    </form>}
  </div>
}
