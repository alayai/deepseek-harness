/** Cloud workspace consumer. Every operation carries both login epoch and a captured Workspace path. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudRequest, CloudValue, LocalReadRequest, LocalReadResult } from '../types.ts'
import type { CloudSource } from './source.ts'
import type { CloudActivities } from './activity.ts'
import type { CloudSection, CloudViewStore } from './view-store.ts'
import { readBinding, type CloudBinding } from './binding.ts'
import { LocalArchive } from './LocalArchive.tsx'
import { canonicalBotDefinition, definitionDigest, findBotExportAttempt, findBotSyncRecord, reserveBotExportAttempt, rejectBotExportAttempt, sameBotSyncScope, saveBotSyncRecord, type BotExportPreview, type BotSyncRecord, type BotSyncScope } from './bot-sync.ts'
import { CloudArtifacts, CloudArtifactReceipts } from './CloudArtifacts.tsx'
import { CloudSessionReplay } from './session-replay.ts'
import { CloudSessionTimeline } from './CloudSessionTimeline.tsx'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'

export interface CloudPanelInjected {
  artifacts?: CloudArtifactReceipts
  replay?: CloudSessionReplay
  hooks: { cloud: CloudSource; activities: CloudActivities['source']; view: CloudViewStore }
  viewActions: CloudViewStore['actions']
  remember: CloudActivities['remember']
  accepted: CloudActivities['accepted']
  login(server: string): Promise<void>
  logout(): Promise<void>
  readLocal(input: LocalReadRequest): Promise<LocalReadResult>
  exportLocal?(input: { kind: 'bot'; epoch: number; botId: string }): Promise<{ version: 1; exportable: boolean; reason?: string; definition?: { schemaVersion: 1; name: string; role: string; instructions: string; requiredCapabilities: readonly string[] } }>
  call(input: CloudRequest): Promise<CloudValue>
}
export type CloudPanelProps = PropsLocale<'dsh.cloud'> & InjectFace<CloudPanelInjected>
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
export function CloudPanel({
  t, artifacts: sharedArtifacts, replay: sharedReplay, useCloud, useActivities, useView, viewActions: actions,
  login, logout, call, readLocal, exportLocal, remember, accepted,
}: CloudPanelProps) {
  const snapshot = useCloud(value => value)
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const { tenant, workspace, runtime, credential, session, desktop, section } = useView(value => value)
  const setTenant = actions.tenant, setWorkspace = actions.workspace
  const setRuntime = (value: string) => { actions.resource('runtime', value) }
  const setCredential = (value: string) => { actions.resource('credential', value) }
  const setSession = (value: string) => { actions.resource('session', value) }
  const setDesktop = (value: string) => { actions.resource('desktop', value) }
  const [server, setServer] = useState(snapshot.serverUrl)
  const [tenants, setTenants] = useState<Row[]>([])
  const [workspaces, setWorkspaces] = useState<Row[]>([])
  const [runtimes, setRuntimes] = useState<Row[]>([])
  const [credentials, setCredentials] = useState<Row[]>([])
  const [sessions, setSessions] = useState<Row[]>([])
  const [desktops, setDesktops] = useState<Row[]>([])
  const [objects, setObjects] = useState<Row[]>([]), [file, setFile] = useState<File | undefined>()
  const [name, setName] = useState(''), [slug, setSlug] = useState('')
  const [endpoint, setEndpoint] = useState('https://api.deepseek.com'), [model, setModel] = useState(''), [apiKey, setApiKey] = useState('')
  const [command, setCommand] = useState(''), [prompt, setPrompt] = useState(''), [path, setPath] = useState('.')
  const [content, setContent] = useState(''), [url, setUrl] = useState('about:blank'), [desktopText, setDesktopText] = useState('')
  const [result, setResult] = useState<CloudValue>(null), [_eventVersion, setEventVersion] = useState(0), [image, setImage] = useState('')
  const [bindingState, setBinding] = useState<{ scope: string; epoch: number; binding: CloudBinding } | null>(null)
  const generation = useRef(0), transfer = useRef<AbortController | undefined>(undefined)
  const localReplay = useRef(new CloudSessionReplay()), localArtifacts = useRef(new CloudArtifactReceipts())
  const active = useRef({ epoch: snapshot.epoch, tenant, workspace, session, mode: snapshot.mode, serverUrl: snapshot.serverUrl })
  active.current = { epoch: snapshot.epoch, tenant, workspace, session, mode: snapshot.mode, serverUrl: snapshot.serverUrl }
  const base = `/tenants/${tenant}/workspaces/${workspace}`, runtimePath = `${base}/runtimes/${runtime}`
  const replay = sharedReplay ?? localReplay.current
  const eventScope = `${snapshot.serverUrl}:${snapshot.epoch}:${base}/sessions/${session}`
  const events = replay.read(eventScope).events
  const activity = useActivities(value => value[base])
  const operation = activity?.operation
  const binding = bindingState?.scope === `${base}/sessions/${session}` && bindingState.epoch === snapshot.epoch ? bindingState.binding : null
  const usable = snapshot.mode === 'cloud' && !busy

  useEffect(() => { generation.current++; transfer.current?.abort(); setBusy(false); setFailed(false); setImage(''); setEventVersion(value => value + 1) }, [snapshot.epoch, tenant, workspace])
  useEffect(() => { setResult(null); setTenants([]); setWorkspaces([]) }, [snapshot.epoch])
  useEffect(() => { setResult(null) }, [tenant, workspace])
  useEffect(() => { setRuntimes([]); setSessions([]); setCredentials([]); setDesktops([]); setObjects([]); setApiKey(''); setFile(undefined) }, [snapshot.epoch, tenant, workspace])
  useEffect(() => () => { generation.current++; active.current = { ...active.current, mode: 'local' }; transfer.current?.abort() }, [])

  const request = (target: string, method: CloudRequest['method'] = 'GET', body: CloudValue = null, key: string | null = null) =>
    call({ epoch: snapshot.epoch, path: target, method, body, idempotencyKey: key })
  const exportCurrent = () => active.current.epoch === snapshot.epoch && active.current.tenant === tenant
    && active.current.workspace === workspace && active.current.mode === 'cloud' && active.current.serverUrl === snapshot.serverUrl
  const exportScope = async (): Promise<BotSyncScope> => {
    const info = record(await request('/server-info'))
    if (record(info.capabilities ?? null).workspaceBots !== true) throw new Error('WORKSPACE_BOTS_UNSUPPORTED')
    const me = record(await request('/me'))
    if (!text(info.serverId) || !text(me.id) || !exportCurrent()) throw new Error('BOT_EXPORT_SCOPE_CHANGED')
    return { serverUrl: snapshot.serverUrl, serverId: text(info.serverId), userId: text(me.id), tenantId: tenant, workspaceId: workspace }
  }
  const previewBot = async (botId: string): Promise<BotExportPreview> => {
    if (!tenant || !workspace || exportLocal === undefined || !exportCurrent()) throw new Error('LOCAL_BOT_EXPORT_UNAVAILABLE')
    const source = await exportLocal({ kind: 'bot', epoch: snapshot.epoch, botId })
    if (!source.exportable || source.definition === undefined) throw new Error(source.reason ?? 'LOCAL_BOT_NOT_EXPORTABLE')
    const scope = await exportScope(), definition = canonicalBotDefinition(source.definition)
    const contentSha256 = await definitionDigest(definition)
    const sync = findBotSyncRecord(scope, botId), attempt = findBotExportAttempt(scope, botId)
    let status: BotExportPreview['status'] = 'new'
    let currentSync = sync
    if (sync !== undefined) {
      status = 'unknown'
      try {
        const meta = record(await request(`${base}/bots/${sync.cloudBotId}`))
        if (meta.state === 'archived') status = 'archived'
        else if (meta.state === 'active' && Number.isSafeInteger(meta.version) && Number(meta.version) > 0) {
          const latest = record(await request(`${base}/bots/${sync.cloudBotId}/revisions/${sync.cloudRevision}`))
          if (meta.latestRevision !== sync.cloudRevision || record(latest.source ?? null).contentSha256 !== sync.contentSha256) status = 'cloud-updated'
          else {
            currentSync = { ...sync, cloudVersion: Number(meta.version) }
            status = contentSha256 === sync.contentSha256 ? 'synced' : 'local-updated'
          }
        }
      } catch { status = 'unknown' }
    }
    if (attempt !== undefined && status !== 'archived') {
      status = attempt.contentSha256 === contentSha256 && attempt.cloudBotId === (sync?.cloudBotId ?? '') ? 'pending' : 'unknown'
      if (sync !== undefined) currentSync = { ...sync, cloudVersion: attempt.expectedVersion }
    }
    if (!exportCurrent()) throw new Error('BOT_EXPORT_SCOPE_CHANGED')
    return { scope, definition, source: { kind: 'local-export', localBotId: botId, exportVersion: 1,
      exportedAt: attempt?.exportedAt ?? new Date().toISOString(), contentSha256 }, status,
    ...(currentSync === undefined ? {} : { sync: currentSync }) }
  }
  const exportBot = async (botId: string, preview: BotExportPreview): Promise<BotSyncRecord> => {
    if (preview.source.localBotId !== botId || !exportCurrent()) throw new Error('LOCAL_EXPORT_PREVIEW_MISMATCH')
    // Re-read the full public definition on confirmation; private or changed Bots require a new preview.
    const checked = await previewBot(botId)
    if (!sameBotSyncScope(checked.scope, preview.scope) || checked.source.contentSha256 !== preview.source.contentSha256
      || checked.sync?.cloudBotId !== preview.sync?.cloudBotId || checked.sync?.cloudVersion !== preview.sync?.cloudVersion
      || preview.status === 'synced' || checked.status === 'synced' || checked.status === 'unknown' || checked.status === 'archived' || checked.status === 'cloud-updated') throw new Error('BOT_EXPORT_REVIEW_REQUIRED')
    const sync = preview.sync
    const attempt = reserveBotExportAttempt({ ...preview.scope, localBotId: botId, cloudBotId: sync?.cloudBotId ?? '',
      expectedVersion: sync?.cloudVersion ?? 0, contentSha256: preview.source.contentSha256,
      exportedAt: preview.source.exportedAt, idempotencyKey: randomUUID() })
    const definition = { ...canonicalBotDefinition(preview.definition), requiredCapabilities: [...preview.definition.requiredCapabilities] }
    const source = { ...preview.source, exportedAt: attempt.exportedAt }
    const body = sync === undefined ? { definition, source } : { expectedVersion: attempt.expectedVersion, definition, source }
    if (!exportCurrent()) throw new Error('BOT_EXPORT_SCOPE_CHANGED')
    const target = sync === undefined ? `${base}/bots` : `${base}/bots/${sync.cloudBotId}/revisions`
    let receipt: ReturnType<typeof record>
    try { receipt = record(await request(target, 'POST', body, attempt.idempotencyKey)) }
    catch (error) {
      if (error instanceof Error && ['BOT_VERSION_CONFLICT', 'BOT_ARCHIVED', 'BOT_NOT_FOUND', 'WORKSPACE_ARCHIVED'].includes(error.message)) rejectBotExportAttempt(attempt)
      throw error
    }
    const cloudBotId = text(receipt.botId) || text(receipt.id)
    const cloudRevision = Number(receipt.revision ?? receipt.latestRevision)
    const cloudVersion = sync === undefined ? Number(receipt.version) : attempt.expectedVersion + 1
    if (sync !== undefined && (cloudBotId !== sync.cloudBotId || cloudRevision !== sync.cloudRevision + 1)) throw new Error('INVALID_BOT_SYNC_RECEIPT')
    const result: BotSyncRecord = { ...preview.scope, localBotId: botId, cloudBotId, cloudRevision, cloudVersion,
      contentSha256: preview.source.contentSha256, syncedAt: new Date().toISOString() }
    saveBotSyncRecord(result)
    if (exportCurrent()) { setResult(receipt); actions.section('agent') }
    return result
  }
  const task = (action: (current: () => boolean) => Promise<void>) => () => {
    void (async () => {
      const id = ++generation.current, epoch = snapshot.epoch, selected = workspace, selectedTenant = tenant
      const current = () => generation.current === id && active.current.epoch === epoch
        && active.current.workspace === selected && active.current.tenant === selectedTenant && active.current.mode === 'cloud' && active.current.serverUrl === snapshot.serverUrl
      setBusy(true); setFailed(false)
      try { await action(current) } catch { if (current()) setFailed(true) }
      finally { if (current()) setBusy(false) }
    })()
  }
  const loadBinding = async (sessionId: string, current: () => boolean) => {
    const info = record(await request('/server-info'))
    const value = await request(`${base}/sessions/${sessionId}/binding`)
    const parsed = readBinding(value, { serverId: text(info.serverId), tenantId: tenant, workspaceId: workspace, sessionId })
    if (current()) setBinding({ scope: `${base}/sessions/${sessionId}`, epoch: snapshot.epoch, binding: parsed })
    if (current()) await loadSessionEvents(sessionId, current)
  }
  const readSessionPage = async (sessionId: string, current: () => boolean): Promise<number> => {
    const scope = `${snapshot.serverUrl}:${snapshot.epoch}:${base}/sessions/${sessionId}`
    const before = replay.read(scope).after
    const page = await request(`${base}/sessions/${sessionId}/events?after=${before}`)
    if (!current() || active.current.session !== sessionId) return 0
    replay.accept(scope, before, page)
    setEventVersion(value => value + 1)
    return Array.isArray(record(page).items) ? (record(page).items as CloudValue[]).length : 0
  }
  const loadSessionEvents = async (sessionId: string, current: () => boolean) => {
    for (let count = 0; count < 20 && current(); count++) if (await readSessionPage(sessionId, current) < 100) return
  }
  const refresh = async (current: () => boolean, includeBinding = true) => {
    const values = await Promise.all(['/runtimes', '/model-credentials', '/sessions', '/desktops', '/objects'].map(suffix => request(base + suffix)))
    if (!current()) return
    setRuntimes(rows(values[0] ?? null)); setCredentials(rows(values[1] ?? null)); setSessions(rows(values[2] ?? null))
    setDesktops(rows(values[3] ?? null)); setObjects(rows(values[4] ?? null))
    if (session && includeBinding) await loadBinding(session, current)
  }
  const queued = async (target: string, body: CloudValue, current: () => boolean, sessionId?: string) => {
    const key = randomUUID()
    // Keep the key visible even if the first write response is lost. Never replay automatically.
    remember({ scope: base, path: target, key })
    setResult({ idempotencyKey: key, path: target })
    const receipt = record(await request(target, 'POST', body, key)), id = text(receipt.id)
    const pollBase = `${base}/runtimes/${text(receipt.runtimeId) || runtime}`
    if (!id) throw new Error('MISSING_OPERATION_ID')
    accepted(base, key, { path: pollBase, id })
    if (!current()) return
    setResult(receipt)
    const readEvents = () => sessionId === undefined ? Promise.resolve(0) : readSessionPage(sessionId, current)
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
  const select = (label: string, value: string, update: (value: string) => void, items: Row[]) => <label className={css.field}>{label}<select aria-label={label} value={value} onChange={(event) =>{  update(event.target.value) }} disabled={!usable}><option value="">{t('choose')}</option>{value && !items.some(item => item.id === value) && <option value={value}>{value}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  const button = (label: string, action: (current: () => boolean) => Promise<void>, enabled = true) => <Button variant="outline" disabled={!usable || !enabled} onClick={task(action)}>{label}</Button>
  const renderSection = (group: CloudSection, label: string, children: ReactNode) => group === section
    ? <section className={css.section}><h3>{label}</h3>{children}</section> : null
  const locked = snapshot.mode !== 'local'
  return <div className={css.panel} data-cloud-panel>
    <header className={css.header}><h2>{t('title')}</h2><span>{t(snapshot.mode)}</span></header>
    <div className={css.body}>
      <p className={css.notice}>{t('policy')}</p>
      <details className={css.connection} open={snapshot.mode !== 'cloud'}>
        <summary>{t('connection')}</summary>
        <div className={css.group}>
          <label className={css.field}>{t('server')}<input value={server} disabled={snapshot.mode === 'cloud' || snapshot.mode === 'authenticating'} onChange={(event) => { setServer(event.target.value) }} /></label>
          <Button variant="primary" disabled={snapshot.mode === 'cloud' || snapshot.mode === 'authenticating' || busy} onClick={task(async () => { await login(server) })}>{t('connect')}</Button>
        </div>
      </details>
      {locked && <Button variant="outline" disabled={busy} onClick={task(async () => { await logout() })}>{t('logout')}</Button>}
      {snapshot.authorizationUrl !== null && <a href={snapshot.authorizationUrl} target="_blank" rel="noopener noreferrer">{t('authorize')}</a>}
      <p role="status" className={`${css.notice} ${failed || snapshot.error !== null ? css.error : ''}`}>
        {failed ? t('failure') : snapshot.error === 'CLOUD_PROTOCOL_UNSUPPORTED' ? t('protocolUnsupported') : snapshot.mode === 'cloud-suspended' ? t('localBlocked') : busy ? t('waiting') : t(snapshot.mode)}
      </p>
      {(snapshot.mode === 'cloud' || snapshot.mode === 'cloud-suspended') && <LocalArchive key={`${snapshot.serverUrl}:${snapshot.epoch}:${tenant}:${workspace}`} t={t} epoch={snapshot.epoch} read={readLocal}
        {...(workspace !== '' && usable && exportLocal !== undefined ? { previewBot, exportBot } : {})}
        cloudAvailable={snapshot.mode === 'cloud'} openCloud={() => { actions.section('agent') }} />}
      {snapshot.mode === 'cloud' && <>
        <section className={css.context}>
          <h3>{t('workspace')}</h3>
          <div className={css.group}>{button(t('refreshTenants'), async (current) => { const data = await request('/me/tenants'); if (current()) setTenants(rows(data)) })}
            {select(t('tenant'), tenant, (value) => { setTenant(value); setWorkspaces([]) }, tenants)}
            {button(t('refreshWorkspaces'), async (current) => { const data = await request(`/tenants/${tenant}/workspaces`); if (current()) setWorkspaces(rows(data)) }, !!tenant)}
            {select(t('workspace'), workspace, setWorkspace, workspaces)}</div>
        </section>
        <nav className={css.tabs} aria-label={t('sections')}>{(['overview', 'agent', 'files', 'desktop', 'tasks', 'settings'] as const).map(item =>
          <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => { actions.section(item) }}>{t(item)}</button>,
        )}</nav>
        {renderSection('settings', t('compatibility'), <>
          <p className={css.notice}>{t('compatibilityHint')}</p>
          {button(t('checkCompatibility'), async (current) => { const data = await request('/server-info'); if (current()) setResult(data) })}
        </>)}
        {renderSection('settings', t('organization'), <div className={css.group}>{field(t('name'), name, setName)}{field(t('slug'), slug, setSlug)}
          {button(t('createTenant'), async (current) => { const data = await request('/tenants', 'POST', { name, slug }, randomUUID()); if (current()) setResult(data) }, !!name && !!slug)}
          {button(t('createWorkspace'), async (current) => { const data = await request(`/tenants/${tenant}/workspaces`, 'POST', { name, slug }, randomUUID()); if (current()) setResult(data) }, !!tenant && !!name && !!slug)}
        </div>)}
        {!workspace && <p className={css.notice}>{t('chooseWorkspace')}</p>}
        {!!workspace && <>
          {!!session && <section className={css.section} aria-label={t('binding')}>
            <h3>{t('binding')}</h3>
            {binding === null ? <p className={css.notice}>{t('bindingUnknown')}</p> : <>
              <p className={css.notice}>{t(binding.state === 'active' ? 'bindingActive' : 'bindingDisabled')} · {t('bindingRevision')} {binding.bindingRevision}</p>
              <dl className={css.binding}>
                <dt>{t('session')}</dt><dd>{binding.cloudSessionId}</dd>
                <dt>{t('runtime')}</dt><dd>{binding.runtimeId}</dd>
                <dt>{t('credential')}</dt><dd>{binding.credentialRef}</dd>
                <dt>{t('desktop')}</dt><dd>{binding.desktopId ?? t('noDesktop')}</dd>
              </dl>
              <p className={css.notice}>{t(runtime === binding.runtimeId ? 'sessionResource' : 'browsingResource')}</p>
              <p className={css.notice}>{t('bindingFixed')}</p>
            </>}
            <div className={css.group}>
              {button(t('refreshBinding'), current => loadBinding(session, current))}
              {binding !== null && button(t(binding.state === 'active' ? 'disableBinding' : 'enableBinding'), async (current) => {
                await request(`${base}/sessions/${session}/binding`, 'PATCH', { expectedRevision: binding.bindingRevision, state: binding.state === 'active' ? 'disabled' : 'active' })
                if (current()) await loadBinding(session, current)
              })}
              {binding !== null && button(t('browseSession'), () => { setRuntime(binding.runtimeId); setCredential(binding.credentialRef); setDesktop(binding.desktopId ?? ''); return Promise.resolve() })}
            </div>
          </section>}
          {renderSection('tasks', t('history'), <>{button(t('history'), async (current) => { const data = await request(runtimePath + '/operations'); if (current()) setResult(data) }, !!runtime)}</>)}
          <div className={css.group}>{button(t('refreshResources'), refresh)}{section !== 'overview' && select(t('runtime'), runtime, setRuntime, runtimes)}</div>
          {renderSection('overview', t('runtime'), <div className={css.group}>
            {select(t('runtime'), runtime, setRuntime, runtimes)}
            {button(t('allocate'), async (current) => { const data = await request(base + '/runtimes', 'POST', null, randomUUID()); if (current()) { setRuntime(text(record(data).id)); setResult(data); await refresh(current) } })}
            {button(t('start'), current => queued(runtimePath + '/lifecycle', { action: 'start' }, current), !!runtime)}
            {button(t('stop'), current => queued(runtimePath + '/lifecycle', { action: 'stop' }, current), !!runtime)}
            {button(t('history'), async (current) => { const data = await request(runtimePath + '/operations'); if (current()) setResult(data) }, !!runtime)}
          </div>)}
          {renderSection('settings', t('credential'), <>
            <div className={css.group}>{field(t('endpoint'), endpoint, setEndpoint, 'url')}{field(t('model'), model, setModel)}{field(t('apiKey'), apiKey, setApiKey, 'password')}
              {button(t('saveCredential'), async (current) => { const secret = apiKey; setApiKey(''); const data = await request(base + '/model-credentials', 'POST', { endpoint, model, apiKey: secret }); if (current()) { setResult(data); await refresh(current) } }, !!apiKey && !!model)}</div>
          </>)}
          {renderSection('agent', t('session'), <>
            <div className={css.group}>{select(t('credential'), credential, setCredential, credentials)}{select(t('sessionDesktop'), desktop, setDesktop, desktops.filter(item => item.runtimeId === runtime))}{select(t('session'), session, (value) => { setSession(value); setBinding(null); setEventVersion(value => value + 1) }, sessions)}
              {button(t('createSession'), async (current) => { const data = await request(base + '/sessions', 'POST', { runtimeId: runtime, credentialId: credential, ...(desktop ? { desktopId: desktop } : {}), title: name || t('session') }, randomUUID()); if (current()) { const id = text(record(data).id); setEventVersion(value => value + 1); setSession(id); setBinding(null); setResult(data); await refresh(current, false); if (current()) await loadBinding(id, current) } }, !!runtime && !!credential && (!desktop || desktops.some(item => item.id === desktop && item.runtimeId === runtime)))}</div>
            <label className={css.field}>{t('prompt')}<textarea value={prompt} onChange={(event) =>{  setPrompt(event.target.value) }} disabled={!usable} maxLength={16000} /></label>
            {button(t('send'), current => queued(`${base}/sessions/${session}/prompts`, { prompt, timeoutSeconds: 180, expectedBindingRevision: binding?.bindingRevision ?? 0 }, current, session), binding !== null && binding.state === 'active' && !!session && !!prompt)}
            <CloudSessionTimeline states={{ running: t('eventRunning'), succeeded: t('eventSucceeded'), failed: t('eventFailed'), interrupted: t('eventInterrupted') }} detailsLabel={t('eventDetails')} label={t('events')} events={events} labels={{ user: t('userMessage'), assistant: t('assistantMessage'), tool: t('toolMessage'), status: t('statusMessage'), error: t('errorMessage'), unknown: t('unknownMessage') }} />
          </>)}
          {renderSection('overview', t('command'), <div className={css.group}>{field(t('command'), command, setCommand)}{button(t('execute'), current => queued(runtimePath + '/commands', { command, timeoutSeconds: 30 }, current), !!runtime && !!command)}</div>)}
          {renderSection('files', t('files'), <>
            <div className={css.group}>{field(t('path'), path, setPath)}{button(t('list'), current => queued(runtimePath + '/files', { action: 'list', path }, current), !!runtime)}{button(t('read'), current => queued(runtimePath + '/files', { action: 'read', path }, current), !!runtime)}</div>
            <label className={css.field}>{t('content')}<textarea value={content} onChange={(event) =>{  setContent(event.target.value) }} disabled={!usable} /></label>
            {button(t('write'), (current) => { const bytes = new TextEncoder().encode(content); if (bytes.length > 16384) throw new Error('FILE_TOO_LARGE'); return queued(runtimePath + '/files', { action: 'write', path, content: btoa(String.fromCharCode(...bytes)) }, current) }, !!runtime)}
          </>)}
          {section === 'files' && <CloudArtifacts key={`${snapshot.serverUrl}:${snapshot.epoch}:${base}`} t={t} scope={base} result={result} receipts={sharedArtifacts ?? localArtifacts.current} enabled={usable} call={request} />}
          {renderSection('files', t('storage'), <>
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
          {renderSection('desktop', t('desktop'), <>
            <div className={css.group}>{select(t('desktop'), desktop, (value) => { setDesktop(value); const match = desktops.find(item => item.id === value); if (match !== undefined) setRuntime(match.runtimeId) }, desktops)}
              {button(t('createDesktop'), async (current) => { const data = await request(base + '/desktops', 'POST', { runtimeId: runtime }); if (current()) { setDesktop(text(record(data).id)); setResult(data); await refresh(current) } }, !!runtime)}
              {button(t('desktopStart'), current => queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'start' }, current), !!desktop && !!runtime)}
              {button(t('desktopStop'), current => queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'stop' }, current), !!desktop && !!runtime)}
              {button(t('connectDesktop'), async (current) => {
                const popup = window.open('about:blank', '_blank'); if (!popup) throw Error('POPUP_BLOCKED'); popup.opener = null
                try {
                  const value = record(await request(`${base}/desktops/${desktop}/viewer`, 'POST'))
                  if (!current()) { popup.close(); return }
                  const target = new URL(text(value.viewerUrl))
                  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || !/^\/[a-f0-9]{64}\/$/.test(target.pathname)) throw Error('INVALID_VIEWER_URL')
                  popup.location.href = target.href
                } catch (error) { popup.close(); throw error }
              }, !!desktop)}
              {button(t('screenshot'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'screenshot' }, current), !!desktop && !!runtime)}</div>
            {image !== '' && <img className={css.image} src={image} alt={t('desktopAlt')} />}
            <div className={css.group}>{field(t('text'), desktopText, setDesktopText)}{button(t('type'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'type', text: desktopText }, current), !!desktop && !!runtime && !!desktopText)}</div>
            <div className={css.group}>{field(t('browserUrl'), url, setUrl)}{button(t('navigate'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'navigate', url }, current), !!desktop && !!runtime)}{button(t('browserContent'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'content' }, current), !!desktop && !!runtime)}</div>
          </>)}
        </>}
      </>}
      {activity !== undefined && <section className={css.section}>
        <h3>{t('taskReference')}</h3>
        <p className={css.notice}>{operation?.id ?? t('unknownResult')}</p>
        {operation !== undefined && <Button variant="outline" disabled={!usable} onClick={task(async (current) => {
          const data = await request(`${operation.path}/operations/${operation.id}`)
          if (current()) setResult(data)
        })}>{t('queryTask')}</Button>}
        {operation === undefined && <pre className={css.output}>
          {JSON.stringify({ path: activity.path, idempotencyKey: activity.key }, null, 2)}
        </pre>}
      </section>}
      {operation !== undefined && <Button variant="outline" disabled={snapshot.mode !== 'cloud'} onClick={task(async (current) => {
        const data = await request(`${operation.path}/operations/${operation.id}/cancel`, 'POST')
        if (current()) setResult(data)
      })}>{t('cancel')}</Button>}
      <pre className={css.output} aria-label={t('result')}>{result === null ? '' : JSON.stringify(result, null, 2)}</pre>
    </div>
  </div>
}
