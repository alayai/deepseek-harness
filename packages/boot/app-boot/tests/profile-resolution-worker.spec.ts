/** The profile-resolution Worker must read Node internals without the native addon. */

import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'

describe('profile resolution in a Worker', () => {
  it('installs interception when the Worker is started with --expose-internals', async () => {
    const bootstrap = [
      `import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}`,
      'register()',
      `await import(${JSON.stringify(new URL('./fixtures/profile-resolution-worker.ts', import.meta.url).href)})`,
    ].join('\n')
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
      execArgv: ['--expose-internals'],
    })
    const message = await new Promise<{ ok: boolean }>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`profile resolution worker exited with ${String(code)}`))
      })
    })
    expect(message).toEqual({ ok: true })
  })
})
