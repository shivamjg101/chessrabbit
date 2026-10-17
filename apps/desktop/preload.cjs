const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chessrabbitLock", {
  status: () => ipcRenderer.invoke("lock:status"),
  unlock: (password) => ipcRenderer.invoke("lock:unlock", password),
  save: (password, currentPassword) => ipcRenderer.invoke("lock:save", password, currentPassword),
  remove: (currentPassword) => ipcRenderer.invoke("lock:remove", currentPassword),
  close: () => ipcRenderer.invoke("lock:close"),
});
