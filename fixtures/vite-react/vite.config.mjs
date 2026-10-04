import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// A dev-only API like a broken backend route: /api/fail logs a server
// error and answers 500.
function api() {
  return {
    name: "fixture-api",
    configureServer(server) {
      server.middlewares.use("/api/fail", (req, res) => {
        console.error("fixture failure: workspace is locked")
        res.statusCode = 500
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ error: "locked" }))
      })
    },
  }
}

// A React dev app for Peck's smoke test. It reuses Peck's own dependencies.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), api()],
  logLevel: "warn",
})
