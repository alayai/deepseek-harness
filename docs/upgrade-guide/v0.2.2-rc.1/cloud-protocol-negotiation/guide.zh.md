---
kind: upgrade-guide
description: "云端登录要求 API 明确声明兼容协议。"
---

# 云端登录要求协议 1

[English](guide.md) | 中文

## 变更

DSH 云端登录此前仅检查执行策略，现在还要求 `/api/v1/server-info` 声明 `compatibility.protocol: 1`，且 `compatibility.client` 范围包含 1。协议缺失或不兼容时暂停云端执行，并保持本地执行阻断。已签发权限保留以供明确退出。

## 迁移

1. 在 dsh-server 仓库中，按照 `docs/UPGRADE_COMPATIBILITY.md` 核对任务、备份数据并部署匹配的 API、Worker 和 Agent。新 API 的执行准入要求迁移 `009_worker_protocol.sql`。
2. 同步更新匹配的 DSH Host 和 Client。单独的云端插件压缩包无法更新旧版 Desktop Host。
3. 重新连接，打开 **设置 → 版本诊断 → 检查运行版本**。确认协议为 1，且所需 Worker 功能就绪后再提交新任务。
4. 协议不兼容时，请管理员完成协调升级后重新连接。如需本地使用，明确点击 **退出云端并返回本地**。不要重试结果未知的云端任务。

维护期间必须阻止请求进入旧 API 节点：旧 API 不会执行该协议检查。Windows 安装版 Desktop 验收仍需单独完成。
