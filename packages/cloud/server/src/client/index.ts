/** Register the generated cloud Remote and the frame-wide cloud workspace surface. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cloud-server/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { CloudPanel, type CloudPanelInjected } from './CloudPanel.tsx'
import { createCloudSource } from './source.ts'
import { en, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale', 'connection']

/** Mount cloud UI with generated Remote types; no Renderer fetch receives a bearer token. */
function registerUi(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register('dsh.cloud', { en, zh }), 'cloud: dictionaries')
  const source = createCloudSource(async () => {
    const result = await ctx.remote.dshCloud.state()
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  })
  ctx.effect(() => () => { source.dispose() }, 'cloud: state poll')
  let previous = source.source.getSnapshot().mode
  ctx.effect(() => source.source.subscribe(() => {
    const mode = source.source.getSnapshot().mode
    if (mode === 'local' && previous !== 'local') connection.reconnect()
    previous = mode
  }), 'cloud: resume local subscriptions')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-cloud', locale: 'dsh.cloud',
    inject: (): CloudPanelInjected => ({
      hooks: { cloud: source.source },
      login: async (server) => {
        const result = await ctx.remote.dshCloud.beginLogin(server)
        if (!result.ok) throw new Error(result.error.code)
        source.publish(result.value)
      },
      logout: async () => {
        const result = await ctx.remote.dshCloud.logout()
        if (!result.ok) throw new Error(result.error.code)
        source.publish(result.value)
      },
      call: async (input) => {
        const result = await ctx.remote.dshCloud.request(input)
        if (!result.ok) { await source.refresh(); throw new Error(result.error.code) }
        return result.value
      },
    }),
  }, CloudPanel))
}

/** Register after the application-selected cloud Remote becomes available. */
export function apply(ctx: Context): void {
  ctx.inject(['remote.dshCloud', 'slots', 'locale', 'connection'], registerUi)
}
