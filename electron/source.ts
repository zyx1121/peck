import {
  FlattenMap,
  originalPositionFor,
  type TraceMap,
} from "@jridgewell/trace-mapping"
import { evaluate, type Send } from "./input"
import type { SourceLocation } from "../src/shared"

// Resolve a picked element to the code that rendered it. Build-time
// attributes (code-inspector-plugin, data-source) win; otherwise a React
// dev build's owner stack is mapped back through the dev server's source
// maps. Next.js server components are resolved by the dev server's own
// stack frame endpoint. Nothing needs to change in the user's project.

// Runs in the page's main world, where React internals are visible. The
// picker marks the element with a one-time nonce attribute.
const probe = (nonce: string) => `(() => {
  const el = document.querySelector('[data-peck-picked="${nonce}"]')
  if (!el) return null
  el.removeAttribute("data-peck-picked")
  const tagged = el.closest("[data-insp-path],[data-source]")
  const attribute = tagged
    ? tagged.getAttribute("data-insp-path") || tagged.getAttribute("data-source")
    : null
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  const fiber = key ? el[key] : null
  const owner = fiber && fiber._debugOwner
  const component = owner
    ? (owner.type && (owner.type.displayName || owner.type.name)) || owner.name || null
    : null
  const stack = fiber && fiber._debugStack ? String(fiber._debugStack.stack).slice(0, 8000) : ""
  return { attribute, component, stack }
})()`

// Frames from React itself and from dependencies are skipped, including
// Turbopack chunks named after node_modules paths.
const internal =
  /\/node_modules[/_]|\/\.vite\/deps\/|react[-_]stack[-_]bottom[-_]frame|jsxDEV|jsx-dev-runtime|fakeJSXCallSite/

export function userFrame(stack: string) {
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim()
    const match = line.match(
      /^at (?:(.+?) \()?((?:https?|about):\/\/\S+?):(\d+):(\d+)\)?$/
    )
    if (!match || internal.test(line)) continue
    return {
      name: match[1],
      url: match[2],
      line: Number(match[3]),
      column: Number(match[4]),
    }
  }
}

export function parseAttribute(value: string): SourceLocation {
  const match = value.match(/^(.*?):(\d+):(\d+)(?::[^:]*)?$/)
  return match
    ? {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        via: "attribute",
      }
    : { file: value, via: "attribute" }
}

// Show a dev server path the way the project names it: /src/App.jsx for a
// module URL, or the file system path behind Vite's /@fs/ prefix.
export function cleanPath(value: string) {
  let path = value
  try {
    if (/^https?:/.test(value)) path = new URL(value).pathname
  } catch {
    /* Keep the raw value. */
  }
  return decodeURIComponent(
    path
      .replace(/^file:\/\//, "")
      .replace(/^\/@fs\//, "/")
      .replace(/[?#].*$/, "")
  )
}

export type Fetch = (url: string, init?: RequestInit) => Promise<string>
const maps = new Map<string, Promise<TraceMap | null>>()

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",")
  const meta = url.slice(5, comma)
  const body = url.slice(comma + 1)
  return meta.endsWith(";base64")
    ? Buffer.from(body, "base64").toString("utf8")
    : decodeURIComponent(body)
}

async function loadMap(fetchText: Fetch, url: string) {
  const script = await fetchText(url)
  const reference = [...script.matchAll(/\/\/[#@] sourceMappingURL=(\S+)/g)].at(
    -1
  )?.[1]
  if (!reference) return null
  const mapUrl = new URL(reference, url)
  if (mapUrl.protocol !== "data:" && mapUrl.origin !== new URL(url).origin)
    return null
  const json = reference.startsWith("data:")
    ? decodeDataUrl(reference)
    : await fetchText(mapUrl.toString())
  // Turbopack serves sectioned index maps; FlattenMap reads both kinds.
  return FlattenMap(json, url)
}

function sourceMap(fetchText: Fetch, url: string) {
  let map = maps.get(url)
  if (!map) {
    map = loadMap(fetchText, url).catch(() => null)
    maps.set(url, map)
    if (maps.size > 50) maps.delete(maps.keys().next().value!)
  }
  return map
}

// Next.js maps React server component frames on the dev server, where the
// server bundles and their source maps live.
async function serverFrame(
  fetchText: Fetch,
  origin: string,
  frame: { name?: string; url: string; line: number; column: number }
) {
  const body = JSON.stringify({
    frames: [
      {
        file: frame.url,
        methodName: frame.name ?? "",
        arguments: [],
        line1: frame.line,
        column1: frame.column,
      },
    ],
    isServer: true,
    isEdgeServer: frame.url.includes("/Edge/"),
    isAppDirectory: true,
  })
  const result = JSON.parse(
    await fetchText(`${origin}/__nextjs_original-stack-frames`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
  )[0]
  const original = result?.value?.originalStackFrame
  if (result?.status !== "fulfilled" || !original?.file || !original.line1)
    return
  return {
    file: String(original.file),
    line: Number(original.line1),
    column: original.column1 ? Number(original.column1) : undefined,
  }
}

// origin is the page origin known to Peck. Stack text comes from the page,
// so Peck only fetches scripts and maps from that origin.
export async function locate(
  send: Send,
  fetchText: Fetch,
  nonce: string,
  origin: string
): Promise<SourceLocation | undefined> {
  const found = (await evaluate(send, probe(nonce))) as {
    attribute: string | null
    component: string | null
    stack: string
  } | null
  if (!found) return
  const component = found.component ?? undefined
  if (found.attribute) return { ...parseAttribute(found.attribute), component }
  const frame = userFrame(found.stack)
  if (!frame) return
  if (frame.url.startsWith("about://")) {
    const original = await serverFrame(fetchText, origin, frame).catch(
      () => undefined
    )
    return original ? { ...original, component, via: "react" } : undefined
  }
  if (new URL(frame.url).origin !== origin) return
  const map = await sourceMap(fetchText, frame.url)
  const position = map
    ? originalPositionFor(map, { line: frame.line, column: frame.column - 1 })
    : undefined
  return position?.source
    ? {
        file: cleanPath(position.source),
        line: position.line ?? undefined,
        column: position.column === null ? undefined : position.column + 1,
        component,
        via: "react",
      }
    : {
        file: cleanPath(frame.url),
        line: frame.line,
        column: frame.column,
        component,
        via: "react",
      }
}
