/** Native Code + PKCE. The callback listener and token belong solely to the Host. */
import { createServer } from 'node:http'
import * as oidc from 'openid-client'
import { z } from 'zod'
import { serverOrigin, ServerTransport } from './transport.ts'

/** Authenticate against the configured server using nonce, state, and PKCE.
 * @param origin - validated server origin.
 * @param authorize - publishes the authorization URL for the owner's browser.
 * @param signal - cancels the pending callback; issued authority still returns for cleanup.
 * @returns Host-owned authority; its owner must verify resource-server acceptance before admission.
 */
export async function nativeLogin(
  origin: string,
  authorize: (url: string) => void,
  signal: AbortSignal,
): Promise<{ transport: ServerTransport; expiresAt: number }> {
  serverOrigin(origin)
  const response = await fetch(`${origin}/api/v1/auth/discovery`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
  if (!response.ok) throw new Error('DISCOVERY_FAILED')
  const { data: discovery } = z.object({ data: z.object({ issuer: z.url(), desktopClientId: z.string(), pkce: z.literal('S256'), localFallback: z.literal(false) }) }).parse(await response.json())
  serverOrigin(new URL(discovery.issuer).origin)
  const issuer = new URL(discovery.issuer)
  // The validated origin permits HTTP only for loopback development identity servers.
  const config = await oidc.discovery(issuer, discovery.desktopClientId, undefined, oidc.None(),
    issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : {})
  const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier()
  const callback = Promise.withResolvers<URL>()
  const listener = createServer((request, reply) => {
    const address = listener.address()
    if (address === null || typeof address === 'string') { reply.writeHead(503).end(); return }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${address.port}`)
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) { reply.writeHead(400).end(); return }
    reply.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" }).end('DSH login received. You can close this window.')
    callback.resolve(url)
  })
  const cancelled = (): void => { callback.reject(new Error('LOGIN_CANCELLED')) }
  void callback.promise.catch(() => {})
  const timer = setTimeout(() => { callback.reject(new Error('LOGIN_TIMEOUT')) }, 120_000)
  signal.addEventListener('abort', cancelled, { once: true })
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
    const address = listener.address()
    if (address === null || typeof address === 'string') throw new Error('CALLBACK_UNAVAILABLE')
    const redirect = `http://127.0.0.1:${address.port}/callback`
    authorize(oidc.buildAuthorizationUrl(config, { redirect_uri: redirect, scope: 'openid profile email', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' }).href)
    const tokens = await oidc.authorizationCodeGrant(config, await callback.promise, {
      expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier, idTokenExpected: true,
    })
    const transport = new ServerTransport(origin, tokens.access_token)
    return { transport, expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000 }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancelled)
    listener.closeAllConnections()
    await new Promise<void>((resolve) => { listener.close(() => { resolve() }) })
  }
}
