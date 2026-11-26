/** Browser-local recovery records for explicitly selected multipart uploads. */
import { z } from 'zod'

const key = 'dsh.cloud.multipart.v1'
const blockSize = 8 * 1024 ** 2
const limit = 64
/** Maximum file size supported by the multipart API. */
export const MAX_MULTIPART_SIZE = 5 * 1024 ** 3
const receipt = z.object({
  scope: z.string().max(2048), objectId: z.uuid(), filename: z.string().min(1).max(255),
  contentType: z.string().max(128), size: z.number().int().positive().max(MAX_MULTIPART_SIZE),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u), expires: z.number().int().positive(),
  asyncScan: z.literal(true).optional(), publicationReady: z.literal(true).optional(),
})
/** Minimum metadata needed to identify a file and reopen its server session. */
export type UploadReceipt = z.infer<typeof receipt>

function currentReceipts(storage: Storage): UploadReceipt[] {
  const raw = storage.getItem(key)
  if (raw === null || raw.length > 256 * 1024) return []
  const input: unknown = JSON.parse(raw)
  if (!Array.isArray(input)) return []
  return input.slice(0, limit).flatMap((item: unknown) => {
    const parsed = receipt.safeParse(item)
    return parsed.success && parsed.data.expires > Date.now() ? [parsed.data] : []
  })
}

/**
 * Read an unexpired receipt without granting access to the cloud session.
 * @param scope - Authenticated server, user, tenant and workspace key.
 * @returns The matching receipt, if browser storage is readable.
 */
export function readUploadReceipt(scope: string): UploadReceipt | undefined {
  try { return currentReceipts(globalThis.localStorage).find(item => item.scope === scope) }
  catch { return undefined }
}

/**
 * Save the accepted session before sending the first part.
 * @param value - Recovery metadata for a selected file.
 * @returns Whether browser storage accepted the receipt.
 */
export function saveUploadReceipt(value: UploadReceipt): boolean {
  const parsed = receipt.safeParse(value)
  return parsed.success && updateReceipts(items => [parsed.data, ...items.filter(item => item.scope !== value.scope)])
}

/**
 * Clear only the settled receipt.
 * @param scope - Authenticated scope key.
 * @param objectId - Settled upload.
 */
export function clearUploadReceipt(scope: string, objectId: string): void {
  updateReceipts(items => items.filter(item => item.scope !== scope || item.objectId !== objectId))
}

function updateReceipts(update: (items: UploadReceipt[]) => UploadReceipt[]): boolean {
  try {
    const storage = globalThis.localStorage
    let items: UploadReceipt[]
    try { items = currentReceipts(storage) } catch { items = [] }
    const next = update(items).slice(0, limit)
    if (next.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(next))
    return true
  } catch { return false }
}

/**
 * Hash all bytes with bounded memory: SHA-256 of the ordered SHA-256 digests of fixed 8 MiB blocks.
 * @param file - File explicitly selected by the user.
 * @param signal - Stop before the next read or hash when cancelled.
 * @returns A local fingerprint, or undefined when the browser does not provide Web Crypto.
 */
export async function uploadFingerprint(file: File, signal: AbortSignal): Promise<string | undefined> {
  const subtle = globalThis.crypto.subtle
  if (typeof subtle === 'undefined') return undefined
  const digests = new Uint8Array(Math.ceil(file.size / blockSize) * 32)
  for (let offset = 0; offset < file.size; offset += blockSize) {
    signal.throwIfAborted()
    const bytes = await file.slice(offset, offset + blockSize).arrayBuffer()
    signal.throwIfAborted()
    const digest = await subtle.digest('SHA-256', bytes)
    digests.set(new Uint8Array(digest), offset / blockSize * 32)
  }
  signal.throwIfAborted()
  const digest = await subtle.digest('SHA-256', digests)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
