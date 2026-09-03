---
description: "dsh web 客户端的交互式 WebGL CAD 预览浮层；打开齿轮齿条执行器模型且不改变会话状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cad-preview

[English](README.md) | 中文

## 概述

`dsh-client-ui-cad-preview` 向 Web shell overlay 贡献一个悬浮入口。点击后会打开 Three.js 模态视口，程序化渲染一个基于图片意图的齿轮齿条执行器：带齿齿条、动画驱动齿轮、螺栓圈、圆柱减速器堆叠、后端方形电机座和前端法兰细节。该包只是浏览器端预览面，不保存数据、不调用 Host API，也不生成可制造 CAD 工件。

## 目录

- [使用此包](#使用此包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制和暂缓工作](#已知限制和暂缓工作)
- [开发说明](#开发说明)

-----

<a id="使用此包"></a>
## 使用此包

把该包组合进 Web app bundle。客户端半侧会等待 `ui-layout` 声明 `shell.overlay` 后注册 `cad-preview` list entry。用户会在 Web 客户端右下角看到 **3D 预览** 悬浮按钮；点击后打开模态视口。鼠标拖动或触控拖动通过 `OrbitControls` 环绕模型，滚轮缩放，Escape 关闭模态框。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

node 半侧为空，仅用于让 Loader 承载该包的 composition row。browser 半侧位于 [`src/client/index.ts`](src/client/index.ts)，通过 `ctx.slots.inject()` 注册到 `shell.overlay`，让声明生命周期和 HMR 生命周期保持配对。[`src/client/CadPreviewOverlay.tsx`](src/client/CadPreviewOverlay.tsx) 只在模态框挂载期间创建 Three.js 场景，关闭时释放 controls、geometry 和 material；所有模型事实都保持在组件本地。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [ui-layout](../ui-layout/README.zh.md) — 声明并渲染 `shell.overlay` 槽位。
- [Web client architecture](../../../docs/subsystems/web-client.zh.md) — 解释浏览器插件加载和 client bundle。
- [Slots reference](../../../docs/subsystems/slots.zh.md) — 描述可叠加 list slot 和注册生命周期。

-----

<a id="模型体验"></a>
## 模型体验

无。该包只贡献浏览器表现层，不进入模型请求。

#### KV Cache effect

无；该包既不组装也不发送 provider request。

## 已知限制和暂缓工作

<a id="已知限制和暂缓工作"></a>

这些限制定义在线视觉预览和已验证 CAD 输出之间的边界。

- **仅预览几何** — 模型是程序化 Three.js mesh geometry，不是经过验证的 STEP/STP 可制造工件。
- **单一内置设计** — 当前包只预览一个齿轮齿条执行器解释，而不是加载任意用户 CAD 文件。
- **没有图像标定** — 尺寸和比例来自提示上下文的尽量还原，不是从标定工程图中测得。

<a id="开发说明"></a>
### 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
