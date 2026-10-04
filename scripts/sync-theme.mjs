import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const source = "https://ui.zyx.tw/r/theme.json"
const root = new URL("../", import.meta.url)

function rule(selector, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected an object for ${selector}`)
  const body = Object.entries(value)
    .map(([key, item]) => {
      if (typeof item === "object") return rule(key, item)
      if (typeof item !== "string" && typeof item !== "number")
        throw new Error(`Invalid CSS value: ${key}`)
      return `${key}: ${item};`
    })
    .join("\n")
  return `${selector} {\n${body
    .split("\n")
    .map((line) => "  " + line)
    .join("\n")}\n}`
}

export function renderTheme(theme) {
  if (theme.name !== "theme" || theme.type !== "registry:theme")
    throw new Error("Expected the ui.zyx.tw theme registry item")
  const sections = [
    "/* Generated from https://ui.zyx.tw/r/theme.json. Run npm run theme:sync. */",
  ]
  for (const [mode, vars] of Object.entries(theme.cssVars ?? {})) {
    const selector = { light: ":root", dark: ".dark", theme: "@theme inline" }[
      mode
    ]
    if (!selector) throw new Error(`Unsupported theme mode: ${mode}`)
    sections.push(
      rule(
        selector,
        Object.fromEntries(
          Object.entries(vars).map(([key, value]) => [`--${key}`, value])
        )
      )
    )
  }
  for (const [selector, value] of Object.entries(theme.css ?? {}))
    sections.push(rule(selector, value))
  return sections.join("\n\n") + "\n"
}

async function sync() {
  const args = process.argv.slice(2)
  if (args.length && (args[0] !== "--file" || args.length !== 2))
    throw new Error("Usage: sync-theme.mjs [--file theme.json]")
  let raw
  if (args.length) raw = await readFile(resolve(args[1]), "utf8")
  else {
    const response = await fetch(source, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Theme fetch failed: ${response.status}`)
    raw = await response.text()
  }
  const css = renderTheme(JSON.parse(raw))
  const sha256 = createHash("sha256").update(raw).digest("hex")
  await writeFile(new URL("src/zyx-theme.css", root), css)
  await writeFile(
    new URL("theme-source.json", root),
    JSON.stringify({ source, sha256 }, null, 2) + "\n"
  )
  console.log(`Updated theme from ${source} (${sha256.slice(0, 12)})`)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  sync().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
