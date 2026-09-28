import { describe, expect, it, vi } from 'vitest'
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
import { dispatchDesktopRequest, type DesktopHostRoutes } from '../src/index.ts'

function handler(response: Response): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    fetch: vi.fn(async () => response),
  }
}

function routes(
  api: Response,
  named: Response | undefined,
): DesktopHostRoutes {
  return {
    api: handler(api),
    webServer: { fetchNamed: vi.fn(async () => named) },
    assets: handler(new Response('asset')),
    streams: handler(new Response('stream')),
  }
}

describe('Desktop in-process request routing', () => {
  it('uses the core API directly so browser trust checks cannot reject RPCs', async () => {
    const selected = routes(new Response('session list'), new Response('browser auth', { status: 401 }))
    const response = await dispatchDesktopRequest(new Request('dsh-app://app/api/session/list'), selected)
    expect(response.status).toBe(200)
    await expect(response.text())
      .resolves.toBe('session list')
    expect(selected.webServer.fetchNamed).not.toHaveBeenCalled()
  })

  it('falls through a core API 404 to a plugin-owned API route', async () => {
    const selected = routes(new Response('not found', { status: 404 }), new Response('plugin route'))
    await expect(dispatchDesktopRequest(new Request('dsh-app://app/api/plugin/action'), selected).then(response => response.text()))
      .resolves.toBe('plugin route')
    expect(selected.webServer.fetchNamed).toHaveBeenCalledOnce()
  })

  it('uses the stream and asset handlers for their dedicated paths', async () => {
    const selected = routes(new Response('api'), undefined)
    await expect(dispatchDesktopRequest(new Request('dsh-app://app/.dsh/remote-stream'), selected).then(response => response.text()))
      .resolves.toBe('stream')
    await expect(dispatchDesktopRequest(new Request('dsh-app://app/index.html'), selected).then(response => response.text()))
      .resolves.toBe('asset')
  })
})
