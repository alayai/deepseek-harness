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

内置 Web 组合为 Web 与 Desktop 客户端挂载本包。在仓库根目录运行 `pnpm run dev:web` 或 `pnpm run dev:desktop`，然后打开 **DSH 云端**。有会话显示时，左侧导航底部状态入口打开现有右侧栏；没有会话时，打开云端管理页。左侧导航也提供管理页入口。关闭或隐藏这些视图不会退出登录，也不会恢复本地执行。填写 dsh-server 的源地址，例如 `http://localhost:17800`，并在浏览器窗口完成统一账号登录。服务端必须提供面向 `dsh-desktop` 公共客户端的原生 PKCE 发现端点。

远程服务使用 HTTPS；HTTP 仅用于回环开发地址。完成登录的浏览器必须能访问 Host 所在机器的回环回调地址。远端 DSH Host 与另一台机器上的浏览器需要其他回调传输方式。

刷新并选择租户和工作空间，再刷新资源。沙箱、会话、文件、私有桌面、任务和设置按分区展示。分配并启动沙箱后，即可提交云端命令。设置区域保存云端模型凭据，会话区域创建云端会话。文件操作使用所选沙箱中的相对路径。RustFS 上传仅传输用户明确选择的文件。桌面区域通过截图、输入文字与离线浏览器请求分配和控制云端桌面。

云端会话由服务端固定绑定 Sandbox、模型凭据和可选桌面。使用已有会话发送前先刷新绑定；资源摘要显示会话目标，浏览资源不会改变它，发送携带显示的绑定版本。停用绑定会取消会话任务并阻止新回合，任务结清后才能重新启用。更换资源需要新建会话；原任务结果未知时，原会话在对账前不能继续发送。服务端必须应用绑定迁移并同时更新 API 与 Worker。

展开 **本地历史与 Bot · 只读**，按需读取 Host 本地预览。会话列表仅显示 ID 和创建时间；明确选择后展示用户及助手文本，先显示最新一页。工具载荷、推理、请求头、附件和工作目录不包含在内。DS Bot 通过 `ctx.botReadOnly` v1 提供已加载团队的名称、角色、有限长度的指令和模型引用；隐私配置仅对 Host 所有者展示。服务缺失或尚未初始化时明确提示，查看不会加载或刷新团队。你曾输入的文本可能含敏感信息。预览不会上传、写入云端提示或在本地继续执行；云端暂停时仍可只读，连接版本变化后丢弃旧结果。通过 **前往云端会话** 另选资源、新建独立会话。

点击“退出云端并返回本地”恢复本地使用。本地任务排空失败或服务端撤销登录未得到确认时，本地执行继续被阻止；相关服务恢复后可重试。Client 在内存中为每个工作空间保留最近提交的任务引用，视图关闭重开后仍可使用。“查询原任务”只读取同一任务，不重新提交。接收响应丢失时保留幂等键和请求路径。登录、退出、Client 刷新和插件卸载会清除此临时索引。服务端任务历史是权威记录，任务不会重放或复制到本地 DSH。

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
| [local-read.ts](src/local-read.ts) | 仅所有者可读的有限本地展示数据，不激活 Agent |
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
- 导航和最近任务引用在同一 Client 生命周期内跨面板关闭保留，刷新或重新登录会清空。关闭视图取消本地上传和轮询，不会取消已接收的云端任务。不同窗口分别维护视图状态。
- 资源选择器读取服务端第一页；尚无完整分页与持久事件游标。
- 桌面绑定当前是元数据；Agent 的 computer/browser 工具和本地 Bot 云端适配仍为独立后续工作。
- 桌面视图支持截图与文字输入，尚无交互式 noVNC 视频流；浏览器提供方按服务端策略接受离线 URL。
- 访问令牌仅保存在 Host 内存，没有持久刷新令牌。重启 Host 会开始新的本地会话，不会恢复云端授权；已有 Client 需要刷新页面以重新建立状态。
- 准入控制覆盖已注册的应用路径；直接访问操作系统的受信任插件需要额外隔离。Windows 安装版 Desktop 验收独立于 Web 验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
