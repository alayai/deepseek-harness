/**
 * WHATWG `Request` → node:http pair for carriers that never bind a socket.
 * Named-route handlers keep their IncomingMessage/ServerResponse contract;
 * Electron and other pipe transports expose the same writes through a Response.
 */
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

function bytesOf(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
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
 * Dispatch one fetch request through a node:http route handler. The Response
 * is published when its headers are sent, and later writes stream into its
 * body. The handler owns completion; this adapter does not invent a fallback.
 * @param request - carrier request (custom schemes included).
 * @param handler - registered webserver route handler.
 * @returns the handler's response once its headers are sent.
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
  let headersSent = false
  let writableEnded = false
  let terminal = false
  let streamFinished = false
  let needsDrain = false
  const listeners = new Map<string, Set<() => void>>()
  const onceListeners = new Map<string, Map<() => void, () => void>>()
  let resolveResponse!: (response: Response) => void
  let rejectResponse!: (error: unknown) => void
  const done = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    pull() {
      if (!needsDrain) return
      needsDrain = false
      emit('drain')
    },
    cancel() {
      if (terminal) return
      terminal = true
      streamFinished = true
      emit('close')
    },
  })

  const emit = (event: string): void => {
    for (const callback of [...(listeners.get(event) ?? [])]) callback()
  }

  const finishStream = (error?: unknown): void => {
    if (streamFinished) return
    streamFinished = true
    if (error === undefined) streamController.close()
    else streamController.error(error)
  }

  const publish = (): void => {
    if (headersSent || terminal) return
    const carriesBody = request.method !== 'HEAD' && status !== 204 && status !== 205 && status !== 304
    const response = new Response(carriesBody ? stream : null, { status, headers: responseHeaders })
    headersSent = true
    if (!carriesBody) finishStream()
    resolveResponse(response)
  }

  const complete = (error?: unknown): void => {
    if (terminal) return
    if (!headersSent) {
      if (error !== undefined) {
        terminal = true
        finishStream()
        rejectResponse(error)
        emit('close')
        return
      }
      publish()
    }
    terminal = true
    finishStream(error)
    emit('close')
  }

  const res: Record<string, unknown> = {
    writeHead(
      nextStatus: number,
      statusMessageOrHeaders?: string | OutgoingHttpHeaders,
      maybeHeaders?: OutgoingHttpHeaders,
    ): unknown {
      status = nextStatus
      responseHeaders = { ...responseHeaders, ...headerRecord(writeHeadArgs(statusMessageOrHeaders, maybeHeaders)) }
      publish()
      return res
    },
    setHeader(name: string, value: string | number | readonly string[]): unknown {
      if (headersSent) throw new Error('Cannot set headers after they are sent to the client')
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.map(String).join(', ') : String(value)
      return res
    },
    getHeader(name: string): string | undefined {
      return responseHeaders[name.toLowerCase()]
    },
    write(chunk: string | Uint8Array): boolean {
      if (terminal) return false
      publish()
      if (!streamFinished) streamController.enqueue(bytesOf(chunk))
      const writable = streamFinished || (streamController.desiredSize ?? 0) > 0
      needsDrain ||= !writable
      return writable
    },
    end(chunk?: string | Uint8Array): unknown {
      if (terminal) return res
      writableEnded = true
      if (chunk !== undefined) {
        publish()
        if (!streamFinished) streamController.enqueue(bytesOf(chunk))
      }
      complete()
      return res
    },
    destroy(error?: Error): unknown {
      complete(error ?? new Error(`webserver: carrier response destroyed for ${request.method} ${url.pathname}`))
      return res
    },
    on(event: string, callback: () => void): unknown {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
      return res
    },
    once(event: string, callback: () => void): unknown {
      const wrapped = (): void => {
        listeners.get(event)?.delete(wrapped)
        onceListeners.get(event)?.delete(callback)
        callback()
      }
      const wrappers = onceListeners.get(event) ?? new Map<() => void, () => void>()
      wrappers.set(callback, wrapped)
      onceListeners.set(event, wrappers)
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(wrapped)
      listeners.set(event, set)
      return res
    },
    off(event: string, callback: () => void): unknown {
      listeners.get(event)?.delete(callback)
      const wrapped = onceListeners.get(event)?.get(callback)
      if (wrapped !== undefined) listeners.get(event)?.delete(wrapped)
      onceListeners.get(event)?.delete(callback)
      return res
    },
  }
  Object.defineProperty(res, 'statusCode', {
    get: () => status,
    set: (nextStatus: number) => { status = nextStatus },
  })
  Object.defineProperty(res, 'headersSent', { get: () => headersSent })
  Object.defineProperty(res, 'writableEnded', { get: () => writableEnded })

  try {
    void Promise.resolve(handler(req, res as unknown as ServerResponse)).catch(complete)
  } catch (error) {
    complete(error)
  }
  return await done
}
