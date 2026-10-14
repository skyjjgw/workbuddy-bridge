/**
 * install-autostart — 让桥接随登录自动启动。
 *
 * 实现选择：**启动文件夹 + 隐藏窗口的 VBS 启动器**，而不是计划任务。
 *
 * 理由（实测）：`schtasks /Create` 在非管理员会话下直接 `Access is denied`，
 * 而本工具的正常用法不该要求用户提权。启动文件夹人人可写、登录即触发，
 * 配合 VBS 的 `WScript.Shell.Run(..., 0)` 可以完全无窗口启动 ——
 * 这正是「计划任务隐藏窗口」想要的效果，却不需要管理员。
 *
 * 崩溃自愈由桥接自身负责（见 src/server.mjs 的 unref 定时刷新与
 * 顶层异常兜底）；启动器只保证「登录后一定起来」。
 *
 * 卸载：`node scripts/install-autostart.mjs --uninstall`
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER_NAME = 'WorkBuddyBridge.vbs'
const uninstall = process.argv.includes('--uninstall')

/**
 * 配置目录固定在用户主目录，保证开机自启与手动运行读到同一份 token ——
 * 否则天枢里保存的 API Key 会在重启后突然失效。
 */
const bridgeHome = join(homedir(), '.workbuddy-bridge')

function startupDir() {
  if (process.platform !== 'win32') return null
  const appData = process.env['APPDATA']
  if (!appData) return null
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

const startup = startupDir()
if (startup === null) {
  console.error('本脚本目前只处理 Windows。macOS/Linux 请用 launchd/systemd 包装：')
  console.error(`  ${process.execPath} ${join(ROOT, 'src', 'server.mjs')}`)
  process.exit(1)
}

const launcherPath = join(startup, LAUNCHER_NAME)

if (uninstall) {
  if (existsSync(launcherPath)) {
    rmSync(launcherPath, { force: true })
    console.log(`已移除自启项：${launcherPath}`)
  } else {
    console.log('自启项不存在，无需移除。')
  }
  process.exit(0)
}

const serverJs = join(ROOT, 'src', 'server.mjs')
if (!existsSync(serverJs)) {
  console.error(`缺少入口文件：${serverJs}`)
  process.exit(1)
}

mkdirSync(bridgeHome, { recursive: true })
mkdirSync(startup, { recursive: true })

/**
 * 包装 cmd：设好 WORKBUDDY_BRIDGE_HOME 并把输出追加到日志。
 *
 * `chcp 65001` 是必要的：cmd 默认用系统 ANSI 代码页（简中为 GBK）写文件，
 * 而桥接的日志是 UTF-8 中文，不切代码页会让日志变成乱码。
 * 同时设 PYTHONIOENCODING 式的 NODE 侧无需处理 —— Node 写 stderr 本就是 UTF-8。
 */
const launcherCmd = join(bridgeHome, 'start-bridge.cmd')
writeFileSync(launcherCmd, [
  '@echo off',
  'chcp 65001 > nul',
  `set "WORKBUDDY_BRIDGE_HOME=${bridgeHome}"`,
  `"${process.execPath}" "${serverJs}" >> "${join(bridgeHome, 'bridge.log')}" 2>&1`,
  '',
].join('\r\n'), 'utf8')

/**
 * VBS 启动器：`Run(cmd, 0, False)` 的第二个参数 0 = 隐藏窗口。
 * 用 8.3 短路径无关紧要，但引号必须转义成 "" —— 这是 VBS 字符串的规则。
 */
const vbs = [
  "' WorkBuddy ↔ 天枢 桥接 —— 登录时无窗口自启。由 install-autostart.mjs 生成。",
  'Set shell = CreateObject("WScript.Shell")',
  `shell.Run """${launcherCmd}""", 0, False`,
  '',
].join('\r\n')

writeFileSync(launcherPath, vbs, 'utf8')

console.log('')
console.log('已安装登录自启（无需管理员权限）')
console.log(`  自启项：${launcherPath}`)
console.log(`  启动脚本：${launcherCmd}`)
console.log(`  日志：${join(bridgeHome, 'bridge.log')}`)
console.log('')
console.log(`立即启动一次：  "${launcherCmd}"`)
console.log('卸载自启：      node scripts/install-autostart.mjs --uninstall')
