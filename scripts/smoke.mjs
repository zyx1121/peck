import { _electron as electron } from "playwright"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { request } from "node:http"
import { createServer } from "node:net"
import { spawn } from "node:child_process"

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
  env: { ...process.env, PECK_DATA_DIR: dataPath, PECK_PORT: "0" },
  timeout: 30000,
}
await mkdir(output, { recursive: true })
await rm(dataPath, { recursive: true, force: true })
const started = Date.now()
console.log("Launching Electron")
const app = await electron.launch(launchOptions)
app.process().stderr.on("data", (d) => {
  if (/Error|Exception|failed/i.test(d.toString())) process.stderr.write(d)
})
let client, bridge, vite
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
  assert.equal(tools.tools.length, 17)
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
  await shell.getByText("還需要調整，重新開啟", { exact: true }).click()
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
  const port = await new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
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
    () => fetch(fixtureUrl).then((r) => r.ok, () => false),
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
    { file: "/src/App.jsx", line: 11, column: undefined, component: "Header", via: "react" }
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
      },
    })
  )
  assert.equal((await bridge.listTools()).tools.length, 17)
  assert.ok(
    !(await bridge.callTool({ name: "peck_status", arguments: {} })).isError
  )
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
const restarted = await electron.launch(launchOptions)
try {
  const shell = await shellOf(restarted)
  await shell.getByText("把標題改成中文，字小一點。", { exact: true }).waitFor()
  console.log("PASS: SQLite annotation persistence after restart")
} finally {
  await restarted.close()
}
