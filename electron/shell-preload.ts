import { contextBridge, ipcRenderer } from "electron"
contextBridge.exposeInMainWorld("peck", {
  invoke: (action: string, args: Record<string, unknown> = {}) =>
    ipcRenderer.invoke("peck:action", action, args),
  state: () => ipcRenderer.invoke("peck:state"),
  onCommand: (callback: (command: string) => void) => {
    const listener = (_: unknown, command: string) => callback(command)
    ipcRenderer.on("peck:command", listener)
    return () => ipcRenderer.removeListener("peck:command", listener)
  },
  subscribe: (callback: (value: unknown) => void) => {
    const listener = (_: unknown, value: unknown) => callback(value)
    ipcRenderer.on("peck:state", listener)
    return () => ipcRenderer.removeListener("peck:state", listener)
  },
})
