'use strict';

/* The only bridge between the game page and the app. Two buttons on an
   update toast -- nothing else crosses. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vbUpdate', {
  restart: () => ipcRenderer.send('vb-update-restart'),
  dismiss: () => ipcRenderer.send('vb-update-dismiss')
});
