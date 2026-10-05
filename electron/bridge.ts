import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

const VERSION = "0.1.0-demo.13"
const LAUNCH_TIMEOUT_MS = 30000
// Peck starts with the user's basic environment, not the agent's: no
// ELECTRON_RUN_AS_NODE (it would start as Node.js and exit), session ids,
// or the agent's telemetry settings.
const APP_ENV =
  /^(HOME|USER|LOGNAME|SHELL|PATH|TMPDIR|TEMP|TMP|LANG|LC_\w+|TZ|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_\w+|DBUS_SESSION_BUS_ADDRESS|SYSTEMROOT|WINDIR|APPDATA|LOCALAPPDATA|USERPROFILE|COMSPEC|PATHEXT|PECK_\w+)$/i
function appEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => APP_ENV.test(key))
  )
}
interface Connection {
  url: string
  token: string
  pid?: number
}
async function main() {
  const dir =
    process.env.PECK_DATA_DIR ??
    (process.platform === "darwin"
      ? join(homedir(), "Library/Application Support/Peck")
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? homedir(), "Peck")
        : join(
            process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
            "Peck"
          ))
  // The agent CLI that started this bridge, so Peck can find its
  // conversation later. Codex sends its thread id in each call's _meta.
  const agentHeader = () => {
    const client = server.getClientVersion()?.name ?? ""
    return encodeURIComponent(
      JSON.stringify({
        agent:
          process.env.CLAUDECODE === "1"
            ? "claude-code"
            : /codex/i.test(client)
              ? "codex"
              : client || "unknown",
        sessionId: process.env.CLAUDE_CODE_SESSION_ID,
        cwd: process.cwd(),
        pid: process.ppid,
        client,
      })
    )
  }
  // The running app's address. A file left by a crashed Peck does not count.
  function running(): Connection | undefined {
    try {
      const config: Connection = JSON.parse(
        readFileSync(join(dir, "connection.json"), "utf8")
      )
      if (config.pid) process.kill(config.pid, 0)
      return config
    } catch {
      return undefined
    }
  }
  // Open Peck in the background and wait for its MCP. On macOS the packaged
  // app opens through LaunchServices without taking focus; open passes its
  // own environment on. "-n" starts it even when LaunchServices still lists a
  // closed instance; a second Peck on the same data quits on its
  // single-instance lock. Arguments after the bridge path go to Peck.
  let launching: Promise<Connection> | undefined
  function launch() {
    // Plain Node.js cannot start the app.
    if (!process.versions.electron)
      return Promise.reject(new Error("Open Peck before connecting its MCP."))
    launching ??= (async () => {
      let failure = ""
      const extra = process.argv.slice(2)
      const bundle = /^(.+?\.app)\/Contents\/MacOS\//.exec(
        process.execPath
      )?.[1]
      const packaged = __dirname.includes(".asar")
      if (process.platform === "darwin" && bundle && packaged) {
        const opener = spawn(
          "/usr/bin/open",
          ["-g", "-n", bundle, ...(extra.length ? ["--args", ...extra] : [])],
          { stdio: ["ignore", "pipe", "pipe"], env: appEnv() }
        )
        opener.stdout?.on("data", (data) => (failure += String(data)))
        opener.stderr?.on("data", (data) => (failure += String(data)))
        opener.on("error", (error) => (failure += String(error)))
      } else
        spawn(
          process.execPath,
          [...(packaged ? [] : [join(__dirname, "..")]), ...extra],
          { detached: true, stdio: "ignore", env: appEnv() }
        )
          .on("error", (error) => (failure += String(error)))
          .unref()
      const deadline = Date.now() + LAUNCH_TIMEOUT_MS
      while (Date.now() < deadline) {
        const config = running()
        if (config) return config
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(
        `Peck did not start${failure ? ` (${failure.trim()})` : ""}. Open Peck and try again.`
      )
    })().finally(() => {
      launching = undefined
    })
    return launching
  }
  let client: Client | undefined
  let previous = ""
  async function connect() {
    const config = running() ?? (await launch())
    const identity = config.url + config.token
    if (!client || previous !== identity) {
      await client?.close()
      client = new Client({ name: "peck-bridge", version: VERSION })
      previous = ""
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${config.token}`,
              "x-peck-agent": agentHeader(),
            },
          },
        })
      )
      previous = identity
    }
    return client
  }
  // The last tool list, so starting an agent session does not open Peck.
  const toolsFile = join(dir, "tools.json")
  function cachedTools(): Tool[] | undefined {
    try {
      const cache = JSON.parse(readFileSync(toolsFile, "utf8"))
      return cache.version === VERSION ? cache.tools : undefined
    } catch {
      return undefined
    }
  }
  const server = new Server(
    { name: "peck", version: VERSION },
    { capabilities: { tools: {} } }
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = running() ? undefined : cachedTools()
    if (tools) return { tools }
    const result = await (await connect()).listTools()
    try {
      writeFileSync(
        toolsFile,
        JSON.stringify({ version: VERSION, tools: result.tools }),
        { mode: 0o600 }
      )
    } catch {
      /* The list still works without the cache. */
    }
    return result
  })
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    (await connect()).callTool(request.params, undefined, {
      signal: extra.signal,
      timeout: 60000,
    })
  )
  await server.connect(new StdioServerTransport())
}
main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
