/** Conversation view and session-local presentation state. */

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
export interface ViewTab { id: string; label: string }

/** One-shot focus request addressed to a Conversation View. */
export interface ConversationViewRequest {
  /** Target `conversation.view` entry id. */
  readonly view: string
  /** Target-owned opaque focus identity. */
  readonly focus: string
}

/** Per-session state owned by the target-neutral Conversation shell. */
export interface ConversationStoreState {
  /** Composer draft (persisted; survives session switches and reloads). */
  draft: string
  /** Preferred `conversation.view` entry id; null resolves to Chat when registered. */
  view: string | null
  /**
   * Optional `conversation.view` entry pinned in the right-hand pane.
   * Null hides the pane. A value equal to the resolved primary View is ignored.
   */
  sideView: string | null
  /** Fraction of the conversation column given to the primary pane (0.25–0.75). */
  sideRatio: number
  /** Focus request consumed and acknowledged by the addressed View. */
  viewRequest: ConversationViewRequest | null
}
