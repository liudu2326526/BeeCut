const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('audioHost', {
  onCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('weijian:audio-host-command', listener); return () => ipcRenderer.removeListener('weijian:audio-host-command', listener); },
  status: status => ipcRenderer.send('weijian:audio-host-status', status),
  capture: packet => ipcRenderer.send('weijian:audio-host-capture', packet),
});
