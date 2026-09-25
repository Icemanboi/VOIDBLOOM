'use strict';

/* The only bridge between the game page and the app:
     vbUpdate  two buttons on the update toast
     vbStats   a send-only outbox for the stats tracker (see stats.js) --
               the page can hand the app a message, never ask for anything
     vbCloud   the online screens' one door (see cloud.js): a named request
               in, a plain answer out. The main process decides what each
               request may do; nothing else crosses. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vbUpdate', {
  restart: () => ipcRenderer.send('vb-update-restart'),
  dismiss: () => ipcRenderer.send('vb-update-dismiss')
});

const KINDS = { tick: 1, run: 1, error: 1, snap: 1 };
contextBridge.exposeInMainWorld('vbStats', {
  post: (kind, data) => {
    if (KINDS[kind] === 1) ipcRenderer.send('vb-stats', kind, data);
  }
});

const OPS = { status: 1, backup: 1, newcode: 1, lookup: 1, adopt: 1, board: 1, name: 1, hide: 1, live: 1, copy: 1 };
let online = false;
try { online = ipcRenderer.sendSync('vb-cloud-ready') === true; } catch (e) { }
if (online) {
  contextBridge.exposeInMainWorld('vbCloud', {
    call: (op, args) => OPS[op] === 1 ? ipcRenderer.invoke('vb-cloud', op, args) : Promise.resolve({ ok: false, error: 'op' })
  });
}
