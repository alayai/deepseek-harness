/** Prepare Desktop resources and publish their versions after every preparation stage succeeds. */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { readPrimaryRuntime } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { packagingStep } from './packaging-step.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { prepareCommandLink } from './prepare-command-link.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

type DesktopTarget = ReturnType<typeof desktopTargetPlatform>

/** True when Windows is holding a file open, so a replacement has to be copied around it. */
function isFileLock(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EPIPE') return true
  const message = error instanceof Error ? error.message : ''
  return message.includes('being used by another process')
}

/**
 * Copy one extracted Electron tree onto a directory that could not be removed.
 * A locked file is kept when it already has the same size as the incoming file.
 */
function copyElectronTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      copyElectronTree(from, to)
      continue
    }
    try {
      cpSync(from, to, { force: true })
    } catch (error) {
      if (!isFileLock(error) || !existsSync(to) || statSync(from).size !== statSync(to).size) throw error
    }
  }
}

/** Replace the extracted Electron tree, copying around a file another process still has open. */
async function installElectronArchive(archive: string): Promise<void> {
  try {
    rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
    await extractZip(archive, { dir: BUILD_PATHS.electron })
    return
  } catch (error) {
    if (!isFileLock(error)) throw error
  }
  const staging = `${BUILD_PATHS.electron}.staging-${Date.now().toString(36)}`
  await extractZip(archive, { dir: staging })
  copyElectronTree(staging, BUILD_PATHS.electron)
  try {
    rmSync(staging, { recursive: true, force: true })
  } catch (error) {
    if (!isFileLock(error)) throw error
  }
}

/** Extract the target Electron distribution and return its embedded Node version. */
async function prepareElectron({ platform, arch }: DesktopTarget): Promise<string> {
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
    () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => installElectronArchive(archive))
  const executable = join(BUILD_PATHS.electron, platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
  return execFileSync(executable, ['-p', 'process.versions.node'], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
}

function prepareCli({ platform, arch }: DesktopTarget): void {
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  const cli = join(RUNTIME_ROOT, 'cli')
  prepareDesktopCli(cli, platform)
  if (platform === 'darwin') {
    const minimumVersion = execFileSync('/usr/libexec/PlistBuddy', [
      '-c', 'Print LSMinimumSystemVersion', join(BUILD_PATHS.electron, 'Electron.app', 'Contents', 'Info.plist'),
    ], { encoding: 'utf8' }).trim()
    prepareCommandLink(cli, arch, minimumVersion)
  }
  cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(cli, 'command-manager.js'))
  cpSync(join(import.meta.dirname, 'command-path.ps1'), join(cli, 'command-path.ps1'))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = desktopTargetPlatform(resolveDesktopBuildTarget())
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const preparePrimary = () => packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
  let nodeVersion: string
  if (target.platform === 'win32') {
    const [electron, primary] = await Promise.allSettled([prepareElectron(target), preparePrimary()])
    if (electron.status === 'rejected') throw electron.reason
    if (primary.status === 'rejected') throw primary.reason
    nodeVersion = electron.value
  } else {
    nodeVersion = await prepareElectron(target)
    await preparePrimary()
  }
  const { pnpm } = await readPrimaryRuntime(join(RUNTIME_ROOT, 'primary-runtime'))
  if (pnpm === undefined) throw new Error('desktop runtime: primary-runtime manifest has no pnpm version')
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:cli', async () => { prepareCli(target) })
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: nodeVersion,
    pnpm,
  }, undefined, 2)}\n`)
}

await main()
