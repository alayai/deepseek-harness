/**
 * WHATWG `Request` → node:http pair for carriers that never bind a socket.
 * Named-route handlers keep their IncomingMessage/ServerResponse contract;
 * Electron and other pipe transports collect the same writes into a Response.
 */
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

const encoder = new TextEncoder()

function bytesOf(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? encoder.encode(chunk) : chunk
}

function headerRecord(headers: OutgoingHttpHeaders | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (headers === undefined) return result
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result[name.toLowerCase()] = Array.isArray(value) ? value.map(String).join(', ') : String(value)
  }
  return result
}

function incomingHeaders(request: Request, host: string): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of request.headers.entries()) {
    const key = name.toLowerCase()
    const current = headers[key]
    if (current === undefined) headers[key] = value
    else if (Array.isArray(current)) current.push(value)
    else headers[key] = [current, value]
  }
  if (headers.host === undefined) headers.host = host
  return headers
}

function writeHeadArgs(
  statusMessageOrHeaders?: string | OutgoingHttpHeaders,
  maybeHeaders?: OutgoingHttpHeaders,
): OutgoingHttpHeaders | undefined {
  return typeof statusMessageOrHeaders === 'string' ? maybeHeaders : statusMessageOrHeaders
}

/**
 * Dispatch one fetch request through a node:http route handler and collect
 * its `writeHead`/`write`/`end` into a Response. The handler owns completion;
 * this adapter does not invent a fallback status.
 * @param request - carrier request (custom schemes included).
 * @param handler - registered webserver route handler.
 * @returns the handler's complete response.
 */
export async function fetchFromHttpHandler(
  request: Request,
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<Response> {
  const url = new URL(request.url)
  const headers = incomingHeaders(request, url.host)
  const body = request.body
  const req = {
    url: `${url.pathname}${url.search}`,
    method: request.method,
    headers,
    destroy(): void { void body?.cancel() },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      if (body === null) return
      for await (const chunk of body) {
        if (chunk.byteLength > 0) yield Buffer.from(chunk)
      }
    },
  } as IncomingMessage

  let status = 200
  let responseHeaders: Record<string, string> = {}
  let finished = false
  const chunks: Uint8Array[] = []
  const listeners = new Map<string, Set<() => void>>()
  let resolveResponse!: (response: Response) => void
  let rejectResponse!: (error: unknown) => void
  const done = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })

  const emit = (event: string): void => {
    for (const callback of [...(listeners.get(event) ?? [])]) callback()
  }

  const complete = (error?: unknown): void => {
    if (finished) return
    finished = true
    emit('close')
    if (error !== undefined) {
      rejectResponse(error)
      return
    }
    const bodyBytes = chunks.length === 0 ? null : new Uint8Array(Buffer.concat(chunks))
    resolveResponse(new Response(bodyBytes, { status, headers: responseHeaders }))
  }

  const res: Record<string, unknown> = {
    writeHead(
      nextStatus: number,
      statusMessageOrHeaders?: string | OutgoingHttpHeaders,
      maybeHeaders?: OutgoingHttpHeaders,
    ): unknown {
      status = nextStatus
      responseHeaders = { ...responseHeaders, ...headerRecord(writeHeadArgs(statusMessageOrHeaders, maybeHeaders)) }
      return res
    },
    setHeader(name: string, value: string | number | readonly string[]): unknown {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.map(String).join(', ') : String(value)
      return res
    },
    getHeader(name: string): string | undefined {
      return responseHeaders[name.toLowerCase()]
    },
    write(chunk: string | Uint8Array): boolean {
      if (finished) return false
      chunks.push(bytesOf(chunk))
      return true
    },
    end(chunk?: string | Uint8Array): unknown {
      if (chunk !== undefined) chunks.push(bytesOf(chunk))
      complete()
      return res
    },
    destroy(): void {
      complete(new Error(`webserver: carrier response destroyed for ${request.method} ${url.pathname}`))
    },
    on(event: string, callback: () => void): unknown {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
      return res
    },
    off(event: string, callback: () => void): unknown {
      listeners.get(event)?.delete(callback)
      return res
    },
  }
  res.once = res.on
  Object.defineProperty(res, 'headersSent', { get: () => chunks.length > 0 || Object.keys(responseHeaders).length > 0 })
  Object.defineProperty(res, 'writableEnded', { get: () => finished })

  try {
    await handler(req, res as unknown as ServerResponse)
    if (!finished) {
      complete(new Error(`webserver: ${request.method} ${url.pathname} did not finish its response`))
    }
  } catch (error) {
    complete(error)
  }
  return await done
}
