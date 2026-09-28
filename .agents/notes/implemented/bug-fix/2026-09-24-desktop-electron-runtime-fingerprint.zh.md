# Agent Note: 固定 Desktop Electron 原生运行时指纹

Status: implemented

[English](2026-09-24-desktop-electron-runtime-fingerprint.md) | 中文

## 问题

Desktop Host 会加载 `node-addon-require-builtin`，其原生二进制只接受固定的 Electron Node 与 V8 运行时指纹。`apps/desktop` 之前把 Electron 声明为 `^44.0.0`，因此刷新 lockfile 时可能选择 Electron `44.4.x`。该版本使用了原生扩展无法识别的更新版 Node/V8 指纹，Host 会在加载 profile 前因 `unsupported runtime fingerprint` 停止启动。

## 决策

Desktop 将 Electron 声明为精确版本 `44.0.0`，lockfile 也记录相同的精确 specifier。因此，Windows x64 打包产物使用的是 `node-addon-require-builtin@0.1.6` 已支持的 Electron 运行时指纹，不再允许看似兼容的小版本改变内置 Node/V8 组合。

本次修复不升级原生扩展，也不放宽其指纹检查。扩展接受的指纹属于原生二进制兼容性约定；改变任一侧都需要单独验证原生构建和平台矩阵，而固定 Electron 精确版本是恢复现有受支持运行时的最小改动。

## 曾考虑的替代方案

**保留 caret 范围并依赖 lockfile。** 不予采纳：依赖更新可以重写 lockfile 并选择更新的 Electron 小版本，从而再次引入启动失败。

**升级 `node-addon-require-builtin` 或重新构建其原生二进制。** 不予采纳：这会改变 Desktop 各平台的原生兼容性，需要新增运行时指纹和发布验证。

**放宽原生运行时指纹检查。** 不予采纳：扩展通过该检查阻止未经验证的二进制加载到不同的 Electron/Node/V8 ABI 组合中。

## 后果

在原生扩展明确支持其他运行时指纹前，Desktop 保持使用 Electron `44.0.0`。Web 启动器和项目包管理器约定不变；Web 项目继续使用 `pnpm dsh web` 启动。今后升级 Electron 时，必须同时更新原生兼容性证据和本精确版本决策。

## 测试

Windows x64 NSIS 构建日志记录 `electronVersion=44.0.0`。未封装的打包可执行文件报告 Electron `44.0.0`、Node `24.18.1` 和 V8 `15.2.124.13-electron.0`，生成的安装包名称为 `coco-lite-v0.1.7-win-x64.exe`。`git diff --check` 已通过。
