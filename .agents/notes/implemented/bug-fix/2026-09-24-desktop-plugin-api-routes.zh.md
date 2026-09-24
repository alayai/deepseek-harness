# Agent Note: 在 Desktop 载体中保留插件 API 路由

Status: implemented

[English](2026-09-24-desktop-plugin-api-routes.md) | 中文

## 问题

Desktop Host 通过分帧的 `dsh-app://` 载体转发渲染器请求，而不是监听 HTTP 服务。它把每个 `/api/*` 请求都直接交给核心 Connection handler，因此 `ctx.webServer` 上以 `/api/<plugin>` 注册的插件路由完全不会被尝试。Client 半边可以渲染面板，但第一次数据请求会得到 HTTP 404。

## 决策

Desktop 先让每个请求经过 `webServer.fetchNamed()`，未命中后再回退到核心 `/api` handler。资源 bundle 路径和内部 remote stream 继续使用各自的专用 handler。HTTP 载体把 `dsh-app://` 命名路由请求表示为进程内回环请求：提供回环 Host 和 socket 地址，并移除跨管道没有意义的浏览器 Origin 标记。这样带有 loopback 保护的插件路由可以接受 Desktop 请求，同时不削弱网络访问规则。

## 考虑过的替代方案

**继续让 `/api/*` 只属于 Connection。** 这会保留原有分流捷径，但使 Desktop 中任何插件自有 API 路由都不可达，即使同一路由在监听 HTTP 的 Web 组合中可以正常工作。

**把 skill-explorer 路由移入核心 Connection 注册表。** 路由所有者是插件本身，其裸 HTTP handler 包含文件系统安全检查和二进制兼容响应；移动它会让核心 API 依赖一个可选插件，也无法修复其他 WebServer 插件。

**在 Desktop 中关闭插件的 loopback 保护。** 这会通过削弱网络保护来实现功能。载体改为提供本地 HTTP 请求具备的回环事实，远程请求仍然经过插件已有的访问围栏。

## 后果

Desktop 支持注册精确 `/api/*` 路由的可选插件；没有命名路由的路径仍由核心 API 处理。自定义载体的回环元数据只用于 `dsh-app://` 命名路由分发，不会暴露网络监听端口。静态资源流兼容性另由 [Desktop Node 流载体记录](2026-09-24-desktop-plugin-static-stream-carrier.zh.md) 记录。

## 测试

WebServer 载体回归测试确认 `dsh-app://` 命名路由能看到回环 Host 和 socket 元数据。Desktop Host 分发器现在会在调用核心 API 回退前，对插件 API 路径执行相同的命名路由优先顺序。
