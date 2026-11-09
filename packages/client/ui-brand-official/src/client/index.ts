/** Official brand occupants for the sidebar, conversation hero, and home whale frame. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PixelWhale } from './home-whale/PixelWhale.tsx'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar and conversation-hero brand slots as one declaration-aware
 * registration set, and frame the blank home with the whale decoration.
 * The mark is installed for every client profile. The name wordmark is
 * installed only for official builds, so a local build keeps its version line.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const official = process.env.DSH_CLIENT_BUILD_PROFILE === 'official'
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
    name: 'conversation.hero.frame',
    id: 'pixel-whale',
  }, PixelWhale))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
        if (official) yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark)
      })))
}
