/** Browser plugin for the interactive rack-and-pinion CAD preview overlay. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CadPreviewOverlay } from './CadPreviewOverlay.tsx'

/** Required service for contributing the overlay entry. */
export const inject = ['slots']

/** Register the floating CAD preview launcher into the shell overlay list slot. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'cad-preview',
    order: 90,
  }, CadPreviewOverlay))
}
