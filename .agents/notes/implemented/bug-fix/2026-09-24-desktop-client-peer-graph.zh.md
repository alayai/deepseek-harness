# Agent Note: 分离 Desktop Host 与浏览器 Client 的 peer 依赖图

Status: implemented

[English](2026-09-24-desktop-client-peer-graph.md) | 中文

## 问题

Desktop profile 会在内置 Node Host 进程中验证已启用的插件包。一个双面插件也可以通过 `dsh.client` 发布浏览器 bundle；它的 peer 包由 Web 模块表或另一个浏览器 bundle 提供，而不是由 Desktop Node profile 提供。如果把每一项 `peerDependencies` 都当作 Node 包必需依赖，就会对合法插件报 `requires missing`，即使它的 Host 入口没有导入该包，而浏览器入口会从 Client 依赖图获得它。

测试中很容易通过把浏览器专用包加入运行时描述文件的 `sharedPackages` 来掩盖这个问题。这样的 fixture 改变了包归属模型，没有复现打包后的 Desktop runtime；在真实的 `resources/dsh/node_modules` 中，浏览器包可能不存在。反过来恢复“忽略所有缺失 peer”又会掩盖真正缺失的 Host peer，并把失败推迟到 Host 激活阶段。

## 决策

Desktop 分开处理两类依赖问题。`validateDesktopPluginGraph()` 证明 Node Host 所需的依赖，并继续检查共享包版本、本地包归属、重复宿主副本以及缺失的必需 Host peer。它首先读取包的 `dsh.client` 声明。对于声明 `platform: web` 的包，来自 Web 壳静态模块表，或列在声明的 `inject` 与 `external` 中的 peer，会被记录为浏览器 peer。缺失的 peer 只有在它是可选 peer，或确实属于这些浏览器 peer 时才会忽略。如果该 peer 出现在 Desktop 共享清单中，仍然要按声明范围检查版本。

浏览器 peer 列表跟随 Web 壳的模块身份，而不是匹配任意名为“client”的包名模式。浏览器声明不会豁免无关的必需 Host peer；没有 Web 声明的包不会获得浏览器 peer 例外。包管理器字段仍然只是依赖元数据，不能证明双面包的哪一面拥有运行时导入。

[Desktop 运行时决策](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md)继续负责资源包和共享链接。[Client 壳决策](../architecture/2026-08-15-client-shells-and-dynamic-packages.zh.md)继续负责浏览器模块 external 声明和模块表组装。本记录负责把这两个事实连接到同一条校验规则中，同时不合并两张依赖图。

## 考虑过的替代方案

**忽略所有缺失 peer。** 这会让报告中的插件通过，但也会移除缺失必需 Host API 时唯一的提前拒绝点。Host 会在更晚、距离包操作更远的位置失败，因此这不是可接受的兼容性规则。

**把浏览器专用包加入 `desktop-runtime.json`。** 这会让测试 fixture 与打包清单看起来一致，但会把浏览器依赖安装到仅供 Node 使用的资源树，并让 Desktop 发布包拥有 Web 壳已经提供的包。对于本仓库没有发布的浏览器包，这种方式同样无法工作。

**只根据 `dependencies`、`peerDependencies` 或包名分类 peer。** 这些字段描述 npm 关系，而不是产物实际导入的构建面。包名模式也无法区分浏览器请求和 Host 请求。明确的 `dsh.client.platform`、`inject`、`external` 以及静态模块表声明才提供了所需的归属证据。

## 后果

Desktop 插件事务可以启用 Node profile 中有意缺少浏览器 peer 的双面插件，同时仍会在激活前拒绝缺失或版本不兼容的 Host peer。Web 静态模块表或 `dsh.client` 声明发生变化时，Desktop 的浏览器 peer 分类必须继续与 Client loader 的实际模块身份保持一致。这个例外范围是刻意收窄的：它只适用于带有有效 Web 声明的已启用包，并且不会绕过 Desktop 实际提供包的版本检查。

## 测试

Desktop profile 测试使用不包含 `@deepseek-ai/dsh-client-runtime` 或 React 的运行时 fixture。测试覆盖：缺少浏览器 peer 的双面插件可以通过；同一插件未声明的必需 Host peer 仍然被拒绝；没有 Web 声明的插件缺少 peer 时仍然被拒绝；共享包版本不兼容时仍然被拒绝。完整的 Desktop 定向回归集覆盖 profile 校验、项目事务、真实 pnpm 安装和启动流程；另外还检查 Windows unpacked 打包产物，确认编译后的 Electron bundle 包含同一条校验规则。
