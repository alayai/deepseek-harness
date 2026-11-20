import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'cloud/blocked': { readonly reason: string } }
}

/** Display-safe cloud state. Credentials never cross the Host boundary. */
export interface CloudSnapshot {
  readonly mode: 'local' | 'authenticating' | 'cloud' | 'cloud-suspended'
  readonly epoch: number
  readonly serverUrl: string
  readonly authorizationUrl: string | null
  readonly error: string | null
}

/** Cloud API values are JSON, including field-level encoded binary results. */
export type CloudValue = null | boolean | number | string | CloudValue[] | { [key: string]: CloudValue }

/** One explicit server operation, scoped to the displayed login generation. */
export interface CloudRequest {
  readonly epoch: number
  readonly path: string
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body: CloudValue
  readonly idempotencyKey: string | null
}

/** Local Bot identity, never a cloud Bot or Session identity. */
export type LocalBotId = Branded<'DshCloudLocalBotId'>
/** Explicit, bounded read of Host-local history or loaded Bot settings. */
export type LocalReadRequest =
  | { readonly kind: 'sessions'; readonly epoch: number; readonly offset: number }
  | { readonly kind: 'messages'; readonly epoch: number; readonly sessionId: SessionId; readonly before: number | null }
  | { readonly kind: 'bots'; readonly epoch: number; readonly offset: number }
/** Selected Bot settings; paths, memory, capabilities and credentials are excluded. */
export interface LocalBotSummary {
  readonly id: LocalBotId
  readonly name: string
  readonly role: string
  readonly instructions: string
  readonly model: string
  readonly private: boolean
  readonly truncated: boolean
}
/** Loaded-memory provider. Reading must not load, refresh, save or activate anything. */
export interface LocalBotReadOnly {
  readonly version: number
  /**
   * Read the currently loaded roster without refreshing durable state.
   * @param offset - non-negative roster offset.
   * @param limit - maximum number of summaries.
   * @returns detached summaries and explicit initialization state.
   */
  list(offset: number, limit: number): { ready: boolean; items: LocalBotSummary[]; nextOffset: number | null }
}
/** Complete declarative definition for an explicit public cloud export. */
export interface LocalBotExport {
  readonly version: 1
  get(botId: LocalBotId): LocalBotExportResult
}
export interface LocalBotExportDefinition {
  readonly schemaVersion: 1
  readonly name: string
  readonly role: string
  readonly instructions: string
  readonly requiredCapabilities: readonly string[]
}
export interface LocalBotExportResult {
  readonly version: 1
  readonly exportable: boolean
  readonly reason?: 'NOT_READY' | 'NOT_FOUND' | 'PRIVATE_BOT' | 'TOO_LARGE' | 'INVALID'
  readonly definition?: LocalBotExportDefinition
}
/** Text-only page; raw events and attachments never cross to the Client. */
export type LocalReadResult =
  | { kind: 'sessions'; items: { id: SessionId; createdAt: number }[]; nextOffset: number | null }
  | { kind: 'messages'; sessionId: SessionId; items: { seq: number; role: 'user' | 'assistant'; text: string; truncated: boolean }[]; nextBefore: number | null }
  | { kind: 'bots'; available: boolean; ready: boolean; items: LocalBotSummary[]; nextOffset: number | null }
