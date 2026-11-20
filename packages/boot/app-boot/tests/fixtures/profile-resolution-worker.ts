/** Worker fixture: install profile resolution the way the Inspector Worker does at startup. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { installRuntimeInterception } from '../../src/profile-resolution/resolver.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-profile-worker-'))
try {
  if (!process.execArgv.includes('--expose-internals')) {
    throw new Error('profile resolution worker is missing --expose-internals')
  }
  const registration = installRuntimeInterception({
    profilesDir: root,
    profileDir: undefined,
    localPackageNames: [],
    entries: [],
    linkedRoots: [],
  })
  registration.dispose()
  parentPort?.postMessage({ ok: true })
} finally {
  rmSync(root, { recursive: true, force: true })
}
