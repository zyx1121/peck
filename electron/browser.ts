import { WebContentsView, BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import type { TabInfo } from "../src/shared"
import { Store, redact, safeUrl } from "./store"

export function webUrl(input: string) {
  const url = new URL(input.includes("://") ? input : `https://${input}`)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only HTTP(S) URLs without embedded credentials are supported"
    )
  return url.toString()
}
export class Browser extends EventEmitter {
  tabs = new Map<
    string,
    {
      info: TabInfo
      view: WebContentsView
      window: BrowserWindow
    }
  >()
  activeId = ""
  private busy = new Map<string, number>()
  constructor(private store: Store) {
    super()
  }
  current(id = this.activeId) {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error("Page window not found")
    return tab
  }
  list() {
    return [...this.tabs.values()].map((t) => ({
      ...t.info,
      visible: t.window.isVisible(),
    }))
  }
  async create(url: string, visible = true) {
    if (this.tabs.size >= 8)
      throw new Error("The demo supports up to 8 windows")
    const target = webUrl(url)
    const id = randomUUID()
    // Cascade from the active window, like a new Safari window.
    const anchor = this.tabs.get(this.activeId)?.window
    const frame =
      anchor && !anchor.isDestroyed() && !anchor.isFullScreen()
        ? anchor.getBounds()
        : undefined
    const window = new BrowserWindow({
      title: "Peck",
      ...(frame
        ? {
            x: frame.x + 24,
            y: frame.y + 24,
            width: frame.width,
            height: frame.height,
          }
        : { width: 1440, height: 960 }),
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: "#000000",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 20 },
          }
        : {}),
      webPreferences: {
        preload: join(__dirname, "shell-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "page-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:peck",
        backgroundThrottling: true,
      },
    })
    const info: TabInfo = {
      id,
      title: "",
      url: target,
      loading: true,
      canGoBack: false,
      canGoForward: false,
    }
    this.tabs.set(id, { info, view, window })
    window.contentView.addChildView(view)
    window.on("focus", () => {
      this.activeId = id
      this.emit("change")
    })
    window.on("closed", () => {
      this.tabs.delete(id)
      if (!view.webContents.isDestroyed()) view.webContents.close()
      this.busy.delete(id)
      if (this.activeId === id)
        this.activeId = [...this.tabs.keys()].at(-1) ?? ""
      this.emit("closed", id)
      this.emit("change")
    })
    window.webContents.on("page-title-updated", (event) =>
      event.preventDefault()
    )
    this.emit("created", id, window)
    const contents = view.webContents
    // Page events can still arrive while its window is being closed.
    const setTitle = (title: string) => {
      if (!window.isDestroyed()) window.setTitle(title || "Peck")
    }
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )
    contents.setWindowOpenHandler(({ url }) => {
      void this.create(url, !window.isDestroyed() && window.isVisible()).catch(
        (e) => this.store.event(id, "system", "error", String(e))
      )
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => {
      try {
        webUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    contents.on("will-redirect", (event, url) => {
      try {
        webUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    contents.on("page-title-updated", (_, title) => {
      info.title = title
      setTitle(title)
      this.emit("change")
    })
    contents.on("did-navigate", (_, url) => {
      info.url = safeUrl(url)
      // A new document starts with the URL as its title until <title> loads.
      info.title = contents.getTitle()
      setTitle(info.title)
      info.canGoBack = contents.navigationHistory.canGoBack()
      info.canGoForward = contents.navigationHistory.canGoForward()
      this.emit("navigated", id)
      this.emit("change")
    })
    contents.on("did-navigate-in-page", (_, url) => {
      info.url = safeUrl(url)
      info.canGoBack = contents.navigationHistory.canGoBack()
      info.canGoForward = contents.navigationHistory.canGoForward()
      this.emit("navigated", id)
      this.emit("change")
    })
    contents.on("did-start-loading", () => {
      info.loading = true
      this.emit("change")
    })
    contents.on("did-stop-loading", () => {
      info.loading = false
      this.emit("change")
    })
    contents.on("did-fail-load", (_, code, description, url, mainFrame) => {
      if (mainFrame && code !== -3)
        this.store.event(id, "system", "error", description, {
          code,
          url: safeUrl(url),
        })
    })
    contents.on("render-process-gone", (_, details) =>
      this.store.event(id, "system", "error", "Page renderer stopped", {
        ...details,
      })
    )
    contents.on("console-message", (_event, level, message, line, source) =>
      this.store.event(
        id,
        "console",
        ["debug", "info", "warning", "error"][level] ?? "info",
        message,
        { line, source: safeUrl(source) }
      )
    )
    contents.debugger.attach("1.3")
    const requests = new Map<
      string,
      {
        url: string
        method: string
        started: number
        request: Record<string, unknown>
        response?: Record<string, unknown>
      }
    >()
    contents.debugger.on("message", async (_, method, params) => {
      try {
        if (method === "Runtime.exceptionThrown") {
          const e = params.exceptionDetails
          this.store.event(
            id,
            "console",
            "error",
            e.exception?.description ?? e.text,
            {
              source: safeUrl(e.url ?? ""),
              line: e.lineNumber,
              stack: e.stackTrace,
            }
          )
        }
        if (method === "Network.requestWillBeSent") {
          const r = params.request
          if (!/^https?:/.test(r.url)) return
          if (requests.size >= 500)
            requests.delete(requests.keys().next().value!)
          let body: unknown = r.postData?.slice(0, 16000)
          if (body) {
            try {
              body = redact(JSON.parse(String(body)))
            } catch {
              body = "[non-JSON request body omitted]"
            }
          }
          requests.set(params.requestId, {
            url: safeUrl(r.url),
            method: r.method,
            started: Date.now(),
            request: { headers: redact(r.headers), body, type: params.type },
          })
        }
        if (method === "Network.responseReceived") {
          const item = requests.get(params.requestId)
          if (item)
            item.response = {
              status: params.response.status,
              statusText: params.response.statusText,
              headers: redact(params.response.headers),
              mimeType: params.response.mimeType,
              fromDiskCache: params.response.fromDiskCache,
            }
        }
        if (
          method === "Network.loadingFinished" ||
          method === "Network.loadingFailed"
        ) {
          const item = requests.get(params.requestId)
          if (!item) return
          requests.delete(params.requestId)
          const failed = method === "Network.loadingFailed"
          const status = Number(item.response?.status ?? 0)
          let body: unknown
          if (
            !failed &&
            /json|text|javascript|xml/.test(String(item.response?.mimeType)) &&
            params.encodedDataLength < 65536
          ) {
            try {
              const result = await contents.debugger.sendCommand(
                "Network.getResponseBody",
                { requestId: params.requestId }
              )
              if (!result.base64Encoded) {
                body = result.body.slice(0, 16000)
                try {
                  body = redact(JSON.parse(String(body)))
                } catch {
                  /* Plain text remains useful for debugging. */
                }
              }
            } catch {
              /* Redirects and evicted bodies are not always available. */
            }
          }
          this.store.event(
            id,
            "network",
            failed || status >= 400 ? "error" : "info",
            `${item.method} ${item.url}`,
            {
              requestId: params.requestId,
              ...item.request,
              url: item.url,
              method: item.method,
              ...item.response,
              durationMs: Date.now() - item.started,
              bytes: params.encodedDataLength,
              responseBody: body,
              error: params.errorText,
            }
          )
        }
        if (
          method === "Network.webSocketFrameReceived" ||
          method === "Network.webSocketFrameSent"
        )
          this.store.event(
            id,
            "network",
            "info",
            method.endsWith("Received")
              ? "WebSocket received"
              : "WebSocket sent",
            {
              requestId: params.requestId,
              opcode: params.response.opcode,
              bytes: params.response.payloadData?.length,
            }
          )
      } catch (error) {
        this.store.event(id, "system", "error", "Capture failed", {
          reason: String(error),
        })
      }
    })
    contents.debugger.on("detach", (_, reason) => {
      if (!contents.isDestroyed())
        this.store.event(id, "system", "warning", "Debug capture detached", {
          reason,
        })
    })
    try {
      await window.loadFile(join(__dirname, "../dist/index.html"))
      // Electron can defer CDP commands until the first document exists.
      await contents.loadURL("about:blank")
      await contents.debugger.sendCommand("Network.enable", {
        maxTotalBufferSize: 8 * 1024 * 1024,
        maxResourceBufferSize: 65536,
      })
      await contents.debugger.sendCommand("Runtime.enable")
      if (!this.activeId || visible) this.activeId = id
      if (visible) window.show()
      this.emit("change")
      void contents
        .loadURL(target)
        .catch((error) =>
          this.store.event(id, "system", "error", String(error))
        )
      return info
    } catch (error) {
      // The user may close a window before it finishes opening.
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
  }
  activate(id: string) {
    const { window } = this.current(id)
    this.activeId = id
    window.show()
    window.focus()
    this.emit("change")
  }
  layout(
    bounds: { x: number; y: number; width: number; height: number },
    id = this.activeId
  ) {
    const { window, view } = this.current(id)
    const [width, height] = window.getContentSize()
    const x = Math.max(0, Math.min(width - 1, Math.round(bounds.x)))
    const y = Math.max(0, Math.min(height - 1, Math.round(bounds.y)))
    view.setBounds({
      x,
      y,
      width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
    })
  }
  async close(id: string) {
    this.current(id).window.close()
  }
  async navigate(url: string, id = this.activeId) {
    await this.current(id).view.webContents.loadURL(webUrl(url))
    return this.current(id).info
  }
  async execute(expression: string, id = this.activeId) {
    const c = this.current(id).view.webContents
    this.busy.set(id, (this.busy.get(id) ?? 0) + 1)
    c.setBackgroundThrottling(false)
    try {
      const response = await c.debugger.sendCommand("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        timeout: 10000,
      })
      if (response.exceptionDetails)
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text
        )
      return response.result.value ?? null
    } finally {
      const count = (this.busy.get(id) ?? 1) - 1
      this.busy.set(id, count)
      if (!count && !c.isDestroyed()) c.setBackgroundThrottling(true)
    }
  }
  pick(enabled: boolean, id = this.activeId) {
    this.current(id).view.webContents.send("peck:pick", enabled)
  }
  async screenshot(id = this.activeId) {
    const img = await this.current(id).view.webContents.capturePage()
    return img
      .resize({ width: Math.min(1280, img.getSize().width) })
      .toJPEG(75)
      .toString("base64")
  }
  destroy() {
    for (const { window } of [...this.tabs.values()]) window.destroy()
    this.tabs.clear()
  }
}
