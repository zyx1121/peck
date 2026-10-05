import {
  WebContentsView,
  BrowserWindow,
  session as electronSession,
  type WebContents,
} from "electron"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import type { TabInfo } from "../src/shared"
import { Store, redact, safeUrl } from "./store"
import * as input from "./input"
import { locate as locateSource } from "./source"
import { describe, met, type Activity, type WaitCondition } from "./wait"

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
export function originOf(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return ""
  }
}
export class Browser extends EventEmitter {
  tabs = new Map<
    string,
    {
      info: TabInfo
      view: WebContentsView
      window: BrowserWindow
      activity: Activity
      // Marks the first real navigation of a window, see create().
      begin: () => void
      // Settles when the window's capture is set up. A navigation during
      // setup can swap the page's process and fail a pending CDP command.
      ready: Promise<void>
    }
  >()
  activeId = ""
  private busy = new Map<string, number>()
  // Per-window capture queue, and windows the user showed during a capture.
  private captures = new Map<string, Promise<unknown>>()
  private shownDuringCapture = new Set<string>()
  // Origins whose dev server runs Peck's dev plugin, and the request ids
  // Peck stamped on requests to them.
  devOrigins = new Set<string>()
  stamped = new Map<string, Set<string>>()
  private stamps = 0
  constructor(private store: Store) {
    super()
    // Tag requests to a dev plugin origin from a page on that origin, so
    // dev server events link to the network record that caused them.
    electronSession
      .fromPartition("persist:peck")
      .webRequest.onBeforeSendHeaders((details, callback) => {
        const origin = originOf(details.url)
        const tab = [...this.tabs.values()].find(
          (t) =>
            !t.view.webContents.isDestroyed() &&
            t.view.webContents.id === details.webContentsId
        )
        if (
          !tab ||
          !this.devOrigins.has(origin) ||
          (details.resourceType !== "mainFrame" &&
            originOf(tab.info.url) !== origin)
        )
          return callback({})
        const id = `pk-${Date.now().toString(36)}-${++this.stamps}`
        const ids = this.stamped.get(origin) ?? new Set<string>()
        ids.add(id)
        if (ids.size > 500) ids.delete(ids.values().next().value!)
        this.stamped.set(origin, ids)
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            "x-peck-request-id": id,
          },
        })
      })
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
  // Without a URL the window opens empty, for the user to type one.
  async create(url?: string, visible = true, focus = true) {
    if (this.tabs.size >= 8)
      throw new Error("The demo supports up to 8 windows")
    const target = url === undefined ? undefined : webUrl(url)
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
      url: target ?? "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    }
    const activity: Activity = {
      pending: new Map(),
      idleSince: Date.now(),
      navigatedAt: 0,
      actedAt: 0,
    }
    // The internal about:blank document stays out of the UI and history,
    // and its white page stays hidden until the first navigation.
    let phase: "blank" | "first" | "ready" = "blank"
    const begin = () => {
      if (phase === "blank") phase = "first"
      view.setVisible(true)
    }
    let settle = () => {}
    const ready = new Promise<void>((resolve) => (settle = resolve))
    this.tabs.set(id, { info, view, window, activity, begin, ready })
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
      if (phase === "blank") return
      info.title = title
      setTitle(title)
      this.emit("change")
    })
    contents.on("did-navigate", (_, url) => {
      if (phase === "blank") return
      if (phase === "first") {
        phase = "ready"
        contents.navigationHistory.clear()
      }
      activity.navigatedAt = Date.now()
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
      activity.navigatedAt = Date.now()
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
    // Request ids stamped for the dev plugin, read from the headers that
    // were actually sent.
    const stampedIds = new Map<string, string>()
    contents.debugger.on("message", async (_, method, params) => {
      try {
        if (method === "Network.requestWillBeSentExtraInfo") {
          const stamp = params.headers?.["x-peck-request-id"]
          if (stamp) {
            stampedIds.set(params.requestId, String(stamp))
            if (stampedIds.size > 500)
              stampedIds.delete(stampedIds.keys().next().value!)
          }
        }
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
          if (params.type !== "EventSource")
            activity.pending.set(params.requestId, Date.now())
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
          const origin = originOf(params.response.url)
          if (
            params.response.headers?.["x-peck-dev"] &&
            !this.devOrigins.has(origin)
          ) {
            this.devOrigins.add(origin)
            this.emit("devserver", origin)
          }
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
          if (
            activity.pending.delete(params.requestId) &&
            !activity.pending.size
          )
            activity.idleSince = Date.now()
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
              peckRequestId: stampedIds.get(params.requestId),
            }
          )
          stampedIds.delete(params.requestId)
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
      // Hide the blank page only after setup. Hidden from the start, setup on
      // macOS was sometimes still pending when the first navigation arrived.
      if (!target) view.setVisible(false)
      settle()
      if (!this.activeId || visible) this.activeId = id
      if (visible && focus) window.show()
      else if (visible) window.showInactive()
      this.emit("change")
      if (target) {
        begin()
        void contents
          .loadURL(target)
          .catch((error) =>
            this.store.event(id, "system", "error", String(error))
          )
      }
      return info
    } catch (error) {
      settle()
      // The user may close a window before it finishes opening.
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
  }
  activate(id: string) {
    const { window } = this.current(id)
    if (this.captures.has(id)) this.shownDuringCapture.add(id)
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
    const tab = this.current(id)
    tab.activity.actedAt = Date.now()
    await tab.ready
    this.current(id).begin()
    await tab.view.webContents.loadURL(webUrl(url))
    return this.current(id).info
  }
  // Run CDP work at full speed, even while the window is hidden.
  private async awake<T>(
    id: string,
    run: (send: input.Send) => Promise<T>,
    action = true
  ) {
    const tab = this.current(id)
    if (action) tab.activity.actedAt = Date.now()
    const c: WebContents = tab.view.webContents
    this.busy.set(id, (this.busy.get(id) ?? 0) + 1)
    c.setBackgroundThrottling(false)
    try {
      return await run((method, params) =>
        c.debugger.sendCommand(method, params)
      )
    } finally {
      const count = (this.busy.get(id) ?? 1) - 1
      this.busy.set(id, count)
      if (!count && !c.isDestroyed()) c.setBackgroundThrottling(true)
    }
  }
  async execute(expression: string, id = this.activeId) {
    return this.awake(id, async (send) => {
      try {
        return await input.evaluate(send, expression)
      } catch (error) {
        // A script that navigates the page loses its result, not its effect.
        if (/navigated or closed|context was destroyed/i.test(String(error)))
          return { navigated: true }
        throw error
      }
    })
  }
  async click(
    target: { selector?: string; x?: number; y?: number },
    options: Parameters<typeof input.click>[2],
    id = this.activeId
  ) {
    return this.awake(id, (send) => input.click(send, target, options))
  }
  async type(
    selector: string,
    text: string,
    clear: boolean,
    id = this.activeId
  ) {
    return this.awake(id, (send) => input.type(send, selector, text, clear))
  }
  async press(keys: string, id = this.activeId) {
    input.parseKeys(keys)
    await this.awake(id, (send) => input.press(send, keys))
    return { pressed: keys }
  }
  // Find the source of a picked element; see source.ts.
  async locate(nonce: string, id = this.activeId) {
    const { info, view } = this.current(id)
    const { session } = view.webContents
    const fetchText = async (url: string, init?: RequestInit) => {
      const response = await session.fetch(url, init)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > 8 * 1024 * 1024) throw new Error("Too large")
      return text
    }
    const origin = new URL(info.url).origin
    return this.awake(
      id,
      (send) => locateSource(send, fetchText, nonce, origin),
      false
    )
  }
  async wait(
    condition: WaitCondition,
    timeoutMs: number,
    signal?: AbortSignal,
    id = this.activeId
  ) {
    const { activity, view } = this.current(id)
    const started = Date.now()
    // A navigation caused by the latest action can commit before this call.
    const since = started - activity.actedAt < 5000 ? activity.actedAt : started
    return this.awake(
      id,
      async (send) => {
        for (;;) {
          if (signal?.aborted) throw new Error("Wait cancelled")
          if (!this.tabs.has(id))
            throw new Error("The page window closed while waiting")
          if (await met(condition, send, view.webContents, activity, since))
            return {
              until: condition.until,
              elapsedMs: Date.now() - started,
              url: this.current(id).info.url,
            }
          if (Date.now() - started >= timeoutMs)
            throw new Error(
              `Timed out after ${timeoutMs} ms waiting for ${describe(condition)}`
            )
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      },
      false
    )
  }
  pick(enabled: boolean, id = this.activeId) {
    this.current(id).view.webContents.send("peck:pick", enabled)
  }
  async screenshot(id = this.activeId) {
    const img = await this.capture(id)
    return img
      .resize({ width: Math.min(1280, img.getSize().width) })
      .toJPEG(75)
      .toString("base64")
  }
  // Capture an element's current bounds with a small margin, after
  // scrolling it into view. Returns null when the selector matches nothing.
  async elementScreenshot(selector: string, id = this.activeId) {
    const rect = (await this.execute(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
        const r = el.getBoundingClientRect()
        const x = Math.max(0, Math.floor(r.left - 16))
        const y = Math.max(0, Math.floor(r.top - 16))
        const right = Math.min(innerWidth, Math.ceil(r.right + 16))
        const bottom = Math.min(innerHeight, Math.ceil(r.bottom + 16))
        if (right <= x || bottom <= y) return null
        return { x, y, width: right - x, height: bottom - y }
      })()`,
      id
    )) as Electron.Rectangle | null
    if (!rect) return null
    const img = await this.capture(id, rect)
    return img
      .resize({ width: Math.min(1280, img.getSize().width) })
      .toJPEG(75)
      .toString("base64")
  }
  // A hidden window produces no new frames: a capture returns a stale frame
  // on macOS and never resolves on Linux. Show the window without the user
  // seeing it, wait for a fresh frame, capture, then hide it again.
  private capture(id: string, rect?: Electron.Rectangle) {
    const run = async () => {
      const { window, view } = this.current(id)
      return this.awake(
        id,
        async (send) => {
          if (window.isVisible()) return view.webContents.capturePage(rect)
          const bounds = window.getBounds()
          // Linux cannot make a window transparent, so it goes off screen.
          const offscreen = process.platform === "linux"
          if (offscreen) window.setPosition(-20000, -20000)
          else {
            window.setOpacity(0)
            window.setIgnoreMouseEvents(true)
          }
          window.showInactive()
          try {
            await Promise.race([
              input.evaluate(
                send,
                "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"
              ),
              new Promise((resolve) => setTimeout(resolve, 1000)),
            ])
            return await view.webContents.capturePage(rect)
          } finally {
            if (!window.isDestroyed()) {
              if (!this.shownDuringCapture.has(id)) window.hide()
              if (offscreen) window.setBounds(bounds)
              else {
                window.setIgnoreMouseEvents(false)
                window.setOpacity(1)
              }
            }
          }
        },
        false
      )
    }
    const queued = (this.captures.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(run)
    this.captures.set(id, queued)
    void queued
      .catch(() => undefined)
      .finally(() => {
        if (this.captures.get(id) === queued) {
          this.captures.delete(id)
          this.shownDuringCapture.delete(id)
        }
      })
    return queued
  }
  destroy() {
    for (const { window } of [...this.tabs.values()]) window.destroy()
    this.tabs.clear()
  }
}
