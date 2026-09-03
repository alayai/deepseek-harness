# Agent Note: 将已挂载插件的 SessionEventMap 键视为已知

Status: implemented

[English](2026-08-31-mounted-plugin-session-event-types.md) | 中文

## 问题

插件通过 declaration merge 扩展 `SessionEventMap`，并追加这些事件且不带 `ignorable: true`，因为重建插件自有 UI 需要它们。持久化读取路径只查阅仓库生成的 `KNOWN_SESSION_EVENT_TYPES`，因此即使 `@alayai/dsh-elite-lowcode` 已挂载，包含 `lowcode/surface-open`（以及该插件其余映射）的已存会话仍被拒绝，并被当作更新版 harness 写入的日志。

[保留 ignorable](2026-08-30-retain-ignorable-external-session-events.zh.md) 把 `ignorable` 留作省略安全性标记，并拒绝用事件名注册来*替代*该标记。它没有为 declaration merge 提供运行时对应物，因此磁盘上已有的插件必需事件无法重新加载。

## 决定

`validateStoredEvents` 在类型属于 `KNOWN_SESSION_EVENT_TYPES`、或从当前已挂载的仓库外插件所发布 `.d.ts` 中的 `SessionEventMap` 成员收获到时，将该类型视为已知。收获从 `SessionPersistence` 构造函数在后端的 Loader 上运行：一次激活扫描，加上之后每个 `internal/plugin` fiber，并通过 `ctx.baseUrl` 解析。第一方 `@deepseek-ai/` 包会被跳过。插件卸载会递减进程内额外类型的引用计数。未知类型仍然拒绝，除非已存信封带有 `ignorable: true`。

这是 TypeScript declaration merging 的运行时对应物。它不判定省略某事件是否安全，也不替代 `ignorable`。

## 曾考虑的替代方案

**在插件中把每个 `lowcode/*` 事件标为 `ignorable` 并重写已存日志。** 不予采用，因为 Elite-Lowcode 标签页需要这些事件，已安装插件不设置该标记，现有 jsonl 行也没有 `ignorable` 字段。

**把 `lowcode/*` 写进生成的已知集合。** 不予采用，因为该集合是本仓库的 `SessionEventMap` 目录；仓库外名称不属于那里。

**把每个未知事件都视为可忽略。** [保留 ignorable](2026-08-30-retain-ignorable-external-session-events.zh.md) 已拒绝：读取器无法推断未识别的持久事件是否属于信息性事件。

**要求每个插件调用新的注册 API。** 不予采用，因为已安装构建（如 `@alayai/dsh-elite-lowcode@0.1.0`）不会调用它，而从已发布 `SessionEventMap` 收获已经能得到相同的键。

## 影响

包含仓库外必需事件的会话在声明插件挂载于该进程时可以重新加载。插件不在场时，同一份日志仍然会被拒绝。对于写入方未挂载、且类型不在生成集合中的信息性事件，仍需要 `ignorable`。
