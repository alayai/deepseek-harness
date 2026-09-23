import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { createPluginProfile } from '../src/project-manager.ts'
import {
  linkDesktopHostPackages,
  readDesktopProfileState,
  recordDesktopRuntimeProfile,
  unlinkDesktopHostPackages,
  validateDesktopPluginGraph,
} from '../src/profile-packages.ts'
import { writeDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
function fixture(additionalShared: Readonly<Record<string, string>> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-profile-'))
  roots.push(root)
  const dsh = join(root, 'dsh')
  let runtime = runtimeFixture(dsh)
  for (const [name, version] of Object.entries(additionalShared)) {
    writePackage(join(dsh, 'node_modules'), name, { version })
  }
  if (Object.keys(additionalShared).length > 0) {
    runtime = writeDesktopRuntime(dsh, runtime.release, [
      ...runtime.sharedPackages.map(entry => entry.name),
      ...Object.keys(additionalShared),
    ])
  }
  const profile = join(root, 'profile')
  createPluginProfile(profile)
  linkDesktopHostPackages(profile, dsh, runtime)
  return { root, dsh, runtime, profile }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('loads one shared ESM instance from both host and external plugin while keeping ordinary dependencies private', () => {
  const { dsh, runtime, profile } = fixture()
  writePackage(join(dsh, 'node_modules'), 'ordinary', {}, 'export default "host"')
  writePackage(join(profile, 'node_modules'), 'ordinary', {}, 'export default "plugin"')
  const plugin = writePackage(join(profile, 'node_modules'), 'plugin', {
    peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' }, dependencies: { ordinary: '1.0.0' },
  }, 'export { identity } from "@deepseek-ai/cordis"; export { default as ordinary } from "ordinary"')
  validateDesktopPluginGraph(profile, dsh, runtime, ['plugin'])
  const entry = join(dsh, 'check.mjs')
  writeFileSync(entry, `import {identity} from '@deepseek-ai/cordis'; import ordinary from 'ordinary'; import * as plugin from ${JSON.stringify(pathToFileURL(join(plugin, 'index.js')).href)}; console.log(JSON.stringify({same:identity===plugin.identity, host:ordinary, plugin:plugin.ordinary}))`)
  const output = execFileSync(process.execPath, [entry], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } })
  expect(JSON.parse(output)).toEqual({ same: true, host: 'host', plugin: 'plugin' })
})
it('runtime resolution retains and ignores an existing Link generation', () => {
  const { dsh, runtime, profile } = fixture()
  const links = readDesktopProfileState(profile)?.links
  expect(links?.length).toBeGreaterThan(0)

  recordDesktopRuntimeProfile(profile, runtime)
  expect(readDesktopProfileState(profile)?.links).toEqual(links)
  expect(lstatSync(join(profile, 'node_modules/@deepseek-ai/cordis')).isSymbolicLink()).toBe(true)
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, [], 'runtime') }).not.toThrow()
})
it('runtime resolution enables plugins even when leftover host links are broken', () => {
  const { root, dsh, runtime, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'plugin', { peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' } })
  const stale = writePackage(join(root, 'stale-runtime', 'node_modules'), '@deepseek-ai/cordis')
  unlinkSync(join(profile, 'node_modules/@deepseek-ai/cordis'))
  symlinkSync(stale, join(profile, 'node_modules/@deepseek-ai/cordis'), process.platform === 'win32' ? 'junction' : 'dir')
  rmSync(stale, { recursive: true })
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin'], 'runtime') }).not.toThrow()
})
it.each(['nested', 'alias'])('rejects a %s second copy of a host package', (placement) => {
  const { dsh, runtime, profile } = fixture()
  const plugin = writePackage(join(profile, 'node_modules'), 'plugin')
  if (placement === 'nested') writePackage(join(plugin, 'node_modules'), '@deepseek-ai/cordis')
  else writePackage(join(profile, 'node_modules'), 'alias', { name: '@deepseek-ai/cordis' })
  expect(() =>{  validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).toThrow(/duplicate or aliased/u)
})
it('binds a host package declared as an ordinary dependency to the host instance', () => {
  const { dsh, runtime, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'plugin', { dependencies: { '@deepseek-ai/cordis': '^1.0.0' } })
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).not.toThrow()
})
it('rejects an incompatible host package version from either dependency field', () => {
  const { dsh, runtime, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'plugin', { dependencies: { '@deepseek-ai/cordis': '^2.0.0' } })
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).toThrow(/found 1.0.0/u)
})
it('accepts client-only peers supplied by the host graph', () => {
  const { dsh, runtime, profile } = fixture({
    '@deepseek-ai/dsh-client-runtime': '1.0.0',
    react: '19.0.0',
  })
  writePackage(join(profile, 'node_modules'), 'plugin', {
    peerDependencies: {
      '@deepseek-ai/cordis': '^1.0.0',
      '@deepseek-ai/dsh-client-runtime': '>=0.1.0-rc.1',
      react: '^18.2.0 || ^19.0.0',
    },
  })
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).not.toThrow()
})
it('rejects a missing required peer and permits a missing optional peer', () => {
  const { dsh, runtime, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'required-plugin', {
    peerDependencies: { '@deepseek-ai/cordis': '^1.0.0', missing: '^1.0.0' },
  })
  writePackage(join(profile, 'node_modules'), 'optional-plugin', {
    peerDependencies: { '@deepseek-ai/cordis': '^1.0.0', optional: '^1.0.0' },
    peerDependenciesMeta: { optional: { optional: true } },
  })
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['required-plugin']) }).toThrow(/requires missing missing@\^1\.0\.0/u)
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['optional-plugin']) }).not.toThrow()
})
it('rejects incompatible peers only when the plugin is enabled', () => {
  const { dsh, runtime, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'plugin', { peerDependencies: { '@deepseek-ai/cordis': '^2.0.0' } })
  expect(() =>{  validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).toThrow(/found 1.0.0/u)
  expect(() =>{  validateDesktopPluginGraph(profile, dsh, runtime, []) }).not.toThrow()
})
it('refuses to satisfy a plugin dependency from an ancestor CLI project', () => {
  const { root, dsh, runtime, profile } = fixture()
  writePackage(join(root, 'node_modules'), 'ambient')
  writePackage(join(profile, 'node_modules'), 'plugin', { dependencies: { ambient: '1.0.0' } })
  expect(() =>{  validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).toThrow(/outside its owned packages/u)
})
it('removes broken owned links without following them', () => {
  const { root, profile } = fixture()
  writePackage(join(profile, 'node_modules'), 'plugin')
  rmSync(join(root, 'dsh'), { recursive: true })
  expect(() =>{  unlinkDesktopHostPackages(profile) }).not.toThrow()
})
it('replaces a profile-local copy of a managed host package', () => {
  const { profile } = fixture()
  unlinkSync(join(profile, 'node_modules/@deepseek-ai/cordis'))
  writePackage(join(profile, 'node_modules'), '@deepseek-ai/cordis')
  expect(() =>{  unlinkDesktopHostPackages(profile) }).not.toThrow()
  expect(existsSync(join(profile, 'node_modules/@deepseek-ai/cordis'))).toBe(false)
})
it('refuses to replace a managed name that resolves outside the profile', () => {
  const { root, profile } = fixture()
  unlinkSync(join(profile, 'node_modules/@deepseek-ai/cordis'))
  const foreign = writePackage(join(root, 'foreign'), '@deepseek-ai/cordis')
  symlinkSync(foreign, join(profile, 'node_modules/@deepseek-ai/cordis'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() =>{  unlinkDesktopHostPackages(profile) }).toThrow(/unowned package/u)
})
it('rejects private package links instead of following cycles or old transaction paths', () => {
  const { dsh, runtime, profile } = fixture()
  const plugin = writePackage(join(profile, 'node_modules'), 'plugin')
  symlinkSync(plugin, join(profile, 'node_modules/alias'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).toThrow(/linked private package/u)
})
it('accepts pnpm store junctions that stay inside the profile', () => {
  const { dsh, runtime, profile } = fixture()
  const stored = writePackage(
    join(profile, 'node_modules', '.pnpm', 'plugin@1.0.0', 'node_modules'),
    'plugin',
    { peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' } },
  )
  symlinkSync(stored, join(profile, 'node_modules', 'plugin'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).not.toThrow()
})
it('resolves private plugin dependencies from the pnpm virtual-store hoist', () => {
  const { dsh, runtime, profile } = fixture()
  const stored = writePackage(join(profile, 'node_modules', '.pnpm', 'ordinary@1.0.0', 'node_modules'), 'ordinary')
  writePackage(join(profile, 'node_modules'), 'plugin', {
    peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
    dependencies: { ordinary: '1.0.0' },
  })
  mkdirSync(join(profile, 'node_modules', '.pnpm', 'node_modules'), { recursive: true })
  symlinkSync(stored, join(profile, 'node_modules', '.pnpm', 'node_modules', 'ordinary'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => { validateDesktopPluginGraph(profile, dsh, runtime, ['plugin']) }).not.toThrow()
})
