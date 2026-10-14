/**
 * pack — 打成可以直接发给别人的发布包。
 *
 * 产物是一个 zip，解开后只有几样东西：
 *   start.cmd            双击即装即用（找 Node → 装自启 → 拉起 → 注册进天枢）
 *   Uninstall.cmd        一键卸载
 *   app/                 桥接本体（自包含，仅依赖 node:* 内置模块）
 *   README.txt           给最终用户的说明
 *
 * 为什么不需要用户先装 Node：天枢自带 `node-runtime\win-x64\tianshu-runtime.exe`
 * （Node 24.18.0）。启动脚本按「天枢自带运行时 → 系统 Node」的顺序找，
 * 两者都没有才提示安装。实测天枢自带运行时能直接跑这个桥接。
 *
 * 用法：node scripts/pack.mjs [--out <目录>]
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = (() => {
  const i = process.argv.indexOf('--out')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join(ROOT, 'dist')
})()

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const stage = join(outDir, `workbuddy-bridge-${version}`)

/** 用户拿到解压包后双击的那个入口。 */
const START_CMD = `@echo off
chcp 65001 > nul
title WorkBuddy 桥接 —— 安装
setlocal
set "HERE=%~dp0"
set "APP=%HERE%app"
set "BRIDGE_HOME=%USERPROFILE%\\.workbuddy-bridge"
set "WORKBUDDY_BRIDGE_HOME=%BRIDGE_HOME%"

echo.
echo   ============================================
echo    WorkBuddy 桥接  ——  让天枢用上 WorkBuddy
echo   ============================================
echo.

rem --- 找一个可用的 Node ---
rem 顺序：用户指定 → 天枢自带运行时（多数人走这条）→ 系统 Node
set "NODE_EXE="
if defined WORKBUDDY_BRIDGE_NODE if exist "%WORKBUDDY_BRIDGE_NODE%" set "NODE_EXE=%WORKBUDDY_BRIDGE_NODE%"
if not defined NODE_EXE if defined TIANSHU_HOME call :try "%TIANSHU_HOME%\\node-runtime\\win-x64\\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%LOCALAPPDATA%\\Programs\\Tianshu\\node-runtime\\win-x64\\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%LOCALAPPDATA%\\Tianshu\\node-runtime\\win-x64\\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%ProgramFiles%\\Tianshu\\node-runtime\\win-x64\\tianshu-runtime.exe"
for %%I in (node.exe) do if not defined NODE_EXE set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE (
  echo   [x] 找不到 Node 运行时。
  echo       本工具通常随天枢一起就能用。若确实没有，
  echo       请先安装天枢，或到 https://nodejs.org 装 LTS 版。
  echo.
  pause
  exit /b 1
)
echo   [1/4] 找到运行时：%NODE_EXE%

rem --- 先跑一次桥接本身，确认能起来（拿凭据、拉模型）---
echo   [2/4] 检查 WorkBuddy 登录状态…
"%NODE_EXE%" "%APP%\\scripts\\doctor.mjs"
if errorlevel 1 (
  echo.
  echo   [!] 自检没有全部通过。多数情况是还没登录 WorkBuddy 桌面端。
  echo       请先打开 WorkBuddy 并登录，然后重新双击本文件。
  echo.
  pause
)

rem --- 装自启 ---
echo   [3/4] 安装开机自启…
"%NODE_EXE%" "%APP%\\scripts\\install-autostart.mjs"

rem --- 后台拉起 ---
echo   [4/4] 启动桥接…
start "" /min "%APP%\\scripts\\run-bridge.cmd"
timeout /t 12 /nobreak > nul

rem --- 注册进天枢 ---
echo.
echo   注册到天枢…
"%NODE_EXE%" "%APP%\\scripts\\setup.mjs"

echo.
echo   ============================================
echo    完成。打开天枢：设置 → 模型提供商
echo    选 workbuddy / workbuddy-global 即可。
echo   ============================================
echo.
pause
exit /b 0

:try
if not defined NODE_EXE if exist %1 set "NODE_EXE=%~1"
exit /b 0
`

/** 卸载入口。 */
const UNINSTALL_CMD = `@echo off
chcp 65001 > nul
title WorkBuddy 桥接 —— 卸载
setlocal
set "APP=%~dp0app"
set "BRIDGE_HOME=%USERPROFILE%\\.workbuddy-bridge"
set "WORKBUDDY_BRIDGE_HOME=%BRIDGE_HOME%"

echo.
echo   正在卸载 WorkBuddy 桥接…
echo.

set "NODE_EXE="
for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\\Programs\\Tianshu\\node-runtime\\win-x64\\tianshu-runtime.exe" set "NODE_EXE=%LOCALAPPDATA%\\Programs\\Tianshu\\node-runtime\\win-x64\\tianshu-runtime.exe"

rem 1) 移除自启
if exist "%APP%\\scripts\\install-autostart.mjs" if defined NODE_EXE "%NODE_EXE%" "%APP%\\scripts\\install-autostart.mjs" --uninstall

rem 2) 停掉正在跑的桥接（按端口找进程）
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"127.0.0.1:879[12].*LISTENING"') do (
  echo   停止进程 %%P
  taskkill /PID %%P /F > nul 2>&1
)

rem 3) 删配置（含 token）
if exist "%BRIDGE_HOME%" (
  echo   删除配置目录 %BRIDGE_HOME%
  rmdir /s /q "%BRIDGE_HOME%"
)

echo.
echo   已卸载。
echo.
echo   注意：天枢里那两个服务商（workbuddy / workbuddy-global）
echo   需要你手动删除：设置 → 模型提供商 → 选中 → 删除。
echo.
pause
exit /b 0
`

/** 给最终用户看的说明。 */
const README_TEXT = `WorkBuddy 桥接（workbuddy-bridge v${version}）
============================================

这个工具把你的 WorkBuddy（腾讯 CodeBuddy / WorkBuddy AI）桌面端
已经登录的模型，接进天枢的「自定义服务商」，不需要另外买 API Key。

它用的是你自己 WorkBuddy 账号的额度。

前提条件
--------
1. 已安装天枢桌面端
2. 已安装 WorkBuddy 桌面端，并且**已登录**

怎么用
------
双击 start.cmd，按提示走完即可。之后：

  天枢 → 设置 → 模型提供商 → 选 workbuddy 或 workbuddy-global

会看到两种：
  workbuddy         国内版（copilot.tencent.com）
  workbuddy-global  国际版（workbuddy.ai）

两个都接，互不干扰。模型清单不同。

卸载
----
双击 Uninstall.cmd。
注意：天枢里那两个服务商要手动删（设置 → 模型提供商 → 选中 → 删除）。

常见问题
--------
Q: 双击后闪一下就没了 / 提示找不到 Node
A: 正常装了天枢就自带 Node 运行时，不用另装。
   如果确实没有，去 https://nodejs.org 装 LTS 版再试。

Q: 提示没找到 WorkBuddy 登录凭据
A: 打开 WorkBuddy 桌面端登录一次，然后重新双击 start.cmd。
   本工具不存你的密码，只读取桌面端已经登录好的凭据。

Q: 天枢里看不到 workbuddy
A: 先确认桥接在跑（重启电脑后等半分钟）。
   再手动跑一次 setup：
     app\\scripts 下用 Node 执行 setup.mjs

Q: 模型列表是旧的
A: 桥接每 30 分钟自动刷新一次。想立刻刷新就重启桥接。

安全说明
--------
- 桥接只监听 127.0.0.1（本机回环），外网访问不到。
- 必须有 API Key 才能用，Key 在首次运行时随机生成，
  存在 %USERPROFILE%\\.workbuddy-bridge\\config.json
- 只读取 WorkBuddy 桌面端的登录凭据，不修改它。
`

// 1) 确保产物存在且最新
console.log('构建核心…')
execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' })

rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'app'), { recursive: true })

// 2) 拷贝运行时需要的文件。刻意不带 vendor/（那是构建输入，不是运行时依赖）
//    也不带 data/（那是本机跑出来的状态，绝不能发给别人）。
cpSync(join(ROOT, 'lib'), join(stage, 'app', 'lib'), { recursive: true })
cpSync(join(ROOT, 'src'), join(stage, 'app', 'src'), { recursive: true })
cpSync(join(ROOT, 'scripts', 'setup.mjs'), join(stage, 'app', 'scripts', 'setup.mjs'))
cpSync(join(ROOT, 'scripts', 'doctor.mjs'), join(stage, 'app', 'scripts', 'doctor.mjs'))
cpSync(join(ROOT, 'scripts', 'install-autostart.mjs'), join(stage, 'app', 'scripts', 'install-autostart.mjs'))
cpSync(join(ROOT, 'scripts', 'run-bridge.cmd'), join(stage, 'app', 'scripts', 'run-bridge.cmd'))
cpSync(join(ROOT, 'package.json'), join(stage, 'app', 'package.json'))

// 3) 一键入口
writeFileSync(join(stage, 'start.cmd'), START_CMD, 'utf8')
writeFileSync(join(stage, 'Uninstall.cmd'), UNINSTALL_CMD, 'utf8')
writeFileSync(join(stage, 'README.txt'), README_TEXT, 'utf8')

// 4) 打 zip
const zip = join(outDir, `workbuddy-bridge-${version}.zip`)
rmSync(zip, { force: true })
console.log('打包 zip…')
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`,
], { stdio: 'inherit' })

console.log('')
console.log(`发布包：${zip}`)
console.log(`大小：${(readFileSync(zip).length / 1024).toFixed(0)} KB`)
console.log('')
console.log('发给别人后，对方：解压 → 双击 start.cmd 即可。')
