/** Cloud workspace consumer. Every operation carries both login epoch and a captured Workspace path. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudRequest, CloudValue } from '../types.ts'
import type { CloudSource } from './source.ts'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'

export interface CloudPanelInjected {
  hooks: { cloud: CloudSource }
  login(server: string): Promise<void>
  logout(): Promise<void>
  call(input: CloudRequest): Promise<CloudValue>
}
export type CloudPanelProps = PropsRuntime<'shell.overlay'> & PropsLocale<'dsh.cloud'> & InjectFace<CloudPanelInjected>
type Row = { id: string; name: string; runtimeId: string }
function record(value: CloudValue): { [key: string]: CloudValue } { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function text(value: CloudValue | undefined): string { return typeof value === 'string' ? value : '' }
function rows(value: CloudValue): Row[] {
  const object = record(value), list = Array.isArray(value) ? value : object.items ?? object.resources ?? []
  return (Array.isArray(list) ? list : []).map((item) => {
    const row = record(item)
    return {
      id: text(row.id),
      name: text(row.name) || text(row.title) || text(row.filename) || text(row.model) || text(row.id),
      runtimeId: text(row.runtimeId),
    }
  })
}

/** Native client view using only Host RPC and explicitly selected RustFS transfers. */
export function CloudPanel({ t, useCloud, login, logout, call }: CloudPanelProps) {
  const snapshot = useCloud(value => value)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [server, setServer] = useState(snapshot.serverUrl)
  const [tenants, setTenants] = useState<Row[]>([]), [tenant, setTenant] = useState('')
  const [workspaces, setWorkspaces] = useState<Row[]>([]), [workspace, setWorkspace] = useState('')
  const [runtimes, setRuntimes] = useState<Row[]>([]), [runtime, setRuntime] = useState('')
  const [credentials, setCredentials] = useState<Row[]>([]), [credential, setCredential] = useState('')
  const [sessions, setSessions] = useState<Row[]>([]), [session, setSession] = useState('')
  const [desktops, setDesktops] = useState<Row[]>([]), [desktop, setDesktop] = useState('')
  const [objects, setObjects] = useState<Row[]>([]), [file, setFile] = useState<File | undefined>()
  const [name, setName] = useState(''), [slug, setSlug] = useState('')
  const [endpoint, setEndpoint] = useState('https://api.deepseek.com'), [model, setModel] = useState(''), [apiKey, setApiKey] = useState('')
  const [command, setCommand] = useState(''), [prompt, setPrompt] = useState(''), [path, setPath] = useState('.')
  const [content, setContent] = useState(''), [url, setUrl] = useState('about:blank'), [desktopText, setDesktopText] = useState('')
  const [result, setResult] = useState<CloudValue>(null), [events, setEvents] = useState<CloudValue[]>([]), [image, setImage] = useState('')
  const [operation, setOperation] = useState<{ path: string; id: string } | undefined>()
  const generation = useRef(0), popup = useRef<Window | null>(null), transfer = useRef<AbortController | undefined>(undefined)
  const active = useRef({ epoch: snapshot.epoch, workspace })
  active.current = { epoch: snapshot.epoch, workspace }
  const base = `/tenants/${tenant}/workspaces/${workspace}`, runtimePath = `${base}/runtimes/${runtime}`
  const usable = snapshot.mode === 'cloud' && !busy

  useEffect(() => { generation.current++; transfer.current?.abort(); setBusy(false); setFailed(false); setImage(''); setEvents([]) }, [snapshot.epoch, workspace])
  useEffect(() => { setResult(null); setOperation(undefined) }, [workspace])
  useEffect(() => { setRuntime(''); setRuntimes([]); setSession(''); setSessions([]); setCredentials([]); setCredential(''); setDesktops([]); setDesktop(''); setObjects([]) }, [snapshot.epoch, workspace])
  useEffect(() => { if (snapshot.mode === 'local') { setTenant(''); setTenants([]); setWorkspace(''); setWorkspaces([]) } }, [snapshot.mode])
  useEffect(() => {
    if (snapshot.authorizationUrl !== null && popup.current !== null) {
      popup.current.location.href = snapshot.authorizationUrl
      popup.current = null
    }
  }, [snapshot.authorizationUrl])
  useEffect(() => () => { generation.current++; transfer.current?.abort(); popup.current?.close() }, [])

  const request = (target: string, method: CloudRequest['method'] = 'GET', body: CloudValue = null, key: string | null = null) =>
    call({ epoch: snapshot.epoch, path: target, method, body, idempotencyKey: key })
  const task = (action: (current: () => boolean) => Promise<void>) => () => {
    void (async () => {
      const id = ++generation.current, epoch = snapshot.epoch, selected = workspace
      const current = () => generation.current === id && active.current.epoch === epoch && active.current.workspace === selected
      setBusy(true); setFailed(false)
      try { await action(current) } catch { if (current()) setFailed(true) }
      finally { if (current()) setBusy(false) }
    })()
  }
  const refresh = async (current: () => boolean) => {
    const values = await Promise.all(['/runtimes', '/model-credentials', '/sessions', '/desktops', '/objects'].map(suffix => request(base + suffix)))
    if (!current()) return
    setRuntimes(rows(values[0] ?? null)); setCredentials(rows(values[1] ?? null)); setSessions(rows(values[2] ?? null))
    setDesktops(rows(values[3] ?? null)); setObjects(rows(values[4] ?? null))
  }
  const queued = async (target: string, body: CloudValue, current: () => boolean, sessionId?: string) => {
    const key = randomUUID()
    // Keep the key visible even if the first write response is lost. Never replay automatically.
    setResult({ idempotencyKey: key, path: target })
    const accepted = record(await request(target, 'POST', body, key)), id = text(accepted.id)
    const pollBase = `${base}/runtimes/${text(accepted.runtimeId) || runtime}`
    if (!id) throw new Error('MISSING_OPERATION_ID')
    if (!current()) return
    setOperation({ path: pollBase, id }); setResult(accepted)
    let after = '0'
    if (sessionId !== undefined) setEvents([])
    const readEvents = async (): Promise<number> => {
      const page = record(await request(`${base}/sessions/${sessionId}/events?after=${after}`))
      if (!current()) return 0
      const items = Array.isArray(page.items) ? page.items : []
      const next = text(page.nextAfter)
      if (items.length > 0 && (!next || next === after)) throw new Error('INVALID_EVENT_CURSOR')
      after = next || after
      setEvents(previous => [...previous, ...items.map(item => record(item).event ?? null)].slice(-2000))
      return items.length
    }
    for (let count = 0; count < 660 && current(); count++) {
      if (sessionId !== undefined) await readEvents()
      const settled = record(await request(`${pollBase}/operations/${id}`))
      if (!current()) return
      setResult(settled)
      const output = record(settled.result ?? null)
      if (output.mimeType === 'image/png' && typeof output.data === 'string') setImage(`data:image/png;base64,${output.data}`)
      if (!['queued', 'running'].includes(text(settled.state))) {
        if (sessionId !== undefined) {
          // Drain committed terminal events before ending the replay.
          while (current() && await readEvents() === 100) { /* The next cursor belongs to readEvents. */ }
        }
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  const field = (label: string, value: string, update: (value: string) => void, type = 'text') => <label className={css.field}>{label}<input type={type} value={value} onChange={(event) =>{  update(event.target.value) }} disabled={!usable} /></label>
  const select = (label: string, value: string, update: (value: string) => void, items: Row[]) => <label className={css.field}>{label}<select aria-label={label} value={value} onChange={(event) =>{  update(event.target.value) }} disabled={!usable}><option value="">{t('choose')}</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  const button = (label: string, action: (current: () => boolean) => Promise<void>, enabled = true) => <Button variant="outline" disabled={!usable || !enabled} onClick={task(action)}>{label}</Button>
  const section = (label: string, children: ReactNode) => <section className={css.section}><h3>{label}</h3>{children}</section>
  const locked = snapshot.mode !== 'local'
  return <>
    <div className={css.entry}><Button variant="outline" onClick={() =>{  setOpen(true) }}>{t('title')} · {t(snapshot.mode)}</Button></div>
    <Modal open={open || locked} title={t('title')} closeLabel={t('close')} onClose={() => { if (!locked) setOpen(false) }} className={css.dialog ?? ''}>
      <div className={css.body}>
        <p className={css.notice}>{t('policy')}</p>
        <div className={css.group}>
          <label className={css.field}>{t('server')}<input data-modal-autofocus value={server} disabled={snapshot.mode === 'cloud' || snapshot.mode === 'authenticating'} onChange={(event) =>{  setServer(event.target.value) }} /></label>
          <Button variant="primary" disabled={snapshot.mode === 'cloud' || snapshot.mode === 'authenticating'} onClick={task(async () => {
            popup.current = window.open('about:blank', '_blank')
            if (popup.current !== null) popup.current.opener = null
            try { await login(server) } catch (error) { popup.current?.close(); popup.current = null; throw error }
          })}>{t('connect')}</Button>
          {locked && <Button variant="outline" onClick={task(async () => { await logout(); setOpen(false) })}>{t('logout')}</Button>}
        </div>
        {snapshot.authorizationUrl !== null && <a href={snapshot.authorizationUrl} target="_blank" rel="noopener noreferrer">{t('authorize')}</a>}
        <p role="status" className={`${css.notice} ${failed || snapshot.error !== null ? css.error : ''}`}>
          {failed ? t('failure') : snapshot.mode === 'cloud-suspended' ? t('localBlocked') : busy ? t('waiting') : t(snapshot.mode)}
        </p>
        {snapshot.mode === 'cloud' && <>
          {section(t('workspace'), <>
            <div className={css.group}>{button(t('retry'), async (current) => { const data = await request('/me/tenants'); if (current()) setTenants(rows(data)) })}
              {select(t('tenant'), tenant, (value) => { setTenant(value); setWorkspace(''); setWorkspaces([]) }, tenants)}
              {button(t('retry'), async (current) => { const data = await request(`/tenants/${tenant}/workspaces`); if (current()) setWorkspaces(rows(data)) }, !!tenant)}
              {select(t('workspace'), workspace, setWorkspace, workspaces)}</div>
            <div className={css.group}>{field(t('name'), name, setName)}{field(t('slug'), slug, setSlug)}
              {button(t('createTenant'), async (current) => { const data = await request('/tenants', 'POST', { name, slug }, randomUUID()); if (current()) setResult(data) }, !!name && !!slug)}
              {button(t('createWorkspace'), async (current) => { const data = await request(`/tenants/${tenant}/workspaces`, 'POST', { name, slug }, randomUUID()); if (current()) setResult(data) }, !!tenant && !!name && !!slug)}</div>
          </>)}
          {!!workspace && <>
            {section(t('runtime'), <div className={css.group}>{button(t('retry'), refresh)}
              {select(t('runtime'), runtime, setRuntime, runtimes)}
              {button(t('allocate'), async (current) => { const data = await request(base + '/runtimes', 'POST', null, randomUUID()); if (current()) { setRuntime(text(record(data).id)); setResult(data); await refresh(current) } })}
              {button(t('start'), current => queued(runtimePath + '/lifecycle', { action: 'start' }, current), !!runtime)}
              {button(t('stop'), current => queued(runtimePath + '/lifecycle', { action: 'stop' }, current), !!runtime)}
              {button(t('history'), async (current) => { const data = await request(runtimePath + '/operations'); if (current()) setResult(data) }, !!runtime)}
            </div>)}
            {section(t('session'), <>
              <div className={css.group}>{field(t('endpoint'), endpoint, setEndpoint, 'url')}{field(t('model'), model, setModel)}{field(t('apiKey'), apiKey, setApiKey, 'password')}
                {button(t('saveCredential'), async (current) => { const secret = apiKey; setApiKey(''); const data = await request(base + '/model-credentials', 'POST', { endpoint, model, apiKey: secret }); if (current()) { setResult(data); await refresh(current) } }, !!apiKey && !!model)}</div>
              <div className={css.group}>{select(t('credential'), credential, setCredential, credentials)}{select(t('session'), session, (value) => { setSession(value); setEvents([]); const match = sessions.find(item => item.id === value); if (match !== undefined) setRuntime(match.runtimeId) }, sessions)}
                {button(t('createSession'), async (current) => { const data = await request(base + '/sessions', 'POST', { runtimeId: runtime, credentialId: credential, title: name || t('session') }, randomUUID()); if (current()) { setSession(text(record(data).id)); setResult(data); await refresh(current) } }, !!runtime && !!credential)}</div>
              <label className={css.field}>{t('prompt')}<textarea value={prompt} onChange={(event) =>{  setPrompt(event.target.value) }} disabled={!usable} maxLength={16000} /></label>
              {button(t('send'), current => queued(`${base}/sessions/${session}/prompts`, { prompt, timeoutSeconds: 180 }, current, session), !!runtime && !!session && !!prompt)}
              <pre aria-label={t('events')} className={css.output}>{events.map(event => JSON.stringify(event)).join('\n')}</pre>
            </>)}
            {section(t('command'), <div className={css.group}>{field(t('command'), command, setCommand)}{button(t('execute'), current => queued(runtimePath + '/commands', { command, timeoutSeconds: 30 }, current), !!runtime && !!command)}</div>)}
            {section(t('files'), <>
              <div className={css.group}>{field(t('path'), path, setPath)}{button(t('list'), current => queued(runtimePath + '/files', { action: 'list', path }, current), !!runtime)}{button(t('read'), current => queued(runtimePath + '/files', { action: 'read', path }, current), !!runtime)}</div>
              <label className={css.field}>{t('content')}<textarea value={content} onChange={(event) =>{  setContent(event.target.value) }} disabled={!usable} /></label>
              {button(t('write'), (current) => { const bytes = new TextEncoder().encode(content); if (bytes.length > 16384) throw new Error('FILE_TOO_LARGE'); return queued(runtimePath + '/files', { action: 'write', path, content: btoa(String.fromCharCode(...bytes)) }, current) }, !!runtime)}
            </>)}
            {section(t('storage'), <>
              <p className={css.notice}>{t('uploadHint')}</p>
              <div className={css.group}><label className={css.field}>{t('files')}<input type="file" disabled={!usable} onChange={(event) =>{  setFile(event.target.files?.[0]) }} /></label>
                {button(t('upload'), async (current) => {
                  if (file === undefined) return
                  const contentType = file.type || 'application/octet-stream'
                  const upload = record(await request(base + '/uploads', 'POST', { filename: file.name, contentType, size: file.size }))
                  const target = new URL(text(upload.uploadUrl))
                  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('INVALID_UPLOAD_URL')
                  if (!current()) return
                  const controller = new AbortController()
                  transfer.current = controller
                  const response = await fetch(target, { method: 'PUT', redirect: 'error', headers: { 'Content-Type': contentType }, body: file, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
                  if (!current()) return
                  if (!response.ok) throw new Error('UPLOAD_FAILED')
                  const completed = await request(`${base}/uploads/${text(record(upload.object ?? null).id)}/complete`, 'POST')
                  if (current()) { setResult(completed); await refresh(current) }
                }, file !== undefined)}
              </div>
              {objects.map(object => <div className={css.row} key={object.id}>{object.name}{button(t('download'), async () => {
                const data = record(await request(`${base}/objects/${object.id}/download`, 'POST')), target = new URL(text(data.downloadUrl))
                if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('INVALID_DOWNLOAD_URL')
                window.open(target.href, '_blank', 'noopener,noreferrer')
              })}</div>)}
            </>)}
            {section(t('desktop'), <>
              <div className={css.group}>{select(t('desktop'), desktop, (value) => { setDesktop(value); const match = desktops.find(item => item.id === value); if (match !== undefined) setRuntime(match.runtimeId) }, desktops)}
                {button(t('createDesktop'), async (current) => { const data = await request(base + '/desktops', 'POST', { runtimeId: runtime }); if (current()) { setDesktop(text(record(data).id)); setResult(data); await refresh(current) } }, !!runtime)}
                {button(t('desktopStart'), current => queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'start' }, current), !!desktop && !!runtime)}
                {button(t('desktopStop'), current => queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'stop' }, current), !!desktop && !!runtime)}
                {button(t('screenshot'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'screenshot' }, current), !!desktop && !!runtime)}</div>
              {image !== '' && <img className={css.image} src={image} alt={t('desktopAlt')} />}
              <div className={css.group}>{field(t('text'), desktopText, setDesktopText)}{button(t('type'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'type', text: desktopText }, current), !!desktop && !!runtime && !!desktopText)}</div>
              <div className={css.group}>{field(t('browserUrl'), url, setUrl)}{button(t('navigate'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'navigate', url }, current), !!desktop && !!runtime)}{button(t('browserContent'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'content' }, current), !!desktop && !!runtime)}</div>
            </>)}
          </>}
        </>}
        {operation !== undefined && <Button variant="outline" disabled={snapshot.mode !== 'cloud'} onClick={task(async (current) => {
          const data = await request(`${operation.path}/operations/${operation.id}/cancel`, 'POST')
          if (current()) setResult(data)
        })}>{t('cancel')}</Button>}
        <pre className={css.output} aria-label={t('result')}>{result === null ? '' : JSON.stringify(result, null, 2)}</pre>
      </div>
    </Modal>
  </>
}
