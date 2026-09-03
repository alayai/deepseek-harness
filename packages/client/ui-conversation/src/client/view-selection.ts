import type { ViewTab } from './contract/views.ts'

const DEFAULT_VIEW_ID = 'chat'

/** Floor of the persisted primary-pane fraction. */
export const SIDE_RATIO_MIN = 0.25
/** Ceiling of the persisted primary-pane fraction. */
export const SIDE_RATIO_MAX = 0.75
/** Primary-pane fraction before any drag. */
export const SIDE_RATIO_DEFAULT = 0.5

/**
 * Resolve a preferred registered View, then Chat, without choosing another View.
 * @param tabs - currently registered Views.
 * @param selectedId - preferred View identity, when one is stored.
 * @returns the selected View, Chat fallback, or undefined when neither is registered.
 */
export function resolveActiveView(
  tabs: readonly ViewTab[],
  selectedId: string | null,
): ViewTab | undefined {
  const selected = selectedId === null ? undefined : tabs.find(view => view.id === selectedId)
  return selected ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

/**
 * Resolve a registered side View that is distinct from the primary View.
 * @param tabs - currently registered Views.
 * @param sideId - persisted side View identity, when one is stored.
 * @param primaryId - resolved primary View identity, if any.
 * @returns the side View, or undefined when it is missing, unregistered, or the primary.
 */
export function resolveSideView(
  tabs: readonly ViewTab[],
  sideId: string | null | undefined,
  primaryId: string | undefined,
): ViewTab | undefined {
  if (sideId === null || sideId === undefined || sideId === primaryId) return undefined
  return tabs.find(view => view.id === sideId)
}

/**
 * Clamp a persisted or dragged primary-pane fraction into the contract range.
 * @param ratio - stored or pointer-derived fraction; non-finite values use the default.
 * @returns a finite fraction in `[SIDE_RATIO_MIN, SIDE_RATIO_MAX]`.
 */
export function clampSideRatio(ratio: number | undefined): number {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return SIDE_RATIO_DEFAULT
  return Math.min(SIDE_RATIO_MAX, Math.max(SIDE_RATIO_MIN, ratio))
}
