import { describe, expect, it } from 'vitest'
import { appendCloudSessionEvents, parseCloudSessionEvent, projectCloudSessionEvent } from '../src/client/session-events.ts'

const row = (id: string, event: import('../src/types.ts').CloudValue) => ({ id, operationId: 'op-1', createdAt: '2026-11-18T00:00:00.000Z', event })

describe('cloud session event projection', () => {
  it('keeps server metadata and removes replayed cursor rows', () => {
    const first = parseCloudSessionEvent(row('1', { type: 'user/message', data: { text: 'hello' } }))
    const second = parseCloudSessionEvent(row('2', { type: 'assistant/message', data: { text: 'world' } }))
    expect(first?.id).toBe('1')
    expect(appendCloudSessionEvents([first!], [first!, second!])).toHaveLength(2)
  })

  it('unwraps native notification events and displays tool status as text', () => {
    const event = parseCloudSessionEvent(row('3', { type: 'notification', params: { event: { type: 'tool/call', data: { name: 'read_file' } } } }))!
    expect(projectCloudSessionEvent(event)).toMatchObject({ kind: 'tool', rawType: 'tool/call', text: 'Tool call: read_file' })
  })

  it('does not interpret markup in unknown events', () => {
    const event = parseCloudSessionEvent(row('4', { type: 'future/event', data: { text: '<script>alert(1)</script>' } }))!
    const projected = projectCloudSessionEvent(event)
    expect(projected.kind).toBe('unknown')
    expect(projected.text).toContain('<script>')
  })
})

import { projectCloudSessionEvents } from '../src/client/session-events.ts'
import { CloudSessionReplay } from '../src/client/session-replay.ts'
const native = (id: string, type: string, data: import('../src/types.ts').CloudValue) => parseCloudSessionEvent(row(id, { type: 'notification', params: { event: { type, data } } }))!
describe('stream and replay recovery', () => {
  it('merges visible deltas and replaces them with the committed content blocks', () => {
    const events = [native('1', 'cloud/assistant-delta', { streamId: 's', text: 'Hello' }), native('2', 'cloud/assistant-delta', { streamId: 's', text: ' world' })]
    expect(projectCloudSessionEvents(events)).toMatchObject([{ kind: 'assistant', text: 'Hello world', state: 'running' }])
    expect(projectCloudSessionEvents([...events, native('3', 'assistant/message', { message: { content: [{ type: 'text', text: 'Hello world!' }] } })])).toMatchObject([{ id: '1', text: 'Hello world!', state: 'succeeded' }])
  })
  it('pairs tools by operation and call ID, preserving failure and text blocks', () => {
    const events = [native('1', 'tool/call', { callId: 'c1', name: 'read', arguments: '{"path":"a"}' }), native('2', 'tool/result', { message: { callId: 'c1', isError: true, content: [{ type: 'text', text: 'denied' }] } })]
    expect(projectCloudSessionEvents(events)).toMatchObject([{ text: 'read', detail: 'denied', state: 'failed' }])
    expect(projectCloudSessionEvents([...events, { ...native('3', 'tool/call', { callId: 'c1', name: 'other' }), operationId: 'op-2' }])).toHaveLength(2)
  })
  it('commits cursor and events together, rejects malformed pages without advancing, and keeps separate sessions', () => {
    const cache = new CloudSessionReplay(), item = row('9007199254740993', { type: 'user/message', data: { text: 'private' } })
    const page = { items: [item], nextAfter: item.id }
    cache.accept('server/user/tenant/workspace/a', '0', page)
    expect(cache.read('server/user/tenant/workspace/a').events).toHaveLength(1)
    expect(cache.read('server/user/tenant/workspace/b')).toEqual({ events: [], after: '0' })
    expect(() => cache.accept('server/user/tenant/workspace/a', item.id, { items: [{ id: 'bad' }], nextAfter: '9007199254740994' })).toThrow()
    expect(cache.read('server/user/tenant/workspace/a').after).toBe(item.id)
    cache.accept('server/user/tenant/workspace/a', item.id, page)
    expect(cache.read('server/user/tenant/workspace/a').events).toHaveLength(1)
    cache.clear(); expect(cache.read('server/user/tenant/workspace/a').after).toBe('0')
  })
  it('rejects invalid pages and reconciles identical concurrent pages without cursor regression', () => {
    const cache = new CloudSessionReplay()
    expect(() => cache.accept('a', '0', { items: [row('2', null), row('1', null)], nextAfter: '1' })).toThrow('INVALID_EVENT_ORDER')
    expect(() => cache.accept('a', '0', { items: [row('1', null)], nextAfter: '2' })).toThrow('INVALID_EVENT_CURSOR')
    cache.accept('a', '0', { items: [row('1', null)], nextAfter: '1' })
    expect(cache.accept('a', '0', { items: [], nextAfter: '0' }).after).toBe('1')
    expect(cache.accept('a', '0', { items: [row('1', null)], nextAfter: '1' }).events).toHaveLength(1)
    expect(() => cache.accept('a', '0', { items: [row('1', 'changed')], nextAfter: '1' })).toThrow('INVALID_EVENT_REPLAY')
    expect(() => cache.accept('a', '2', { items: [], nextAfter: '2' })).toThrow('STALE_EVENT_PAGE')
  })
  it('rejects an oversized single event without advancing its cursor', () => {
    const cache = new CloudSessionReplay()
    expect(() => cache.accept('a', '0', { items: [row('1', { text: 'x'.repeat(2_000_000) })], nextAfter: '1' })).toThrow('EVENT_CACHE_ITEM_TOO_LARGE')
    expect(cache.read('a')).toEqual({ events: [], after: '0' })
  })
})
