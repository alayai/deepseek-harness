/**
 * Runtime SessionEventMap keys declared by mounted out-of-repo plugins.
 *
 * The generated `KNOWN_SESSION_EVENT_TYPES` set covers this repository only.
 * A persistence read also accepts keys harvested from a live loader entry's
 * published `.d.ts` `SessionEventMap` merges. `ignorable` remains the marker
 * for skipping an unrecognized type; harvest does not classify omission safety.
 * @module @deepseek-ai/dsh-session-persistence/plugin-session-event-types
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

/** Refcounted `SessionEventMap` keys harvested from mounted out-of-repo plugins. */
const extraEventTypeCounts = new Map<string, number>()

/** One loader row's published package name and optional live fiber. */
interface LoaderEntryLike {
  readonly options: { readonly name: string }
  readonly fiber?: object
}

/** The Loader subset this harvest observes. */
interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
}

/** A fiber that may carry a loader entry and owns effect disposal. */
interface PluginFiberLike {
  readonly entry?: { readonly options?: { readonly name?: unknown } }
  readonly ctx: Context
}

/**
 * Npm package root for a loader specifier, or `undefined` when the name is not
 * a package (builtin, relative, file URL, incomplete scope).
 * @param specifier - loader entry `options.name`.
 * @returns `@scope/name` or the unscoped package name.
 */
export function packageRootSpecifier(specifier: string): string | undefined {
  if (specifier.length === 0 || specifier.includes(':') || specifier.startsWith('.') || isAbsolute(specifier)) {
    return undefined
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    if (parts.length < 2 || parts[1] === '') return undefined
    return `${parts[0]}/${parts[1]}`
  }
  const name = specifier.split('/')[0]
  return name
}

/**
 * Increment per-type counts and return a disposer that decrements once.
 * @param counts - live extra-type refcounts owned by one persistence service.
 * @param types - SessionEventMap keys from one plugin.
 * @returns disposer; a second call is a no-op.
 */
export function registerCountedTypes(counts: Map<string, number>, types: readonly string[]): () => void {
  const unique = [...new Set(types)]
  for (const type of unique) {
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const type of unique) {
      const n = counts.get(type)
      if (n === undefined || n <= 1) counts.delete(type)
      else counts.set(type, n - 1)
    }
  }
}

/**
 * Collect `'ns/name'` keys from every `interface SessionEventMap` block.
 * Nested payload braces stay inside the matched block; keys without `/` are
 * ignored so object-literal fields such as `'kind'` are not harvested.
 * @param source - TypeScript declaration text.
 * @returns harvested keys in source order, duplicates retained.
 */
export function extractSessionEventMapKeys(source: string): string[] {
  const keys: string[] = []
  const re = /interface\s+SessionEventMap\s*\{/g
  let match = re.exec(source)
  while (match !== null) {
    const open = match.index + match[0].length - 1
    const block = sliceBalancedBlock(source, open)
    if (block === undefined) break
    re.lastIndex = open + block.length
    const inner = block.slice(1, -1)
    for (const keyMatch of inner.matchAll(/['"]([^'"]+)['"]\s*:/g)) {
      const key = keyMatch[1]
      if (key !== undefined && key.includes('/')) keys.push(key)
    }
    match = re.exec(source)
  }
  return keys
}

/**
 * SessionEventMap keys published by one resolvable out-of-repo package.
 * First-party `@deepseek-ai/` packages are skipped: they already appear in
 * `KNOWN_SESSION_EVENT_TYPES`. Unresolvable names return an empty list.
 * @param specifier - loader entry `options.name`.
 * @param resolvePath - `createRequire(baseUrl).resolve`.
 * @returns unique harvested keys.
 */
export function harvestPublishedSessionEventTypes(
  specifier: string,
  resolvePath: (id: string) => string,
): readonly string[] {
  const pkgName = packageRootSpecifier(specifier)
  if (pkgName === undefined || pkgName.startsWith('@deepseek-ai/')) return []
  let pkgJsonPath: string
  try {
    pkgJsonPath = resolvePath(`${pkgName}/package.json`)
  } catch {
    // Builtins, subpath-only rows, and missing packages are not contributors.
    return []
  }
  let pkgRoot: string
  try {
    pkgRoot = dirname(pkgJsonPath)
    const manifest: unknown = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return []
  } catch {
    // An unreadable or non-JSON manifest cannot own published types.
    return []
  }
  const keys: string[] = []
  for (const file of declarationFiles(pkgRoot)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      /* v8 ignore next -- the walk raced a deletion. */
      continue
    }
    keys.push(...extractSessionEventMapKeys(text))
  }
  return [...new Set(keys)]
}

/**
 * Whether a stored event type is in the generated catalog or currently harvested.
 * @param type - `SessionEvent.type` from a stored record.
 * @returns true when `validateStoredEvents` must accept the type as known.
 */
export function isKnownStoredSessionEventType(type: string): boolean {
  return KNOWN_SESSION_EVENT_TYPES.has(type) || extraEventTypeCounts.has(type)
}

/**
 * Register harvested keys on the process-wide extra-type set used by
 * {@link isKnownStoredSessionEventType}.
 * @param types - SessionEventMap keys from one plugin.
 * @returns disposer that decrements those keys once.
 */
export function registerHarvestedSessionEventTypes(types: readonly string[]): () => void {
  return registerCountedTypes(extraEventTypeCounts, types)
}

/**
 * Harvest SessionEventMap keys from live loader entries into `register`.
 * No-ops when the context has no Loader or `baseUrl`. Subscribe before the
 * initial scan so an entry arriving mid-activation is not missed.
 * @param ctx - persistence backend context (may carry `loader` and `baseUrl`).
 * @param register - refcounted extra-type registration; defaults to the
 *   process-wide set consulted by {@link isKnownStoredSessionEventType}.
 */
export function installMountedPluginSessionEventTypes(
  ctx: Context,
  register: (types: readonly string[]) => () => void = registerHarvestedSessionEventTypes,
): void {
  const loader = loaderOf(ctx)
  if (loader === undefined) return
  const baseUrl = (ctx as Context & { baseUrl?: string }).baseUrl
  if (baseUrl === undefined) return
  let resolvePath: (id: string) => string
  try {
    const require = createRequire(baseUrl)
    resolvePath = id => require.resolve(id)
  } catch {
    // createRequire requires a file URL or path; a non-file baseUrl cannot harvest.
    return
  }
  const seen = new WeakSet<object>()
  const recognize = (fiber: object): void => {
    if (seen.has(fiber)) return
    seen.add(fiber)
    const name = entryNameOf(fiber)
    if (name === undefined) return
    const types = harvestPublishedSessionEventTypes(name, resolvePath)
    if (types.length === 0) return
    const dispose = register(types)
    ;(fiber as PluginFiberLike).ctx.effect(() => dispose, 'plugin session event types')
  }
  ctx.on('internal/plugin', (fiber) => {
    recognize(fiber)
  })
  for (const entry of loader.entries()) {
    if (entry.fiber !== undefined) recognize(entry.fiber)
  }
}

/** Return the text from `openBrace` through its matching `}`, or `undefined`. */
function sliceBalancedBlock(source: string, openBrace: number): string | undefined {
  let depth = 0
  for (let i = openBrace; i < source.length; i++) {
    const c = source[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBrace, i + 1)
    }
  }
  return undefined
}

/** Recursively list `.d.ts` files under `root`, skipping `node_modules`. */
function declarationFiles(root: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    /* v8 ignore next -- the package root vanished between resolve and walk. */
    return []
  }
  const files: string[] = []
  for (const ent of entries) {
    if (ent.name === 'node_modules') continue
    const full = join(root, ent.name)
    if (ent.isDirectory()) files.push(...declarationFiles(full))
    else if (ent.isFile() && ent.name.endsWith('.d.ts')) files.push(full)
  }
  return files
}

function loaderOf(ctx: Context): LoaderLike | undefined {
  let loader: unknown
  try {
    loader = (ctx as Context & { loader?: unknown }).loader
  } catch {
    // Uninjected service property access throws; the registry lookup does not.
    loader = ctx.get('loader')
  }
  if (loader === undefined || typeof loader !== 'object' || loader === null) return undefined
  if (typeof (loader as LoaderLike).entries !== 'function') return undefined
  return loader as LoaderLike
}

function entryNameOf(fiber: object): string | undefined {
  const entry = (fiber as PluginFiberLike).entry
  const name = entry?.options?.name
  return typeof name === 'string' ? name : undefined
}
