import { z } from 'zod'
import type { CloudValue } from '../types.ts'

const Bot = z.object({ id: z.uuid(), name: z.string(), state: z.enum(['active', 'archived']), latestRevision: z.number().int().positive() })
const BotsPage = z.union([
  z.object({ items: z.array(Bot), nextCursor: z.string().nullish() }),
  z.array(Bot).transform(items => ({ items, nextCursor: null })),
])
export type WorkspaceBot = z.infer<typeof Bot>
export const Session = z.object({
  id: z.uuid(), title: z.string().optional(), bot: z.object({ id: z.uuid(), revision: z.number().int().positive() }).optional(),
})
export const Sessions = z.union([z.array(Session), z.object({ items: z.array(Session) }).transform(value => value.items)])
const SessionPage = z.object({ items: z.array(Session).max(100), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable() })
export type SessionDirectory = z.infer<typeof SessionPage> & { cursors: string[]; truncated: boolean }

/** Read one page; older APIs ignore query parameters and return a capped array. */
export async function readSessionPage(base: string, get: (path: string) => Promise<CloudValue>, botId = '', previous?: SessionDirectory): Promise<SessionDirectory> {
  const cursor = previous?.nextCursor
  const value = await get(base + '/sessions?limit=20' + (botId ? '&botId=' + encodeURIComponent(botId) : '') + (cursor ? '&cursor=' + cursor : ''))
  const legacy = Array.isArray(value)
  if (legacy && cursor) throw Error('SESSION_PAGING_UNAVAILABLE')
  const page = SessionPage.parse(legacy ? { items: value, nextCursor: null } : value)
  if (!legacy && botId && page.items.some(row => row.bot?.id !== botId)) throw Error('SESSION_BOT_MISMATCH')
  const cursors = previous?.cursors ?? []
  if (page.nextCursor && cursors.includes(page.nextCursor)) throw Error('SESSION_CURSOR_REPEATED')
  const items = new Map(previous?.items.map(row => [row.id, row]))
  for (const row of page.items) if (!botId || row.bot?.id === botId) items.set(row.id, row)
  return { items: [...items.values()], nextCursor: page.nextCursor, cursors: page.nextCursor ? [...cursors, page.nextCursor] : cursors,
    truncated: legacy && page.items.length === 100 }
}

/** Read active Bots, including those past the first page, in server order. */
export async function readWorkspaceBots(base: string, get: (path: string) => Promise<CloudValue>, current: () => boolean) {
  const found = new Map<string, WorkspaceBot>(), cursors = new Set<string>()
  let cursor = ''
  while (current()) {
    const page = BotsPage.parse(await get(base + '/bots?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')))
    for (const bot of page.items) if (bot.state === 'active') found.set(bot.id, bot)
    if (!page.nextCursor) break
    if (cursors.has(page.nextCursor)) throw Error('INVALID_BOT_PAGE')
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return [...found.values()]
}
