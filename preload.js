'use strict';
// Runs sandboxed in every page. It exposes a small API ONLY to the browser's own zentro:// pages.
// Websites get nothing: no Node.js, no Electron, no bridge.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'zentro:') {
  const callbacks = new Map();
  ipcRenderer.on('zentro:event', (_e, name, payload) => {
    for (const cb of callbacks.get(name) || []) { try { cb(payload); } catch { /* page bug must not break others */ } }
  });
  contextBridge.exposeInMainWorld('zentro', Object.freeze({
    call: (method, arg) => ipcRenderer.invoke('zentro:call', String(method), arg).then((r) => {
      if (!r || r.ok !== true) throw new Error((r && r.error) || 'Something went wrong.');
      return r.data;
    }),
    on: (name, cb) => {
      if (typeof cb !== 'function') return () => {};
      const set = callbacks.get(name) || new Set();
      set.add(cb);
      callbacks.set(name, set);
      return () => set.delete(cb);
    },
  }));
}
