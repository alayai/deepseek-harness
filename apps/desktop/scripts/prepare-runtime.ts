/** Prepare the target Electron distribution and pinned pnpm CLI. */

import { packagingStep } from './packaging-step.mjs'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

/**
 * Reject an incomplete Electron distribution before electron-builder copies it.
 * @param root - Extracted Electron distribution directory.
 * @param platform - Electron distribution platform.
 * @returns Nothing; throws when a required runtime file is missing or malformed.
 */
function verifyElectronDistribution(root: string, platform: 'darwin' | 'win32'): void {
  const executable = join(root, platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
  const resources = join(root, platform === 'win32' ? 'resources' : 'Electron.app/Contents/Resources')
  const locales = join(root, platform === 'win32' ? 'locales' : 'Electron.app/Contents/Resources/locales')
  for (const path of [executable, join(resources, 'default_app.asar'), join(root, 'icudtl.dat')]) {
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`desktop runtime: extracted Electron file is missing: ${path}`)
    }
  }
  if (!statSync(locales, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`desktop runtime: extracted Electron locales is not a directory: ${locales}`)
  }
  const localeFiles = readdirSync(locales).filter(file => file.endsWith('.pak'))
  if (!localeFiles.includes('en-US.pak') || !localeFiles.includes('zh-CN.pak')) {
    throw new Error(`desktop runtime: extracted Electron locales are incomplete (${localeFiles.length} .pak files)`)
  }
}

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = resolveDesktopBuildTarget()
  const platform = target.startsWith('mac-') ? 'darwin' : 'win32'
  const arch = target.endsWith('arm64') ? 'arm64' : 'x64'
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
    () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
  rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => extractZip(archive, { dir: BUILD_PATHS.electron }))
  verifyElectronDistribution(BUILD_PATHS.electron, platform)
  const executable = join(BUILD_PATHS.electron, platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
  const nodeVersion = execFileSync(executable, ['-p', 'process.versions.node'], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const pnpmVersion = preparePnpm()
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: nodeVersion,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
}

await main()
