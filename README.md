# SimpleShell

SimpleShell 是一个基于 Go 和 Wails 的 Windows SSH 客户端，前端使用 Vanilla TypeScript 与 xterm.js，后端使用 `golang.org/x/crypto/ssh` 处理 SSH 连接。

## 功能

- 支持密码登录和私钥登录
- 支持多个 SSH 连接配置
- 支持连接的新建、编辑和删除
- 支持终端输入、输出、清屏和窗口尺寸同步
- 支持透明背景和背景透明度调节
- 支持主机密钥确认与变更拦截
- 密码和私钥口令只保存在运行内存中，不写入本地配置

## 技术栈

- Go
- Wails
- WebView2
- TypeScript
- xterm.js

## 开发运行

确保已安装 Go、Node.js、npm 和 Wails CLI。

```powershell
wails dev
```

## 构建

```powershell
wails build -ldflags "-s -w"
```

构建后的 Windows 可执行文件位于：

```powershell
build\bin\SimpleShell.exe
```

## 测试

```powershell
go test ./...
```

前端构建验证：

```powershell
cd frontend
npm run build
```

## 配置说明

连接配置会保存在浏览器本地存储中，包含连接名称、主机、端口、用户名、认证方式和私钥路径。

不会保存：

- SSH 密码
- 私钥 passphrase

## 目标平台

当前主要面向 Windows x64。
