---
kind: upgrade-guide
description: "Cloud login requires an explicit compatible API protocol."
---

# Cloud login requires protocol 1

English | [中文](guide.zh.md)

## Change

DSH cloud login previously checked only the execution policy. It now also requires `/api/v1/server-info` to advertise `compatibility.protocol: 1` and a `compatibility.client` range containing 1. A missing or incompatible contract pauses cloud execution and keeps local execution blocked. Issued authority remains available for explicit logout.

## Migration

1. In the dsh-server repository, follow `docs/UPGRADE_COMPATIBILITY.md` to reconcile tasks, back up data and deploy the matching API, Worker and Agent. The new API requires migration `009_worker_protocol.sql` for execution admission.
2. Update the matching DSH Host and Client together. A cloud plugin archive alone does not update an older Desktop Host.
3. Reconnect, then open **Settings → Version diagnostics → Check running versions**. Confirm protocol 1 and the readiness of the required Worker features before submitting new work.
4. If the protocol is unsupported, ask the administrator to finish the coordinated upgrade, then reconnect. Use **Sign out and return to local** for explicit local use. Do not retry cloud tasks whose outcomes remain unknown.

Maintenance must prevent requests from reaching old API nodes: older APIs do not enforce this contract. Windows installed-Desktop acceptance remains a separate check.
