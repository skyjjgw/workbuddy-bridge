import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('workbuddyBridge', {
  snapshot: () => ipcRenderer.invoke('bridge:snapshot'),
  refresh: () => ipcRenderer.invoke('bridge:refresh'),
  startLogin: region => ipcRenderer.invoke('oauth:start', region),
  pollLogin: (region, loginId) => ipcRenderer.invoke('oauth:poll', region, loginId),
  test: () => ipcRenderer.invoke('bridge:test'),
  smokeTest: (region, modelId) => ipcRenderer.invoke('bridge:smoke-test', region, modelId),
  registerTianshu: () => ipcRenderer.invoke('tianshu:register'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: enabled => ipcRenderer.invoke('autostart:set', enabled),
  openExternal: url => ipcRenderer.invoke('external:open', url),
})
