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
