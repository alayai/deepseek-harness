# Agent Note: 将面向插件的 client-runtime specifier 播种为 store 身份

Status: implemented

[English](2026-08-31-seed-client-runtime-store-identity.md) | 中文

## 问题

已安装的 web profile 客户端 bundle 为拿到 `createSnapshotStore` 会 `require("@deepseek-ai/dsh-client-runtime/client")`。该 specifier 不是平台 seed word、不是启动图 row、也不是已登记的 factory：`packages/client/runtime` 已不存在，`createSnapshotStore` 在 `@deepseek-ai/dsh-client-store` 上，外壳已经用它自己的精确 key 播种了该包。Seed 匹配是精确的，包含末尾 `/client`，因此 store seed 不会应答 runtime specifier。随后 loader 在导入 `dsh-at-file` entry 时抛出 `missed the module table`，启动页停在 “Failed to load plugins”。对 runtime 包名的 `dsh.client.inject` 只是信息性声明，不能凭空造出缺失的图 row。

## 决定

`PLATFORM_MODULES` 与 `getStaticModules()` 将 `@deepseek-ai/dsh-client-runtime` 和 `@deepseek-ai/dsh-client-runtime/client` 播种为与 `@deepseek-ai/dsh-client-store` 相同的对象。它们是额外的精确静态表 key，不是通用 `dsh.client.provide` 别名协议，也不是被恢复的 runtime 包。对这两个 specifier 的同步 `require` 都会从该身份拿到 `createSnapshotStore`。仓库内客户端源码继续导入 `@deepseek-ai/dsh-client-store`。

这是在包导出上保留面向插件名字的模块表对应物（[settings 与 LLM 辅助函数](2026-08-31-plugin-facing-settings-and-llm-helpers.zh.md)）。[客户端外壳决策](2026-08-15-client-shells-and-dynamic-packages.zh.md) 仍然拒绝通用模块 provider 声明；这两个 key 是表中已有 store 身份的额外精确提供方。

## 曾考虑的替代方案

**不播种这些 specifier，并让每个插件按 `dsh-client-store` 重建。** 不予采用，因为失败的 bundle 位于本仓库之外。它们已安装的 `lib/client.js` 已经把 runtime specifier 标成 external，本树无法在同一次启动中改动那些产物。

**恢复 `packages/client/runtime` 作为再导出 store 的动态图 row。** 不予采用，因为图 row 会为一个不再作为归属方存在的包重新引入 Loader entry 和 client bundle。这些 bundle 需要的值已经是静态 seed；第二条到达路径会分裂身份或复制 store。

**查找 seed word 时去掉 `/client`。** 不予采用，因为 seed key 有意保持精确：`react-dom` 与 `react-dom/client` 是不同身份。后缀剥离仍然只是 graph-row 别名。

**让运维卸载 `dsh-at-file`。** 不予采用，因为已经挂载它的 profile 是受支持的组合；缺失的 seed word 不得拖垮整棵客户端插件树。

## 影响

为 `createSnapshotStore` 而 require runtime specifier 的客户端 bundle 可以加载。若某个 bundle 还需要该前包上的其他 runtime 专有值，仍会在调用点失败，而不是在模块表查找时失败。删除这两个额外 key 需要先更新那些已安装的 bundle。
