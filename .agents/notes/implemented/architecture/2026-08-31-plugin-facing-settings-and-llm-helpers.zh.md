# Agent Note: 在包导出上保留面向插件的 settings 与 LLM 辅助函数

Status: implemented

[English](2026-08-31-plugin-facing-settings-and-llm-helpers.md) | 中文

## 问题

仓库外插件从 `@deepseek-ai/dsh-settings` 导入 `settingsNamespace` 与 `installSettingsSection`，并从 `@deepseek-ai/dsh-llm` 导入 `assertNever`。这些名字不在包的公开导出中：仓库内调用方使用字符串字面量、`ctx.settings.installSection` 与 `@deepseek-ai/dsh-util-values`。ESM 具名导入求值因此在 profile 启动时失败。缺失的导出是 `SyntaxError`，loader 会拒绝整棵插件树。已安装的 web profile 插件（`dsh-at-file`、`@alayai/dsh-elite-lowcode`、`@alayai/dsh-model-hub-pro`）目前因此失败。

## 决定

`@deepseek-ai/dsh-settings` 导出 `settingsNamespace`（小写连字符 namespace 的名义构造函数）和 `installSettingsSection`（可选 settings 的 inject 辅助函数，委托给 `SettingsProvider.installSection`）。`@deepseek-ai/dsh-llm` 从 `@deepseek-ai/dsh-util-values` 再导出 `assertNever`，因此对本包封闭联合类型做 switch 时可从与 `HarnessError` 相同的模块导入该辅助函数。

这些是当前的公开插件 API，不是兼容别名。仓库内调用方可以继续使用字符串字面量、方法形式与 util-values 导入；两种写法都有效。

## 曾考虑的替代方案

**不导出这些名字，并更新每个插件。** 不予采用，因为失败的插件位于本仓库之外。它们已安装的构建导入这些名字，本树无法在同一次启动中改动那些包。

**只保留仓库内调用点，并让运维卸载这些插件。** 不予采用，因为已经挂载它们的 profile 是受支持的组合；缺失的具名导出不得拖垮整棵插件树。

**只从 `dsh-util-values` 导出 `assertNever`。** 不作为唯一路径采用，因为当前插件把它与 `HarnessError` 一起从 `dsh-llm` 导入。util 包仍是实现所在处；LLM 包再导出同一函数。

## 影响

注册 settings namespace、接线可选 settings 分节、或穷举封闭 LLM 联合类型的插件可以继续导入这些名字。删除其中任何一个都需要先更新那些插件，切换条件与[可忽略会话事件决策](2026-08-30-retain-ignorable-external-session-events.zh.md)对信封字段的记录相同。
