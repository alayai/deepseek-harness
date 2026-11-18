/** Host-only, text-only browsing; these reads never resolve a local Agent. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import type { LocalBotReadOnly, LocalReadRequest, LocalReadResult } from './types.ts'
import { CloudApiError } from './transport.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { botReadOnly: LocalBotReadOnly }
}

const epoch = z.number().int().nonnegative()
const offset = z.number().int().min(0).max(1_000_000)
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sessions'), epoch, offset }).strict(),
  z.object({ kind: z.literal('messages'), epoch, sessionId: z.string().min(1).max(200), before: epoch.nullable() }).strict(),
  z.object({ kind: z.literal('bots'), epoch, offset }).strict(),
])

/**
 * Project an explicit read into bounded display data. No HTTP or model request is made.
 * @param ctx - Host services, including the optional loaded Bot provider.
 * @param input - wire-validated local read selection.
 * @param signal - invocation cancellation.
 * @returns one detached page; no raw metadata or execution handles.
 */
export async function readLocal(ctx: Context, input: LocalReadRequest, signal: AbortSignal): Promise<LocalReadResult> {
  if (!requestSchema.safeParse(input).success) throw new CloudApiError('LOCAL_READ_INVALID', 400)
  signal.throwIfAborted()
  if (input.kind === 'bots') {
    const provider = ctx.get('botReadOnly')
    if (provider === undefined) return { kind: 'bots', available: false, ready: false, items: [], nextOffset: null }
    if (provider.version !== 1) throw new CloudApiError('LOCAL_BOT_PROVIDER_UNSUPPORTED', 409)
    const page = provider.list(input.offset, 10)
    // Copy only declared settings even if a JavaScript provider has extra properties.
    return { kind: 'bots', available: true, ready: page.ready, nextOffset: page.nextOffset, items: page.items.slice(0, 10).map(bot => ({
      id: bot.id, name: bot.name.slice(0, 120), role: bot.role.slice(0, 120),
      instructions: bot.instructions.slice(0, 4096), model: bot.model.slice(0, 200), private: bot.private,
      truncated: bot.truncated || bot.instructions.length > 4096,
    })) }
  }
  const query = ctx.get('sessionQuery')
  if (query === undefined) throw new CloudApiError('LOCAL_HISTORY_UNAVAILABLE', 503)
  if (input.kind === 'sessions') {
    const records = await query.listSessions(signal)
    return { kind: 'sessions', items: records.slice(input.offset, input.offset + 25).map(({ header }) => ({
      id: header.id, createdAt: header.createdAt,
    })), nextOffset: input.offset + 25 < records.length ? input.offset + 25 : null }
  }
  using observation = await query.observeSession(input.sessionId, { signal, projectionMode: 'none' })
  const events = observation.events
  let index = Math.min(input.before ?? events.length, events.length) - 1
  const items: Extract<LocalReadResult, { kind: 'messages' }>['items'] = []
  let remaining = 32_768
  for (; index >= 0 && items.length < 25 && remaining > 0; index--) {
    signal.throwIfAborted()
    const event = events[index]
    if (event === undefined || (event.type !== 'user/message' && event.type !== 'assistant/message')) continue
    const content = event.type === 'user/message' ? event.data.content : event.data.message.content
    // Never serialize tool arguments, reasoning, binary blocks or declaration-merged payloads.
    let text = '', truncated = false
    const budget = Math.min(4096, remaining)
    for (const block of content) {
      if (block.type !== 'text') continue
      const part = (text ? '\n' : '') + block.text
      const room = budget - text.length
      text += part.slice(0, room)
      if (part.length > room) truncated = true
    }
    if (!text) continue
    remaining -= text.length
    items.push({ seq: event.seq, role: event.type === 'user/message' ? 'user' : 'assistant', text, truncated })
  }
  return { kind: 'messages', sessionId: input.sessionId, items: items.reverse(), nextBefore: index >= 0 ? index + 1 : null }
}
