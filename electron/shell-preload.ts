import { contextBridge, ipcRenderer } from "electron"
contextBridge.exposeInMainWorld("peck", {
  invoke: (action: string, args: Record<string, unknown> = {}) =>
    ipcRenderer.invoke("peck:action", action, args),
  state: () => ipcRenderer.invoke("peck:state"),
  subscribe: (callback: (value: unknown) => void) => {
    const listener = (_: unknown, value: unknown) => callback(value)
    ipcRenderer.on("peck:state", listener)
    return () => ipcRenderer.removeListener("peck:state", listener)
  },
})
