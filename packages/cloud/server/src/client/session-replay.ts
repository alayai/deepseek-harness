import type { CloudValue } from '../types.ts'
import { appendCloudSessionEvents, parseCloudSessionEvent, type CloudSessionEvent } from './session-events.ts'

/** Events and cursor are committed together; dropping the cache always restarts replay at zero. */
export interface SessionReplay {
  readonly events: readonly CloudSessionEvent[]
  readonly after: string
}
const empty: SessionReplay = { events: [], after: '0' }
const cursor = (value: string): boolean => /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n

/** Client-owned, bounded and discardable cache. No message bodies are saved to browser storage. */
export class CloudSessionReplay {
  private readonly sessions = new Map<string, SessionReplay>()
  /** Read a cached page without I/O. @param scope - full authority and session scope. @returns events and matching cursor. */
  read(scope: string): SessionReplay { return this.sessions.get(scope) ?? empty }
  /** Validate a complete wire page and atomically append it. @returns the accepted replay state. */
  accept(scope: string, expected: string, page: CloudValue): SessionReplay {
    const previous = this.read(scope)
    if (!cursor(expected) || BigInt(expected) > BigInt(previous.after)) throw Error('STALE_EVENT_PAGE')
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page.items) || typeof page.nextAfter !== 'string' || !cursor(page.nextAfter)) throw Error('INVALID_EVENT_PAGE')
    const items: CloudSessionEvent[] = []
    let last = BigInt(expected)
    for (const raw of page.items) {
      const item = parseCloudSessionEvent(raw)
      if (!item || !cursor(item.id)) throw Error('INVALID_EVENT_PAGE')
      // Replayed rows are accepted only if already present, with identical data.
      if (BigInt(item.id) <= BigInt(expected)) {
        const known = previous.events.find(value => value.id === item.id)
        if (!known || JSON.stringify(known) !== JSON.stringify(item)) throw Error('INVALID_EVENT_REPLAY')
        continue
      }
      if (BigInt(item.id) <= last) throw Error('INVALID_EVENT_ORDER')
      last = BigInt(item.id)
      if (last <= BigInt(previous.after)) {
        const known = previous.events.find(value => value.id === item.id)
        if (!known || JSON.stringify(known) !== JSON.stringify(item)) throw Error('INVALID_EVENT_REPLAY')
      } else items.push(item)
    }
    if (BigInt(page.nextAfter) !== last) throw Error('INVALID_EVENT_CURSOR')
    let events = appendCloudSessionEvents(previous.events, items)
    const sizes = events.map(event => JSON.stringify(event).length)
    if (sizes.some(size => size + 2 > 2_000_000)) throw Error('EVENT_CACHE_ITEM_TOO_LARGE')
    let size = 2 + sizes.reduce((total, value) => total + value, 0) + Math.max(0, events.length - 1)
    let start = 0
    while (size > 2_000_000 && start < events.length) {
      const itemSize = sizes[start]
      if (itemSize === undefined) break
      size -= itemSize + 1
      start += 1
    }
    if (start) events = events.slice(start)
    const next = { events, after: last > BigInt(previous.after) ? page.nextAfter : previous.after }
    this.sessions.delete(scope); this.sessions.set(scope, next)
    while (this.sessions.size > 4) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      this.sessions.delete(oldest)
    }
    return next
  }
  /** Forget cached text when authority is withdrawn. */
  clear(): void { this.sessions.clear() }
}
