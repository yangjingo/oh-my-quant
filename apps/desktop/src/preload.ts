import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./bridge.ts";

const bridge: DesktopBridge = {
  start: size => ipcRenderer.invoke("terminal:start", size),
  input: data => ipcRenderer.send("terminal:input", data),
  resize: size => ipcRenderer.send("terminal:resize", size),
  acknowledge: length => ipcRenderer.send("terminal:ack", length),
  copy: text => ipcRenderer.invoke("clipboard:copy", text),
  paste: () => ipcRenderer.invoke("clipboard:paste"),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  openLink: url => ipcRenderer.invoke("link:open", url),
  onData: callback => {
    const listener = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on("terminal:data", listener);
    return () => { ipcRenderer.removeListener("terminal:data", listener); };
  },
  onExit: callback => {
    const listener = (_event: unknown, code: number) => callback(code);
    ipcRenderer.on("terminal:exit", listener);
    return () => { ipcRenderer.removeListener("terminal:exit", listener); };
  },
};
contextBridge.exposeInMainWorld("desktop", bridge);
