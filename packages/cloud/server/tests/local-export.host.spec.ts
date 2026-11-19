import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { exportLocal } from '../src/local-export.ts'

const signal = () => new AbortController().signal

describe('local public Bot export', () => {
  it('returns a complete detached definition from the explicit provider', () => {
    const ctx = new Context()
    ctx.provide('botExport', { version: 1, get: () => ({ version: 1, exportable: true, definition: { schemaVersion: 1, name: 'Builder', role: 'Engineer', instructions: 'safe', requiredCapabilities: [] } }) } as never)
    expect(exportLocal(ctx, { kind: 'bot', epoch: 2, botId: 'bot-a' }, signal())).toMatchObject({ exportable: true, definition: { instructions: 'safe' } })
  })

  it('does not make an unavailable provider look like a truncated preview', () => {
    const ctx = new Context()
    expect(() => exportLocal(ctx, { kind: 'bot', epoch: 2, botId: 'bot-a' }, signal())).toThrowError(expect.objectContaining({ code: 'LOCAL_BOT_EXPORT_UNAVAILABLE' }))
  })
})
