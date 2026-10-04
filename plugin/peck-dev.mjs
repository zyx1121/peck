// Peck dev plugin: dev-mode server observability for Peck
// (https://github.com/zyx1121/peck). Add it for a debugging session, then
// delete this file and its config lines. It never runs in production.
//
// Vite:    import peckDev from "./peck-dev.mjs", then plugins: [peckDev()]
// Next.js: call register() and onRequestError() from instrumentation.ts
//
// It serves GET /__peck/events on the dev server, which Peck pulls: server
// console output, uncaught errors, failed requests, and Next.js request
// errors, each tagged with the x-peck-request-id of the request that caused
// it. Requests must carry Peck's token in x-peck-token.

import { AsyncLocalStorage } from "node:async_hooks"
import net from "node:net"
import { format } from "node:util"

const TOKEN = "__PECK_TOKEN__"
const VERSION = 1
const LIMIT = 1000

// One state per process, even if the module is loaded twice.
const state = (globalThis.__peckDev ??= {
  started: false,
  events: [],
  nextId: 1,
  clients: new Set(),
  store: new AsyncLocalStorage(),
})

function record(kind, level, message, details = {}) {
  const event = {
    id: state.nextId++,
    time: Date.now(),
    kind,
    level,
    message: String(message).slice(0, 8000),
    requestId: state.store.getStore()?.requestId,
    ...details,
  }
  state.events.push(event)
  if (state.events.length > LIMIT) state.events.shift()
  for (const send of state.clients) send(event)
}

// JSON by default; a Server-Sent Events stream when asked for one. Both
// replay events after ?after= or Last-Event-ID.
function serve(req, res) {
  if (req.headers["x-peck-token"] !== TOKEN) {
    res.writeHead(404).end()
    return
  }
  const url = new URL(req.url, "http://dev")
  const after = Number(
    req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0
  )
  const pending = state.events.filter((e) => e.id > after)
  const headers = { "cache-control": "no-store" }
  if (!String(req.headers.accept).includes("text/event-stream")) {
    res.writeHead(200, { ...headers, "content-type": "application/json" })
    res.end(
      JSON.stringify({
        version: VERSION,
        last: state.nextId - 1,
        events: pending,
      })
    )
    return
  }
  res.writeHead(200, { ...headers, "content-type": "text/event-stream" })
  const send = (event) =>
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)
  pending.forEach(send)
  state.clients.add(send)
  req.on("close", () => state.clients.delete(send))
}

// Answer /__peck/events, and run each request inside its request id so
// console output from its handlers is tagged. HTTP, HTTPS, and HTTP/2
// servers all inherit emit from net.Server.
function patchServers() {
  const emit = net.Server.prototype.emit
  net.Server.prototype.emit = function (event, req, res) {
    if (event !== "request" || typeof req?.url !== "string")
      return emit.apply(this, arguments)
    if (req.url.startsWith("/__peck/events")) {
      serve(req, res)
      return true
    }
    // Tells Peck this dev server has the plugin, so it starts tagging
    // requests and pulling events. Peck sends its token nowhere else.
    res.setHeader?.("x-peck-dev", String(VERSION))
    const id = req.headers["x-peck-request-id"]
    const context = { requestId: id ? String(id).slice(0, 100) : undefined }
    const started = Date.now()
    res.on("finish", () => {
      if (res.statusCode >= 500)
        state.store.run(context, () =>
          record(
            "request",
            "error",
            `${req.method} ${req.url.split("?")[0]} ${res.statusCode}`,
            { status: res.statusCode, durationMs: Date.now() - started }
          )
        )
    })
    return state.store.run(context, () => emit.apply(this, arguments))
  }
}

export function start() {
  if (state.started || process.env.NODE_ENV === "production") return
  state.started = true
  patchServers()
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method]
    const level =
      method === "log" ? "info" : method === "warn" ? "warning" : method
    console[method] = function (...args) {
      try {
        record("console", level, format(...args))
      } catch {
        /* Never break the app's logging. */
      }
      return original.apply(this, args)
    }
  }
  process.on("uncaughtExceptionMonitor", (error) =>
    record("error", "error", error?.stack ?? String(error))
  )
}

// Next.js instrumentation hooks.
export function register() {
  start()
}
export function onRequestError(error, request, context) {
  const id = request?.headers?.["x-peck-request-id"]
  record(
    "request",
    "error",
    `${request?.method ?? ""} ${request?.path ?? ""}: ${error?.message ?? error}`,
    {
      requestId: id ? String(id).slice(0, 100) : undefined,
      stack: String(error?.stack ?? "").slice(0, 8000),
      routePath: context?.routePath,
      routeType: context?.routeType,
    }
  )
}

// Vite plugin. apply: "serve" keeps it out of production builds.
export default function peckDev() {
  return { name: "peck-dev", apply: "serve", configureServer: start }
}
