const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('weijianDesktop', {
  chooseJianyingDraft: () => ipcRenderer.invoke('weijian:choose-jianying-draft'),
  chooseJianyingMedia: request => ipcRenderer.invoke('weijian:choose-jianying-media', request),
  onImportJianyingDraft: callback => { const listener = () => callback(); ipcRenderer.on('weijian:import-jianying', listener); return () => ipcRenderer.removeListener('weijian:import-jianying', listener); },
});
contextBridge.exposeInMainWorld('weijianAudio', {
  command: command => ipcRenderer.invoke('weijian:audio-command', command),
  saveCapture: () => ipcRenderer.invoke('weijian:audio-save-capture'),
  subscribe: callback => { const listener = (_event, status) => callback(status); ipcRenderer.on('weijian:audio-status', listener); return () => ipcRenderer.removeListener('weijian:audio-status', listener); },
});
