const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mood', {
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  expandDropped: fileList => ipcRenderer.invoke('paths:expand', Array.from(fileList, f => webUtils.getPathForFile(f)).filter(Boolean)),
  readFile: file => ipcRenderer.invoke('file:read', file),
  saveExport: payload => ipcRenderer.invoke('export:save', payload),
  reveal: file => ipcRenderer.invoke('export:reveal', file),
  openExternal: url => ipcRenderer.invoke('open:external', url),
  version: () => ipcRenderer.invoke('app:version'),
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: cb => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  },
  pinterest: {
    status: () => ipcRenderer.invoke('pinterest:status'),
    saveConfig: cfg => ipcRenderer.invoke('pinterest:saveConfig', cfg),
    signIn: () => ipcRenderer.invoke('pinterest:signIn'),
    signOut: () => ipcRenderer.invoke('pinterest:signOut'),
    boards: () => ipcRenderer.invoke('pinterest:boards'),
    download: id => ipcRenderer.invoke('pinterest:download', id),
    onProgress: cb => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('pinterest:progress', h);
      return () => ipcRenderer.removeListener('pinterest:progress', h);
    },
  },
});
