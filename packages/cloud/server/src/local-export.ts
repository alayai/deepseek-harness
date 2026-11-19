import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { LocalBotExportResult } from './types.ts'
import { CloudApiError } from './transport.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { botExport: { version: 1; get(botId: string): LocalBotExportResult } }
}

const requestSchema = z.object({ kind: z.literal('bot'), epoch: z.number().int().nonnegative(), botId: z.string().min(1).max(200) }).strict()

/** Explicitly export one public Bot definition; this never reads files or credentials. */
export function exportLocal(ctx: Context, input: { kind: 'bot'; epoch: number; botId: string }, signal: AbortSignal): LocalBotExportResult {
  if (!requestSchema.safeParse(input).success) throw new CloudApiError('LOCAL_EXPORT_INVALID', 400)
  signal.throwIfAborted()
  const provider = ctx.get('botExport')
  if (provider === undefined) throw new CloudApiError('LOCAL_BOT_EXPORT_UNAVAILABLE', 503)
  if (provider.version !== 1) throw new CloudApiError('LOCAL_BOT_EXPORT_UNSUPPORTED', 409)
  const result = provider.get(input.botId)
  signal.throwIfAborted()
  return result
}
