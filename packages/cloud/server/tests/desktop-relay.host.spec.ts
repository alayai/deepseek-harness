import { describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { openDesktopRelay } from '../src/desktop-relay.ts'

describe('Host-owned cloud desktop relay', () => {
  it('serves a single-use viewer, forwards binary frames and closes on authority withdrawal', async () => {
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(upstream, 'listening')
    const address = upstream.address(); if (!address || typeof address === 'string') throw Error('NO_ADDRESS')
    upstream.on('connection', (socket) => { socket.on('message', (data, binary) => socket.send(data, { binary })) })
    const abort = new AbortController()
    const viewer = await openDesktopRelay({ signal: abort.signal, connect: () => new WebSocket(`ws://127.0.0.1:${address.port}`), asset: async () => 'export default class RFB {}' })
    const page = await fetch(viewer)
    expect(page.status).toBe(200); expect(await page.text()).not.toContain('Bearer')
    expect((await fetch(viewer, { headers: { Origin: 'https://hostile.test' } })).status).toBe(403)
    const url = new URL('connect', viewer); url.protocol = 'ws:'
    const socket = new WebSocket(url, { headers: { Origin: new URL(viewer).origin } })
    try {
      await once(socket, 'open')
      const received = once(socket, 'message'); socket.send(Buffer.from([0, 255, 1]))
      const [data, binary] = await received; expect(binary).toBe(true); expect(data).toEqual(Buffer.from([0, 255, 1]))
      const second = new WebSocket(url, { headers: { Origin: new URL(viewer).origin } })
      await new Promise<void>((resolve) => { second.on('error', () => resolve()); second.on('open', () => { second.terminate(); throw Error('REUSED_TICKET') }) })
      const closed = once(socket, 'close'); abort.abort(); await closed
      await expect(fetch(viewer)).rejects.toThrow()
    } finally { abort.abort(); socket.terminate(); upstream.close() }
  })
})
