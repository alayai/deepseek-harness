/** Per-session Conversation store shared by the shell body and header. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationStoreState } from './contract/views.ts'
import { clampSideRatio, SIDE_RATIO_DEFAULT } from './view-selection.ts'

const CONVERSATION_STORE_KEY = 'dsh.conversation'

const EMPTY_STATE = (): ConversationStoreState => ({
  draft: '',
  view: null,
  sideView: null,
  sideRatio: SIDE_RATIO_DEFAULT,
  viewRequest: null,
})

/**
 * Fill fields a pre-side-pane persisted record omits so later actions do not
 * read `undefined` for `sideView` / `sideRatio`.
 * @param stored - live snapshot, possibly a wholesale rehydrate of older JSON.
 * @returns a complete Conversation store snapshot.
 */
function normalizeConversationState(stored: ConversationStoreState): ConversationStoreState {
  return {
    draft: typeof stored.draft === 'string' ? stored.draft : '',
    view: typeof stored.view === 'string' ? stored.view : null,
    sideView: typeof stored.sideView === 'string' ? stored.sideView : null,
    sideRatio: clampSideRatio(stored.sideRatio),
    viewRequest: stored.viewRequest ?? null,
  }
}

/** Declared write set for the Conversation shell. */
type ConversationActions = {
  setDraft: (draft: ConversationStoreState, text: string) => void
  setView: (draft: ConversationStoreState, view: string) => void
  setSideView: (draft: ConversationStoreState, view: string) => void
  clearSideView: (draft: ConversationStoreState) => void
  setSideRatio: (draft: ConversationStoreState, ratio: number) => void
  openView: (draft: ConversationStoreState, view: string, focus: string) => void
  completeViewRequest: (draft: ConversationStoreState) => void
}

/**
 * Declare per-session draft persistence, View selection, and side-pane pinning.
 * @returns the store handle.
 */
export function createConversationStore(): EngineStoreHandle<ConversationStoreState, ConversationActions> {
  const handle = defineStore({
    init: EMPTY_STATE,
    persist: CONVERSATION_STORE_KEY,
    actions: {
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => {
        if (d.sideView === view) return
        d.view = view
      },
      setSideView: (d, view: string) => {
        d.sideView = view
        if (d.view === view) d.view = null
      },
      clearSideView: (d) => { d.sideView = null },
      setSideRatio: (d, ratio: number) => { d.sideRatio = clampSideRatio(ratio) },
      openView: (d, view: string, focus: string) => {
        if (d.sideView !== view) d.view = view
        d.viewRequest = { view, focus }
      },
      completeViewRequest: (d) => { d.viewRequest = null },
    },
  })
  const create = handle.create.bind(handle)
  handle.create = ((scopeKey?: string) => {
    const instance = create(scopeKey)
    instance.store.set(normalizeConversationState(instance.store.getSnapshot()))
    return instance
  }) as typeof handle.create
  return handle
}

/** Persisted primary and side View ids read before the Slot store is materialized. */
export interface ConversationLayoutPreference {
  /** Preferred primary View id, or null when storage has no usable value. */
  view: string | null
  /** Preferred side View id, or null when storage has no usable value. */
  sideView: string | null
}

/**
 * Read the persisted View layout before the Slot store is materialized.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns primary and side View ids; missing or corrupt storage yields nulls.
 */
export function readConversationLayoutPreference(sessionId: SessionId): ConversationLayoutPreference {
  const empty = { view: null, sideView: null }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`)
    if (raw === null) return empty
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return empty
    const record = stored as Record<string, unknown>
    return {
      view: typeof record.view === 'string' ? record.view : null,
      sideView: typeof record.sideView === 'string' ? record.sideView : null,
    }
  } catch {
    return empty
  }
}

/**
 * Read the persisted View preference before the Slot store is materialized.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns the preferred View id, or null when storage has no usable value.
 */
export function readConversationViewPreference(sessionId: SessionId): string | null {
  return readConversationLayoutPreference(sessionId).view
}
