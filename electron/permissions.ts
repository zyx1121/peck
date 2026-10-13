import {
  dialog,
  session as electronSession,
  systemPreferences,
  type BrowserWindow,
  type WebContents,
} from "electron"
import type { Store } from "./store"

// Site permissions, as a browser asks for them: the first request from an
// origin shows a sheet on its window, and the answer is kept per origin in
// SQLite until the user changes it from the menu. The origin is always the
// top-level page's.
export const KINDS = {
  camera: "Camera",
  microphone: "Microphone",
  location: "Location",
  notifications: "Notifications",
  clipboard: "Clipboard",
  midi: "MIDI Devices",
} as const
export type Kind = keyof typeof KINDS
const ASK: Record<Kind, string> = {
  camera: "use your camera",
  microphone: "use your microphone",
  location: "know your location",
  notifications: "show notifications",
  clipboard: "read your clipboard",
  midi: "use your MIDI devices",
}
// Granted without asking, as in Chrome.
const ALWAYS = new Set([
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "clipboard-sanitized-write",
])
function kindsOf(permission: string, mediaTypes: string[] = []): Kind[] {
  switch (permission) {
    case "media":
      return mediaTypes.flatMap((t): Kind[] =>
        t === "audio" ? ["microphone"] : t === "video" ? ["camera"] : []
      )
    case "geolocation":
      return ["location"]
    case "notifications":
      return ["notifications"]
    case "clipboard-read":
      return ["clipboard"]
    case "midi":
    case "midiSysex":
      return ["midi"]
    default:
      return []
  }
}
export function webOrigin(url: string) {
  try {
    const { protocol, origin } = new URL(url)
    return protocol === "http:" || protocol === "https:" ? origin : ""
  } catch {
    return ""
  }
}
const list = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

export function setupPermissions(
  store: Store,
  windowOf: (contents: WebContents) => BrowserWindow | undefined,
  notify: (contents: WebContents, message: string) => void
) {
  const pending = new Map<string, Promise<boolean>>()
  // The user's answer for these kinds, asking for the undecided ones.
  async function ask(contents: WebContents, origin: string, kinds: Kind[]) {
    const stored = kinds.map((k) => store.permission(origin, k))
    if (stored.includes(false)) return false
    const open = kinds.filter((_, i) => stored[i] === undefined)
    if (!open.length) return true
    const key = `${origin} ${open.join(",")}`
    let answer = pending.get(key)
    if (!answer) {
      answer = prompt(contents, origin, open).finally(() => pending.delete(key))
      pending.set(key, answer)
    }
    return answer
  }
  async function prompt(contents: WebContents, origin: string, kinds: Kind[]) {
    // The sheet belongs to the page's window. A hidden window cannot show
    // it, so the request fails without keeping an answer.
    const window = windowOf(contents)
    if (!window || window.isDestroyed() || !window.isVisible()) return false
    const leave = new AbortController()
    const close = () => leave.abort()
    contents.once("did-navigate", close)
    contents.once("destroyed", close)
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: "question",
        message: `${new URL(origin).host} wants to ${list(kinds.map((k) => ASK[k]))}`,
        detail: "Change this later from the More menu.",
        buttons: ["Allow", "Don't Allow"],
        defaultId: 0,
        cancelId: 1,
        signal: leave.signal,
      })
      if (leave.signal.aborted) return false
      const allowed = response === 0
      for (const kind of kinds) store.setPermission(origin, kind, allowed)
      return allowed
    } catch {
      return false
    } finally {
      if (!contents.isDestroyed()) {
        contents.off("did-navigate", close)
        contents.off("destroyed", close)
      }
    }
  }
  // macOS also asks once per app for the camera and microphone.
  async function systemAccess(contents: WebContents, kinds: Kind[]) {
    if (process.platform !== "darwin") return true
    for (const kind of kinds) {
      if (kind !== "camera" && kind !== "microphone") continue
      const status = systemPreferences.getMediaAccessStatus(kind)
      const granted =
        status === "granted" ||
        (status === "not-determined" &&
          (await systemPreferences.askForMediaAccess(kind)))
      if (!granted) {
        notify(
          contents,
          `Allow Peck in System Settings > Privacy & Security > ${KINDS[kind]}`
        )
        return false
      }
    }
    return true
  }
  const session = electronSession.fromPartition("persist:peck")
  session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (ALWAYS.has(permission)) return callback(true)
      // Answers belong to the site in the address bar, as in Chrome. An
      // iframe asks as the page that embeds it, so a site cannot borrow
      // another site's answer by framing it.
      const origin = webOrigin(contents.getURL())
      const kinds = kindsOf(
        permission,
        "mediaTypes" in details ? details.mediaTypes : undefined
      )
      if (!origin || !kinds.length) return callback(false)
      void ask(contents, origin, kinds)
        .then(
          async (allowed) => allowed && (await systemAccess(contents, kinds))
        )
        .then(callback, () => callback(false))
    }
  )
  // What the page sees before it asks (navigator.permissions and the like).
  // Undecided reads as granted so the page goes on to request it, except
  // notifications, which a page would then send without asking.
  session.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) => {
      if (ALWAYS.has(permission)) return true
      const origin = webOrigin(
        contents?.getURL() || details.embeddingOrigin || requestingOrigin
      )
      const kinds = kindsOf(permission, [details.mediaType ?? ""])
      if (!origin || !kinds.length) return false
      return kinds.every(
        (k) => store.permission(origin, k) ?? k !== "notifications"
      )
    }
  )
}
