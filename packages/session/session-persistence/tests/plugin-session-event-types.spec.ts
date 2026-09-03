import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  extractSessionEventMapKeys,
  harvestPublishedSessionEventTypes,
  installMountedPluginSessionEventTypes,
  packageRootSpecifier,
  registerCountedTypes,
} from '../src/plugin-session-event-types.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-events-'))
  roots.push(root)
  return root
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, source] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
}

function fixtureProfile(): string {
  const profile = tempRoot()
  writeTree(profile, { 'package.json': JSON.stringify({ name: 'profile-anchor' }) })
  return profile
}

function writePluginMap(profile: string, keys: readonly string[]): void {
  const members = keys.map(key => `    '${key}': { n: 1 }`).join('\n')
  writeTree(join(profile, 'node_modules/@tmp/live'), {
    'package.json': JSON.stringify({ name: '@tmp/live' }),
    'lib/types/events.d.ts': `declare module '@deepseek-ai/dsh-session/types' {\n  interface SessionEventMap {\n${members}\n  }\n}\n`,
  })
}

/** Assign mock `loader`/`baseUrl` without intersecting Context's `Loader`. */
function assignHarvestHost(ctx: Context, host: { loader?: unknown; baseUrl?: string }): void {
  Object.assign(ctx as unknown as { loader?: unknown; baseUrl?: string }, host)
}

describe('packageRootSpecifier', () => {
  it('keeps an exact package name and strips a subpath', () => {
    expect(packageRootSpecifier('@alayai/dsh-elite-lowcode')).toBe('@alayai/dsh-elite-lowcode')
    expect(packageRootSpecifier('@alayai/dsh-elite-lowcode/client')).toBe('@alayai/dsh-elite-lowcode')
    expect(packageRootSpecifier('left-pad')).toBe('left-pad')
    expect(packageRootSpecifier('left-pad/sub')).toBe('left-pad')
  })

  it('rejects builtins, relatives, files, and incomplete scopes', () => {
    expect(packageRootSpecifier('')).toBeUndefined()
    expect(packageRootSpecifier('cordis:include')).toBeUndefined()
    expect(packageRootSpecifier('./local')).toBeUndefined()
    expect(packageRootSpecifier('file:///tmp/x')).toBeUndefined()
    expect(packageRootSpecifier('/abs/pkg')).toBeUndefined()
    expect(packageRootSpecifier('@scope')).toBeUndefined()
    expect(packageRootSpecifier('@scope/')).toBeUndefined()
  })
})

describe('extractSessionEventMapKeys', () => {
  it('reads slash keys from a declaration merge and ignores nested field names', () => {
    const source = `
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'lowcode/surface-open': { kind: string; nested: { 'kind': number } }
    "lowcode/embed-command": { ok: true }
  }
}
`
    expect(extractSessionEventMapKeys(source)).toEqual([
      'lowcode/surface-open',
      'lowcode/embed-command',
    ])
  })

  it('skips an unclosed map and a lookalike interface name', () => {
    expect(extractSessionEventMapKeys('interface SessionEventMapLike { \'x/y\': 1 }')).toEqual([])
    expect(extractSessionEventMapKeys('interface SessionEventMap { \'x/y\': {')).toEqual([])
  })
})

describe('registerCountedTypes', () => {
  it('refcounts overlapping keys and ignores a second dispose', () => {
    const counts = new Map<string, number>()
    const first = registerCountedTypes(counts, ['a/b', 'a/b', 'c/d'])
    const second = registerCountedTypes(counts, ['c/d'])
    expect(counts.get('a/b')).toBe(1)
    expect(counts.get('c/d')).toBe(2)
    first()
    first()
    expect(counts.has('a/b')).toBe(false)
    expect(counts.get('c/d')).toBe(1)
    second()
    expect(counts.size).toBe(0)
    const missing = registerCountedTypes(counts, ['gone/key'])
    counts.delete('gone/key')
    missing()
    expect(counts.size).toBe(0)
  })

  it('returns an idempotent disposer for an empty list', () => {
    const counts = new Map<string, number>()
    const dispose = registerCountedTypes(counts, [])
    dispose()
    dispose()
    expect(counts.size).toBe(0)
  })
})

describe('harvestPublishedSessionEventTypes', () => {
  it('harvests maps under lib/types and skips node_modules plus first-party names', () => {
    const pkg = tempRoot()
    writeTree(pkg, {
      'package.json': JSON.stringify({ name: '@tmp/live' }),
      'lib/types/events.d.ts': 'interface SessionEventMap { \'lowcode/surface-open\': { x: 1 } }\n',
      'lib/types/more.d.ts': 'interface SessionEventMap { \'lowcode/mutate\': { y: 2 } }\n',
      'lib/types/empty.d.ts': 'export type X = 1\n',
      'node_modules/other/index.d.ts': 'interface SessionEventMap { \'other/skip\': {} }\n',
    })
    const resolve = (id: string): string => {
      if (id === '@tmp/live/package.json') return join(pkg, 'package.json')
      throw new Error(`unexpected resolve ${id}`)
    }
    expect(harvestPublishedSessionEventTypes('@tmp/live', resolve)).toEqual([
      'lowcode/surface-open',
      'lowcode/mutate',
    ])
    expect(harvestPublishedSessionEventTypes('@tmp/live/client', resolve)).toEqual([
      'lowcode/surface-open',
      'lowcode/mutate',
    ])
    expect(harvestPublishedSessionEventTypes('@deepseek-ai/dsh-session', () => {
      throw new Error('must not resolve first-party packages')
    })).toEqual([])
    expect(harvestPublishedSessionEventTypes('cordis:include', () => {
      throw new Error('must not resolve builtins')
    })).toEqual([])
    expect(harvestPublishedSessionEventTypes('@tmp/missing', () => {
      throw new Error('missing')
    })).toEqual([])
  })

  it('skips a non-JSON manifest, a non-object manifest, and a missing package.json path', () => {
    const root = tempRoot()
    writeTree(root, { 'package.json': '{not json' })
    expect(harvestPublishedSessionEventTypes('@tmp/bad', () => join(root, 'package.json'))).toEqual([])
    writeFileSync(join(root, 'array.json'), '[]\n')
    expect(harvestPublishedSessionEventTypes('@tmp/array', () => join(root, 'array.json'))).toEqual([])
    writeFileSync(join(root, 'null.json'), 'null\n')
    expect(harvestPublishedSessionEventTypes('@tmp/null', () => join(root, 'null.json'))).toEqual([])
    expect(harvestPublishedSessionEventTypes('@tmp/gone', () => join(root, 'no-such-package.json'))).toEqual([])
  })
})

describe('installMountedPluginSessionEventTypes', () => {
  it('no-ops without a loader or a usable baseUrl', () => {
    const counts = new Map<string, number>()
    const register = (types: readonly string[]) => registerCountedTypes(counts, types)
    installMountedPluginSessionEventTypes(new Context(), register)
    expect(counts.size).toBe(0)

    const noBase = new Context()
    assignHarvestHost(noBase, { loader: { entries: () => [] } })
    installMountedPluginSessionEventTypes(noBase, register)
    expect(counts.size).toBe(0)

    const invalid = new Context()
    assignHarvestHost(invalid, { loader: { entries: () => [] }, baseUrl: 'http://example.test/' })
    installMountedPluginSessionEventTypes(invalid, register)
    expect(counts.size).toBe(0)

    const notALoader = new Context()
    assignHarvestHost(notALoader, {
      loader: 'nope',
      baseUrl: pathToFileURL(join(tempRoot(), 'x')).href,
    })
    installMountedPluginSessionEventTypes(notALoader, register)
    expect(counts.size).toBe(0)

    const nullLoader = new Context()
    assignHarvestHost(nullLoader, {
      loader: null,
      baseUrl: pathToFileURL(join(tempRoot(), 'y')).href,
    })
    installMountedPluginSessionEventTypes(nullLoader, register)
    expect(counts.size).toBe(0)

    const noEntries = new Context()
    assignHarvestHost(noEntries, {
      loader: {},
      baseUrl: pathToFileURL(join(tempRoot(), 'z')).href,
    })
    installMountedPluginSessionEventTypes(noEntries, register)
    expect(counts.size).toBe(0)
  })

  it('harvests the initial scan, ignores a duplicate fiber, and drops types on dispose', async () => {
    const profile = fixtureProfile()
    writePluginMap(profile, ['plugin/from-scan'])
    const ctx = new Context()
    const fiber = { entry: { options: { name: '@tmp/live' } }, ctx }
    assignHarvestHost(ctx, {
      loader: { entries: () => [{ options: { name: '@tmp/live' }, fiber }] },
      baseUrl: pathToFileURL(profile).href + '/',
    })
    const counts = new Map<string, number>()
    installMountedPluginSessionEventTypes(ctx, types => registerCountedTypes(counts, types))
    expect(counts.get('plugin/from-scan')).toBe(1)
    ctx.emit('internal/plugin', fiber as never)
    expect(counts.get('plugin/from-scan')).toBe(1)
    ctx.emit('internal/plugin', { ctx } as never)
    expect(counts.get('plugin/from-scan')).toBe(1)
    await ctx.fiber.dispose()
    expect(counts.size).toBe(0)
  })

  it('harvests a fiber that arrives after activation', async () => {
    const profile = fixtureProfile()
    writePluginMap(profile, ['plugin/from-event'])
    const ctx = new Context()
    assignHarvestHost(ctx, {
      loader: { entries: () => [{ options: { name: '@tmp/live' } }] },
      baseUrl: pathToFileURL(profile).href + '/',
    })
    const counts = new Map<string, number>()
    installMountedPluginSessionEventTypes(ctx, types => registerCountedTypes(counts, types))
    expect(counts.size).toBe(0)
    ctx.emit('internal/plugin', {
      entry: { options: { name: '@tmp/live' } },
      ctx,
    } as never)
    expect(counts.get('plugin/from-event')).toBe(1)
    ctx.emit('internal/plugin', {
      entry: { options: { name: '@tmp/missing' } },
      ctx,
    } as never)
    expect(counts.size).toBe(1)
    await ctx.fiber.dispose()
    expect(counts.size).toBe(0)
  })
})
