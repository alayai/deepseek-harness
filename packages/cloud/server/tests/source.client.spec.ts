import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudSource } from '../src/client/source.ts'
import type { CloudSnapshot } from '../src/types.ts'

afterEach(() => { vi.useRealTimers() })
describe('cloud state observation', () => {
  it('retains a blocked cloud state on Host disconnect and never reconnects by replaying business requests', async () => {
    const snapshot: CloudSnapshot = { mode: 'cloud', epoch: 4, serverUrl: 'https://server.example', authorizationUrl: null, error: null }
    const read = vi.fn(async () => snapshot)
    const source = createCloudSource(read)
    try {
      await vi.waitFor(() =>{  expect(source.source.getSnapshot().mode).toBe('cloud') })
      read.mockRejectedValue(new Error('Host disconnected'))
      await source.refresh()
      expect(source.source.getSnapshot().mode).toBe('cloud-suspended')
      expect(source.source.getSnapshot().error).toBe('HOST_DISCONNECTED')
    } finally { source.dispose() }
  })
  it('discards an observation completing after disposal', async () => {
    const pending = Promise.withResolvers<CloudSnapshot>()
    const source = createCloudSource(() => pending.promise), listener = vi.fn()
    source.source.subscribe(listener)
    source.dispose()
    pending.resolve({ mode: 'cloud', epoch: 5, serverUrl: 'https://server.example', authorizationUrl: null, error: null })
    await Promise.resolve(); await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(source.source.getSnapshot().mode).toBe('local')
  })
})
