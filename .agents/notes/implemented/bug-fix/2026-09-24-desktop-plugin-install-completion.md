# Agent Note: Complete Desktop plugin transactions independently of primary-window navigation

Status: implemented

English | [中文](2026-09-24-desktop-plugin-install-completion.zh.md)

## Problem

The Desktop plugin manager invokes package mutations through Electron IPC. The mutation writes the profile and restarts the Host, but the primary application window may take longer to load its application document. Waiting for that unrelated navigation before resolving the IPC call leaves the plugin manager showing its installing message even though the package is already installed.

## Decision

The plugin mutation handler resolves after the profile mutation and backend restart complete. It starts the primary-window application navigation without making that navigation part of the plugin-manager IPC result. A navigation failure is reported through the existing startup-error path, while the plugin manager can refresh its installed inventory and display the completed operation immediately.

## Alternatives considered

**Keep navigation in the mutation Promise.** This preserves strict sequencing but couples package-operation feedback to an unrelated renderer document and can leave a completed install indefinitely busy when that document is slow or blocked.

**Report success immediately after pnpm exits.** This would expose a package as installed before the restarted Host is ready, so the manager could show success while activation is still incomplete. The handler continues to await the backend restart.

**Poll the profile from the renderer while the IPC call is pending.** Polling duplicates transaction ownership in the UI and could release controls while pnpm or Host restart still owns the profile lock. Completion remains an IPC responsibility.

## Consequences

Plugin-manager feedback reflects the completed profile transaction and Host restart rather than primary-window load time. The primary window can finish loading independently; failures still enter the existing startup error handling. Tests must keep the IPC completion path independent from application-document navigation.

## Testing

The Desktop main-process regression harness blocks the primary application navigation after a plugin mutation and asserts that the plugin IPC Promise still resolves once the replacement Host is ready. `git diff --check` and JavaScript syntax validation cover the edited source in environments without the repository's full test dependency installation.
