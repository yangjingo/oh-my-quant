import { contextBridge, ipcRenderer } from "electron";

// Main validates the recovery page and frame for each call. No Host tokens or
// filesystem access cross into the renderer.
contextBridge.exposeInMainWorld("desktopRecovery", {
  status: () => ipcRenderer.invoke("recovery:status"),
  retry: () => ipcRenderer.invoke("recovery:retry"),
});
