---
description: "DSH 云端连接，包括 dsh-server 认证与云端资源选择。"
kind: "package-group"
---

# cloud/——云端执行目标

[English](README.md) | 中文

## 概述

通过 Cloud 分组，将 DSH 客户端连接到独立部署的云端服务。server 包提供 dsh-server 登录与云端资源操作。在开始云端登录前，本地执行保持可用。远程授权与运行隔离由云端服务负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

选择以下服务连接。

| Package | Role |
|---|---|
| [server](server/README.zh.md) | 登录 dsh-server 并操作云端资源。 |

<a id="related-documentation"></a>
## 相关文档

- [Cloud 子系统](../../docs/subsystems/cloud.zh.md)——云端执行目标数据与生成的 Remote 方法。
- [API 包](../api/README.zh.md)——应用 Remote 选择。

<a id="dev-note"></a>
## 开发备注

无。
