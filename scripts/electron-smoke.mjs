import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
process.on('uncaughtException', error => console.error('[smoke] uncaught', error))
process.on('unhandledRejection', error => console.error('[smoke] rejection', error))

await app.whenReady()
const window = new BrowserWindow({
  width: 1000,
  height: 700,
  show: false,
  webPreferences: {
    preload: join(here, '..', 'src', 'desktop', 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
window.webContents.on('render-process-gone', (_event, details) => console.error('[smoke] renderer gone', details))
window.webContents.on('did-fail-load', (_event, code, description) => console.error('[smoke] load failed', code, description))
await window.loadFile(join(here, '..', 'src', 'desktop', 'renderer', 'index.html'))
console.log('[smoke] window loaded')
await new Promise(resolve => setTimeout(resolve, 750))
console.log('[smoke] success')
app.quit()
