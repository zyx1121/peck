import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
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
  let client: Client | undefined
  let previous = ""
  async function connect() {
    let config: { url: string; token: string }
    try {
      config = JSON.parse(readFileSync(join(dir, "connection.json"), "utf8"))
    } catch {
      throw new Error("Open Peck before connecting its MCP.")
    }
    const identity = config.url + config.token
    if (!client || previous !== identity) {
      await client?.close()
      client = new Client({ name: "peck-bridge", version: "0.1.0-demo.1" })
      previous = ""
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
        })
      )
      previous = identity
    }
    return client
  }
  const server = new Server(
    { name: "peck", version: "0.1.0-demo.1" },
    { capabilities: { tools: {} } }
  )
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    (await connect()).listTools()
  )
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
