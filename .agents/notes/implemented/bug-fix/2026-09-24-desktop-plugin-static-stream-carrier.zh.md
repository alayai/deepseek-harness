# Agent Note: 保持 Desktop HTTP 载体兼容 Node 流

Status: implemented

[English](2026-09-24-desktop-plugin-static-stream-carrier.md) | 中文

## 问题

Desktop 通过模拟的 `node:http` 响应分发命名 WebServer 路由。第三方插件通常使用 `createReadStream(file).pipe(res)` 提供 HTML 资源。此前载体缺少 Node `Readable.pipe()` 所需的 EventEmitter 方法和完成事件，因此文档路由可以返回 `200`，但 JavaScript 和 CSS 请求会以 `TypeError: dest.emit is not a function` 失败，插件页面最终空白。

## 决策

Desktop HTTP 载体提供 Node 流使用的最小 EventEmitter 生命周期：监听器参数、`emit()` 的布尔返回值、`prependListener()`、`once()`、`removeListener()`/`off()` 以及 `listenerCount()`。`res.end()` 完成时先发出 `finish` 再发出 `close`，让 `Readable.pipe()` 能清理监听器。载体继续使用现有 WHATWG 流响应体，不绑定 socket。

## 考虑过的替代方案

**在每个插件中缓存静态文件。** 这会在可选插件中重复传输逻辑，其他基于流的路由仍会暴露同样的故障。

**绕过 WebServer 提供插件资源。** 这会避开模拟响应，但也会让 Desktop 分发失去路由所有者的路径检查、响应头和生命周期处理。

**只增加 `emit()`。** 首次写入可以成功，但 `pipe()` 在移除 `finish`/`close` 监听器时仍会失败，或者在完成后留下旧监听器。

## 后果

Desktop 命名路由可以通过与监听 WebServer 相同的 handler 流式返回二进制和文本资源。载体只实现路由 handler 所需的流生命周期，并不是 `node:http.ServerResponse` 的通用替代品。

## 测试

WebServer 载体测试将 `Readable` pipe 到 `dsh-app://` 命名路由，并断言完整响应体。针对已安装 `deepseek-idesign` 包的真实路由进行的 smoke check 返回 JavaScript 资源，状态为 `200`、content type 正确且字节数完整。API 路由载体行为仍由[相关 Desktop API 路由记录](2026-09-24-desktop-plugin-api-routes.zh.md)覆盖。
