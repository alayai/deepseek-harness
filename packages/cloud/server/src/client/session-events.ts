import type { CloudValue } from '../types.ts'

/** One durable event returned by dsh-server. The id is the server cursor. */
export interface CloudSessionEvent {
  readonly id: string
  readonly operationId: string
  readonly event: CloudValue
  readonly createdAt: string
}

export type CloudSessionEventKind = 'user' | 'assistant' | 'tool' | 'error'

/** A display-only projection. It deliberately contains no executable markup. */
export interface CloudSessionTimelineItem {
  readonly id: string
  readonly operationId: string
  readonly kind: CloudSessionEventKind
  readonly text: string
  readonly createdAt: string
  readonly state?: 'running' | 'succeeded' | 'failed' | 'interrupted'
  readonly detail?: string
}

function object(value: CloudValue | undefined): { [key: string]: CloudValue } {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function string(value: CloudValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** Parse one page item without trusting malformed server data. */
export function parseCloudSessionEvent(value: CloudValue): CloudSessionEvent | null {
  const row = object(value)
  const id = string(row.id), operationId = string(row.operationId), createdAt = string(row.createdAt)
  if (!id || !operationId || !createdAt || row.event === undefined) return null
  return { id, operationId, event: row.event, createdAt }
}

/** Append a page while preserving server order and removing replayed rows by cursor id. */
export function appendCloudSessionEvents(
  previous: readonly CloudSessionEvent[],
  incoming: readonly CloudSessionEvent[],
  limit = 2000,
): CloudSessionEvent[] {
  const seen = new Set<string>(), result: CloudSessionEvent[] = []
  for (const item of [...previous, ...incoming]) {
    if (seen.has(item.id)) continue
    seen.add(item.id); result.push(item)
  }
  return result.slice(Math.max(0, result.length - limit))
}

function unwrap(event: CloudValue): { type: string; data: CloudValue } {
  const root = object(event)
  const nested = object(object(root.params).event)
  const candidate = Object.keys(nested).length > 0 ? nested : root
  return { type: string(candidate.type) || 'unknown', data: candidate.data ?? candidate }
}

function contentText(value: CloudValue | undefined): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => { const block = object(part); return block.type === 'text' ? string(block.text) : '' }).join('')
}
function messageText(data: CloudValue): string {
  const value = object(data), message = object(value.message)
  return string(value.text) || contentText(value.content) || string(message.text) || contentText(message.content)
}

/** Fold durable events into user-visible messages. Transport diagnostics never enter the transcript. */
export function projectCloudSessionEvents(items: readonly CloudSessionEvent[]): CloudSessionTimelineItem[] {
  const result: CloudSessionTimelineItem[] = []
  const streams = new Map<string, number>(), latestStream = new Map<string, number>(), tools = new Map<string, number>()
  const users = new Map<string, number>(), errors = new Set<string>(), seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const { type, data } = unwrap(item.event), value = object(data)
    const { id, operationId, createdAt } = item
    const row = { id, operationId, createdAt }
    if (type === 'user/message' || type === 'agent/inbox/spliced') {
      // The inbox records typed messages before execution consumes them. A removal is not a new message.
      const inserted = type === 'user/message' ? [value.message ?? data] : value.inserted
      if (!Array.isArray(inserted)) continue
      for (const [offset, entry] of inserted.entries()) {
        const user = object(entry), source = object(user.source)
        if (type === 'agent/inbox/spliced' && (user.role !== 'user' || source.kind !== 'user')) continue
        if (type === 'user/message' && source.kind !== undefined && source.kind !== 'user') continue
        const text = messageText(entry), userId = string(user.id)
        if (!text.trim()) continue
        const key = JSON.stringify([operationId, userId])
        const index = userId ? users.get(key) : undefined
        if (index === undefined) {
          if (userId) users.set(key, result.length)
          result.push({ ...row, id: type === 'user/message' ? id : `${id}:${offset}`, kind: 'user', text })
        } else if (type === 'user/message') {
          const current = result[index]
          if (current !== undefined) result[index] = { ...current, text }
        }
      }
      continue
    }
    if (type === 'cloud/assistant-delta') {
      const streamId = string(value.streamId)
      if (!streamId || typeof value.text !== 'string' || !value.text) continue
      const key = JSON.stringify([operationId, streamId])
      const index = streams.get(key)
      if (index === undefined) {
        streams.set(key, result.length); latestStream.set(operationId, result.length)
        result.push({ ...row, kind: 'assistant', state: 'running', text: value.text })
      } else {
        const current = result[index]
        if (current?.state === 'running') result[index] = { ...current, text: current.text + value.text }
      }
      continue
    }
    if (type === 'assistant/message' || type === 'assistant/attempt') {
      const index = latestStream.get(operationId)
      const text = type === 'assistant/message' ? messageText(data) : ''
      if (index !== undefined) {
        const current = result[index]
        if (current !== undefined) {
          const state = type === 'assistant/attempt' || value.interrupted === true ? 'interrupted' : 'succeeded'
          result[index] = { ...current, state, text: text || current.text }
        }
        latestStream.delete(operationId)
      } else if (text.trim()) {
        result.push({ ...row, kind: 'assistant', state: value.interrupted === true ? 'interrupted' : 'succeeded', text })
      }
      continue
    }
    if (type === 'tool/call' || type === 'tool/result') {
      const message = object(value.message), source = object(message.source)
      const blocks = Array.isArray(message.content) ? message.content.map(object) : []
      const callId = string(value.callId) || string(source.callId) || string(message.toolCallId) || string(message.callId)
      if (!callId) continue
      const resultBlock = blocks.find(block => block.type === 'tool-result' && block.toolCallId === callId)
      const key = JSON.stringify([operationId, callId]), index = tools.get(key)
      const failed = resultBlock?.isError === true || message.isError === true || value.error != null
      const tool: CloudSessionTimelineItem = {
        ...row, kind: 'tool', text: string(value.name) || string(message.name),
        state: type === 'tool/call' ? 'running' : failed ? 'failed' : 'succeeded',
        detail: (type === 'tool/call' ? string(value.arguments) : contentText(resultBlock?.content) || messageText(data)).slice(0, 16000),
      }
      if (index === undefined) { tools.set(key, result.length); result.push(tool) }
      else {
        const current = result[index]
        if (current !== undefined) result[index] = type === 'tool/call'
          ? { ...current, text: tool.text || current.text }
          : { ...tool, id: current.id, createdAt: current.createdAt, text: current.text || tool.text }
      }
      continue
    }
    const reason = string(object(value.reason).kind)
    const failed = type === 'error' || type.endsWith('/error') || (type === 'turn/end' && reason === 'error')
    if (type === 'turn/end' || failed) {
      latestStream.delete(operationId)
      for (const [index, pending] of result.entries()) {
        if (pending.operationId !== operationId || pending.state !== 'running') continue
        result[index] = { ...pending, state: failed ? 'failed' : pending.kind === 'assistant' && reason === 'completed' ? 'succeeded' : 'interrupted' }
      }
      if (failed && !errors.has(operationId)) {
        errors.add(operationId)
        result.push({ ...row, kind: 'error', text: '' })
      }
    }
  }
  return result
}
