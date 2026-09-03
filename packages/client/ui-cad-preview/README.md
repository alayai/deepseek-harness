---
description: "Interactive WebGL CAD preview overlay for the dsh web client; opens a rack-and-pinion actuator model without changing conversation state."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cad-preview

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-cad-preview` contributes one floating launcher to the Web shell overlay. Activating it opens a modal Three.js viewport that procedurally renders an image-inspired rack-and-pinion actuator: a toothed rack, animated drive gear, bolt circle, cylindrical reducer stack, square rear motor block, and front flange details. The package is a browser-only preview surface; it stores no data, calls no Host APIs, and does not generate manufacturing CAD artifacts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package into the Web app bundle. The client half waits for the `shell.overlay` declaration from `ui-layout`, then registers the `cad-preview` list entry. Users see a **3D Preview** floating button at the lower-right of the Web client; pressing it opens the modal viewport. Mouse drag or touch drag orbits the model through `OrbitControls`, wheel zooms, and Escape closes the modal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The node half is empty and exists so the Loader can carry the package row. The browser half is [`src/client/index.ts`](src/client/index.ts), which registers into `shell.overlay` through `ctx.slots.inject()` so declaration and HMR lifetimes stay paired. [`src/client/CadPreviewOverlay.tsx`](src/client/CadPreviewOverlay.tsx) creates the Three.js scene only while the modal is mounted, disposes controls, geometries, and materials on close, and keeps all model facts local to the component.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-layout](../ui-layout/README.md) — declares and renders the `shell.overlay` slot.
- [Web client architecture](../../../docs/subsystems/web-client.md) — explains browser plugin loading and client bundles.
- [Slots reference](../../../docs/subsystems/slots.md) — describes additive list slots and registration lifetimes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the boundary between an online visual preview and validated CAD output.

- **Preview geometry only** — the model is procedural Three.js mesh geometry, not a validated STEP/STP manufacturing artifact.
- **Single built-in design** — this package currently previews one rack-and-pinion actuator interpretation rather than loading arbitrary user CAD files.
- **No image calibration** — dimensions and proportions are best-effort visual reconstruction from the prompt context, not measured from a calibrated drawing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
