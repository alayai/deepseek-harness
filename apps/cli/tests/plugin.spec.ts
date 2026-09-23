/** `dsh plugin` forwards to pnpm in the profile directory. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnSync = vi.hoisted(() => vi.fn((_command?: string, _args?: readonly string[], _options?: object) => ({ status: 0 })))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync }
})

import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runPlugin } from '../src/plugin.ts'

describe('runPlugin', () => {
  const homes: string[] = []
  const previousHome = process.env.DSH_HOME
  afterEach(() => {
    spawnSync.mockClear()
    vi.restoreAllMocks()
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  function withHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-'))
    homes.push(home)
    process.env.DSH_HOME = home
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    return home
  }

  it('pins workspace-root and auto-install-peers flags for profile pnpm', () => {
    const home = withHome()
    expect(runPlugin('web', ['add', 'dsh1024@latest'])).toBe(0)
    expect(spawnSync).toHaveBeenCalledOnce()
    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      [
        '--config.ignore-workspace-root-check=true',
        '--config.auto-install-peers=false',
        'add',
        'dsh1024@latest',
      ],
      expect.objectContaining({
        cwd: resolveProfileDir('web', home),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      }),
    )
  })

  it('anchors a relative add spec to the invoking directory', () => {
    withHome()
    const cwd = process.cwd()
    expect(runPlugin('web', ['add', '.'])).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      [
        '--config.ignore-workspace-root-check=true',
        '--config.auto-install-peers=false',
        'add',
        resolve(cwd, '.'),
      ],
      expect.anything(),
    )
  })
})
