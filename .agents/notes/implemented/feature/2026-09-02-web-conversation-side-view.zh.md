# Agent Note: Conversation View side pane

Status: implemented

[English](2026-09-02-web-conversation-side-view.md) | 中文

## Problem

`conversation.view` 标签是互斥的：shell 一次只渲染一个 View，其余卸载。像 Elite-Lowcode 这样的插件 View 因此会替换对话，用户无法在看着该 View 更新的同时发送消息。details 栏不能承载它：该栏由工具检查占用，宽度上限是 520px。

## Decision

**Conversation shell 把主 View 留在现有滚动视口中，并可以把第二个已注册 View 钉到同一对话栏的右侧。**

- Conversation store 在现有 `view` 偏好旁持久化 `sideView`（钉住的 entry id，或 null）和 `sideRatio`（主栏比例，限制在 0.25–0.75）。
- 每个不是唯一已注册 View 的标签都有侧边打开控件。打开已经是主 View 的 View 时，主栏回退到 Chat，使两栏不同。点击已经钉住的标签是空操作，避免用户误把侧边 View 全屏。关闭侧边栏后恢复单个主 View。
- 侧边 View 通过 portal 进入 Root 拥有的挂载点（`data-conversation-side`），它是滚动视口的 grid 兄弟。Chat 滚动、粘性 composer 和 composer overlay 留在左栏；侧边栏全高，包括与 composer 并排。侧边栏打开时隐藏 transcript 宽度手柄。
- 指向已钉住 View 的 `openView` 只写入一次性 focus 请求，不改主 View，因此钉住 Trajectory 时 Inspect 类交接不会拆掉对话分栏。

## Alternatives considered

**把第二个 View 画进 details 栏并提高 `DETAILS_MAX`。** 不予采用：details 是工具检查占用的单槽，把应用 iframe 和调用详情混进同一宽度预算会压垮两份工作。

**第四条 AppFrame 栏。** 不予采用：需要的是第二个 Conversation View，不是新的 shell 区域；AppFrame 的让步链和 details 生命周期保持不变。

**两个 View 都保持挂载但隐藏（`display: none`），而不是可见分栏。** 那会在切换标签时保留 iframe 状态，但不能让用户同时看到对话和插件 View，而这正是所要求的布局。

## Consequences

有两个或更多 Conversation View 的用户可以把对话（或轨迹）留在左侧、插件 View 留在右侧，并在同一 Session 重新加载后恢复。关闭侧边栏仍会卸载该 View。details 栏仍按现有宽度用于工具检查。
