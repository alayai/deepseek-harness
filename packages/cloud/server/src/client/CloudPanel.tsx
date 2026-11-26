/** Cloud workspace consumer. Every operation carries both login epoch and a captured Workspace path. */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CloudRequest, CloudValue, LocalReadRequest, LocalReadResult } from '../types.ts'
import type { CloudSource } from './source.ts'
import type { CloudActivities } from './activity.ts'
import { useWorkspaceModels } from './workspace-models.ts'
import type { CloudSection, CloudViewStore } from './view-store.ts'
import { readBinding, type CloudBinding } from './binding.ts'
import { LocalArchive } from './LocalArchive.tsx'
import { canonicalBotDefinition, definitionDigest, findBotExportAttempt, findBotSyncRecord, reserveBotExportAttempt, rejectBotExportAttempt, sameBotSyncScope, saveBotSyncRecord, type BotExportPreview, type BotSyncRecord, type BotSyncScope } from './bot-sync.ts'
import { CloudArtifacts, CloudArtifactReceipts } from './CloudArtifacts.tsx'
import { CloudFileState, AuthenticatedCloudFiles } from './CloudFiles.tsx'
import { CloudTaskHistory } from './CloudTaskHistory.tsx'
import { RuntimeReceipts, type RuntimeAction } from './runtime-receipts.ts'
import { CloudObjectBrowser } from './CloudObjectBrowser.tsx'
import { CloudWorkspacePicker } from './CloudWorkspacePicker.tsx'
import { checkDesktopOperation, readDesktop, useDesktopTarget, type DesktopOperationKind } from './desktop-target.ts'
import css from './CloudPanel.module.css'
import type {} from './locales.ts'
import { z } from 'zod'
import { MAX_MULTIPART_SIZE, readUploadReceipt, saveUploadReceipt, clearUploadReceipt, uploadFingerprint, type UploadReceipt } from './upload-resume.ts'
import { uploadMissingParts } from './multipart-transfer.ts'
import { CloudRequestFailure } from './chat-turns.ts'
import { readSessionPage, readWorkspaceBots, type SessionDirectory } from './bot-directory.ts'

export interface CloudPanelInjected {
  taskReceipts?: RuntimeReceipts
  artifacts?: CloudArtifactReceipts
  files?: CloudFileState
  openChat(): void
  hooks: { cloud: CloudSource; activities: CloudActivities['source']; view: CloudViewStore }
  viewActions: CloudViewStore['actions']
  remember: CloudActivities['remember']
  accepted: CloudActivities['accepted']
  rejected: CloudActivities['rejected']
  login(server: string): Promise<void>
  logout(): Promise<void>
  readLocal(input: LocalReadRequest): Promise<LocalReadResult>
  exportLocal?(input: { kind: 'bot'; epoch: number; botId: string }): Promise<{ version: 1; exportable: boolean; reason?: string; definition?: { schemaVersion: 1; name: string; role: string; instructions: string; requiredCapabilities: readonly string[] } }>
  call(input: CloudRequest): Promise<CloudValue>
}
export type CloudPanelProps = PropsLocale<'dsh.cloud'> & InjectFace<CloudPanelInjected>
type Row = { id: string; name: string; runtimeId: string; state?: string }
type SandboxIssue = 'sandboxDisabled' | 'sandboxWorkerUnavailable' | 'sandboxAllocationUnconfirmed' | 'sandboxStartUnconfirmed'
type ModelTemplate = { id: string; provider: string; endpoint: string; model: string; protocol: string }
type UploadState = {
  context: string
  status: 'checking' | 'uploading' | 'finalizing' | 'failed' | 'cancelled' | 'completed' | 'different'
        | 'expired' | 'scanUnavailable' | 'scanBlocked' | 'scanLimit' | 'unconfirmed'
        | 'scanQueued' | 'scanning' | 'scanFailed' | 'scanSubmit' | 'scanCheck'
  uploaded: number
  total: number
  pending?: PendingUpload | undefined
  completion?: { kind: 'uploads' | 'multipart'; objectId: string } | undefined
}
type PendingUpload = Omit<UploadReceipt, 'fingerprint'> & { fingerprint?: string; source?: File }
const UPLOAD_STATUS = {
  checking: 'uploadChecking', uploading: 'uploadProgress', finalizing: 'uploadFinalizing', failed: 'uploadFailed',
  cancelled: 'uploadCancelled', completed: 'uploadCompleted', different: 'uploadDifferent', expired: 'uploadExpired',
  scanUnavailable: 'uploadScanUnavailable', scanBlocked: 'uploadScanBlocked', scanLimit: 'uploadScanLimit',
  unconfirmed: 'uploadUnconfirmed',
  scanQueued: 'asyncQueued', scanning: 'asyncScanning', scanFailed: 'asyncFailed', scanSubmit: 'asyncReady', scanCheck: 'asyncUnconfirmed',
} as const
const terminalUpload = (state: UploadState | undefined) =>
  state?.status === 'expired' || state?.status === 'scanBlocked' || state?.status === 'scanLimit' || state?.status === 'scanFailed'
const awaitingScan = (state?: UploadState) => !!state?.pending?.asyncScan &&
  (state.pending.publicationReady || ['scanCheck', 'scanning', 'scanQueued'].includes(state.status))
const MULTIPART_THRESHOLD = 8 * 1024 * 1024
const publication = z.object({ objectId: z.uuid(), state: z.enum(['uploading', 'queued', 'scanning', 'published', 'blocked', 'failed', 'expired']) })
const multipartSession = z.object({
  objectId: z.uuid(), size: z.number().int().positive(), partSize: z.number().int().positive().max(64 * 1024 ** 2),
  partCount: z.number().int().positive().max(1000), expiresAt: z.iso.datetime(),
  state: z.enum(['pending', 'available', 'expired']), uploaded: z.array(z.number().int().positive()).max(1000),
})
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
      state: text(row.state),
    }
  })
}
function modelTemplates(value: CloudValue): ModelTemplate[] {
  return (Array.isArray(value) ? value : []).map((item) => {
    const row = record(item)
    return {
      id: text(row.id), provider: text(row.provider), endpoint: text(row.endpoint),
      model: text(row.model), protocol: text(row.protocol),
    }
  }).filter(item => item.id && item.endpoint && item.model)
}

/** Native client view using only Host RPC and explicitly selected RustFS transfers. */
export function CloudPanel({
  t, artifacts: sharedArtifacts, files, openChat, useCloud, useActivities, useView, viewActions: actions,
  login, logout, call, readLocal, exportLocal, remember, accepted, rejected, taskReceipts,
}: CloudPanelProps) {
  const snapshot = useCloud(value => value)
  const [ownedTaskReceipts] = useState(() => new RuntimeReceipts())
  const receipts = taskReceipts ?? ownedTaskReceipts
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const {
    tenant, workspace, runtime, credential, session, desktop, section,
    composeBot: botId, botFilter, botSetupVersion, botCreateVersion,
  } = useView(value => value)
  const setTenant = actions.tenant, setWorkspace = actions.workspace
  const setRuntime = (value: string) => { actions.resource('runtime', value) }
  const setCredential = (value: string) => { actions.resource('credential', value) }
  const setDesktop = (value: string) => { actions.resource('desktop', value) }
  const [server, setServer] = useState(snapshot.serverUrl)
  const [tenants, setTenants] = useState<Row[]>([])
  const [runtimeList, setRuntimes] = useState<Row[]>()
  const runtimes = runtimeList ?? []
  const [sandboxIssue, setSandboxIssue] = useState<SandboxIssue>()
  const [templates, setTemplates] = useState<ModelTemplate[]>([]), [template, setTemplate] = useState('')
  const [sessionPage, setSessionPage] = useState<SessionDirectory>()
  const [bots, setBots] = useState<(Row & { revision: number })[]>([])
  const setBotId = (id: string) => { actions.resource('composeBot', id) }
  const [supportsBots, setSupportsBots] = useState(false)
  const [botName, setBotName] = useState(''), [botRole, setBotRole] = useState(''), [botInstructions, setBotInstructions] = useState('')
  const bot = bots.find(item => item.id === botId)
  const [desktops, setDesktops] = useState<Row[]>([])
  const [objectRevision, refreshObjects] = useState(0)
  const [folderSelection, setFolderSelection] = useState<{ scope: string; id: string | null }>()
  const [fileSelection, setFile] = useState<{ context: string; file: File }>()
  const [storedUpload, setUploadState] = useState<UploadState>()
  const uploadInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(''), [slug, setSlug] = useState('')
  const [endpoint, setEndpoint] = useState('https://api.deepseek.com'), [model, setModel] = useState(''), [apiKey, setApiKey] = useState('')
  const [command, setCommand] = useState(''), [path, setPath] = useState('.')
  const [content, setContent] = useState(''), [url, setUrl] = useState('about:blank'), [desktopText, setDesktopText] = useState('')
  const [fileRead, setFileRead] = useState<{ scope: string; value: CloudValue }>()
  const [result, setResult] = useState<CloudValue>(null), [image, setImage] = useState<{ scope: string; src: string }>()
  const [bindingState, setBinding] = useState<{ scope: string; epoch: number; binding: CloudBinding } | null>(null)
  const generation = useRef(0), transfer = useRef<AbortController | undefined>(undefined)
  const localArtifacts = useRef(new CloudArtifactReceipts())
  const active = useRef({ epoch: snapshot.epoch, tenant, workspace, session, mode: snapshot.mode, serverUrl: snapshot.serverUrl })
  active.current = { epoch: snapshot.epoch, tenant, workspace, session, mode: snapshot.mode, serverUrl: snapshot.serverUrl }
  const base = `/tenants/${tenant}/workspaces/${workspace}`, runtimePath = `${base}/runtimes/${runtime}`
  const [localFiles] = useState(() => new CloudFileState())
  const readSequence = useRef(0)
  const fileIdentity = JSON.stringify([snapshot.serverUrl, runtimePath])
  const fileScope = JSON.stringify([fileIdentity, snapshot.epoch])
  const objectScope = JSON.stringify([snapshot.serverUrl, snapshot.epoch, snapshot.mode, tenant, workspace])
  const folderId = folderSelection?.scope === objectScope ? folderSelection.id : null
  const uploadContext = JSON.stringify([objectScope, folderId])
  const file = fileSelection?.context === uploadContext ? fileSelection.file : undefined
  const uploadState = storedUpload?.context === uploadContext ? storedUpload : undefined
  const [uploadIdentity, setUploadIdentity] = useState<{ context: string; scope: string | null; asyncMax?: number }>()
  const [scanChoice, setScanChoice] = useState<File>()
  const uploadScope = uploadIdentity?.context === uploadContext ? uploadIdentity.scope : undefined
  const canChooseScan = !!file && file.size > MULTIPART_THRESHOLD && typeof uploadScope === 'string'
    && file.size <= (uploadIdentity?.asyncMax ?? 0) && !uploadState?.pending && !uploadState?.completion && uploadState?.status !== 'completed'
  const latest = useActivities(value => value[runtimePath])
  const activity = section === 'desktop' && latest?.path.startsWith(base + '/desktops/') &&
    !latest.path.startsWith(base + '/desktops/' + desktop + '/') ? undefined : latest
  const operation = activity?.operation
  const references = useSyncExternalStore(receipts.entries.subscribe, receipts.entries.getSnapshot)
  const [verified, setVerified] = useState<{ context: string; scope: string }>()
  const [lookupNotice, setLookupNotice] = useState<{ key: string; message: 'taskNotConfirmed' | 'taskLookupFailed' }>()
  const [scopeRetry, retryScope] = useState(0), [scopeFailure, setScopeFailure] = useState('')
  const context = JSON.stringify([snapshot.serverUrl, snapshot.epoch, snapshot.mode, runtimePath])
  const desktopScope = JSON.stringify([context, desktop])
  const desk = useDesktopTarget(call, snapshot.epoch, base, runtime, desktop, desktopScope, section === 'desktop' && snapshot.mode === 'cloud')
  const activeContext = useRef(context); activeContext.current = context
  const needsLookup = references.length > 0 && snapshot.mode === 'cloud' && !!runtime && !!workspace && !!tenant
  useEffect(() => {
    let live = true
    if (needsLookup) void receipts.scope(snapshot.serverUrl, snapshot.epoch, runtimePath, call)
      .then((scope) => { if (live) { setVerified({ context, scope }); setScopeFailure('') } })
      .catch(() => { if (live) { setVerified(undefined); setScopeFailure(context) } })
    return () => { live = false }
  }, [needsLookup, context, scopeRetry, call, receipts])
  const pendingTasks = verified?.context === context && needsLookup ? references.filter(entry => entry.scope === verified.scope) : []
  const binding = bindingState?.scope === `${base}/sessions/${session}` && bindingState.epoch === snapshot.epoch ? bindingState.binding : null
  const usable = snapshot.mode === 'cloud' && !busy

  useEffect(() => {
    generation.current++
    transfer.current?.abort()
    setBusy(false)
    setFailed(false)
    setUploadState(undefined)
    setSandboxIssue(undefined)
  }, [snapshot.epoch, snapshot.serverUrl, snapshot.mode, tenant, workspace])
  useEffect(() => { setImage(undefined); setDesktopText(''); setUrl('about:blank'); setResult(null) }, [desktopScope])
  useEffect(() => { setResult(null); setTenants([]) }, [snapshot.epoch])
  useEffect(() => { setResult(null); setFileRead(undefined) }, [fileScope])
  useEffect(() => { setRuntimes(undefined); setSessionPage(undefined); setBots([]); setSupportsBots(false); setTemplates([]); setTemplate(''); setDesktops([]); setApiKey(''); setFile(undefined); setUploadState(undefined); setBotName(''); setBotRole(''); setBotInstructions(''); setFolderSelection(undefined) }, [snapshot.epoch, snapshot.serverUrl, snapshot.mode, tenant, workspace])
  const needsModels = section === 'agent' || section === 'settings'
  const models = useWorkspaceModels(call, snapshot.epoch, base + '/model-credentials', snapshot.serverUrl,
    needsModels && snapshot.mode === 'cloud' && !!tenant && !!workspace)
  const credentials = (models.page?.items ?? []).map(row => ({ id: row.id, name: row.model, runtimeId: '' }))
  const filesOpen = section === 'files' && snapshot.mode === 'cloud' && !!tenant && !!workspace
  const activeUpload = useRef('')
  activeUpload.current = filesOpen ? uploadContext : ''
  const uploadGeneration = useRef(0)
  useLayoutEffect(() => () => {
    uploadGeneration.current++
    transfer.current?.abort()
    if (filesOpen) setUploadState((previous) => {
      if (previous?.context !== uploadContext || !['checking', 'uploading', 'finalizing'].includes(previous.status)) return previous
      if (previous.pending?.asyncScan && previous.pending.publicationReady) return { ...previous, status: 'scanCheck' }
      if (previous.completion) return { ...previous, status: 'unconfirmed' }
      return previous.pending ? { ...previous, status: 'cancelled' } : undefined
    })
  }, [filesOpen, uploadContext])
  useEffect(() => { if (!filesOpen) setFolderSelection(undefined) }, [filesOpen])
  useEffect(() => {
    if (!filesOpen) return
    const { epoch, serverUrl } = snapshot
    let live = true
    const get = (path: string) => call({ epoch, path, method: 'GET', body: null, idempotencyKey: null })
    void Promise.all([get('/server-info'), get('/me')]).then(([info, me]) => {
      if (!live) return
      const serverId = z.uuid().parse(record(info).serverId), userId = z.uuid().parse(record(me).id)
      const scope = JSON.stringify([serverUrl, serverId, userId, tenant, workspace, ...(folderId === null ? [] : [folderId])])
      const pending = readUploadReceipt(scope)
      const advertised = z.object({ maxBytes: z.number().int().positive().max(256 * 1024 ** 2) }).safeParse(record(info).multipartScan)
      setUploadIdentity({ context: uploadContext, scope, ...(advertised.success ? { asyncMax: advertised.data.maxBytes } : {}) })
      if (pending !== undefined) setUploadState(previous => previous?.context === uploadContext
        ? previous : { context: uploadContext, status: pending.asyncScan ? 'scanCheck' : 'cancelled', pending,
          uploaded: pending.publicationReady ? pending.size : 0, total: pending.size })
    }).catch(() => {
      if (live) setUploadIdentity({ context: uploadContext, scope: null })
    })
    return () => { live = false }
  }, [call, filesOpen, snapshot.epoch, snapshot.serverUrl, tenant, workspace, uploadContext])
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
    if (exportCurrent()) { setResult(receipt); actions.refreshBots(); actions.section('agent') }
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
  }
  const refresh = async (current: () => boolean, includeBinding = true) => {
    const [runtimes, sessions, desktops] = await Promise.all([
      request(base + '/runtimes'), readSessionPage(base, request), request(base + '/desktops'),
    ])
    const [presetValue, info] = await Promise.all([request(base + '/model-templates').catch(() => null), request('/server-info')])
    if (!current()) return
    setRuntimes(rows(runtimes)); setSessionPage(sessions)
    setTemplates(modelTemplates(presetValue)); setDesktops(rows(desktops ?? null)); refreshObjects(value => value + 1)
    const supportsBots = record(record(info).capabilities ?? null).workspaceBots === true
    setSupportsBots(supportsBots)
    if (supportsBots) await refreshBots(current)
    if (session && includeBinding && current()) await loadBinding(session, current)
  }
  const refreshBots = async (current: () => boolean) => {
    const result = await readWorkspaceBots(base, request, current)
    if (!current()) return
    setBots(result.map(item => ({ id: item.id, name: `${item.name} · ${t('bindingRevision')} ${item.latestRevision}`, runtimeId: '', revision: item.latestRevision })))
  }
  useEffect(() => {
    if (section !== 'desktop' || snapshot.mode !== 'cloud' || !tenant || !workspace) return
    let live = true
    const ticket = generation.current
    void Promise.all([request(base + '/runtimes'), request(base + '/desktops')]).then(([r, d]) => {
      if (live && ticket === generation.current) { setRuntimes(rows(r)); setDesktops(rows(d)) }
    }).catch(() => { if (live && ticket === generation.current) setFailed(true) })
    return () => { live = false }
  }, [section, objectScope, call])
  useEffect(() => {
    if (!needsModels || snapshot.mode !== 'cloud' || !tenant || !workspace) return
    let live = true
    const ticket = generation.current
    const valid = () => live && generation.current === ticket && exportCurrent()
    // Read on entry without making an unrelated credential read or explicit write wait.
    void refresh(valid, false).catch(() => { if (valid()) setFailed(true) })
    return () => { live = false }
  }, [needsModels, botSetupVersion, botCreateVersion, snapshot.epoch, snapshot.serverUrl, snapshot.mode, tenant, workspace])
  const beginRead = (expectedPath: string) => {
    const sequence = ++readSequence.current
    setFileRead(undefined)
    return (value: CloudValue) => {
      const op = record(value), file = record(record(op.result ?? null).file ?? null)
      if (sequence === readSequence.current && op.runtimeId === runtime && file.path === expectedPath) {
        setFileRead({ scope: fileScope, value })
      }
    }
  }
  const queued = async (target: string, body: CloudValue, current: () => boolean, desktopKind?: DesktopOperationKind) => {
    const input = record(body)
    const onRead = target === runtimePath + '/files' && input.action === 'read' && typeof input.path === 'string'
      ? beginRead(input.path) : undefined
    const key = randomUUID()
    const kind: RuntimeAction | undefined = target === runtimePath + '/commands' ? 'command'
      : target === runtimePath + '/lifecycle' && (input.action === 'start' || input.action === 'stop') ? input.action : undefined
    if (kind) {
      const scope = await receipts.scope(snapshot.serverUrl, snapshot.epoch, runtimePath, call)
      if (!current() || activeContext.current !== context) return
      receipts.reserve({ scope, kind, key })
    }
    // Keep the key visible even if the first write response is lost. Never replay automatically.
    remember({ scope: runtimePath, path: target, key })
    setResult({ idempotencyKey: key, path: target })
    const receipt = record(await request(target, 'POST', body, key).catch((error) => {
        if (kind && error instanceof CloudRequestFailure && ['VALIDATION_ERROR', 'WORKER_UNAVAILABLE', 'SERVICE_NOT_ENABLED',
          'RUNTIME_NOT_READY', 'QUEUE_FULL', 'RUNTIME_NOT_FOUND', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_ARCHIVED', 'WORKSPACE_WRITE_REQUIRED'].includes(error.message)) {
          receipts.forget(key); rejected(runtimePath, key)
        }
        throw error
      })), id = text(receipt.id)
    const pollBase = `${base}/runtimes/${text(receipt.runtimeId) || runtime}`
    if (!id) throw new Error('MISSING_OPERATION_ID')
    if (desktopKind && (receipt.runtimeId !== runtime || !z.uuid().safeParse(id).success)) throw Error('DESKTOP_RECEIPT_MISMATCH')
    if (kind) {
      if (receipt.runtimeId !== runtime || receipt.kind !== kind || !z.uuid().safeParse(id).success) throw Error('TASK_RECEIPT_MISMATCH')
    }
    if (accepted(runtimePath, key, { path: pollBase, id, ...(desktopKind ? { desktopKind } : {}) }) && kind) receipts.forget(key)
    const visible = () => current() && (!kind || activeContext.current === context)
    if (!visible()) return
    setResult(receipt)
    for (let count = 0; count < 660 && visible(); count++) {
      const settled = record(await request(`${pollBase}/operations/${id}`))
      if (!visible()) return
      if (kind && (settled.id !== id || settled.runtimeId !== runtime || settled.kind !== kind)) throw Error('TASK_STATUS_MISMATCH')
      if (desktopKind) checkDesktopOperation(settled, id, runtime, desktopKind)
      setResult(settled)
      if (settled.state === 'succeeded' && settled.id === id) onRead?.(settled)
      const output = record(settled.result ?? null)
      if (desktopKind === 'computer' && input.action === 'screenshot' && settled.state === 'succeeded' &&
        output.mimeType === 'image/png' && typeof output.data === 'string') setImage({ scope: desktopScope, src: `data:image/png;base64,${output.data}` })
      if (!['queued', 'running'].includes(text(settled.state))) return
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  const sandboxAction = (fallback: SandboxIssue, action: (current: () => boolean) => Promise<void>) => async (current: () => boolean) => {
    setSandboxIssue(undefined)
    try { await action(current) } catch (error) {
      if (!current()) return
      const code = error instanceof CloudRequestFailure ? error.message : undefined
      setSandboxIssue(code === 'SERVICE_NOT_ENABLED' ? 'sandboxDisabled' : code === 'WORKER_UNAVAILABLE' ? 'sandboxWorkerUnavailable' : fallback)
    }
  }
  const saveRuntime = (data: CloudValue) => {
    const row = rows([data])[0]
    if (!row?.id) throw new Error('INVALID_SANDBOX_RECEIPT')
    setRuntimes(items => items?.some(item => item.id === row.id)
      ? items.map(item => item.id === row.id ? row : item)
      : [...items ?? [], row])
    return row
  }
  const allocateRuntime = sandboxAction('sandboxAllocationUnconfirmed', async (current) => {
    const data = await request(base + '/runtimes', 'POST', null, randomUUID())
    if (current()) { setRuntime(saveRuntime(data).id); setResult(data) }
  })
  const changeRuntimeState = async (action: 'start' | 'stop', current: () => boolean) => {
    await queued(runtimePath + '/lifecycle', { action }, current)
    if (!current()) return
    const data = await request(runtimePath)
    return current() ? saveRuntime(data).state : undefined
  }
  const startRuntime = sandboxAction('sandboxStartUnconfirmed', async (current) => {
    if (await changeRuntimeState('start', current) !== 'ready' && current()) setSandboxIssue('sandboxStartUnconfirmed')
  })
  const checkPublication = async (pending: PendingUpload, method: 'GET' | 'POST', current: () => boolean) => {
    if (!pending.asyncScan || !uploadScope || pending.scope !== uploadScope || !current()) return
    const generation = uploadGeneration.current
    const valid = () => current() && activeUpload.current === uploadContext && generation === uploadGeneration.current
    const show = (status: UploadState['status'], record = pending) => setUploadState({ context: uploadContext, status,
      pending: record, uploaded: record.publicationReady ? record.size : 0, total: record.size })
    try {
      const receipt = publication.parse(await request(`${base}/multipart/${pending.objectId}/publication`, method))
      if (!valid()) return
      if (receipt.objectId !== pending.objectId) throw Error('PUBLICATION_RECEIPT_MISMATCH')
      if (receipt.state === 'published') {
        clearUploadReceipt(pending.scope, pending.objectId)
        setUploadState({ context: uploadContext, status: 'completed', uploaded: pending.size, total: pending.size })
        setResult(receipt); refreshObjects(v => v + 1)
      } else if (receipt.state === 'uploading') show(pending.publicationReady ? 'scanSubmit' : 'cancelled')
      else show(({ queued: 'scanQueued', scanning: 'scanning', blocked: 'scanBlocked', failed: 'scanFailed', expired: 'expired' } as const)[receipt.state])
    } catch (error) {
      if (!valid()) return
      if (error instanceof CloudRequestFailure && error.message === 'PARTS_INCOMPLETE' && method === 'POST') {
        const { publicationReady: _ready, ...resume } = pending
        if (resume.fingerprint) saveUploadReceipt({ ...resume, fingerprint: resume.fingerprint })
        show('cancelled', resume)
      } else show('scanCheck')
    }
  }
  const uploadFile = async (taskCurrent: () => boolean) => {
    const generation = uploadGeneration.current
    const current = () => taskCurrent() && generation === uploadGeneration.current && activeUpload.current === uploadContext
    const selected = file
    if (selected === undefined || terminalUpload(uploadState) || !current()) return
    const contentType = selected.type || 'application/octet-stream'
    const controller = new AbortController()
    transfer.current = controller
    const guard = () => {
      controller.signal.throwIfAborted()
      if (!current()) throw new DOMException('Upload context changed', 'AbortError')
    }
    const pending = uploadState?.pending
    let state: UploadState = { context: uploadContext, status: 'uploading', uploaded: uploadState?.uploaded ?? 0, total: pending?.size ?? selected.size,
      pending, completion: uploadState?.completion }
    const update = (patch: Partial<UploadState>) => {
      state = { ...state, ...patch }
      if (current()) setUploadState(state)
    }
    let completed: CloudValue
    try {
      if (state.completion === undefined && pending === undefined && selected.size <= MULTIPART_THRESHOLD) {
        update({ status: 'uploading' })
        const upload = record(await request(base + '/uploads', 'POST', { filename: selected.name, contentType, size: selected.size, ...(folderId ? { folderId } : {}) }))
        guard()
        const objectId = text(record(upload.object ?? null).id), target = new URL(text(upload.uploadUrl))
        if (!objectId || !['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw Error('INVALID_UPLOAD_URL')
        const response = await fetch(target, { method: 'PUT', redirect: 'error', credentials: 'omit', headers: { 'Content-Type': contentType },
          body: selected, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
        guard()
        if (!response.ok) throw Error('UPLOAD_FAILED')
        update({ completion: { kind: 'uploads', objectId } })
      } else if (state.completion === undefined) {
        update({ status: 'checking' })
        if (uploadScope === undefined || selected.size > MAX_MULTIPART_SIZE) throw Error('MULTIPART_UNAVAILABLE')
        if (pending !== undefined && (pending.size !== selected.size || pending.filename !== selected.name
          || pending.contentType !== contentType)) {
          update({ status: 'different' })
          return
        }
        const fingerprint = pending?.source === selected ? pending.fingerprint : await uploadFingerprint(selected, controller.signal)
        guard()
        if (pending !== undefined && pending.source !== selected && (fingerprint === undefined || fingerprint !== pending.fingerprint)) {
          update({ status: 'different' })
          return
        }
        const session = multipartSession.parse(pending === undefined
          ? await request(base + '/multipart', 'POST', { filename: selected.name, contentType, size: selected.size, ...(folderId ? { folderId } : {}),
            ...(canChooseScan && scanChoice === selected ? { asyncScan: true } : {}) }, randomUUID())
          : await request(`${base}/multipart/${pending.objectId}`))
        if (session.size !== selected.size || session.partCount !== Math.ceil(selected.size / session.partSize)
          || (pending !== undefined && pending.objectId !== session.objectId)) throw Error('INVALID_MULTIPART_SESSION')
        if (pending === undefined && current()) {
          const identity = {
            scope: uploadScope ?? '', objectId: session.objectId, filename: selected.name, contentType,
            size: selected.size, expires: Date.parse(session.expiresAt),
            ...(canChooseScan && scanChoice === selected ? { asyncScan: true as const } : {}),
          }
          if (uploadScope !== null && fingerprint !== undefined) saveUploadReceipt({ ...identity, fingerprint })
          update({ pending: { ...identity, source: selected, ...(fingerprint === undefined ? {} : { fingerprint }) } })
        }
        guard()
        if (session.state === 'expired') { update({ status: 'expired' }); return }
        const { objectId, partSize, partCount } = session
        if (session.state === 'pending') {
          if (session.uploaded.some(part => part > partCount)) throw Error('INVALID_MULTIPART_PART')
          const uploaded = new Set(session.uploaded)
          const bytesFor = (part: number) => Math.min(partSize, selected.size - (part - 1) * partSize)
          update({ status: 'uploading', uploaded: [...uploaded].reduce((sum, part) => sum + bytesFor(part), 0) })
          await uploadMissingParts({
            file: selected, partSize,
            missing: Array.from({ length: partCount }, (_, index) => index + 1).filter(part => !uploaded.has(part)),
            signal: controller.signal, guard,
            sign: part => request(`${base}/multipart/${objectId}/parts/${part}`, 'POST'),
            onUploaded: (bytes) => { update({ uploaded: state.uploaded + bytes }) },
          })
        }
        if (state.pending?.asyncScan) {
          guard()
          const ready = { ...state.pending, publicationReady: true as const }
          if (ready.fingerprint) saveUploadReceipt({ ...ready, fingerprint: ready.fingerprint })
          update({ pending: ready, status: 'finalizing', uploaded: selected.size })
          await checkPublication(ready, session.state === 'available' ? 'GET' : 'POST', current)
          return
        }
        update({ completion: { kind: 'multipart', objectId } })
      }
      guard()
      const completion = state.completion
      if (completion === undefined) throw Error('MISSING_UPLOAD_COMPLETION')
      const { kind, objectId } = completion
      update({ status: 'finalizing', uploaded: selected.size })
      completed = await request(`${base}/${kind}/${objectId}/complete`, 'POST')
      const published = record(completed)
      if (published.id !== objectId || published.status !== 'available'
        || (published.workspaceId !== undefined && published.workspaceId !== workspace)
        || (published.tenantId !== undefined && published.tenantId !== tenant)) throw Error('UPLOAD_RECEIPT_MISMATCH')
      if (kind === 'multipart' && typeof uploadScope === 'string') clearUploadReceipt(uploadScope, objectId)
    } catch (error) {
      const code = error instanceof CloudRequestFailure ? error.message : undefined
      switch (code) {
        case 'UPLOAD_NOT_FOUND': case 'UPLOAD_NOT_PENDING': case 'UPLOAD_EXPIRED': case 'OBJECT_NOT_FOUND':
          update({ status: 'expired', completion: undefined }); break
        case 'OBJECT_SCAN_BLOCKED':
          update({ status: 'scanBlocked', completion: undefined }); break
        case 'STORAGE_SCAN_SIZE_LIMIT':
          update({ status: 'scanLimit', completion: undefined }); break
        case 'STORAGE_SCAN_BUSY': case 'STORAGE_SCAN_UNAVAILABLE':
          update({ status: 'scanUnavailable' }); break
        case 'PARTS_INCOMPLETE':
          update({ status: 'failed', completion: undefined }); break
        default:
          update({ status: controller.signal.aborted ? 'cancelled' : state.completion !== undefined ? 'unconfirmed' : 'failed' })
      }
      return
    } finally {
      if (transfer.current === controller) transfer.current = undefined
    }
    if (current()) {
      setUploadState({ context: uploadContext, status: 'completed', uploaded: selected.size, total: selected.size })
      setResult(completed)
      refreshObjects(value => value + 1)
    }
  }
  const discardUpload = async (current: () => boolean) => {
    const generation = uploadGeneration.current
    const pending = uploadState?.pending
    if (pending !== undefined && uploadState?.status !== 'expired') {
      try { await request(`${base}/multipart/${pending.objectId}`, 'DELETE') }
      catch (error) {
        if (!(error instanceof CloudRequestFailure) || !['UPLOAD_NOT_FOUND', 'UPLOAD_COMPLETED'].includes(error.message)) throw error
      }
    }
    if (pending?.scope) clearUploadReceipt(pending.scope, pending.objectId)
    if (current() && generation === uploadGeneration.current && activeUpload.current === uploadContext) {
      setUploadState(undefined)
      setFile(undefined)
      if (uploadInput.current) uploadInput.current.value = ''
    }
  }
  const selectUploadFile = (next: File | undefined) => {
    setScanChoice(undefined)
    setFile(next === undefined ? undefined : { context: uploadContext, file: next })
    setResult(null)
    setUploadState(previous => previous?.context !== uploadContext || previous.pending === undefined ? undefined
      : terminalUpload(previous) || awaitingScan(previous)
        ? previous : { ...previous, status: 'cancelled', completion: undefined })
  }
  const uploadAction = uploadState?.completion !== undefined ? 'uploadRetryPublication'
    : uploadState?.pending === undefined ? 'upload' : 'uploadResume'
  const canUpload = file !== undefined && uploadState?.status !== 'completed' && !terminalUpload(uploadState)
    && (file.size <= MULTIPART_THRESHOLD || uploadScope !== undefined)
  const scanPending = uploadState?.pending?.asyncScan ? uploadState.pending : undefined
  const discardAction = uploadState?.status === 'expired' ? 'uploadClear'
    : uploadState?.pending === undefined ? 'uploadClearSelection' : 'uploadDiscard'
  const field = (label: string, value: string, update: (value: string) => void, type = 'text') => <label className={css.field}>{label}<input type={type} value={value} onChange={(event) =>{  update(event.target.value) }} disabled={!usable} /></label>
  const select = (label: string, value: string, update: (value: string) => void, items: Row[]) => <label className={css.field}>{label}<select aria-label={label} value={value} onChange={(event) =>{  update(event.target.value) }} disabled={!usable}><option value="">{t('choose')}</option>{value && !items.some(item => item.id === value) && <option value={value}>{value}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  const button = (label: string, action: (current: () => boolean) => Promise<void>, enabled = true) => <Button variant="outline" disabled={!usable || !enabled} onClick={task(action)}>{label}</Button>
  const desktopButton = (label: string, action: (current: () => boolean) => Promise<void>, enabled: boolean) =>
    button(label, async (current) => {
      const ticket = desk.generation.current
      const valid = () => current() && desk.generation.current === ticket
      try { await action(valid) } catch (error) { if (valid()) throw error }
    }, enabled)
  const runningDesktop = desk.state === 'running'
  const taskReferenceButton = section === 'desktop' || operation?.desktopKind ? desktopButton : button
  const renderSection = (group: CloudSection, label: string, children: ReactNode) => group === section
    ? <section className={css.section}><h3>{label}</h3>{children}</section> : null
  const locked = snapshot.mode !== 'local'
  const selectedRuntime = runtimes.find(item => item.id === runtime)
  const sessionNeedsRuntime = selectedRuntime?.state !== 'ready'
  const sessionNeedsCredential = !credentials.some(row => row.id === credential)
  const sessionNeedsDesktop = !!desktop && !desktops.some(item => item.id === desktop && item.runtimeId === runtime)
  const sandboxNotice = sandboxIssue === undefined ? null : <p className={`${css.notice} ${css.error}`} role="alert">{t(sandboxIssue)}</p>
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
        {snapshot.error === 'CLOUD_PROTOCOL_UNSUPPORTED' ? t('protocolUnsupported') : failed ? t('failure') : snapshot.mode === 'cloud-suspended' ? t('localBlocked') : busy ? t('waiting') : t(snapshot.mode)}
      </p>
      {(snapshot.mode === 'cloud' || snapshot.mode === 'cloud-suspended') && <LocalArchive key={`${snapshot.serverUrl}:${snapshot.epoch}:${tenant}:${workspace}`} t={t} epoch={snapshot.epoch} read={readLocal}
        {...(workspace !== '' && usable && exportLocal !== undefined ? { previewBot, exportBot } : {})}
        cloudAvailable={snapshot.mode === 'cloud'} openCloud={() => { actions.section('agent') }} />}
      {snapshot.mode === 'cloud' && <>
        <section className={css.context}>
          <h3>{t('workspace')}</h3>
          <div className={css.group}>{button(t('refreshTenants'), async (current) => { const data = await request('/me/tenants'); if (current()) setTenants(rows(data)) })}
            {select(t('tenant'), tenant, setTenant, tenants)}
            <CloudWorkspacePicker key={JSON.stringify([snapshot.serverUrl, snapshot.epoch, tenant])} t={t} tenant={tenant}
              epoch={snapshot.epoch} value={workspace} select={setWorkspace} call={call} disabled={!usable} /></div>
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
          {renderSection('tasks', t('history'), runtime ? <CloudTaskHistory key={fileScope} t={t} runtime={runtime} base={base} epoch={snapshot.epoch} call={call} /> : <p>{t('runtime')}</p>)}
          <div className={css.group}>{button(t('refreshResources'), async (current) => { setSandboxIssue(undefined); models.refresh(); await refresh(current); if (current()) actions.refreshBots() })}{section !== 'overview' && section !== 'agent' && select(t('runtime'), runtime, setRuntime, runtimes)}</div>
          {renderSection('overview', t('runtime'), <>
            <div className={css.group}>
              {select(t('runtime'), runtime, setRuntime, runtimes)}
              {button(t('allocate'), allocateRuntime)}
              {button(t('start'), startRuntime, !!runtime)}
              {button(t('stop'), async (current) => { await changeRuntimeState('stop', current) }, !!runtime)}
              {button(t('history'), async () => { actions.section('tasks') }, !!runtime)}
            </div>
            {sandboxNotice}
          </>)}
          {renderSection('settings', t('credential'), <>
            {templates.length > 0 && <div className={css.group}><label className={css.field}>{t('modelTemplate')}<select aria-label={t('modelTemplate')} value={template} onChange={(event) => { setTemplate(event.target.value) }} disabled={!usable}><option value="">{t('choose')}</option>{templates.map(item => <option key={item.id} value={item.id}>{item.provider} · {item.model}</option>)}</select></label>
              <Button variant="outline" disabled={!usable || !template} onClick={() => {
                const selected = templates.find(item => item.id === template)
                if (selected) { setApiKey(''); setEndpoint(selected.endpoint); setModel(selected.model) }
              }}>{t('useTemplate')}</Button></div>}
            <div className={css.group}>{field(t('endpoint'), endpoint, setEndpoint, 'url')}{field(t('model'), model, setModel)}{field(t('apiKey'), apiKey, setApiKey, 'password')}
              {button(t('saveCredential'), async (current) => { const secret = apiKey; setApiKey(''); const data = await request(base + '/model-credentials', 'POST', { endpoint, model, apiKey: secret }); if (current()) { setResult(data); models.refresh(); await refresh(current) } }, !!apiKey && !!model)}</div>
          </>)}
          {renderSection('agent', t('session'), <>
            {supportsBots && <section className={css.botRoster} aria-label={t('chatBotList')}>
              <h4>{t('chatBotList')}</h4>
              {bots.length === 0 ? <p className={css.notice}>{t('empty')}</p> : <ul>
                {bots.map(item => <li key={item.id}>
                  <button type="button" className={botId === item.id ? css.botSelected : undefined} onClick={() => { setBotId(item.id) }}>
                    <span>{item.name}</span><small>v{item.revision}</small>
                  </button>
                </li>)}
              </ul>}
            </section>}
            {!credentials.length && <p role={models.status === 'error' ? 'alert' : 'status'}>
              {t(models.status === 'loading' ? 'waiting' : models.page ? 'noWorkspaceModels' : 'modelsReadFailed')}
              {models.status === 'error' && !models.page && <Button variant="outline" onClick={models.refresh}>{t('retry')}</Button>}
              {models.page && <Button variant="outline" onClick={() => actions.section('settings')}>{t('manageModels')}</Button>}
            </p>}
            <div className={css.group}>
              {select(t('runtime'), runtime, (value) => { setSandboxIssue(undefined); setRuntime(value) }, runtimes)}
              {runtimeList?.length === 0 && button(t('allocate'), allocateRuntime)}
              {selectedRuntime?.state === 'stopped' && button(t('start'), startRuntime)}
            </div>
            {sandboxNotice}
            {sessionNeedsRuntime && runtimeList && <p className={css.notice} role="status">{t(runtimes.length === 0 ? 'sessionAllocateSandbox'
              : selectedRuntime?.state === 'stopped' ? 'sessionStartSandbox' : 'sessionSelectSandbox')}</p>}
            <div className={css.group}>{select(t('credential'), credential, setCredential, credentials)}
              {models.page?.nextCursor && <Button variant="outline" disabled={!usable || models.status === 'loadingMore'} onClick={() => { void models.more() }}>{t('moreModels')}</Button>}
              {models.page && models.status === 'error' && <p role="alert">{t('modelPageFailed')}</p>}
              {models.page?.truncated && <p>{t('legacyModels')}</p>}
              {select(t('sessionDesktop'), desktop, setDesktop, desktops.filter(item => item.runtimeId === runtime))}
              {supportsBots && select(t('chatBotOptional'), botId, setBotId, bots)}
              {select(t('session'), session, (value) => { actions.filterBot('', value); setBinding(null) },
                (sessionPage?.items ?? []).map(row => ({ id: row.id, name: row.title || row.id, runtimeId: '' })))}
              {sessionPage?.nextCursor && button(t('moreSessions'), async (current) => {
                const next = await readSessionPage(base, request, '', sessionPage)
                if (current()) setSessionPage(next)
              })}
              {sessionPage?.truncated && <p>{t('legacySessions')}</p>}
              {button(t('createSession'), async (current) => {
                const data = await request(base + '/sessions', 'POST', {
                  runtimeId: runtime, credentialId: credential, ...(desktop ? { desktopId: desktop } : {}),
                  ...(bot ? { bot: { id: bot.id, revision: bot.revision } } : {}), title: name || t('session'),
                }, randomUUID())
                if (current()) {
                  const id = text(record(data).id)
                  actions.filterBot(bot?.id ?? '', id); setBinding(null); setResult(data)
                  await refresh(current, false)
                  if (current()) await loadBinding(id, current)
                }
              }, !sessionNeedsRuntime && !sessionNeedsCredential && (!botId || bot !== undefined) && !sessionNeedsDesktop)}
              <Button variant="outline" disabled={!usable || !session} onClick={openChat}>{t('openCloudConversation')}</Button>
            </div>
            {!sessionNeedsRuntime && credentials.length > 0 && sessionNeedsCredential && <p className={css.notice} role="status">{t('sessionSelectCredential')}</p>}
            {!sessionNeedsRuntime && sessionNeedsDesktop && <p className={css.notice} role="status">{t('sessionSelectMatchingDesktop')}</p>}
            {supportsBots && <details key={botCreateVersion} className={css.botEditor} open={botCreateVersion > 0}>
              <summary>{t('chatBotCreate')}</summary>
              <p className={css.notice}>{t('chatBotCreateHint')}</p>
              <div className={css.group}>
                {field(t('chatBotName'), botName, setBotName)}
                {field(t('chatBotRole'), botRole, setBotRole)}
              </div>
              <label className={css.field}>{t('chatBotInstructions')}<textarea value={botInstructions} maxLength={16000} onChange={(event) => { setBotInstructions(event.target.value) }} disabled={!usable} /></label>
              {button(t('chatBotCreate'), async (current) => {
                const created = record(await request(`${base}/bots`, 'POST', {
                  definition: {
                    schemaVersion: 1, name: botName.trim(), role: botRole.trim(), instructions: botInstructions, requiredCapabilities: [],
                  },
                  source: { kind: 'manual' },
                }, randomUUID()))
                if (current()) {
                  setBotName(''); setBotRole(''); setBotInstructions('')
                  const id = text(created.id)
                  if (!z.uuid().safeParse(id).success) throw new Error('INVALID_BOT_RECEIPT')
                  actions.createdBot(id, session, botFilter, botId)
                  setResult({ ...created, created: true })
                  await refreshBots(current)
                }
              }, !!botName.trim() && botInstructions.length <= 16000)}
            </details>}
          </>)}
          {renderSection('overview', t('command'), <div className={css.group}>{field(t('command'), command, setCommand)}{button(t('execute'), current => queued(runtimePath + '/commands', { command, timeoutSeconds: 30 }, current), !!runtime && !!command)}</div>)}
          {workspace && runtime && locked && <section className={section === 'files' ? css.section : undefined} hidden={section !== 'files'}>
            <h3>{t('fileSandbox')}</h3>
            {section === 'files' && <AuthenticatedCloudFiles key={fileScope} runtime={runtime} runtimePath={runtimePath} epoch={snapshot.epoch} scope={fileIdentity}
              state={files ?? localFiles} enabled={usable} t={t} call={call} beginRead={beginRead} />}
            <details>
              <summary>{t('fileLegacy')}</summary>
              <div className={css.group}>{field(t('path'), path, setPath)}{button(t('list'), current => queued(runtimePath + '/files', { action: 'list', path }, current), !!runtime)}{button(t('read'), current => queued(runtimePath + '/files', { action: 'read', path }, current), !!runtime)}</div>
              <label className={css.field}>{t('content')}<textarea value={content} onChange={(event) => { setContent(event.target.value) }} disabled={!usable} /></label>
              {button(t('write'), (current) => { const bytes = new TextEncoder().encode(content); if (bytes.length > 16384) throw new Error('FILE_TOO_LARGE'); return queued(runtimePath + '/files', { action: 'write', path, content: btoa(String.fromCharCode(...bytes)) }, current) }, !!runtime)}
            </details>
          </section>}
          {section === 'files' && <CloudArtifacts key={fileScope} t={t} scope={base}
            result={fileRead?.scope === fileScope ? fileRead.value : null}
            receipts={sharedArtifacts ?? localArtifacts.current} enabled={usable} call={request} />}
          {renderSection('files', t('storage'), <>
            <p className={css.notice}>{t('uploadHint')}</p>
            <p className={css.notice}>{t('uploadResumable')}</p>
            <div className={css.group}>
              <label className={css.field}>{t('files')}
                <input key={uploadContext} ref={uploadInput} type="file" disabled={!usable || awaitingScan(uploadState)}
                  onChange={(event) => { selectUploadFile(event.target.files?.[0]) }} />
              </label>
              {canChooseScan && <label><input type="checkbox" checked={scanChoice === file} disabled={!usable}
                onChange={e => setScanChoice(e.target.checked ? file : undefined)} />{t('asyncOptIn')}</label>}
              {!awaitingScan(uploadState) && button(t(uploadAction), uploadFile, canUpload)}
              {scanPending && !terminalUpload(uploadState) && <>
                {button(t('asyncCheck'), current => checkPublication(scanPending, 'GET', current))}
                {uploadState?.status === 'scanSubmit' && button(t('asyncSubmit'), current => checkPublication(scanPending, 'POST', current))}
              </>}
              {(uploadState?.status === 'checking' || uploadState?.status === 'uploading') &&
                <Button variant="outline" onClick={() => { transfer.current?.abort() }}>{t('uploadCancel')}</Button>}
              {!busy && (uploadState?.pending !== undefined || terminalUpload(uploadState)) &&
                <Button variant="outline" disabled={!usable} onClick={task(discardUpload)}>{t(discardAction)}</Button>}
            </div>
            {uploadState !== undefined && <div className={css.uploadStatus} role="status">
              <span>{t(uploadState.status === 'cancelled' && file === undefined && uploadState.pending !== undefined
                ? 'uploadReselect' : uploadState.status === 'failed' && uploadState.pending === undefined
                  ? 'uploadTransferFailed' : UPLOAD_STATUS[uploadState.status])}</span>
              {!terminalUpload(uploadState) && <>
                <progress value={uploadState.uploaded} max={uploadState.total} aria-label={t('uploadProgress')} />
                <span>{uploadState.uploaded.toLocaleString()} / {uploadState.total.toLocaleString()} {t('uploadBytes')}</span>
              </>}
              {uploadState.pending !== undefined && <bdi className={css.uploadName}>{uploadState.pending.filename}</bdi>}
            </div>}
            {filesOpen && <CloudObjectBrowser key={objectScope} t={t} base={base} enabled={usable} request={request} current={exportCurrent}
              revision={objectRevision} selectFolder={(id) => { setFolderSelection({ scope: objectScope, id }) }} />}
          </>)}
          {renderSection('desktop', t('desktop'), <>
            <div className={css.group}>{select(t('desktop'), desktop, (value) => { const match = desktops.find(item => item.id === value); if (match) setRuntime(match.runtimeId); setDesktop(value) }, desktops.filter(item => !runtime || item.runtimeId === runtime))}
              {desktopButton(t('createDesktop'), async (current) => {
                const data = await request(base + '/desktops', 'POST', { runtimeId: runtime })
                if (!current()) return
                const row = readDesktop(data, runtime)
                setDesktops(items => [...items.filter(item => item.id !== row.id), { ...row, name: row.id }])
                setDesktop(row.id); desk.reload()
              }, selectedRuntime?.state === 'ready')}
              {desktopButton(t('desktopStart'), async (current) => {
                await queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'start' }, current, 'desktop_start')
                if (current()) desk.reload()
              }, desk.state === 'stopped')}
              {desktopButton(t('desktopStop'), async (current) => {
                await queued(`${base}/desktops/${desktop}/lifecycle`, { action: 'stop' }, current, 'desktop_stop')
                if (current()) { setImage(undefined); desk.reload() }
              }, runningDesktop || desk.state === 'unknown')}
              {desktopButton(t('connectDesktop'), async (current) => {
                const popup = window.open('about:blank', '_blank'); if (!popup) throw Error('POPUP_BLOCKED'); popup.opener = null
                try {
                  const value = record(await request(`${base}/desktops/${desktop}/viewer`, 'POST'))
                  if (!current()) { popup.close(); return }
                  const target = new URL(text(value.viewerUrl))
                  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || !/^\/[a-f0-9]{64}\/$/.test(target.pathname)) throw Error('INVALID_VIEWER_URL')
                  popup.location.href = target.href
                } catch (error) { popup.close(); throw error }
              }, runningDesktop)}
              {desktopButton(t('screenshot'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'screenshot' }, current, 'computer'), runningDesktop)}</div>
            {desktop && runtime && <div className={css.group}><p role="status">{t(desk.state === 'running' ? 'deskRunning' : desk.state === 'stopped' ? 'deskStopped'
              : desk.state === 'error' ? 'deskReadFailed' : desk.state === 'unknown' ? 'deskUnknown' : 'waiting')}</p>
            <Button variant="outline" disabled={!usable} onClick={desk.reload}>{t('deskRefresh')}</Button></div>}
            {runningDesktop && image?.scope === desktopScope && <img className={css.image} src={image.src} alt={t('desktopAlt')} />}
            <div className={css.group}>{field(t('text'), desktopText, setDesktopText)}{desktopButton(t('type'), current => queued(`${base}/desktops/${desktop}/computer`, { action: 'type', text: desktopText }, current, 'computer'), runningDesktop && !!desktopText)}</div>
            <div className={css.group}>{field(t('browserUrl'), url, setUrl)}{desktopButton(t('navigate'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'navigate', url }, current, 'browser'), runningDesktop)}{desktopButton(t('browserContent'), current => queued(`${base}/desktops/${desktop}/browser`, { action: 'content' }, current, 'browser'), runningDesktop)}</div>
          </>)}
        </>}
      </>}
      {needsLookup && scopeFailure === context && <Button variant="outline" onClick={() => retryScope(n => n + 1)}>{t('taskRetryIdentity')}</Button>}
      {pendingTasks.map(entry => <section key={entry.key} className={css.section}>
        <p><span>{t('unknownResult')}</span> · {t(entry.kind === 'command' ? 'command' : entry.kind)} · <code>{entry.key}</code></p>
        <Button variant="outline" disabled={!usable} onClick={task(async (current) => {
          const valid = () => current() && activeContext.current === context
          const lookup = await request(runtimePath + '/task-receipts?kind=' + entry.kind + '&key=' + encodeURIComponent(entry.key))
            .catch(() => undefined)
          if (!valid()) return
          if (lookup === null) { setLookupNotice({ key: entry.key, message: 'taskNotConfirmed' }); return }
          const receipt = lookup === undefined ? {} : record(lookup)
          if (receipt.runtimeId !== runtime || receipt.kind !== entry.kind || !z.uuid().safeParse(receipt.id).success) {
            setLookupNotice({ key: entry.key, message: 'taskLookupFailed' }); return
          }
          const id = text(receipt.id)
          const status = record(await request(runtimePath + '/operations/' + id).catch(() => null))
          if (!valid()) return
          if (status.id !== id || status.runtimeId !== runtime || status.kind !== entry.kind ||
            !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'unknown'].includes(text(status.state))) {
            setLookupNotice({ key: entry.key, message: 'taskLookupFailed' }); return
          }
          if (!activity || activity.key === entry.key) {
            remember({ scope: runtimePath, path: runtimePath + (entry.kind === 'command' ? '/commands' : '/lifecycle'), key: entry.key })
            accepted(runtimePath, entry.key, { path: runtimePath, id })
          }
          receipts.forget(entry.key); setResult(status)
        })}>{t('queryTask')}</Button>
        {lookupNotice?.key === entry.key && <p role="status">{t(lookupNotice.message)}</p>}
      </section>)}
      {activity !== undefined && !references.some(entry => entry.key === activity.key) && <section className={css.section}>
        <h3>{t('taskReference')}</h3>
        <p className={css.notice}>{operation?.id ?? t('unknownResult')}</p>
        {operation !== undefined && taskReferenceButton(t('queryTask'), async (current) => {
          const data = await request(`${operation.path}/operations/${operation.id}`)
          if (!current()) return
          if (operation.desktopKind) checkDesktopOperation(data, operation.id, runtime, operation.desktopKind)
          setResult(data)
        }, true)}
        {operation === undefined && <pre className={css.output}>
          {JSON.stringify({ path: activity.path, idempotencyKey: activity.key }, null, 2)}
        </pre>}
      </section>}
      {operation !== undefined && <Button variant="outline" disabled={snapshot.mode !== 'cloud'} onClick={task(async (current) => {
        const ticket = desk.generation.current
        const data = await request(`${operation.path}/operations/${operation.id}/cancel`, 'POST')
        if (!current() || ((section === 'desktop' || operation.desktopKind) && ticket !== desk.generation.current)) return
        if (operation.desktopKind) checkDesktopOperation(data, operation.id, runtime, operation.desktopKind)
        setResult(data)
      })}>{t('cancel')}</Button>}
      {record(result).created === true && <p className={css.notice} role="status">{t('chatBotCreated')}</p>}
      <pre className={css.output} aria-label={t('result')}>{result === null ? '' : JSON.stringify(result, null, 2)}</pre>
    </div>
  </div>
}
