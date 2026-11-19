import type { CloudValue } from '../types.ts'

/** One durable event returned by dsh-server. The id is the server cursor. */
export interface CloudSessionEvent {
  readonly id: string
  readonly operationId: string
  readonly event: CloudValue
  readonly createdAt: string
}

export type CloudSessionEventKind = 'user' | 'assistant' | 'tool' | 'status' | 'error' | 'unknown'

/** A display-only projection. It deliberately contains no executable markup. */
export interface CloudSessionTimelineItem {
  readonly id: string
  readonly operationId: string
  readonly kind: CloudSessionEventKind
  readonly text: string
  readonly createdAt: string
  readonly state?: 'running' | 'succeeded' | 'failed' | 'interrupted'
  readonly detail?: string
  readonly rawType?: string
}

function object(value: CloudValue | undefined): { [key: string]: CloudValue } {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function string(value: CloudValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function boundedJson(value: CloudValue, limit = 2000): string {
  try {
    const encoded = JSON.stringify(value)
    return encoded.length > limit ? `${encoded.slice(0, limit)}…` : encoded
  } catch {
    return '[unserializable event]'
  }
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

/** Convert a durable event into a safe text-only timeline row. */
export function projectCloudSessionEvent(item: CloudSessionEvent): CloudSessionTimelineItem {
  const { type, data } = unwrap(item.event)
  let kind: CloudSessionEventKind = 'unknown', text = ''
  if (type === 'user/message') { kind = 'user'; text = messageText(data) || boundedJson(data) }
  else if (type === 'assistant/message') { kind = 'assistant'; text = messageText(data) || boundedJson(data) }
  else if (type === 'assistant/attempt') { kind = 'status'; text = messageText(data) || 'Assistant attempt' }
  else if (type === 'tool/call') { kind = 'tool'; const value = object(data); text = `Tool call: ${string(value.name) || string(value.tool) || 'unknown tool'}` }
  else if (type === 'tool/result') { kind = 'tool'; const value = object(data); text = `Tool result: ${messageText(value) || string(value.name) || 'completed'}` }
  else if (type === 'turn/end') { kind = 'status'; const value = object(data); const reason = object(value.reason); text = `Turn ended: ${string(reason.kind) || 'completed'}` }
  else if (type === 'error' || type.endsWith('/error')) { kind = 'error'; text = messageText(data) || boundedJson(data) }
  else text = `Unsupported cloud event (${type}): ${boundedJson(item.event)}`
  return { id: item.id, operationId: item.operationId, kind, text: kind === 'user' || kind === 'assistant' ? text : text.slice(0, 4000), createdAt: item.createdAt, rawType: type }
}

/** Fold durable server events into chat rows; tool IDs are scoped to their operation. */
export function projectCloudSessionEvents(items: readonly CloudSessionEvent[]): CloudSessionTimelineItem[] {
  const result: CloudSessionTimelineItem[] = [], streams = new Map<string, number>(), tools = new Map<string, number>()
  const latestStream = new Map<string, number>()
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const { type, data } = unwrap(item.event), value = object(data)
    if (type === 'cloud/assistant-delta') {
      const key = `${item.operationId}:${string(value.streamId)}`
      if (!string(value.streamId) || typeof value.text !== 'string') { result.push(projectCloudSessionEvent(item)); continue }
      const index = streams.get(key)
      if (index === undefined) {
        streams.set(key, result.length); latestStream.set(item.operationId, result.length)
        result.push({ ...projectCloudSessionEvent(item), kind: 'assistant', rawType: type, state: 'running', text: value.text })
      } else {
        const current = result[index]
        if (current !== undefined) result[index] = { ...current, text: current.text + value.text }
      }
      continue
    }
    if (type === 'assistant/message' || type === 'assistant/attempt') {
      const index = latestStream.get(item.operationId)
      const projected = { ...projectCloudSessionEvent(item), state: type === 'assistant/attempt' || value.interrupted === true ? 'interrupted' as const : 'succeeded' as const }
      if (index !== undefined) {
        const current = result[index]
        if (current !== undefined) {
          result[index] = {
            ...projected,
            ...(type === 'assistant/attempt' ? { kind: 'assistant' as const, text: current.text } : {}),
            id: current.id,
          }
        }
        latestStream.delete(item.operationId)
      }
      else result.push(projected)
      continue
    }
    if (type === 'tool/call' || type === 'tool/result') {
      const message = object(value.message), callId = string(value.callId) || string(message.toolCallId) || string(message.callId)
      const key = `${item.operationId}:${callId}`
      const index = callId ? tools.get(key) : undefined
      const failed = message.isError === true || value.error !== undefined
      const projected = { ...projectCloudSessionEvent(item), state: type === 'tool/call' ? 'running' as const : failed ? 'failed' as const : 'succeeded' as const,
        text: type === 'tool/call' ? string(value.name) : messageText(data) || string(object(value.error).reason),
        detail: type === 'tool/call' ? string(value.arguments).slice(0, 16000) : '' }
      if (index === undefined) { if (callId) tools.set(key, result.length); result.push(projected) }
      else {
        const current = result[index]
        if (current !== undefined) {
          result[index] = type === 'tool/call'
            ? { ...current, text: projected.text }
            : {
              ...projected,
              id: current.id,
              text: current.text,
              detail: messageText(data) || string(object(value.error).reason),
            }
        }
      }
      continue
    }
    if (type === 'turn/end') {
      const reason = string(object(value.reason).kind)
      for (let i = 0; i < result.length; i++) {
        const row = result[i]
        if (row === undefined || row.operationId !== item.operationId || row.state !== 'running') continue
        result[i] = { ...row, state: reason === 'error' ? 'failed' : 'interrupted' }
      }
    }
    result.push(projectCloudSessionEvent(item))
  }
  return result
}
