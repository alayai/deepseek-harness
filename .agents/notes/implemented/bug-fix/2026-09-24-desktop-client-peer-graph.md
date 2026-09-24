# Agent Note: Keep Desktop Host and browser Client peer graphs separate

Status: implemented

English | [中文](2026-09-24-desktop-client-peer-graph.zh.md)

## Problem

The Desktop profile validates enabled plugin packages in the bundled Node Host process. A dual-face plugin can also publish a browser bundle through `dsh.client`, whose peer packages are supplied by the Web module table or by another browser bundle rather than by the Desktop Node profile. Treating every `peerDependencies` entry as a required Node package rejects a valid plugin with `requires missing`, even though its Host entry has no import of that package and its browser entry will receive it from the Client graph.

This failure is easy to hide in tests by adding browser-only packages to the runtime descriptor's `sharedPackages`. That fixture changes the ownership model instead of reproducing the packaged Desktop runtime, where browser packages may be absent from `resources/dsh/node_modules`. Reverting to “ignore every missing peer” would hide genuinely missing Host peers and allow a later Host activation failure.

## Decision

Desktop keeps two dependency questions separate. `validateDesktopPluginGraph()` proves dependencies needed by the Node Host and preserves the existing checks for shared-package versions, local package ownership, duplicate host copies, and missing required Host peers. It first reads the package's `dsh.client` declaration. For a package declaring `platform: web`, peers named by the Web shell's static module table or by the declaration's `inject` and `external` entries are recorded as browser peers. A missing peer is ignored only when it is optional or is one of those browser peers. If the peer is present in the Desktop shared inventory, its version is still checked against the declared range.

The browser peer list follows the Web shell's module identities, not an arbitrary “client” name pattern. A browser declaration does not waive validation for an unrelated required Host peer, and a package without a Web declaration receives no browser-peer exception. Package-manager fields remain dependency metadata; they do not prove which face of a dual-face package owns a runtime import.

The [Desktop runtime decision](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md) continues to own resource packages and shared links. The [Client shell decision](../architecture/2026-08-15-client-shells-and-dynamic-packages.md) continues to own browser module externality and module-table composition. This note owns the validation rule that joins those two facts without merging their dependency graphs.

## Alternatives considered

**Ignore every missing peer.** This makes the reported plugin pass, but removes the only early rejection for a required Host API that is absent from the profile. The Host then fails later and farther from the package operation, so this is not an acceptable compatibility rule.

**Add browser-only packages to `desktop-runtime.json`.** This makes a test fixture and the packaged inventory look alike, but it installs browser graph packages into a Node-only resource tree and makes the Desktop release own packages that the Web shell already supplies. It also fails for browser packages that are intentionally not published in this repository.

**Classify peers from `dependencies`, `peerDependencies`, or package names alone.** Those fields describe npm relationships, not the emitted face that imports a module. Name patterns also cannot distinguish a browser request from a Host request. The explicit `dsh.client.platform`, `inject`, `external`, and static module-table declarations provide the required ownership evidence.

## Consequences

The Desktop plugin transaction can enable dual-face plugins whose browser peers are intentionally absent from the Node profile, while still failing before activation for missing or incompatible Host peers. A change to the Web static module table or the `dsh.client` declaration must keep the Desktop browser-peer classification aligned with the Client loader's actual module identities. The exception is deliberately narrow: it applies only to enabled packages with a valid Web declaration and never bypasses version checks for packages that Desktop does supply.

## Testing

The Desktop profile tests use a runtime fixture that does not contain `@deepseek-ai/dsh-client-runtime` or React. They cover acceptance of a dual-face plugin with absent browser peers, rejection of an undeclared required Host peer from the same plugin, rejection of a missing peer without a Web declaration, and rejection of incompatible shared versions. The full focused Desktop regression set covers profile validation, project transactions, real pnpm installation, and startup. A packaged Windows unpacked build is also checked to ensure the compiled Electron bundle contains the same validation rule.
