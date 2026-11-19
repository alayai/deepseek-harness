import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { CloudApiError } from './transport.ts'

/** A loopback viewer owns one upstream socket; cloud authority never leaves the Host. */
export async function openDesktopRelay(input: {
  signal: AbortSignal
  closed?(): void
  connect(): WebSocket
  asset(path: string): Promise<string>
}): Promise<string> {
  input.signal.throwIfAborted()
  const prefix = `/${randomBytes(32).toString('hex')}`, sockets = new Set<WebSocket>()
  let origin = '', consumed = false, closed = false
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
    const path = req.url ?? ''
    if (closed || req.method !== 'GET' || req.headers.host !== new URL(origin).host || !path.startsWith(prefix + '/') || (req.headers.origin !== undefined && req.headers.origin !== origin)) { res.writeHead(403).end(); return }
    if (path === prefix + '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><html><meta charset="utf-8"><title>DSH cloud desktop</title><link rel="stylesheet" href="${prefix}/view.css"><div id="status" role="status">Connecting…</div><div id="screen"></div><script type="module" src="${prefix}/view.js"></script></html>`); return
    }
    if (path === prefix + '/view.css') { res.setHeader('Content-Type', 'text/css'); res.end('html,body{margin:0;width:100%;height:100%;background:#172536;color:#e9eff7;font:13px system-ui}#status{height:30px;box-sizing:border-box;padding:6px 12px}#screen{height:calc(100% - 30px);width:100%}'); return }
    if (path === prefix + '/view.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`import RFB from '${prefix}/novnc/core/rfb.js';const u=new URL('${prefix}/connect',location.origin);u.protocol='ws:';const s=document.getElementById('status');const r=new RFB(document.getElementById('screen'),u.href);r.scaleViewport=true;r.resizeSession=false;r.addEventListener('connect',()=>{s.textContent='Connected';});r.addEventListener('disconnect',()=>{s.textContent='Disconnected. Open a new viewer from DSH to reconnect.';});r.addEventListener('securityfailure',()=>{s.textContent='Connection authorization failed.';});addEventListener('pagehide',()=>r.disconnect());`); return
    }
    const asset = path.slice(prefix.length)
    if (!/^\/novnc\/[a-zA-Z0-9_/-]+\.js$/.test(asset)) { res.writeHead(404).end(); return }
    void input.asset(asset).then((body) => { res.setHeader('Content-Type', 'text/javascript'); res.end(body) }).catch(() => { res.writeHead(502).end() })
  })
  const close = () => {
    if (closed) return; closed = true
    clearTimeout(deadline); input.signal.removeEventListener('abort', close)
    for (const socket of sockets) socket.terminate()
    wss.close(); server.closeAllConnections(); server.close(); input.closed?.()
  }
  const deadline = setTimeout(close, 30_000); deadline.unref()
  server.on('upgrade', (req, socket, head) => {
    if (closed || consumed || req.url !== prefix + '/connect' || req.headers.origin !== origin || req.headers.host !== new URL(origin).host) { socket.destroy(); return }
    consumed = true
    wss.handleUpgrade(req, socket, head, (downstream) => {
      let upstream: WebSocket
      try { upstream = input.connect() } catch { downstream.terminate(); close(); return }
      sockets.add(upstream); sockets.add(downstream)
      const waiting: { bytes: Buffer; binary: boolean }[] = []; let size = 0
      const send = (target: WebSocket, bytes: Buffer, binary: boolean) => {
        if (target.readyState !== WebSocket.OPEN || target.bufferedAmount > 4 * 1024 * 1024) { close(); return }
        target.send(bytes, { binary })
      }
      downstream.on('message', (data, binary) => {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        if (upstream.readyState === WebSocket.OPEN) send(upstream, bytes, binary)
        else if (waiting.length < 16 && size + bytes.length <= 1024 * 1024) { size += bytes.length; waiting.push({ bytes, binary }) }
        else close()
      })
      upstream.on('open', () => { clearTimeout(deadline); for (const frame of waiting) send(upstream, frame.bytes, frame.binary); waiting.length = 0 })
      upstream.on('message', (data, binary) => send(downstream, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), binary))
      for (const endpoint of [upstream, downstream]) { endpoint.on('error', close); endpoint.on('close', close) }
    })
  })
  input.signal.addEventListener('abort', close, { once: true })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string' || input.signal.aborted) throw new CloudApiError('DESKTOP_RELAY_CLOSED', 409)
    origin = `http://127.0.0.1:${address.port}`
    return origin + prefix + '/'
  } catch (error) { close(); throw error }
}
