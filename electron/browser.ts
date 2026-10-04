import { WebContentsView, type BrowserWindow } from "electron"
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
  tabs = new Map<string, { info: TabInfo; view: WebContentsView }>()
  activeId = ""
  bounds = { x: 20, y: 180, width: 800, height: 500 }
  private busy = new Map<string, number>()
  constructor(
    private window: BrowserWindow,
    private store: Store
  ) {
    super()
  }
  current(id = this.activeId) {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error("Tab not found")
    return tab
  }
  list() {
    return [...this.tabs.values()].map((t) => ({ ...t.info }))
  }
  async create(url: string) {
    if (this.tabs.size >= 8) throw new Error("The demo supports up to 8 tabs")
    const target = webUrl(url)
    const id = randomUUID()
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
    const info: TabInfo = { id, title: "New tab", url: target, loading: true }
    this.tabs.set(id, { info, view })
    this.window.contentView.addChildView(view)
    const contents = view.webContents
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )
    contents.setWindowOpenHandler(({ url }) => {
      void this.create(url).catch((e) =>
        this.store.event(id, "system", "error", String(e))
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
      this.emit("change")
    })
    contents.on("did-navigate", (_, url) => {
      info.url = safeUrl(url)
      this.emit("navigated", id)
      this.emit("change")
    })
    contents.on("did-navigate-in-page", (_, url) => {
      info.url = safeUrl(url)
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
    // Electron can defer CDP commands until the first document exists.
    await contents.loadURL("about:blank")
    await contents.debugger.sendCommand("Network.enable", {
      maxTotalBufferSize: 8 * 1024 * 1024,
      maxResourceBufferSize: 65536,
    })
    await contents.debugger.sendCommand("Runtime.enable")
    this.activate(id)
    void contents
      .loadURL(target)
      .catch((error) => this.store.event(id, "system", "error", String(error)))
    return info
  }
  activate(id: string) {
    this.current(id)
    this.activeId = id
    for (const [key, tab] of this.tabs) tab.view.setVisible(key === id)
    this.current().view.setBounds(this.bounds)
    this.emit("change")
  }
  layout(bounds: typeof this.bounds) {
    const [width, height] = this.window.getContentSize()
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.min(width, Math.round(bounds.width))),
      height: Math.max(1, Math.min(height, Math.round(bounds.height))),
    }
    if (this.activeId) this.current().view.setBounds(this.bounds)
  }
  async close(id: string) {
    if (this.tabs.size === 1) throw new Error("Keep at least one tab open")
    const tab = this.current(id)
    this.tabs.delete(id)
    this.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (id === this.activeId) this.activate(this.tabs.keys().next().value!)
    this.emit("change")
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
  pick(enabled: boolean) {
    this.current().view.webContents.send("peck:pick", enabled)
  }
  async screenshot(id = this.activeId) {
    const img = await this.current(id).view.webContents.capturePage()
    return img
      .resize({ width: Math.min(1280, img.getSize().width) })
      .toJPEG(75)
      .toString("base64")
  }
  destroy() {
    for (const { view } of this.tabs.values()) {
      this.window.contentView.removeChildView(view)
      view.webContents.close()
    }
    this.tabs.clear()
  }
}
