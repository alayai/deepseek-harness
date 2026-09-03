/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-cad-preview`.
 * @module @deepseek-ai/dsh-client-ui-cad-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-cad-preview'

/** Cordis companion plugin name. */
export const name = 'client-ui-cad-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure visual client plugin that only registers one
 * presentational overlay entry and owns no host data, events, or durable state.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
