'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = name => async arg => { const result = await ipcRenderer.invoke(name, arg); if (!result.ok) { const error = new Error(result.error); error.code = result.code; error.details = result.details; throw error; } return result.value; };
contextBridge.exposeInMainWorld('whale', {
  state: call('get-state'), manage: call('open-manager'), save: call('save-site'), remove: call('delete-site'), select: call('select-site'),
  refresh: call('refresh'), test: arg => ipcRenderer.invoke('test', arg), preferences: call('preferences'), dashboard: call('open-dashboard'), hide: call('hide-pet'), show: call('show-pet'),
  copyTestResult: call('copy-test-result'),
  usage: call('usage-summary'),
  drag: value => ipcRenderer.send('drag', value), passThrough: ignore => ipcRenderer.send('mouse-pass-through', ignore),
  onState: callback => { const fn = (_event, value) => callback(value); ipcRenderer.on('state', fn); return () => ipcRenderer.removeListener('state', fn); },
  onLayout: callback => { const fn = (_event, value) => callback(value); ipcRenderer.on('layout', fn); return () => ipcRenderer.removeListener('layout', fn); },
});
