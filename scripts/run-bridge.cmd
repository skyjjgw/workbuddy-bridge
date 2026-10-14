@echo off
rem 桥接启动器 —— 由 start.cmd / 自启项调用。
rem 依次尝试：环境变量指定 → 天枢自带 Node → 系统 Node。
setlocal

set "APP=%~dp0.."
set "WORKBUDDY_BRIDGE_HOME=%USERPROFILE%\.workbuddy-bridge"
if not exist "%WORKBUDDY_BRIDGE_HOME%" mkdir "%WORKBUDDY_BRIDGE_HOME%"

set "NODE_EXE="

rem 1) 用户显式指定
if defined WORKBUDDY_BRIDGE_NODE if exist "%WORKBUDDY_BRIDGE_NODE%" set "NODE_EXE=%WORKBUDDY_BRIDGE_NODE%"

rem 2) 天枢自带运行时（多数用户走这条，无需另装 Node）
rem    不写死任何机器的绝对路径：便携版靠 TIANSHU_HOME，常规安装靠 LOCALAPPDATA。
if not defined NODE_EXE if defined TIANSHU_HOME call :try "%TIANSHU_HOME%\node-runtime\win-x64\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%LOCALAPPDATA%\Programs\Tianshu\node-runtime\win-x64\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%LOCALAPPDATA%\Tianshu\node-runtime\win-x64\tianshu-runtime.exe"
if not defined NODE_EXE call :try "%ProgramFiles%\Tianshu\node-runtime\win-x64\tianshu-runtime.exe"

rem 3) 系统 Node
for %%I in (node.exe) do if not defined NODE_EXE set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE (
  echo.
  echo   [x] 找不到可用的 Node 运行时。
  echo.
  echo   本工具需要 Node ^>= 22。通常装了天枢就自带，无需另装。
  echo   若确实没有，请到 https://nodejs.org 装 LTS 版后重试。
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%APP%\src\server.mjs"
exit /b %ERRORLEVEL%

:try
if not defined NODE_EXE if exist %1 set "NODE_EXE=%~1"
exit /b 0
