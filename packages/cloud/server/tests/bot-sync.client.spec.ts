// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  findBotExportAttempt, findBotSyncRecord, reserveBotExportAttempt, saveBotSyncRecord,
  type BotSyncRecord, type BotSyncScope,
} from '../src/client/bot-sync.ts'

const scope: BotSyncScope = { serverUrl: 'https://cloud.example', serverId: 'server-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' }
const record: BotSyncRecord = { ...scope, localBotId: 'local-a', cloudBotId: 'cloud-a', cloudRevision: 1, cloudVersion: 1, contentSha256: 'a'.repeat(64), syncedAt: '2026-11-18T00:00:00.000Z' }

beforeEach(() => { localStorage.clear() })

describe('persistent local Bot synchronization metadata', () => {
  it('persists only the bounded identity, revision and digest', () => {
    saveBotSyncRecord(record)
    expect(findBotSyncRecord(scope, 'local-a')).toEqual(record)
    const raw = localStorage.getItem('dsh.cloud.bot-sync.v1')!
    expect(raw).toContain('cloud-a')
    expect(raw).not.toContain('instructions')
    expect(raw).not.toContain('secret')
    expect(findBotSyncRecord({ ...scope, userId: 'other-user' }, 'local-a')).toBeUndefined()
    expect(findBotSyncRecord({ ...scope, serverId: 'other-server' }, 'local-a')).toBeUndefined()
  })

  it('keeps one original idempotency key for an unknown export result', () => {
    const attempt = { ...scope, localBotId: 'local-a', cloudBotId: '', expectedVersion: 0, contentSha256: 'b'.repeat(64), exportedAt: '2026-11-18T00:00:00.000Z', idempotencyKey: 'request-a' }
    expect(reserveBotExportAttempt(attempt)).toEqual(attempt)
    expect(reserveBotExportAttempt({ ...attempt, idempotencyKey: 'request-b' })).toEqual(attempt)
    expect(findBotExportAttempt(scope, 'local-a')?.idempotencyKey).toBe('request-a')
    expect(() => reserveBotExportAttempt({ ...attempt, contentSha256: 'c'.repeat(64) })).toThrow('BOT_EXPORT_RESULT_UNKNOWN')
  })
})
