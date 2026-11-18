import { describe, expect, it } from 'vitest'
import { readBinding } from '../src/client/binding.ts'

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const value = { schemaVersion: 1, serverId: id(1), tenantId: id(2), workspaceId: id(3), cloudSessionId: id(4), runtimeId: id(5), credentialRef: id(6), desktopId: null, bindingRevision: 7, state: 'active' }
const expected = { serverId: id(1), tenantId: id(2), workspaceId: id(3), sessionId: id(4) }

describe('cloud binding identity', () => {
  it('accepts the matching deployment and conversation identity', () => {
    expect(readBinding(value, expected)).toEqual(value)
  })
  it.each(['serverId', 'tenantId', 'workspaceId', 'sessionId'] as const)('rejects a result for another %s', (key) => {
    expect(() => readBinding(value, { ...expected, [key]: id(10) })).toThrow('BINDING_IDENTITY_MISMATCH')
  })
  it('refuses unsupported versions and malformed revisions before enabling Send', () => {
    expect(() => readBinding({ ...value, schemaVersion: 2 }, expected)).toThrow()
    expect(() => readBinding({ ...value, bindingRevision: 0 }, expected)).toThrow()
  })
})
