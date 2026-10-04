import { app, BrowserWindow, clipboard, ipcMain, Menu, shell } from "electron"
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { Browser } from "./browser"
import { Store, safeUrl } from "./store"
import { startMcp } from "./mcp"
import { telemetry } from "./telemetry"
import type {
  BrowserEvent,
  PeckState,
  PickedElement,
  SourceLocation,
} from "../src/shared"

// Each page window owns its selection and the context frozen at pick time.
type Session = {
  id: string
  window: BrowserWindow
  picking: boolean
  selection: PickedElement | null
  shot?: string
  locating: Promise<SourceLocation | undefined>
  generation: number
  context: BrowserEvent[]
  capture: Promise<string | undefined>
}

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
  const browser = new Browser(store)
  const sessions = new Map<string, Session>()
  let quitting = false
  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function state(session: Session): PeckState {
    return {
      page: { ...browser.current(session.id).info },
      platform: process.platform,
      fullscreen: session.window.isFullScreen(),
      selection: session.selection,
      picking: session.picking,
      annotations: store.annotations().map((a) => ({
        ...a,
        screenshot: undefined,
        context: [],
        replies: a.replies.map(({ image, ...r }) => ({
          ...r,
          hasImage: !!image,
        })),
      })),
      events: store.events(session.id),
      mcp: {
        ...mcp.status,
        clients:
          Date.now() - mcp.status.lastActivity < 90000 ? mcp.status.clients : 0,
      },
      visible: session.window.isVisible(),
      version: app.getVersion(),
      dataPath,
    }
  }
  function push() {
    if (quitting || pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = undefined
      for (const session of sessions.values()) {
        const { window } = session
        if (
          !quitting &&
          !window.isDestroyed() &&
          !window.webContents.isLoadingMainFrame()
        )
          window.webContents.send("peck:state", state(session))
      }
    }, 80)
  }
  // Show or hide one page window. Showing with no windows left opens one.
  async function visibility(visible: boolean, id = browser.activeId) {
    if (!id) {
      if (visible) await browser.create(mcp.demoUrl)
      return
    }
    if (visible) browser.activate(id)
    else browser.current(id).window.hide()
    push()
  }
  const mcp = await startMcp(
    browser,
    store,
    visibility,
    push,
    (id) => !!sessions.get(id)?.picking
  )
  const connectionFile = join(dataPath, "connection.json")
  writeFileSync(
    connectionFile,
    JSON.stringify({ url: mcp.status.url, token: mcp.token, pid: process.pid }),
    { mode: 0o600 }
  )
  function command(session: Session, name: string) {
    session.window.webContents.focus()
    session.window.webContents.send("peck:command", name)
  }
  function clearSelection(session: Session) {
    session.selection = null
    session.shot = undefined
    session.picking = false
    session.generation++
  }
  function togglePicker(session: Session) {
    session.picking = !session.picking
    browser.pick(session.picking, session.id)
    push()
  }
  function openWindow() {
    void browser.create(mcp.demoUrl).catch((error) => {
      const session = sessions.get(browser.activeId)
      if (session) command(session, `error:${String(error)}`)
    })
  }
  const focused = () => sessions.get(browser.activeId)
  const openExternal = (url: string) => {
    if (
      url.startsWith("https://www.zyx.tw") ||
      url.startsWith("https://github.com/zyx1121/peck")
    )
      void shell.openExternal(url)
  }
  browser.on("created", (id: string, window: BrowserWindow) => {
    sessions.set(id, {
      id,
      window,
      picking: false,
      selection: null,
      generation: 0,
      context: [],
      capture: Promise.resolve(undefined),
      locating: Promise.resolve(undefined),
    })
    window.on("show", push)
    window.on("hide", push)
    window.on("enter-full-screen", push)
    window.on("leave-full-screen", push)
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: "deny" }
    })
    window.webContents.on("will-navigate", (event, url) => {
      event.preventDefault()
      openExternal(url)
    })
  })
  browser.on("closed", (id: string) => sessions.delete(id))
  browser.on("change", push)
  store.on("change", push)
  browser.on("navigated", (id: string) => {
    const session = sessions.get(id)
    if (session) clearSelection(session)
  })
  app.on("activate", () => void visibility(true))
  app.on("second-instance", () => void visibility(true))
  // Closing the last page window keeps the local MCP running.
  app.on("window-all-closed", () => {})
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
  function assertShell(event: Electron.IpcMainInvokeEvent) {
    const session = [...sessions.values()].find(
      (s) => s.window.webContents === event.sender
    )
    if (!session || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Untrusted IPC sender")
    return session
  }
  function pageSession(event: Electron.IpcMainEvent) {
    const tab = [...browser.tabs.values()].find(
      (t) => t.view.webContents === event.sender
    )
    if (!tab || event.senderFrame !== event.sender.mainFrame) return
    return sessions.get(tab.info.id)
  }
  ipcMain.handle("peck:state", (event) => state(assertShell(event)))
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
    nonce: z.string().uuid().optional(),
  })
  ipcMain.on("peck:picked", (event, value) => {
    const session = pageSession(event)
    const parsed = pickedSchema.safeParse(value)
    if (!session || !parsed.success) return
    const generation = ++session.generation
    const { nonce, ...picked } = parsed.data
    session.selection = { ...picked, url: safeUrl(picked.url) }
    session.picking = false
    session.shot = undefined
    session.context = store.events(session.id, 30)
    session.capture = browser
      .screenshot(session.id)
      .then((image) => {
        if (generation === session.generation) session.shot = image
        return image
      })
      .catch(() => undefined)
    session.locating = nonce
      ? browser
          .locate(nonce, session.id)
          .then((location) => {
            if (
              location &&
              generation === session.generation &&
              session.selection
            ) {
              session.selection = { ...session.selection, location }
              push()
            }
            return location
          })
          .catch(() => undefined)
      : Promise.resolve(undefined)
    push()
  })
  ipcMain.on("peck:pick-cancel", (event) => {
    const session = pageSession(event)
    if (!session) return
    session.picking = false
    push()
  })
  ipcMain.handle(
    "peck:action",
    async (event, action: string, args: Record<string, unknown> = {}) => {
      const session = assertShell(event)
      const { id, window } = session
      const contents = browser.current(id).view.webContents
      switch (action) {
        case "navigate": {
          clearSelection(session)
          browser.pick(false, id)
          const loading = browser.navigate(
            z.string().max(4000).parse(args.url),
            id
          )
          contents.focus()
          return loading
        }
        case "new-window":
          return browser.create(mcp.demoUrl)
        case "back":
          if (contents.navigationHistory.canGoBack())
            contents.navigationHistory.goBack()
          return
        case "forward":
          if (contents.navigationHistory.canGoForward())
            contents.navigationHistory.goForward()
          return
        case "reload":
          contents.reload()
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
              .parse(args),
            id
          )
          return
        case "pick":
          session.picking = z.boolean().parse(args.enabled)
          browser.pick(session.picking, id)
          push()
          return
        case "clear-selection":
          clearSelection(session)
          push()
          return
        case "comment": {
          if (!session.selection) throw new Error("Select an element first")
          const comment = z.string().trim().min(1).max(4000).parse(args.comment)
          const selected = session.selection
          const context = session.context
          const generation = session.generation
          const image = session.shot ?? (await session.capture)
          // Wait briefly for the source location if it is still resolving.
          const location =
            selected.location ??
            (await Promise.race([
              session.locating,
              new Promise<undefined>((resolve) => setTimeout(resolve, 1000)),
            ]))
          const item = store.add(
            id,
            comment,
            location ? { ...selected, location } : selected,
            image,
            context
          )
          if (session.generation === generation) clearSelection(session)
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
        case "reply-image":
          return (
            store.get(z.string().parse(args.id)).replies[
              z.number().int().min(0).parse(args.index)
            ]?.image ?? null
          )
        case "hide":
          await visibility(false, id)
          return
        case "menu":
          Menu.buildFromTemplate([
            {
              label: "新增視窗",
              accelerator: "CmdOrCtrl+N",
              click: openWindow,
            },
            { label: "Local MCP…", click: () => command(session, "connect") },
            { label: "切換深淺色", click: () => command(session, "theme") },
            { type: "separator" },
            {
              label: "移至背景",
              accelerator: "CmdOrCtrl+H",
              click: () => void visibility(false, id),
            },
            {
              label: "關閉視窗",
              accelerator: "CmdOrCtrl+W",
              click: () => window.close(),
            },
          ]).popup({ window })
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
          return app.getAppMetrics().map((p) => ({
            type: p.type,
            cpu: p.cpu.percentCPUUsage,
            memory: p.memory,
          }))
        default:
          throw new Error("Unknown action")
      }
    }
  )
  const withFocused = (run: (session: Session) => void) => () => {
    const session = focused()
    if (session) run(session)
  }
  const history = (step: "goBack" | "goForward") =>
    withFocused((session) => {
      const { navigationHistory } = browser.current(session.id).view.webContents
      if (
        step === "goBack"
          ? navigationHistory.canGoBack()
          : navigationHistory.canGoForward()
      )
        navigationHistory[step]()
    })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Peck",
        submenu: [
          {
            label: "Local MCP…",
            click: withFocused((s) => command(s, "connect")),
          },
          { type: "separator" },
          { label: "顯示視窗", click: () => void visibility(true) },
          {
            label: "移至背景",
            accelerator: "CmdOrCtrl+H",
            click: () => void visibility(false),
          },
          { type: "separator" },
          { role: "quit", label: "結束 Peck" },
        ],
      },
      {
        label: "檔案",
        submenu: [
          {
            label: "新增視窗",
            accelerator: "CmdOrCtrl+N",
            click: openWindow,
          },
          {
            label: "關閉視窗",
            accelerator: "CmdOrCtrl+W",
            click: withFocused((s) => s.window.close()),
          },
        ],
      },
      { role: "editMenu", label: "編輯" },
      {
        label: "瀏覽",
        submenu: [
          {
            label: "輸入網址",
            accelerator: "CmdOrCtrl+L",
            click: withFocused((s) => command(s, "address")),
          },
          {
            label: "選取元件",
            accelerator: "CmdOrCtrl+Shift+C",
            click: withFocused(togglePicker),
          },
          { type: "separator" },
          {
            label: "上一頁",
            accelerator: "CmdOrCtrl+[",
            click: history("goBack"),
          },
          {
            label: "下一頁",
            accelerator: "CmdOrCtrl+]",
            click: history("goForward"),
          },
          {
            label: "重新整理",
            accelerator: "CmdOrCtrl+R",
            click: withFocused((s) =>
              browser.current(s.id).view.webContents.reload()
            ),
          },
        ],
      },
      { role: "windowMenu", label: "視窗" },
    ])
  )
  await browser.create(mcp.demoUrl)
  telemetry("app.started", {
    version: app.getVersion(),
    platform: process.platform,
  })
}
