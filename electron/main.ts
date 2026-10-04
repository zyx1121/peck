import { app, BrowserWindow, clipboard, ipcMain, Menu, shell } from "electron"
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { Browser } from "./browser"
import { Store, safeUrl } from "./store"
import { startMcp } from "./mcp"
import { telemetry } from "./telemetry"
import type { BrowserEvent, PeckState, PickedElement } from "../src/shared"

app.setName("Peck")
process.on("uncaughtException", (error) => {
  console.error(error)
  app.exit(1)
})
process.on("unhandledRejection", (error) => {
  console.error(error)
  app.exit(1)
})
if (process.env.PECK_DATA_DIR)
  app.setPath("userData", process.env.PECK_DATA_DIR)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void boot()
}
async function boot() {
  await app.whenReady()
  const dataPath = app.getPath("userData")
  mkdirSync(dataPath, { recursive: true, mode: 0o700 })
  const store = new Store(join(dataPath, "peck.sqlite"))
  const window = new BrowserWindow({
    title: "Peck",
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: join(__dirname, "shell-preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const browser = new Browser(window, store)
  let quitting = false
  let picking = false
  let selection: PickedElement | null = null
  let shot: string | undefined
  let pickedTab = ""
  let pickGeneration = 0
  let capturedContext: BrowserEvent[] = []
  let capture: Promise<string | undefined> = Promise.resolve(undefined)
  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function push() {
    if (quitting || pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = undefined
      if (
        !quitting &&
        !window.isDestroyed() &&
        !window.webContents.isLoadingMainFrame()
      )
        window.webContents.send("peck:state", state())
    }, 80)
  }
  function visibility(visible: boolean) {
    if (visible) {
      window.show()
      window.focus()
    } else window.hide()
    push()
  }
  const mcp = await startMcp(browser, store, visibility, push)
  const connectionFile = join(dataPath, "connection.json")
  writeFileSync(
    connectionFile,
    JSON.stringify({ url: mcp.status.url, token: mcp.token, pid: process.pid }),
    { mode: 0o600 }
  )
  function state(): PeckState {
    return {
      tabs: browser.list(),
      activeTabId: browser.activeId,
      selection,
      picking,
      annotations: store
        .annotations()
        .map((a) => ({ ...a, screenshot: undefined, context: [] })),
      events: store.events(browser.activeId),
      mcp: {
        ...mcp.status,
        clients:
          Date.now() - mcp.status.lastActivity < 90000 ? mcp.status.clients : 0,
      },
      visible: window.isVisible(),
      version: app.getVersion(),
      dataPath,
    }
  }
  store.on("change", push)
  browser.on("change", push)
  browser.on("navigated", (id: string) => {
    if (id === browser.activeId) {
      selection = null
      shot = undefined
      picking = false
      pickGeneration++
    }
  })
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault()
      visibility(false)
    }
  })
  window.on("show", push)
  window.on("hide", push)
  app.on("activate", () => visibility(true))
  app.on("second-instance", () => visibility(true))
  app.on("before-quit", () => {
    if (quitting) return
    quitting = true
    if (pushTimer) clearTimeout(pushTimer)
    mcp.close()
    browser.destroy()
    store.close()
    try {
      unlinkSync(connectionFile)
    } catch {
      /* Already removed. */
    }
  })
  process.on("SIGTERM", () => app.quit())
  process.on("SIGINT", () => app.quit())
  const openExternal = (url: string) => {
    if (
      url.startsWith("https://www.zyx.tw") ||
      url.startsWith("https://github.com/zyx1121/peck")
    )
      void shell.openExternal(url)
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault()
    openExternal(url)
  })
  function assertShell(event: Electron.IpcMainInvokeEvent) {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender")
  }
  ipcMain.handle("peck:state", (event) => {
    assertShell(event)
    return state()
  })
  const pickedSchema = z.object({
    selector: z.string().max(2000),
    tag: z.string().max(100),
    text: z.string().max(1200),
    url: z.string().max(6000),
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    viewport: z.object({
      width: z.number(),
      height: z.number(),
      devicePixelRatio: z.number(),
    }),
    styles: z.record(z.string().max(500)),
    source: z.string().max(2000).optional(),
  })
  ipcMain.on("peck:picked", async (event, value) => {
    const tab = [...browser.tabs.values()].find(
      (t) => t.view.webContents === event.sender
    )
    if (
      !tab ||
      tab.info.id !== browser.activeId ||
      event.senderFrame !== event.sender.mainFrame
    )
      return
    const parsed = pickedSchema.safeParse(value)
    if (!parsed.success) return
    const generation = ++pickGeneration
    selection = { ...parsed.data, url: safeUrl(parsed.data.url) }
    pickedTab = tab.info.id
    picking = false
    shot = undefined
    push()
    capturedContext = store.events(pickedTab, 30)
    capture = browser
      .screenshot(pickedTab)
      .then((image) => {
        if (generation === pickGeneration) shot = image
        return image
      })
      .catch(() => undefined)
  })
  ipcMain.on("peck:pick-cancel", (event) => {
    if (browser.current().view.webContents !== event.sender) return
    picking = false
    push()
  })
  ipcMain.handle(
    "peck:action",
    async (event, action: string, args: Record<string, unknown> = {}) => {
      assertShell(event)
      switch (action) {
        case "navigate":
          selection = null
          shot = undefined
          picking = false
          browser.pick(false)
          return browser.navigate(z.string().max(4000).parse(args.url))
        case "new-tab":
          return browser.create(mcp.demoUrl)
        case "activate":
          browser.pick(false)
          picking = false
          selection = null
          pickGeneration++
          browser.activate(z.string().parse(args.id))
          return
        case "close-tab":
          return browser.close(z.string().parse(args.id))
        case "back":
          browser.current().view.webContents.navigationHistory.goBack()
          return
        case "forward":
          browser.current().view.webContents.navigationHistory.goForward()
          return
        case "reload":
          browser.current().view.webContents.reload()
          return
        case "layout":
          browser.layout(
            z
              .object({
                x: z.number().finite(),
                y: z.number().finite(),
                width: z.number().positive(),
                height: z.number().positive(),
              })
              .parse(args)
          )
          return
        case "pick":
          picking = z.boolean().parse(args.enabled)
          browser.pick(picking)
          push()
          return
        case "clear-selection":
          selection = null
          shot = undefined
          pickGeneration++
          push()
          return
        case "comment": {
          if (!selection) throw new Error("Select an element first")
          const comment = z.string().trim().min(1).max(4000).parse(args.comment)
          const selected = selection
          const tabId = pickedTab
          const context = capturedContext
          const image = shot ?? (await capture)
          const item = store.add(tabId, comment, selected, image, context)
          selection = null
          shot = undefined
          telemetry("annotation.created", { annotation_id: item.id })
          push()
          return item.id
        }
        case "reply":
          return store.update(
            z.string().parse(args.id),
            undefined,
            z.string().trim().min(1).max(8000).parse(args.text),
            "user"
          )
        case "reopen":
          return store.update(
            z.string().parse(args.id),
            "pending",
            "重新開啟，請再檢查。",
            "user"
          )
        case "annotation-image":
          return store.get(z.string().parse(args.id)).screenshot ?? null
        case "hide":
          visibility(false)
          return
        case "copy-config": {
          const config = {
            mcpServers: {
              peck: {
                command: process.execPath,
                args: [join(app.getAppPath(), "dist-electron/bridge.cjs")],
                env: { ELECTRON_RUN_AS_NODE: "1" },
              },
            },
          }
          clipboard.writeText(JSON.stringify(config, null, 2))
          return config
        }
        case "metrics":
          return app
            .getAppMetrics()
            .map((p) => ({
              type: p.type,
              cpu: p.cpu.percentCPUUsage,
              memory: p.memory,
            }))
        default:
          throw new Error("Unknown action")
      }
    }
  )
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Peck",
        submenu: [
          { label: "顯示 Peck", click: () => visibility(true) },
          {
            label: "移至背景",
            accelerator: "CmdOrCtrl+H",
            click: () => visibility(false),
          },
          { type: "separator" },
          { role: "quit", label: "結束 Peck" },
        ],
      },
      { role: "editMenu" },
      {
        label: "瀏覽",
        submenu: [
          {
            label: "選取元件",
            accelerator: "CmdOrCtrl+Shift+C",
            click: () => {
              picking = !picking
              browser.pick(picking)
              push()
            },
          },
          {
            label: "重新整理",
            accelerator: "CmdOrCtrl+R",
            click: () => browser.current().view.webContents.reload(),
          },
        ],
      },
    ])
  )
  await window.loadFile(join(__dirname, "../dist/index.html"))
  await browser.create(mcp.demoUrl)
  window.show()
  push()
  telemetry("app.started", {
    version: app.getVersion(),
    platform: process.platform,
  })
}
