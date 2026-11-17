---
description: "在 DSH 中登录 dsh-server，使用云端工作空间、沙箱、会话、RustFS 对象与私有桌面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-cloud-server

[English](README.md) | 中文

## 概述

通过 DSH 云端入口登录 dsh-server，即可操作云端资源。本地模式保留现有 DSH 工作流程。开始登录时，系统停止本地任务并阻止新的本地业务调用。云端故障会暂停执行，直到重新连接或显式退出，绝不自动切换为本地执行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

内置 Web 组合为 Web 与 Desktop 客户端挂载本包。在仓库根目录运行 `pnpm run dev:web` 或 `pnpm run dev:desktop`，然后打开 **DSH 云端**。填写 dsh-server 的源地址，例如 `http://localhost:17800`，并在浏览器窗口完成统一账号登录。服务端必须提供面向 `dsh-desktop` 公共客户端的原生 PKCE 发现端点。

远程服务使用 HTTPS；HTTP 仅用于回环开发地址。完成登录的浏览器必须能访问 Host 所在机器的回环回调地址。远端 DSH Host 与另一台机器上的浏览器需要其他回调传输方式。

使用相邻的“刷新”按钮选择租户和工作空间，再刷新沙箱区域。分配并启动沙箱后，即可提交云端命令。会话区域可保存云端模型凭据并创建云端会话。文件操作使用所选沙箱中的相对路径。RustFS 上传仅传输用户明确选择的文件。桌面区域通过截图、输入文字与离线浏览器请求分配和控制云端桌面。

点击“退出云端并返回本地”恢复本地使用。本地任务排空失败或服务端撤销登录未得到确认时，本地执行继续被阻止；相关服务恢复后可重试。已接受的云端操作保留操作 ID，不会重放或复制到本地 DSH。

直接上传前，RustFS 桶的 CORS 规则必须允许 DSH 页面的准确源地址。将该地址加入 dsh-server 的 `CORS_ORIGINS`，再在服务端仓库运行 `pnpm storage:init`。DSH 端口不同即属于不同的源，无需使用通配符。

### 组合配置

本包没有插件配置字段。应用通过 API Remotes 选择其生成的 Remote，并通过以下配置行挂载 Host 与 Client 两部分。本包未声明配置层 bundle；dsh-server 服务压缩包也不是需要安装到 Desktop 的插件。

```yaml
- name: "@deepseek-ai/dsh-cloud-server"
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 负责 PKCE、临时回调监听器、访问令牌、登录代次和上游请求。Renderer 仅获得展示状态与有大小限制的 JSON。云端目标被保留期间，API Gateway 守卫、连接请求瀑布、工具守卫和 Agent 步骤前钩子共同阻止本地准入。登录会等待活动 Agent、终端、Job、已准入的 Remote 调用和已跟踪 HTTP 处理器结清。

每个业务请求携带当前展示代次和工作空间路径。代次变化后，旧结果会被拒绝。网络错误、认证拒绝与过期会暂停云端目标。退出操作串行执行，在客户端异步任务结清且服务端确认撤销或令牌已知过期后才恢复本地准入。重连先撤销旧授权，再获取新授权。

这些机制是应用层准入控制，不是针对受信任 Host 插件的操作系统沙箱。服务端租户授权与运行环境隔离仍由 dsh-server 负责。

| File | Responsibility |
|---|---|
| [connection.ts](src/connection.ts) | 执行目标生命周期与授权所有权 |
| [index.ts](src/index.ts) | Host Remote 与本地准入 |
| [CloudPanel.tsx](src/client/CloudPanel.tsx) | 云端资源操作界面 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Cloud 分组](../README.zh.md)——包职责。
- [API Gateway](../../api/gateway/README.zh.md)——调用准入与排空。
- [云端执行目标决策](../../../.agents/notes/implemented/architecture/2026-11-17-dsh-server-cloud-target.zh.md)——所有权与取舍。

-----

<a id="model-experience"></a>
## 模型体验

### 云端提示词

#### 模型看到什么

用户向所选云端会话提交 `prompt` 提示词。dsh-server 负责该会话的模型上下文与工具。本包不添加本地模型提示词或工具 schema。

#### Token 影响

提交文本进入云端请求；历史与截断由服务端控制。状态轮询和资源操作不会增加本地模型 token。

#### KV Cache effect

云端会话独立于本地会话。缓存复用由 dsh-server 与所选模型提供方负责；切换云端会话会改变请求上下文。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

云端视图具有以下限制。

- 云端会话显示事件文本，尚未复用本地对话气泡；每次提交提示词时重放历史，界面保留最近 2,000 条事件。
- 资源选择器读取服务端第一页；尚无完整分页与持久事件游标。
- 桌面视图支持截图与文字输入，尚无交互式 noVNC 视频流；浏览器提供方按服务端策略接受离线 URL。
- 访问令牌仅保存在 Host 内存，没有持久刷新令牌。重启 Host 会开始新的本地会话，不会恢复云端授权。
- 准入控制覆盖已注册的应用路径；直接访问操作系统的受信任插件需要额外隔离。Windows 安装版 Desktop 验收独立于 Web 验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
