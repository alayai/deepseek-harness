# Agent Note: Pin Desktop Electron to the native runtime fingerprint

Status: implemented

English | [中文](2026-09-24-desktop-electron-runtime-fingerprint.zh.md)

## Problem

The Desktop Host loads `node-addon-require-builtin`, whose native binaries accept a fixed set of Electron Node and V8 runtime fingerprints. `apps/desktop` declared Electron as `^44.0.0`, so a lockfile refresh could select Electron `44.4.x`. That release used a newer Node/V8 fingerprint than the native add-on recognized, and the Host stopped before profile loading with `unsupported runtime fingerprint`.

## Decision

Desktop declares Electron as the exact version `44.0.0`, and the lockfile records the same exact specifier. The packaged Windows x64 artifact therefore uses the Electron runtime fingerprint supported by `node-addon-require-builtin@0.1.6` instead of allowing a compatible-looking minor release to change the embedded Node/V8 pair.

The native add-on is not upgraded or its fingerprint check relaxed. Its accepted fingerprints are part of the native binary compatibility contract; changing either side requires a separately verified native build and a platform matrix, while an exact Electron pin is the smallest change that restores the already-supported runtime.

## Alternatives considered

**Keep the caret range and rely on the lockfile.** Rejected because dependency updates can rewrite the lockfile and select a newer Electron minor release, reintroducing the startup failure.

**Upgrade `node-addon-require-builtin` or rebuild its native binaries.** Rejected for this fix because it changes native compatibility across Desktop platforms and requires new runtime fingerprints and release verification.

**Relax the native runtime fingerprint check.** Rejected because the add-on uses that check to prevent loading an unverified binary against a different Electron/Node/V8 ABI combination.

## Consequences

Desktop builds remain on Electron `44.0.0` until a native add-on release explicitly supports another runtime fingerprint. The Web launcher and the project package-manager contract are unchanged; the project continues to use `pnpm dsh web` for Web startup. Updating Electron now requires updating the native compatibility evidence and this exact-version decision together.

## Testing

The Windows x64 NSIS build logs `electronVersion=44.0.0`. The unpacked packaged executable reports Electron `44.0.0`, Node `24.18.1`, and V8 `15.2.124.13-electron.0`, and the generated installer is `coco-lite-v0.1.7-win-x64.exe`. `git diff --check` passes.
