# DSH 云端原生会话桥接开发计划 III

状态：提案，尚未进入实现阶段。

前置条件：先完成当前云端开发计划的收尾和 Web/Desktop 验收，再进入本计划。

## 1. 目标

当前云端聊天有独立的 CloudChat、CloudChatTurns、事件回放和云端时间线。它能显示云端消息、流式文本、工具卡片和 Bot，但云端事件尚未进入本地 DSH Session、原生事件订阅和本地 Bot UI 数据协议。

本计划增加 CloudSessionAdapter，把云端会话适配为原生 Conversation UI 的统一来源。适配后应复用本地消息、流式状态、工具卡片、Composer、取消/恢复和 Bot 选择体验；执行权仍属于 dsh-server，不能转成本地 Agent 或工具。

本计划只打通数据协议和 UI，不把云端执行搬到本地，也不把云端历史伪装成本地历史。

## 2. 进入计划 III 前必须完成的当前计划

| 编号 | 当前计划收尾项 | 完成标准 | 验收证据 |
| --- | --- | --- | --- |
| C-01 | 云端目标生命周期 | 登录、暂停、退出、重连、epoch 和本地准入阻断稳定。 | Host/Client 生命周期和旧 epoch 测试。 |
| C-02 | 云端资源面板 | 租户、工作空间、沙箱、凭据、会话、文件、对象、桌面、任务和设置可用。 | 面板、契约和异常测试。 |
| C-03 | 云端聊天基础链路 | 创建会话、binding、提示词、轮询、取消、回执恢复和未知结果可用。 | chat-turns 测试和真实服务端记录。 |
| C-04 | 云端 Bot 基础能力 | Bot 列表、revision、创建、绑定和显式本地 Bot 导出可用。 | Bot 契约、面板和 Workspace 验证。 |
| C-05 | 云端事件回放 | 游标分页、去重、增量、工具合并、失败终态和刷新恢复稳定。 | session-events、timeline 和回放测试。 |
| C-06 | 文件与上传 | 小文件、分片上传、回执恢复、取消和失败提示符合协议。 | 文件、弱网和对象回执测试。 |
| C-07 | 桌面远程桥 | Host 所有权、短期能力、暂停/退出清理和错误行为稳定。 | relay 测试和开发桌面验收。 |
| C-08 | Web 验收 | Web 登录、资源、聊天、Bot 创建和异常路径通过。 | 浏览器验收记录。 |
| C-09 | Windows Desktop 验收 | 安装版启动、登录、聊天、退出回本地和升级重载通过。 | 独立 Windows 验收记录。 |
| C-10 | 文档与版本同步 | API、Worker、Agent、Host、Client 兼容矩阵和回滚准确。 | README、协议说明和诊断输出。 |

以下范围明确暂缓到 III：云端事件写入本地 Session、复用本地 Session 控制器、复用本地工具实例、自动把云端 Bot 变成本地 Bot、模型截图附件、完整跨窗口同步和离线云端缓存。

只有 C-01 至 C-10 有责任人、提交和证据，代码与文档检查通过，Web/Desktop 验收通过，兼容矩阵冻结，且协议失败仍阻断本地执行时，才能进入 III-00。

## 3. 设计边界

- 云端历史、操作状态、工具结果、Bot revision 和权限由 dsh-server 持有。
- 适配器只维护有上限的显示缓存、事件投影和未完成操作索引。
- 本地和云端可以共享 UI 组件，但不能共享执行器。
- 每次请求都校验 server、tenant、workspace、session、epoch 和 binding revision。
- 事件必须支持游标恢复、重复去重、缺口检测和终态收敛。
- 工具卡片默认只读；远程动作必须同时满足服务端 capability 和用户显式操作。
- 不保存 token、私有 Bot 指令、远程工具凭据或文件字节。

## 4. 目标模块

| 模块 | 职责 |
| --- | --- |
| CloudSessionAdapter | 统一会话来源和生命周期。 |
| cloud-session-identity | 身份、epoch、binding revision 校验。 |
| cloud-session-cursor | 游标、分页、去重、缺口和缓存上限。 |
| cloud-session-events | 云端事件到规范事件的映射。 |
| cloud-session-operations | receipt、operation、取消、unknown 和恢复。 |
| cloud-session-bot | Bot 摘要、来源、能力和 revision 绑定。 |
| cloud-session-tool | 工具卡片安全投影和受控远程动作。 |
| cloud-conversation-source | 适配器注入和 local/cloud 切换。 |

统一来源接口至少包含：列出会话、打开会话、读取快照、订阅变化、发送消息、取消操作、恢复回执和关闭句柄。关闭句柄只停止客户端工作，不取消已接受的服务端操作。

## 5. 规范事件

| 云端事件 | 规范事件 | 规则 |
| --- | --- | --- |
| user/message | user/message | 只接受用户来源消息，按 message id 去重。 |
| agent/inbox/spliced | user/message | 保留插入的用户消息，删除项不生成新事件。 |
| cloud/assistant-delta | assistant/delta | 按 operationId 和 streamId 累积，保持服务端顺序。 |
| assistant/message | assistant/message | 覆盖增量并结束流式状态。 |
| assistant/attempt | operation/state | 标记中断或未完成，不猜测成功。 |
| tool/call | tool/call | 过滤大小、类型和敏感字段。 |
| tool/result | tool/result | 过滤大结果、HTML、链接和二进制。 |
| turn/end | operation/state | 按服务端 reason 收敛终态。 |
| error 或 */error | error | 只输出稳定错误码。 |

同一 event id 只处理一次；最终助手消息不能与增量重复；工具按 operationId 加 callId 配对；服务端终态优先于客户端计时器；事件投影不能执行脚本、自动下载或调用本地文件解析器。

## 6. 分阶段开发

### III-00：当前计划收尾与协议冻结

完成 C-01 至 C-10，冻结 API 字段、错误码、binding revision、receipt 语义和版本矩阵，记录现有云端 UI 的回归基线。

### III-01：统一会话来源

盘点本地 Session、Conversation UI、Composer、工具卡片和 Bot 选择器的真实输入。定义统一来源接口，增加不改变本地行为的 LocalSessionAdapter，再把 CloudChat 的目录、binding、turns 和 replay 迁移到来源接口。

退出条件：本地回归通过，CloudChat 不再直接调用云端 API。

### III-02：云端读取、游标和订阅

把事件分页从 React effect 移入 Adapter，实现身份校验、游标恢复、分页上限、去重、缺口检测、取消和稳定错误分类。先使用可取消轮询，未来再切换 SSE 或 WebSocket。

退出条件：刷新、重复事件、分页边界、缺口、网络恢复和视图关闭都有确定性测试。

### III-03：消息和流式接入原生 UI

把规范事件转换为原生消息 ViewModel，复用 Markdown、代码块、复制、时间和滚动组件。把增量映射为 streaming 状态，最终消息只收敛一次，事件不完整时显示同步中或结果未知。

退出条件：本地和云端来源共享消息 UI 断言，独立云端时间线只作为回退。

### III-04：统一工具卡片

复用原生工具卡片的状态和视觉，但不把云端工具注册到本地工具表。参数编辑、重试和本地运行默认关闭；远程动作必须经过 capability、binding revision、用户操作和幂等键检查。

退出条件：卡片统一，安全测试证明云端卡片不能调用本地工具。

### III-05：发送、取消、恢复和未知结果

把 CloudChatTurns 迁移到 Adapter.send。每次发送只生成一个幂等键；响应丢失只查原回执，不重发。取消只请求停止并继续跟踪原 operation；unknown 阻止同一会话继续发送，直到核对或新建会话。

退出条件：重复点击、响应丢失、取消竞态、刷新恢复、服务端拒绝和 unknown 均有测试。

### III-06：BotAdapter

定义 BotSummary、BotBinding、BotSource 和 capability。云端 Bot 以只读摘要进入统一选择器，创建会话时固定 revision。区分 local、cloud 和 linked Bot；Bot 更新要求新会话或显式重绑，不改变历史。保留本地导出的预览、摘要、确认和冲突流程。

退出条件：Bot 列表、创建、绑定、刷新、归档、revision 冲突和导出都有契约与 UI 测试。

### III-07：安全与隔离审查

审计所有 Adapter 调用，证明云端模式不会进入本地 Agent、tools、jobs、HTTP 或文件写入路径。统一 Renderer 字段、脱敏、大小限制、URL 策略和稳定错误码。暂停/退出时执行 Adapter drain。

退出条件：本地准入、凭据边界、租户隔离、Workspace 隔离和旧 epoch 审查通过。

### III-08：缓存、刷新和多窗口

把缓存所有权移到 Adapter 生命周期，定义容量、截断、会话切换、退出清理和多窗口策略。刷新从服务端游标恢复，处理历史裁剪、游标过期和 revision 变化。缓存不保存 token、私有 Bot 定义或文件字节。

退出条件：刷新、重连、多窗口、缓存满、服务端裁剪和退出清理都有测试和文档。

### III-09：测试、验收和性能

增加身份、映射、游标、去重、终态、Bot revision 和过滤单测；成功、失败、断线、恢复、乱序、重复和过期的集成测试；本地/云端共享 UI 断言；Host 准入测试；浏览器和 Windows 安装版验收；长会话、大工具结果、丢包、重启、版本不兼容和权限撤销故障注入。

退出条件：阻断测试通过，性能在预算内，Web 和 Windows Desktop 都有独立证据。

### III-10：灰度、迁移和回滚

增加 cloudSessionAdapterV1 开关。灰度前默认使用旧云端时间线；按服务端 capability、Workspace、用户或会话启用。Adapter 失败只能回退到旧云端时间线，不能回到本地执行。回滚只关闭开关、清理适配器内存并保留服务端任务，不重放提示词。

退出条件：灰度无数据错配、重复提交或本地越权，回滚演练通过。

## 7. 验收矩阵

- 本地发送行为不变，并通过本地回归测试。
- 云端选择会话使用原生 UI，并显示 Workspace 和 Bot revision。
- 云端发送只调用 prompts，本地 Agent 不被触发。
- 流式文本使用原生 streaming，最终文本只出现一次。
- 工具卡片统一显示但默认不能运行本地工具。
- 工具结果丢失时保持 running 或 unknown 并继续补读。
- 取消跟踪原 operation，响应丢失查询原幂等键，不重发。
- Bot 刷新不改变会话绑定；revision 更新需要新会话或显式重绑。
- 页面刷新从服务端游标恢复事件。
- 退出完成 drain 和 revoke 后才恢复本地准入。
- 云端故障只暂停云端，不选择本地执行。
- Windows Desktop 与 Web 行为一致，并有独立验收证据。

## 8. 里程碑与交付物

M0 关闭当前计划；M1 完成来源抽象；M2 接入原生消息；M3 统一工具和操作生命周期；M4 完成 Bot 体验；M5 完成安全审查、灰度和回滚。

代码交付物包括 CloudSessionAdapter、身份/游标/事件/操作/Bot/工具模块、统一来源接口、本地适配器、原生 UI 接入、feature flag、capability 协商和回滚支持。

文档交付物包括适配协议、事件映射、Bot revision 规则、版本兼容矩阵、灰度回滚流程、故障排查说明和 README 开关状态。

## 9. 开发纪律和当前结论

C-01 至 C-10 未关闭前，不得把 III 实现混入当前云端交付。先写协议和测试，再改 UI；截图不能替代事件或安全测试。保留已有未提交改动；未经明确授权不改版本、不提交、不推送。每次修改运行针对性的 TypeScript、Vitest 和 git diff --check；UI 阶段必须有 Web 或 Desktop 证据。

先完成当前云端开发计划、测试、Web/Desktop 验收和文档收尾。完成 M0 后从 III-01 开始实现 CloudSessionAdapter。在计划 III 完成前，独立云端时间线仍是正式回退路径，不能描述为云端事件已经进入本地 Session 历史。
