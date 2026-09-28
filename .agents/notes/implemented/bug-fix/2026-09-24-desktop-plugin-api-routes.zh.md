# Agent Note: 在 Desktop 载体中保留插件 API 路由

Status: implemented

[English](2026-09-24-desktop-plugin-api-routes.md) | 中文

## 问题

Desktop Host 通过分帧的 `dsh-app://` 载体转发渲染器请求，而不是监听 HTTP 服务。最初它把每个 `/api/*` 请求都直接交给核心 Connection handler，因此 `ctx.webServer` 上以 `/api/<plugin>` 注册的插件路由完全不会被尝试。第一次路由顺序修复又把 `/api/*` 先交给 WebServer，但这会命中同样注册在 WebServer 上、要求浏览器鉴权的核心 `/api` 前缀，Desktop RPC 全部得到 401，历史和工作区数据于是显示为空。

## 决策

Desktop 先直接调用核心 `/api` handler，绕过只面向浏览器的鉴权围栏。只有核心返回 404 时，才回退到 `webServer.fetchNamed()` 处理插件自有的 `/api/*` 路由。其他命名路由仍先使用 WebServer，再回退到静态资源；资源 bundle 路径和内部 remote stream 继续使用各自的专用 handler。HTTP 载体把 `dsh-app://` 命名路由请求表示为进程内回环请求：提供回环 Host 和 socket 地址，并移除跨管道没有意义的浏览器 Origin 标记。这样插件路由可用，同时核心 RPC 不会错误地经过浏览器鉴权。

## 考虑过的替代方案

**继续让 `/api/*` 只属于 Connection。** 这会保留原有分流捷径，但使 Desktop 中任何插件自有 API 路由都不可达，即使同一路由在监听 HTTP 的 Web 组合中可以正常工作。

**始终先分发到 WebServer。** 放弃该方案，因为核心 Connection 前缀本身也是 WebServer 路由并要求浏览器鉴权；内部 `dsh-app://` 请求必须绕过这道围栏。

**把 skill-explorer 路由移入核心 Connection 注册表。** 路由所有者是插件本身，其裸 HTTP handler 包含文件系统安全检查和二进制兼容响应；移动它会让核心 API 依赖一个可选插件，也无法修复其他 WebServer 插件。

**在 Desktop 中关闭插件的 loopback 保护。** 这会通过削弱网络保护来实现功能。载体改为提供本地 HTTP 请求具备的回环事实，远程请求仍然经过插件已有的访问围栏。

## 后果

Desktop 支持注册精确 `/api/*` 路由的可选插件，同时保留核心 RPC。核心 API 的所有非 404 响应都由核心处理；没有核心端点时才使用插件命名路由。自定义载体的回环元数据只用于 `dsh-app://` 命名路由分发，不会暴露网络监听端口。静态资源流兼容性另由 [Desktop Node 流载体记录](2026-09-24-desktop-plugin-static-stream-carrier.zh.md) 记录。

## 测试

WebServer 载体回归测试确认 `dsh-app://` 命名路由能看到回环 Host 和 socket 元数据。Desktop Host 路由回归测试确认核心 API 绕过 WebServer 鉴权，并且核心 404 会继续到插件 API 路由。
