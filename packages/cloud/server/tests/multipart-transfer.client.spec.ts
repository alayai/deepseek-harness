import { afterEach, expect, it, vi } from 'vitest'
import { uploadMissingParts } from '../src/client/multipart-transfer.ts'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const signPart = (part: number) => ({ uploadUrl: `https://rustfs.test/${part}`, size: 1 })

it('stops sibling PUTs on permanent failure and ignores signatures that arrive after failure', async () => {
  const first = Promise.withResolvers<Response>()
  const siblingStarted = Promise.withResolvers<AbortSignal>()
  const siblingStopped = Promise.withResolvers<undefined>()
  const lateSignature = Promise.withResolvers<ReturnType<typeof signPart>>()
  const sign = vi.fn(async (part: number) => part === 3 ? lateSignature.promise : signPart(part))
  const onUploaded = vi.fn()
  const fetchMock = vi.fn((target: URL, init: RequestInit) => {
    if (target.pathname === '/1') return first.promise
    const signal = init.signal!
    siblingStarted.resolve(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => { siblingStopped.resolve(undefined); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  const result = uploadMissingParts({ file: new File(['abcd'], 'test.bin'), partSize: 1, missing: [1, 2, 3, 4],
    signal: new AbortController().signal, guard() {}, sign, onUploaded })
  const outcome = expect(result).rejects.toMatchObject({ status: 403 })
  const sibling = await siblingStarted.promise
  first.resolve(new Response(null, { status: 403 }))
  await siblingStopped.promise
  expect(sibling.aborted).toBe(true)
  lateSignature.resolve(signPart(3))
  await outcome
  expect(sign.mock.calls.flat()).toEqual([1, 2, 3])
  expect(fetchMock.mock.calls.map(([target]) => target.pathname)).toEqual(['/1', '/2'])
  expect(onUploaded).not.toHaveBeenCalled()
})

it('cancels a scheduled retry when the user pauses during backoff', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const sign = vi.fn(async (part: number) => signPart(part))
  const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetchMock)
  const result = uploadMissingParts({ file: new File(['a'], 'test.bin'), partSize: 1, missing: [1],
    signal: controller.signal, guard() {}, sign, onUploaded: vi.fn() })
  const outcome = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(249)
  expect(fetchMock).toHaveBeenCalledOnce()
  controller.abort()
  await outcome
  await vi.advanceTimersByTimeAsync(1_000)
  expect(sign).toHaveBeenCalledOnce()
  expect(fetchMock).toHaveBeenCalledOnce()
})
