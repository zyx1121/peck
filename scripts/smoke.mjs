import { _electron as electron } from "playwright"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { request } from "node:http"

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
let client, bridge
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
try {
  console.log("Electron launched; waiting for shell")
  const shell = await app.firstWindow()
  await shell.waitForSelector(".workspace", { timeout: 30000 })
  console.log("Shell loaded; waiting for guest")
  const guest = await waitFor(
    () => Promise.resolve(app.windows().find((p) => p.url().endsWith("/demo"))),
    "demo page"
  )
  await guest.locator("#headline").waitFor()
  const coldStartMs = Date.now() - started
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
  assert.equal(tools.tools.length, 12)
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
  assert.equal(parse(await call("peck_annotation_get", { id: item.id })).status, "pending")
  const beforeTabs = parse(await call("peck_tabs")).length
  await call("peck_tabs", {
    action: "open",
    url: config.url.replace("/mcp", "/demo"),
  })
  const afterTabs = parse(await call("peck_tabs"))
  assert.equal(afterTabs.length, beforeTabs + 1)
  await call("peck_tabs", { action: "close", tabId: afterTabs.at(-1).id })
  bridge = new Client({ name: "bridge-smoke", version: "1.0.0" })
  await bridge.connect(
    new StdioClientTransport({
      command: executablePath ?? process.execPath,
      args: [resolve(process.env.PECK_BRIDGE_PATH ?? "dist-electron/bridge.cjs")],
      env: { ...process.env, PECK_DATA_DIR: dataPath, ELECTRON_RUN_AS_NODE: "1" },
    })
  )
  assert.equal((await bridge.listTools()).tools.length, 12)
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
          "multiple tabs",
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
  await bridge?.close()
  await client?.close()
  await app.close()
}
const restarted = await electron.launch(launchOptions)
try {
  const shell = await restarted.firstWindow()
  await shell.getByText("把標題改成中文，字小一點。", { exact: true }).waitFor()
  console.log("PASS: SQLite annotation persistence after restart")
} finally {
  await restarted.close()
}
