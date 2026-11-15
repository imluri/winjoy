const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: callback => {
    const listener = (_event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },
})

contextBridge.exposeInMainWorld('winjoy', {
  getState: () => ipcRenderer.invoke('winjoy:get-state'),
  getAddresses: () => ipcRenderer.invoke('winjoy:get-addresses'),
  startLocal: () => ipcRenderer.invoke('winjoy:start-local'),
  startHost: options => ipcRenderer.invoke('winjoy:start-host', options),
  startGuest: options => ipcRenderer.invoke('winjoy:start-guest', options),
  stop: () => ipcRenderer.invoke('winjoy:stop'),
  getUpdateState: () => ipcRenderer.invoke('winjoy:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('winjoy:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('winjoy:install-update'),
  copy: text => ipcRenderer.invoke('winjoy:copy', text),
  onState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('winjoy:state', listener)
    return () => { ipcRenderer.removeListener('winjoy:state', listener) }
  },
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('winjoy:update-state', listener)
    return () => { ipcRenderer.removeListener('winjoy:update-state', listener) }
  },
})
