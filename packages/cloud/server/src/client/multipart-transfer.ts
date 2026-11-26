/** Transfers missing RustFS parts under one cancellation and completion boundary. */
import { z } from 'zod'
import type { CloudValue } from '../types.ts'

const parallelParts = 3
const attemptsPerPart = 3
const retryBaseMs = 250
const putTimeoutMs = 120_000
const transientStatuses = new Set([408, 429, 500, 502, 503, 504])
const signedPart = z.object({ uploadUrl: z.url(), size: z.number().int().positive() })

class PartPutError extends Error {
  constructor(readonly status: number) { super('PART_UPLOAD_FAILED') }
}

interface MultipartTransfer {
  file: File
  partSize: number
  missing: readonly number[]
  signal: AbortSignal
  guard(): void
  sign(part: number): Promise<CloudValue>
  onUploaded(bytes: number): void
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function putPart(transfer: MultipartTransfer, part: number, signal: AbortSignal): Promise<void> {
  const start = (part - 1) * transfer.partSize
  const body = transfer.file.slice(start, start + transfer.partSize)
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted()
    transfer.guard()
    const value = signedPart.parse(await transfer.sign(part))
    signal.throwIfAborted()
    transfer.guard()
    const target = new URL(value.uploadUrl)
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || value.size !== body.size) {
      throw Error('INVALID_PART_UPLOAD_URL')
    }
    const timeout = AbortSignal.timeout(putTimeoutMs)
    try {
      const response = await fetch(target, {
        method: 'PUT', redirect: 'error', credentials: 'omit', body, signal: AbortSignal.any([signal, timeout]),
      })
      void response.body?.cancel().catch(() => undefined)
      if (!response.ok) throw new PartPutError(response.status)
    } catch (error) {
      signal.throwIfAborted()
      transfer.guard()
      const retryable = error instanceof PartPutError ? transientStatuses.has(error.status) : timeout.aborted || error instanceof TypeError
      if (!retryable || attempt === attemptsPerPart) throw error
      await delay(retryBaseMs * 2 ** (attempt - 1), signal)
      continue
    }
    signal.throwIfAborted()
    transfer.guard()
    transfer.onUploaded(body.size)
    return
  }
}

/**
 * Upload each missing part with bounded concurrency. A temporary PUT failure
 * repeats only that part with a fresh signature; signature errors stop the run.
 * @param transfer - Selected file, server-confirmed missing parts and live upload scope.
 * @returns Resolves only when every missing part succeeded. On failure, stops and settles all workers before rejecting.
 */
export async function uploadMissingParts(transfer: MultipartTransfer): Promise<void> {
  const failure = new AbortController()
  const signal = AbortSignal.any([transfer.signal, failure.signal])
  const parts = transfer.missing.values()
  const worker = async () => {
    try {
      for (const part of parts) await putPart(transfer, part, signal)
    } catch (error) {
      if (!signal.aborted) failure.abort(error)
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallelParts, transfer.missing.length) }, worker))
  signal.throwIfAborted()
}
