/** Display-only metadata. Definitions and authentication secrets never enter this store. */
import type { LocalBotExportDefinition } from '../types.ts'

export interface BotSyncScope {
  readonly serverUrl: string
  readonly serverId: string
  readonly userId: string
  readonly tenantId: string
  readonly workspaceId: string
}
export interface BotSyncRecord extends BotSyncScope {
  readonly localBotId: string
  readonly cloudBotId: string
  readonly cloudRevision: number
  readonly cloudVersion: number
  readonly contentSha256: string
  readonly syncedAt: string
}
export interface BotExportPreview {
  readonly scope: BotSyncScope
  readonly definition: LocalBotExportDefinition
  readonly source: { kind: 'local-export'; localBotId: string; exportVersion: 1; exportedAt: string; contentSha256: string }
  readonly status: BotSyncStatus
  readonly sync?: BotSyncRecord
}
export type BotSyncStatus = 'new' | 'synced' | 'local-updated' | 'cloud-updated' | 'archived' | 'unknown' | 'pending'
export interface BotExportAttempt extends BotSyncScope {
  readonly localBotId: string
  readonly cloudBotId: string
  readonly expectedVersion: number
  readonly contentSha256: string
  readonly exportedAt: string
  readonly idempotencyKey: string
}
interface SyncData { version: 1; records: BotSyncRecord[]; attempts: BotExportAttempt[] }
const STORAGE_KEY = 'dsh.cloud.bot-sync.v1'
const LIMIT = 200
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,200}$/.test(value)
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function scopeValid(value: Record<string, unknown>): boolean {
  if (typeof value.serverUrl !== 'string' || !identifier(value.serverId) || !identifier(value.userId)
    || !identifier(value.tenantId) || !identifier(value.workspaceId) || !identifier(value.localBotId)) return false
  try { const url = new URL(value.serverUrl); return url.origin === value.serverUrl && ['https:', 'http:'].includes(url.protocol) } catch { return false }
}
function validRecord(value: unknown): value is BotSyncRecord {
  return object(value) && scopeValid(value) && identifier(value.cloudBotId) && positive(value.cloudRevision)
    && positive(value.cloudVersion) && hash(value.contentSha256) && timestamp(value.syncedAt)
}
function validAttempt(value: unknown): value is BotExportAttempt {
  return object(value) && scopeValid(value) && (value.cloudBotId === '' || identifier(value.cloudBotId))
    && Number.isSafeInteger(value.expectedVersion) && Number(value.expectedVersion) >= 0
    && hash(value.contentSha256) && timestamp(value.exportedAt) && identifier(value.idempotencyKey)
}
function read(): SyncData {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return { version: 1, records: [], attempts: [] }
  const value: unknown = JSON.parse(raw)
  if (!object(value) || value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.attempts)
    || value.records.length > LIMIT || value.attempts.length > LIMIT || !value.records.every(validRecord) || !value.attempts.every(validAttempt)) throw new Error('BOT_SYNC_STORAGE_INVALID')
  return { version: 1, records: value.records, attempts: value.attempts }
}
function write(data: SyncData): void {
  if (data.records.length > LIMIT || data.attempts.length > LIMIT) throw new Error('BOT_SYNC_STORAGE_FULL')
  // Explicit fields prevent a caller's definition, token, or other extra data from being persisted.
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1,
    records: data.records.map(r => ({ ...scopeFields(r), localBotId: r.localBotId, cloudBotId: r.cloudBotId,
      cloudRevision: r.cloudRevision, cloudVersion: r.cloudVersion, contentSha256: r.contentSha256, syncedAt: r.syncedAt })),
    attempts: data.attempts.map(r => ({ ...scopeFields(r), localBotId: r.localBotId, cloudBotId: r.cloudBotId,
      expectedVersion: r.expectedVersion, contentSha256: r.contentSha256, exportedAt: r.exportedAt, idempotencyKey: r.idempotencyKey })),
  }))
}
function scopeFields(scope: BotSyncScope): BotSyncScope {
  return {
    serverUrl: scope.serverUrl,
    serverId: scope.serverId,
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  }
}
export function sameBotSyncScope(a: BotSyncScope, b: BotSyncScope): boolean {
  return a.serverUrl === b.serverUrl && a.serverId === b.serverId && a.userId === b.userId
    && a.tenantId === b.tenantId && a.workspaceId === b.workspaceId
}
const matches = (a: BotSyncScope & { localBotId: string }, scope: BotSyncScope, botId: string) =>
  sameBotSyncScope(a, scope) && a.localBotId === botId
/** Read verified metadata; corrupt or unavailable storage blocks publication instead of losing its identity. */
export function findBotSyncRecord(scope: BotSyncScope, localBotId: string): BotSyncRecord | undefined {
  return read().records.find(item => matches(item, scope, localBotId))
}
export function findBotExportAttempt(scope: BotSyncScope, localBotId: string): BotExportAttempt | undefined {
  return read().attempts.find(item => matches(item, scope, localBotId))
}
/** Reserve a durable key before sending; a changed unknown request must be reconciled manually. */
export function reserveBotExportAttempt(attempt: BotExportAttempt): BotExportAttempt {
  if (!validAttempt(attempt)) throw new Error('BOT_SYNC_ATTEMPT_INVALID')
  const data = read(), existing = data.attempts.find(item => matches(item, attempt, attempt.localBotId))
  if (existing !== undefined) {
    if (existing.contentSha256 !== attempt.contentSha256 || existing.cloudBotId !== attempt.cloudBotId
      || existing.expectedVersion !== attempt.expectedVersion) throw new Error('BOT_EXPORT_RESULT_UNKNOWN')
    return existing
  }
  data.attempts.push(attempt); write(data); return attempt
}
/** Remove only a request the server definitively rejected before publication. */
export function rejectBotExportAttempt(attempt: BotExportAttempt): void {
  const data = read()
  data.attempts = data.attempts.filter(item =>
    !matches(item, attempt, attempt.localBotId) || item.idempotencyKey !== attempt.idempotencyKey)
  write(data)
}
/** Save a successful receipt even when the initiating view has closed. */
export function saveBotSyncRecord(record: BotSyncRecord): void {
  if (!validRecord(record)) throw new Error('BOT_SYNC_RECORD_INVALID')
  const data = read()
  data.records = data.records.filter(item => !matches(item, record, record.localBotId))
  data.records.push(record)
  data.attempts = data.attempts.filter(item => !matches(item, record, record.localBotId))
  write(data)
}
/** Match the server's validated definition order and name normalization before hashing. */
export function canonicalBotDefinition(value: LocalBotExportDefinition): LocalBotExportDefinition {
  return {
    schemaVersion: 1,
    name: value.name.trim(),
    role: value.role,
    instructions: value.instructions,
    requiredCapabilities: [...value.requiredCapabilities],
  }
}
export async function definitionDigest(definition: LocalBotExportDefinition): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error('BOT_DIGEST_UNAVAILABLE')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalBotDefinition(definition))))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
