---
description: "Cloud connections for DSH, including dsh-server authentication and cloud resource selection."
kind: "package-group"
---

# cloud/ — Cloud execution targets

English | [中文](README.zh.md)

## Summary

Use the cloud group to connect DSH clients to separately deployed cloud services. The server package supplies dsh-server login and cloud resource controls. Local execution remains available until cloud login starts. Cloud services own remote authorization and runtime isolation.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the service connection below.

| Package | Role |
|---|---|
| [server](server/README.md) | Sign in to dsh-server and operate cloud resources. |

<a id="related-documentation"></a>
## Related documentation

- [Cloud subsystem](../../docs/subsystems/cloud.md) — cloud target data and generated Remote methods.
- [API packages](../api/README.md) — application Remote selection.

<a id="dev-note"></a>
## Dev Note

None.
