import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq, SESSION_FORMAT_VERSION, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle, SessionAccess } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { readLocal } from '../src/local-read.ts'

class HistoryQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('search not used') }
  async searchEvents(): Promise<never> { throw new Error('search not used') }
}
const signal = () => new AbortController().signal
async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(HistoryQuery)
  return ctx
}

describe('cloud local read projection', () => {
  it('lists only identities and dates; reads user/assistant text without tool payloads or Agent activation', async () => {
    const ctx = await fixture()
    try {
      const s = ctx.sessions.create(SessionId('local-a'), { meta: { cwd: '/secret/path' } })
      s.append('user/message', createUserMessage({ content: [{ type: 'text', text: '<script>plain</script>' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      s.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'mock', model: 'test' }, content: [{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'hidden-reasoning' }] }) }, { surfaceOp: 'append' })
      const before = s.snapshotEvents(), prepare = vi.spyOn(ctx.sessions, 'prepare')
      const list = await readLocal(ctx, { kind: 'sessions', epoch: 1, offset: 0 }, signal())
      expect(list).toEqual({ kind: 'sessions', items: [{ id: s.id, createdAt: s.header.createdAt }], nextOffset: null })
      const page = await readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: s.id, before: null }, signal())
      expect(page).toMatchObject({ kind: 'messages', items: [{ role: 'user', text: '<script>plain</script>' }, { role: 'assistant', text: 'answer' }], nextBefore: null })
      expect(JSON.stringify(page)).not.toContain('hidden-reasoning')
      expect(s.snapshotEvents()).toEqual(before)
      expect(prepare).not.toHaveBeenCalled()
      expect(ctx.get('agents')).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
  it('reads interrupted cold logs with read handles, balances only in memory and never publishes a Session', async () => {
    const ctx = await fixture(), id = SessionId('cold-a')
    const header: SessionHeader = { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: '/hidden/path' }
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: SessionSeq(1), time: 2, data: createUserMessage({ content: [{ type: 'text', text: 'cold text' }], source: { kind: 'user' } }), surfaceOp: 'append' },
    ]
    const closed = vi.fn(), write = vi.fn(() => { throw new Error('must not write') }), accesses: SessionAccess[] = []
    ctx.provide('sessionPersistence', {
      identity: Symbol('cold'), stat: async () => ({ header, revision: SessionPersistenceRevision('r1') }),
      open: async (_id: typeof id, access: SessionAccess): Promise<SessionHandle> => {
        accesses.push(access)
        return { id, header, inheritedEventCount: SessionLogOffset(0), access, read: async () => ({ eventState: 'detached', events: structuredClone(events) }), append: write, flush: write, close: closed, [Symbol.asyncDispose]: async () => { closed() } }
      },
    } as never)
    try {
      const before = JSON.stringify(events)
      expect(await readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: id, before: null }, signal())).toMatchObject({ items: [{ text: 'cold text' }] })
      expect(accesses).toEqual(['read'])
      expect(closed).toHaveBeenCalledOnce()
      expect(write).not.toHaveBeenCalled()
      expect(ctx.sessions.get(id)).toBeUndefined()
      expect(JSON.stringify(events)).toBe(before)
    } finally { await ctx.fiber.dispose() }
  })
  it('bounds text pages and returns stable older-message positions', async () => {
    const ctx = await fixture()
    try {
      const s = ctx.sessions.create(SessionId('many'))
      for (let i = 0; i < 30; i++) s.append('user/message', createUserMessage({ content: [{ type: 'text', text: String(i) }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const page = await readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: s.id, before: null }, signal())
      expect(page.kind).toBe('messages')
      if (page.kind !== 'messages') throw new Error('wrong result')
      expect(page.items.map(i => i.text)).toEqual(Array.from({ length: 25 }, (_, i) => String(i + 5)))
      const older = await readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: s.id, before: page.nextBefore }, signal())
      expect(older).toMatchObject({ items: Array.from({ length: 5 }, (_, i) => ({ text: String(i) })), nextBefore: null })
      s.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'x'.repeat(5000) }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const long = await readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: s.id, before: null }, signal())
      if (long.kind !== 'messages') throw new Error('wrong result')
      expect(long.items.at(-1)).toMatchObject({ text: 'x'.repeat(4096), truncated: true })
    } finally { await ctx.fiber.dispose() }
  })
  it('makes optional providers explicit, rejects invalid input and respects cancellation', async () => {
    const ctx = await fixture()
    try {
      expect(await readLocal(ctx, { kind: 'bots', epoch: 1, offset: 0 }, signal())).toEqual({ kind: 'bots', available: false, ready: false, items: [], nextOffset: null })
      const list = vi.fn(() => ({ ready: false, items: [], nextOffset: null }))
      ctx.provide('botReadOnly', { version: 1, list })
      expect(await readLocal(ctx, { kind: 'bots', epoch: 1, offset: 0 }, signal())).toMatchObject({ available: true, ready: false })
      await expect(readLocal(ctx, { kind: 'sessions', epoch: 1, offset: -1 }, signal())).rejects.toMatchObject({ code: 'LOCAL_READ_INVALID' })
      await expect(readLocal(ctx, { kind: 'messages', epoch: 1, sessionId: SessionId(''), before: null }, signal())).rejects.toMatchObject({ code: 'LOCAL_READ_INVALID' })
      const abort = new AbortController(); abort.abort()
      await expect(readLocal(ctx, { kind: 'bots', epoch: 1, offset: 0 }, abort.signal)).rejects.toBeTruthy()
      expect(list).toHaveBeenCalledTimes(1)
    } finally { await ctx.fiber.dispose() }
  })
})
