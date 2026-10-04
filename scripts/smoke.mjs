import { _electron as electron } from "playwright"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { cp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { request } from "node:http"
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { Command } from "commander"

const output = resolve("output/playwright")
const dataPath = resolve("output/smoke-profile")
const executablePath = process.env.PECK_EXECUTABLE_PATH
  ? resolve(process.env.PECK_EXECUTABLE_PATH)
  : undefined
const launchOptions = {
  executablePath,
  args: [
    ...(executablePath ? [] : ["."]),
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ],
  env: {
    ...process.env,
    PECK_DATA_DIR: dataPath,
    PECK_PORT: "0",
    // Fake agent CLIs for the resume test, found before the real ones.
    PECK_AGENT_PATH: resolve("output/fake-agents"),
    PECK_FAKE_AGENT_OUT: resolve("output/fake-agents/calls.txt"),
    PECK_WAKE_DEBOUNCE_MS: "300",
  },
  timeout: 30000,
}
await mkdir(output, { recursive: true })
await rm(dataPath, { recursive: true, force: true })
await rm(resolve("output/fake-agents"), { recursive: true, force: true })
await mkdir(resolve("output/fake-agents"), { recursive: true })
for (const name of ["claude", "codex"])
  await writeFile(
    resolve(`output/fake-agents/${name}`),
    `#!/bin/sh\nprintf '%s\\n' call "$$" "$PWD" "$@" end >> "$PECK_FAKE_AGENT_OUT"\n[ -f "$PECK_FAKE_AGENT_OUT.sleep" ] && sleep 60\nexit 0\n`,
    { mode: 0o755 }
  )
const started = Date.now()
console.log("Launching Electron")
const app = await electron.launch(launchOptions)
app.process().stderr.on("data", (d) => {
  if (/Error|Exception|failed/i.test(d.toString())) process.stderr.write(d)
})
let client, bridge, vite
const claudeSession = "11111111-2222-4333-8444-555555555555"
const codexThread = "019a0000-0000-7000-8000-000000000001"
const wakeSession = "22222222-3333-4444-8555-666666666666"
const homeSession = "33333333-4444-4555-8666-777777777777"
const liveSession = "44444444-5555-4666-8777-888888888888"
let quitSleeper
async function waitFor(fn, description, timeout = 12000) {
  const limit = Date.now() + timeout
  while (Date.now() < limit) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out: ${description}`)
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 60000,
  })
  assert.ok(!result.isError, JSON.stringify(result.content))
  return result
}
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
const viteArgs = (config, port) => [
  "node_modules/vite/bin/vite.js",
  "--config",
  config,
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort",
]
const parse = (result) =>
  JSON.parse(result.content.find((c) => c.type === "text").text)
// Each page window has a shell page and a separate page view. Find the first
// shell by its bundled document instead of relying on target order.
const shellOf = (electronApp) =>
  waitFor(
    () =>
      Promise.resolve(
        electronApp.windows().find((p) => p.url().endsWith("/dist/index.html"))
      ),
    "browser shell",
    30000
  )
const windowCount = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
try {
  console.log("Electron launched; waiting for shell")
  const shell = await shellOf(app)
  await shell.waitForSelector(".workspace", { timeout: 30000 })
  console.log("Shell loaded; waiting for guest")
  const guest = await waitFor(
    () => Promise.resolve(app.windows().find((p) => p.url().endsWith("/demo"))),
    "demo page"
  )
  await guest.locator("#headline").waitFor()
  const coldStartMs = Date.now() - started
  // One compact header: no tab strip or footer, and the page title in place
  // of the address until the field is focused.
  assert.equal(
    await shell.locator(".tab-strip, .browser-tab, .panel-footer").count(),
    0
  )
  assert.equal((await shell.locator(".address-bar").boundingBox()).y, 0)
  assert.equal((await shell.locator(".page-viewport").boundingBox()).y, 56)
  const address = shell.getByRole("textbox", { name: "網址" })
  await waitFor(
    async () => (await address.inputValue()) === "Peck Playground",
    "page title in the address field"
  )
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle()
    ),
    "Peck Playground"
  )
  await address.focus()
  assert.ok((await address.inputValue()).endsWith("/demo"))
  await address.press("Escape")
  assert.equal(await address.inputValue(), "Peck Playground")
  await shell.getByRole("button", { name: "隱藏檢查面板" }).click()
  await waitFor(
    async () => !(await shell.locator(".inspector").isVisible()),
    "hidden inspector"
  )
  await shell.getByRole("button", { name: "顯示檢查面板" }).click()
  await shell.locator(".inspector").waitFor()
  const config = JSON.parse(
    await readFile(`${dataPath}/connection.json`, "utf8")
  )
  client = new Client({ name: "peck-smoke", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
    })
  )
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 18)
  // A new window starts its history at the requested page.
  const firstPage = parse(await call("peck_status")).tabs[0]
  assert.ok(firstPage.url.endsWith("/demo"))
  assert.equal(firstPage.canGoBack, false)
  assert.ok(await shell.getByRole("button", { name: "上一頁" }).isDisabled())
  assert.equal(
    (await fetch(config.url, { method: "POST", body: "{}" })).status,
    403
  )
  assert.equal(
    (
      await fetch(config.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Origin: "https://evil.invalid",
        },
        body: "{}",
      })
    ).status,
    403
  )
  const hostileHost = await new Promise((resolve) => {
    const req = request(
      config.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Host: "evil.invalid",
        },
      },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      }
    )
    req.end("{}")
  })
  assert.equal(hostileHost, 403)
  await guest.locator("#add-idea").click()
  assert.equal(await guest.locator("#count").textContent(), "4")
  await call("peck_window", { visible: false })
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible()
    ),
    false
  )
  const revealStart = Date.now()
  await call("peck_window", { visible: true })
  const revealMs = Date.now() - revealStart
  assert.equal(await guest.locator("#count").textContent(), "4")
  await guest.locator("#save-button").click()
  await waitFor(
    async () =>
      parse(await call("peck_events", { kind: "network" })).some(
        (e) => e.details.status === 422
      ),
    "HTTP 422 capture"
  )
  assert.ok(
    parse(await call("peck_events", { kind: "console" })).some((e) =>
      e.message.includes("Save failed")
    )
  )
  await call("peck_evaluate", {
    expression: `fetch('/demo/api/save',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer private-test'},body:JSON.stringify({password:'do-not-store',name:'ok'})}).then(r=>r.status)`,
  })
  await waitFor(
    async () =>
      parse(await call("peck_events", { kind: "network" })).some(
        (e) => e.details.body?.password === "[redacted]"
      ),
    "redaction"
  )
  const captured = JSON.stringify(
    parse(await call("peck_events", { kind: "network" }))
  )
  assert.ok(!captured.includes("do-not-store"))
  assert.ok(!captured.includes("private-test"))
  const watch = call("peck_watch_annotations", {
    afterSequence: 0,
    timeoutMs: 15000,
  })
  await shell.getByRole("button", { name: "選取元件", exact: true }).click()
  await guest.locator("#headline").click()
  await shell
    .getByRole("textbox", { name: "修改意見" })
    .fill("把標題改成中文，字小一點。")
  await shell.getByRole("button", { name: "送出留言", exact: true }).click()
  const received = parse(await watch)
  assert.equal(received.annotations.length, 1)
  const item = received.annotations[0]
  assert.equal(item.element.selector, "#headline")
  assert.deepEqual(item.element.location, {
    file: "electron/demo.ts",
    via: "attribute",
  })
  assert.equal(item.comment, "把標題改成中文，字小一點。")
  const full = await call("peck_annotation_get", { id: item.id })
  assert.ok(full.content.some((c) => c.type === "image" && c.data.length > 100))
  assert.ok(parse(full).context.some((e) => e.kind === "network"))
  await call("peck_annotation_update", {
    id: item.id,
    status: "acknowledged",
    reply: "測試已收到元件與截圖，正在驗證回覆同步。",
  })
  await shell.getByText("處理中", { exact: true }).waitFor()
  await call("peck_annotation_update", {
    id: item.id,
    status: "resolved",
    reply:
      "端到端測試：已驗證選取、截圖、422 紀錄與留言同步。這則測試沒有修改專案原始碼。",
  })
  await shell.getByText("已完成", { exact: true }).waitFor()
  // After screenshot in a reply, and a note when the selector is gone.
  await call("peck_annotation_update", {
    id: item.id,
    reply: "修改後的畫面。",
    screenshot: true,
  })
  const withAfter = await call("peck_annotation_get", { id: item.id })
  assert.equal(withAfter.content.filter((c) => c.type === "image").length, 2)
  assert.ok(parse(withAfter).replies.at(-1).hasImage)
  assert.ok(!JSON.stringify(parse(withAfter)).includes("/9j/"))
  await shell.getByText("查看修改後畫面", { exact: true }).click()
  await shell.getByRole("img", { name: "修改後的元件截圖" }).waitFor()
  await call("peck_evaluate", {
    expression:
      "document.querySelector('#headline').id = 'headline-moved'; true",
  })
  await call("peck_annotation_update", {
    id: item.id,
    reply: "再看一次。",
    screenshot: true,
  })
  const missing = parse(
    await call("peck_annotation_get", { id: item.id })
  ).replies.at(-1)
  assert.ok(!missing.hasImage && missing.text.includes("selector"))
  await call("peck_evaluate", {
    expression:
      "document.querySelector('#headline-moved').id = 'headline'; true",
  })
  await shell.screenshot({ path: `${output}/shell.png` })
  const composed =
    process.platform !== "linux"
      ? undefined
      : await app.evaluate(async ({ desktopCapturer }) => {
          const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 1600, height: 1100 },
          })
          return sources[0]?.thumbnail.toPNG().toString("base64")
        })
  if (composed)
    await writeFile(`${output}/desktop.png`, Buffer.from(composed, "base64"))
  await shell.getByRole("tab", { name: /^Network/ }).click()
  await shell.locator(".event").first().click()
  const networkShot =
    process.platform !== "linux"
      ? undefined
      : await app.evaluate(async ({ desktopCapturer }) =>
          (
            await desktopCapturer.getSources({
              types: ["screen"],
              thumbnailSize: { width: 1600, height: 1100 },
            })
          )[0]?.thumbnail
            .toPNG()
            .toString("base64")
        )
  if (networkShot)
    await writeFile(`${output}/network.png`, Buffer.from(networkShot, "base64"))
  const sizes = await shell.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.address-bar [data-slot="button"],.address-bar input'
      ),
    ].map((e) => e.getBoundingClientRect().height)
  )
  assert.ok(
    sizes.every((n) => n === 36),
    `Toolbar height mismatch: ${sizes}`
  )
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1080, 780)
  )
  await waitFor(
    async () => (await shell.locator(".inspector").boundingBox()).width <= 384,
    "compact layout"
  )
  assert.ok(
    await shell.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  )
  const snapshot = await call("peck_snapshot")
  assert.ok(JSON.stringify(snapshot).includes("FIELDNOTES"))
  // Trusted input: real events, typing and editing keys, hidden windows, and
  // no agent input while the user is selecting an element.
  await call("peck_evaluate", {
    expression:
      "window.__peckTrusted = []; document.addEventListener('click', (e) => window.__peckTrusted.push(e.isTrusted), true); true",
  })
  const countBefore = Number(await guest.locator("#count").textContent())
  await call("peck_click", { selector: "#add-idea" })
  assert.equal(
    Number(await guest.locator("#count").textContent()),
    countBefore + 1
  )
  assert.deepEqual(
    parse(await call("peck_evaluate", { expression: "window.__peckTrusted" })),
    [true]
  )
  await call("peck_type", {
    selector: "#workspace-name",
    text: "Peck 測試 Ab1",
    clear: true,
  })
  assert.equal(
    await guest.locator("#workspace-name").inputValue(),
    "Peck 測試 Ab1"
  )
  await call("peck_press", { keys: "Backspace" })
  assert.equal(
    await guest.locator("#workspace-name").inputValue(),
    "Peck 測試 Ab"
  )
  await call("peck_window", { visible: false })
  await call("peck_click", { selector: "#add-idea" })
  assert.equal(
    Number(await guest.locator("#count").textContent()),
    countBefore + 2
  )
  // Hidden windows: a screenshot shows the current page, including the first
  // capture of a window opened in the background.
  await call("peck_evaluate", {
    expression:
      "document.body.dataset.peckBackground = document.body.style.background; document.body.style.background = 'rgb(255, 0, 0)'; true",
  })
  const hiddenShot = (await call("peck_screenshot")).content.find(
    (c) => c.type === "image"
  ).data
  const corner = await app.evaluate(({ nativeImage }, data) => {
    const bitmap = nativeImage
      .createFromBuffer(Buffer.from(data, "base64"))
      .toBitmap()
    return [bitmap[2], bitmap[1], bitmap[0]]
  }, hiddenShot)
  assert.ok(
    corner[0] > 200 && corner[1] < 80 && corner[2] < 80,
    `Stale frame from a hidden window: ${corner}`
  )
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible()
    ),
    false
  )
  const background = parse(
    await call("peck_tabs", {
      action: "open",
      url: config.url.replace("/mcp", "/demo"),
    })
  ).at(-1)
  assert.equal(background.visible, false)
  await call("peck_screenshot", { tabId: background.id })
  await call("peck_tabs", { action: "close", tabId: background.id })
  await waitFor(async () => (await windowCount()) === 1, "closed hidden window")
  await call("peck_evaluate", {
    expression:
      "document.body.style.background = document.body.dataset.peckBackground; true",
  })
  await call("peck_window", { visible: true })
  const pickButton = shell.getByRole("button", {
    name: "選取元件",
    exact: true,
  })
  await pickButton.click()
  await shell.locator('[aria-label="選取元件"][aria-pressed="true"]').waitFor()
  const blocked = await client.callTool({
    name: "peck_click",
    arguments: { selector: "#add-idea" },
  })
  assert.ok(
    blocked.isError &&
      JSON.stringify(blocked.content).includes("selecting an element")
  )
  await pickButton.click()
  await shell.locator('[aria-label="選取元件"][aria-pressed="false"]').waitFor()
  const reopenedWatch = call("peck_watch_annotations", {
    afterSequence: received.cursor,
    timeoutMs: 15000,
  })
  await waitFor(
    async () => parse(await call("peck_status")).mcp.waiters > 0,
    "reopened feedback watcher"
  )
  await shell.getByRole("tab", { name: /^留言/ }).click()
  await shell.getByText("重新開啟", { exact: true }).click()
  const reopened = parse(await reopenedWatch)
  assert.equal(reopened.annotations[0]?.id, item.id)
  assert.ok(reopened.cursor > received.cursor)
  assert.equal(
    parse(await call("peck_annotation_get", { id: item.id })).status,
    "pending"
  )
  const beforeTabs = parse(await call("peck_tabs")).length
  await call("peck_tabs", {
    action: "open",
    url: config.url.replace("/mcp", "/demo"),
  })
  const afterTabs = parse(await call("peck_tabs"))
  assert.equal(afterTabs.length, beforeTabs + 1)
  assert.equal(await windowCount(), beforeTabs + 1)
  await call("peck_tabs", { action: "close", tabId: afterTabs.at(-1).id })
  await waitFor(
    async () => (await windowCount()) === beforeTabs,
    "closed page window"
  )
  await shell.getByRole("button", { name: "新增視窗", exact: true }).click()
  const second = await waitFor(
    () =>
      Promise.resolve(
        app
          .windows()
          .find((p) => p !== shell && p.url().endsWith("/dist/index.html"))
      ),
    "new page window shell"
  )
  await second.waitForSelector(".workspace", { timeout: 30000 })
  assert.equal(await windowCount(), beforeTabs + 1)
  const opened = parse(await call("peck_tabs")).at(-1)
  await call("peck_tabs", { action: "close", tabId: opened.id })
  await waitFor(
    async () => (await windowCount()) === beforeTabs,
    "closed new page window"
  )
  // Waiting: navigation after history.back(), text and selector after a
  // click, network idle, and a clear timeout.
  const demoUrl = config.url.replace("/mcp", "/demo")
  await call("peck_navigate", { url: `${demoUrl}?second` })
  await call("peck_wait", { until: "url", value: "?second" })
  await call("peck_evaluate", { expression: "history.back(); true" })
  const back = parse(await call("peck_wait", { until: "navigation" }))
  assert.ok(back.url.endsWith("/demo"), back.url)
  await call("peck_wait", { until: "load" })
  await call("peck_click", { selector: "#save-button" })
  await call("peck_wait", { until: "text", value: "儲存失敗" })
  await call("peck_wait", { until: "selector", value: "#result" })
  await call("peck_wait", { until: "networkIdle", idleMs: 200 })
  const timedOut = await client.callTool({
    name: "peck_wait",
    arguments: { until: "selector", value: "#missing", timeoutMs: 300 },
  })
  assert.ok(
    timedOut.isError && JSON.stringify(timedOut.content).includes("Timed out")
  )
  // Event cursor: only records after lastEventId come back.
  const cursor = parse(await call("peck_status")).lastEventId
  assert.ok(Number.isInteger(cursor) && cursor > 0)
  await call("peck_click", { selector: "#save-button" })
  await call("peck_wait", { until: "networkIdle", idleMs: 200 })
  const fresh = parse(await call("peck_events", { afterId: cursor }))
  assert.ok(fresh.length && fresh.every((e) => e.id > cursor))
  assert.equal(
    fresh.filter((e) => e.kind === "network" && e.details.status === 422)
      .length,
    1
  )
  // Dev server MCP: the built-in demo has none, so the tool says so.
  const devServer = parse(await call("peck_dev_server"))
  assert.equal(devServer.available, false)
  assert.ok(devServer.endpoint.endsWith("/_next/mcp"))
  // Source locations: a React dev app on Vite resolves the picked element
  // to its component and original file and line without project changes.
  const port = await freePort()
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "fixtures/vite-react/vite.config.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: "inherit" }
  )
  const fixtureUrl = `http://127.0.0.1:${port}/`
  await waitFor(
    () =>
      fetch(fixtureUrl).then(
        (r) => r.ok,
        () => false
      ),
    "Vite fixture",
    30000
  )
  await call("peck_navigate", { url: fixtureUrl })
  await call("peck_wait", { until: "selector", value: "#title" })
  const fixtureWatch = call("peck_watch_annotations", {
    afterSequence: reopened.cursor,
    timeoutMs: 20000,
  })
  await shell.getByRole("button", { name: "選取元件", exact: true }).click()
  await shell.locator('[aria-label="選取元件"][aria-pressed="true"]').waitFor()
  await guest.locator("#title").click()
  await shell.getByText("Header · /src/App.jsx:11", { exact: true }).waitFor()
  await shell.getByRole("textbox", { name: "修改意見" }).fill("標題放大。")
  await shell.getByRole("button", { name: "送出留言", exact: true }).click()
  const fixtureItem = parse(await fixtureWatch).annotations.find(
    (a) => a.comment === "標題放大。"
  )
  assert.deepEqual(
    {
      ...fixtureItem.element.location,
      column: undefined,
    },
    {
      file: "/src/App.jsx",
      line: 11,
      column: undefined,
      component: "Header",
      via: "react",
    }
  )
  // Dev plugin: add it to a copy of the Vite fixture as an agent would,
  // read tagged server events with the token, keep it out of the
  // production build, then remove it.
  const nextPlugin = parse(await call("peck_dev_plugin", { framework: "next" }))
  assert.ok(
    nextPlugin.instrumentation.includes("export async function register()") &&
      nextPlugin.instrumentation.includes(
        "export async function onRequestError("
      ) &&
      nextPlugin.instrumentation.includes("turbopackIgnore")
  )
  const plugin = parse(await call("peck_dev_plugin", { framework: "vite" }))
  const token = plugin.file.content.match(/const TOKEN = "([0-9a-f]{64})"/)[1]
  const project = resolve("output/plugin-fixture")
  await rm(project, { recursive: true, force: true })
  await cp("fixtures/vite-react", project, { recursive: true })
  const configPath = `${project}/vite.config.mjs`
  const originalConfig = await readFile(configPath, "utf8")
  await writeFile(`${project}/${plugin.file.path}`, plugin.file.content)
  await writeFile(
    configPath,
    `import peckDev from "./peck-dev.mjs"\n` +
      originalConfig.replace(
        "plugins: [react(), api()]",
        "plugins: [react(), api(), peckDev()]"
      )
  )
  const pluginPort = await freePort()
  const pluginVite = spawn(process.execPath, viteArgs(configPath, pluginPort), {
    stdio: "inherit",
  })
  try {
    const origin = `http://127.0.0.1:${pluginPort}`
    await waitFor(
      () =>
        fetch(origin).then(
          (r) => r.ok,
          () => false
        ),
      "plugin fixture",
      30000
    )
    const failed = await fetch(`${origin}/api/fail`, {
      method: "POST",
      headers: { "x-peck-request-id": "smoke-1" },
    })
    assert.equal(failed.status, 500)
    assert.equal((await fetch(`${origin}/__peck/events`)).status, 404)
    // Peck sees the plugin, tags the page's requests, and links the dev
    // server's records to the network record.
    await call("peck_navigate", { url: `${origin}/` })
    await call("peck_wait", { until: "selector", value: "#save" })
    await call("peck_click", { selector: "#save" })
    const linked = await waitFor(
      async () => {
        const events = parse(await call("peck_events", { limit: 300 }))
        const request = events.find(
          (e) =>
            e.kind === "network" &&
            e.message.startsWith("POST") &&
            e.message.includes("/api/fail") &&
            e.details.peckRequestId
        )
        const server =
          request &&
          events.find(
            (e) =>
              e.kind === "server" &&
              e.details.peckRequestId === request.details.peckRequestId &&
              e.message.includes("workspace is locked")
          )
        return server && { request, server }
      },
      "linked dev server record",
      20000
    )
    assert.equal(linked.request.details.status, 500)
    await shell.getByRole("tab", { name: /^Network/ }).click()
    await shell.locator(".event", { hasText: "/api/fail" }).first().click()
    await shell
      .locator(".server-records", { hasText: "workspace is locked" })
      .first()
      .waitFor()
    await shell.getByRole("tab", { name: /^留言/ }).click()
    // A comment's frozen context carries the linked server records.
    await shell.getByRole("button", { name: "選取元件", exact: true }).click()
    await shell
      .locator('[aria-label="選取元件"][aria-pressed="true"]')
      .waitFor()
    await guest.locator("#title").click()
    await shell.getByRole("textbox", { name: "修改意見" }).fill("儲存會失敗。")
    await shell.getByRole("button", { name: "送出留言", exact: true }).click()
    const saved = await waitFor(
      async () =>
        parse(await call("peck_annotations")).find(
          (a) => a.comment === "儲存會失敗。"
        ),
      "comment with server context"
    )
    assert.ok(
      parse(await call("peck_annotation_get", { id: saved.id })).context.some(
        (e) =>
          e.kind === "server" &&
          e.details.peckRequestId === linked.request.details.peckRequestId
      )
    )
    await waitFor(async () => {
      const body = await (
        await fetch(`${origin}/__peck/events?after=0`, {
          headers: { "x-peck-token": token },
        })
      ).json()
      const tagged = body.events.filter((e) => e.requestId === "smoke-1")
      return (
        tagged.some((e) => e.kind === "request" && e.status === 500) &&
        tagged.some(
          (e) =>
            e.kind === "console" && e.message.includes("workspace is locked")
        )
      )
    }, "tagged dev server events")
  } finally {
    pluginVite.kill()
  }
  await new Promise((done, fail) =>
    spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "build",
        "--config",
        configPath,
        "--logLevel",
        "error",
      ],
      { stdio: "inherit" }
    ).on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`vite build exited ${code}`))
    )
  )
  for (const file of await readdir(`${project}/dist`, { recursive: true }))
    if (/\.(js|html|css)$/.test(file))
      assert.ok(
        !(await readFile(`${project}/dist/${file}`, "utf8")).includes("__peck"),
        `Peck code in the production build: ${file}`
      )
  await rm(`${project}/${plugin.file.path}`)
  await rm(`${project}/dist`, { recursive: true })
  await writeFile(configPath, originalConfig)
  const files = (dir) =>
    readdir(dir, { recursive: true, withFileTypes: true }).then((entries) =>
      entries
        .filter((e) => e.isFile())
        .map((e) => `${e.parentPath.slice(dir.length)}/${e.name}`)
        .sort()
    )
  const original = await files(resolve("fixtures/vite-react"))
  assert.deepEqual(await files(project), original)
  for (const file of original)
    assert.equal(
      await readFile(`${project}${file}`, "utf8"),
      await readFile(resolve(`fixtures/vite-react${file}`), "utf8")
    )
  bridge = new Client({ name: "bridge-smoke", version: "1.0.0" })
  await bridge.connect(
    new StdioClientTransport({
      command: executablePath ?? process.execPath,
      args: [
        resolve(process.env.PECK_BRIDGE_PATH ?? "dist-electron/bridge.cjs"),
      ],
      env: {
        ...process.env,
        PECK_DATA_DIR: dataPath,
        ELECTRON_RUN_AS_NODE: "1",
        CLAUDECODE: "1",
        CLAUDE_CODE_SESSION_ID: claudeSession,
      },
    })
  )
  assert.equal((await bridge.listTools()).tools.length, 18)
  // The bridge registers its Claude Code conversation, and every result
  // tells an agent about pending comments.
  const bridged = await bridge.callTool({ name: "peck_status", arguments: {} })
  assert.ok(
    bridged.content.at(-1).text.includes("pending comment"),
    JSON.stringify(bridged.content.at(-1))
  )
  await bridge.callTool({
    name: "peck_watch_annotations",
    arguments: { timeoutMs: 200 },
  })
  // Codex sends its thread id in each call's _meta.
  const codex = new Client({ name: "codex-mcp-client", version: "1.0.0" })
  await codex.connect(
    new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${config.token}`,
          "x-peck-agent": encodeURIComponent(
            JSON.stringify({
              agent: "codex",
              cwd: process.cwd(),
              pid: process.pid,
            })
          ),
        },
      },
    })
  )
  await codex.callTool({
    name: "peck_status",
    arguments: {},
    _meta: { "x-codex-turn-metadata": { threadId: codexThread } },
  })
  await codex.close()
  const agents = parse(await call("peck_status")).agents
  const claude = agents.find((a) => a.sessionId === claudeSession)
  assert.equal(claude.agent, "claude-code")
  assert.equal(claude.cwd, process.cwd())
  assert.equal(claude.pid, process.pid)
  assert.ok(claude.lastWatch)
  assert.equal(agents.find((a) => a.sessionId === codexThread)?.agent, "codex")
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items[0].submenu.items[0].click()
  )
  await shell
    .getByText(`Claude Code · ${claudeSession.slice(0, 8)}`, { exact: true })
    .waitFor()
  assert.ok(
    !(await bridge.callTool({ name: "peck_status", arguments: {} })).isError
  )
  // Resume: a stopped conversation the user opted in is resumed with narrow
  // permissions on user feedback, and only then.
  const stoppedPid = await new Promise((done) => {
    const child = spawn(process.execPath, ["-e", ""])
    child.on("exit", () => done(child.pid))
  })
  const wakeProject = resolve("output/wake-project")
  await mkdir(wakeProject, { recursive: true })
  const register = async (sessionId, pid, cwd = wakeProject) => {
    const agent = new Client({ name: "wake-smoke", version: "1.0.0" })
    await agent.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "x-peck-agent": encodeURIComponent(
              JSON.stringify({ agent: "claude-code", sessionId, cwd, pid })
            ),
          },
        },
      })
    )
    await agent.callTool({ name: "peck_status", arguments: {} })
    await agent.close()
  }
  const fakeOut = resolve("output/fake-agents/calls.txt")
  const runs = async () =>
    (await readFile(fakeOut, "utf8").catch(() => ""))
      .split("call\n")
      .slice(1)
      .map((block) => {
        const [pid, cwd, ...args] = block.split("\n").slice(0, -2)
        return { pid: Number(pid), cwd, args }
      })
  const addFeedback = async (text) => {
    await shell.getByRole("tab", { name: /^留言/ }).click()
    const reply = shell.getByRole("textbox", { name: "回覆留言" }).first()
    await reply.fill(text)
    await reply.press("Enter")
    await shell.getByText(text, { exact: true }).first().waitFor()
  }
  const settle = () => new Promise((r) => setTimeout(r, 1500))
  const openMcpPanel = () =>
    app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click()
    )
  const toggle = async (sessionId, on) => {
    await openMcpPanel()
    const box = shell
      .locator(".agent-session", {
        hasText: `Claude Code · ${sessionId.slice(0, 8)}`,
      })
      .getByRole("checkbox")
    await box.click()
    await waitFor(
      async () => (await box.isChecked()) === on,
      `auto-resume ${on ? "on" : "off"}`
    )
  }
  await register(wakeSession, stoppedPid)
  // Off by default.
  await addFeedback("先不要自動接回。")
  await settle()
  assert.equal((await runs()).length, 0, "Resumed without opting in")
  // The home directory cannot be opted in.
  await register(homeSession, stoppedPid, homedir())
  await assert.rejects(
    shell.evaluate(
      (sessionId) =>
        window.peck.invoke("auto-resume", { sessionId, enabled: true }),
      homeSession
    )
  )
  await toggle(wakeSession, true)
  await shell
    .locator(".agent-command", { hasText: `--resume=${wakeSession}` })
    .waitFor()
  await addFeedback("現在可以接回了。")
  await waitFor(async () => (await runs()).length === 1, "resumed agent run")
  const [first] = await runs()
  assert.equal(first.cwd, wakeProject)
  // Parse the arguments the way Claude Code's CLI does: --allowedTools
  // takes several values and must not swallow the prompt.
  const cli = new Command()
    .exitOverride()
    .option("-p, --print")
    .option("-r, --resume [value]")
    .option("--permission-mode <mode>")
    .option("--permission-prompts <target>")
    .option("--allowedTools, --allowed-tools <tools...>")
    .argument("[prompt]")
  cli.parse(first.args, { from: "user" })
  assert.ok(cli.args[0]?.startsWith("New Peck comments are waiting."))
  assert.deepEqual(cli.opts(), {
    print: true,
    resume: wakeSession,
    permissionMode: "acceptEdits",
    permissionPrompts: "none",
    allowedTools: [
      "peck_status",
      "peck_watch_annotations",
      "peck_annotations",
      "peck_annotation_get",
      "peck_annotation_update",
      "peck_snapshot",
      "peck_screenshot",
      "peck_events",
    ].map((tool) => `mcp__peck__${tool}`),
  })
  assert.ok(!first.args.join(" ").includes("可以接回"))
  await waitFor(
    async () =>
      parse(await call("peck_events", { kind: "system" })).some((e) =>
        e.message.startsWith(
          `Resumed claude-code session ${wakeSession.slice(0, 8)}`
        )
      ),
    "resume system event"
  )
  // An agent putting a comment back to pending is not user feedback.
  const pendingItem = parse(await call("peck_annotations")).find(
    (a) => a.status === "pending"
  )
  await call("peck_annotation_update", {
    id: pendingItem.id,
    status: "pending",
    reply: "Blocked: needs the user.",
  })
  await settle()
  assert.equal((await runs()).length, 1, "An agent status change resumed")
  // A live conversation in the same directory blocks a second agent.
  await register(liveSession, process.pid)
  await addFeedback("同一個專案有對話在跑。")
  await settle()
  assert.equal((await runs()).length, 1, "Resumed beside a live conversation")
  await register(liveSession, stoppedPid)
  // Turning it off, or quitting Peck, stops a running agent.
  await writeFile(`${fakeOut}.sleep`, "")
  await addFeedback("跑久一點。")
  await waitFor(async () => (await runs()).length === 2, "second agent run")
  const sleeper = (await runs())[1].pid
  await toggle(wakeSession, false)
  await waitFor(() => {
    try {
      process.kill(sleeper, 0)
      return false
    } catch {
      return true
    }
  }, "stopped agent after opting out")
  await toggle(wakeSession, true)
  await addFeedback("關掉 Peck 也要停。")
  await waitFor(async () => (await runs()).length === 3, "third agent run")
  quitSleeper = (await runs())[2].pid
  const metrics = await shell.evaluate(() => window.peck.invoke("metrics"))
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        coldStartMs,
        revealMs,
        tools: tools.tools.length,
        toolbarHeights: sizes,
        metrics,
        checks: [
          "real Electron navigation",
          "HTTP/Origin/Host authentication",
          "console and 422 response capture",
          "header and JSON redaction",
          "DOM selection",
          "annotation screenshot and frozen context",
          "MCP long-poll delivery",
          "reopened feedback advances the watch cursor",
          "reply/status UI synchronization",
          "background state preservation",
          "compact layout",
          "single header row with the page title",
          "one page per window",
          "trusted click, type, and key input",
          "waiting for navigation, text, selector, and network idle",
          "event cursor",
          "dev server MCP availability",
          "fresh screenshots of hidden windows",
          "after screenshots in agent replies",
          "source locations from attributes and React owner stacks",
          "removable dev plugin with tagged server events",
          "dev server records linked to network records",
          "agent session registry and pending comment hints",
          "opt-in resume of a stopped agent conversation",
          "bundled stdio bridge",
        ],
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      status: "PASS",
      coldStartMs,
      revealMs,
      tools: tools.tools.length,
    })
  )
} finally {
  vite?.kill()
  await bridge?.close()
  await client?.close()
  await app.close()
}
// Quitting Peck stopped the agent it started.
await waitFor(() => {
  try {
    process.kill(quitSleeper, 0)
    return false
  } catch {
    return true
  }
}, "stopped agent after quitting Peck")
await rm(`${resolve("output/fake-agents/calls.txt")}.sleep`, { force: true })
const restarted = await electron.launch(launchOptions)
try {
  const shell = await shellOf(restarted)
  await shell.getByText("把標題改成中文，字小一點。", { exact: true }).waitFor()
  console.log("PASS: SQLite annotation persistence after restart")
  // Registered conversations persist, and can be removed.
  await restarted.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items[0].submenu.items[0].click()
  )
  const session = shell.locator(".agent-session", {
    hasText: `Claude Code · ${claudeSession.slice(0, 8)}`,
  })
  await session.waitFor()
  await session.getByRole("button", { name: "移除" }).click()
  await session.waitFor({ state: "detached" })
  console.log("PASS: agent session registry persists and clears")
} finally {
  await restarted.close()
}
