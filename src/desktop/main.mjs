import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bridgeRegistrationConfig,
  dashboardSnapshot,
  pollOAuthLogin,
  refreshDashboard,
  runModelSmokeTest,
  startOAuthLogin,
  stopBridge,
  testBridgeEndpoints,
} from '../server.mjs'
import { registerProviders, testTianshu } from './tianshu.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const hiddenStart = process.argv.includes('--hidden')
let mainWindow
let tray
let quitting = false

function safeHandler(name, handler) {
  ipcMain.handle(name, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function loginItemPath() {
  return process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 660,
    show: false,
    backgroundColor: '#07101f',
    title: 'WorkBuddy Bridge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadFile(join(HERE, 'renderer', 'index.html'))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.once('ready-to-show', () => {
    if (!hiddenStart) mainWindow.show()
  })
}

function createTray() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#6c7cff"/><path d="M8 9h4l3 12 3-9 3 9 3-12h4l-5 15h-4l-3-8-3 8h-4z" fill="white"/></svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 })
  tray = new Tray(icon)
  tray.setToolTip('WorkBuddy Bridge')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制台', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

safeHandler('bridge:snapshot', dashboardSnapshot)
safeHandler('bridge:refresh', refreshDashboard)
safeHandler('oauth:start', async region => {
  const result = await startOAuthLogin(region)
  if ('verificationUri' in result && /^https?:\/\//i.test(result.verificationUri)) {
    await shell.openExternal(result.verificationUri)
  }
  return result
})
safeHandler('oauth:poll', pollOAuthLogin)
safeHandler('bridge:test', async () => {
  const config = bridgeRegistrationConfig()
  const [bridge, tianshu] = await Promise.all([testBridgeEndpoints(), testTianshu(config)])
  return { ok: bridge.ok && tianshu.ok, bridge, tianshu }
})
safeHandler('bridge:smoke-test', async (region, modelId) => {
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['开始实测', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '模型实测',
    message: `将调用 ${modelId} 生成一个极短回答`,
    detail: '这会消耗少量 WorkBuddy 积分。',
  })
  if (answer.response !== 0) return { cancelled: true }
  return runModelSmokeTest(region, modelId)
})
safeHandler('tianshu:register', () => registerProviders(bridgeRegistrationConfig()))
safeHandler('autostart:get', () => app.getLoginItemSettings({ path: loginItemPath(), args: ['--hidden'] }).openAtLogin)
safeHandler('autostart:set', enabled => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: loginItemPath(),
    args: ['--hidden'],
  })
  return app.getLoginItemSettings({ path: loginItemPath(), args: ['--hidden'] }).openAtLogin
})
safeHandler('external:open', async url => {
  if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http/https 链接')
  await shell.openExternal(url)
  return true
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  await app.whenReady()
  createWindow()
  createTray()
}

app.on('activate', () => {
  if (mainWindow) mainWindow.show()
})

app.on('before-quit', () => {
  quitting = true
  void stopBridge()
})
