import type { WebContents } from "electron"
import { evaluate, type Send } from "./input"

export type WaitCondition =
  | { until: "load" }
  | { until: "navigation" }
  | { until: "networkIdle"; idleMs: number }
  | {
      until: "selector"
      selector: string
      state: "attached" | "visible" | "hidden" | "detached"
    }
  | { until: "text"; text: string }
  | { until: "url"; url: string }

// Per-window page activity that wait conditions read.
export interface Activity {
  // In-flight HTTP requests by id and start time. EventSource streams are
  // never added, and requests open longer than 30 s count as streams.
  pending: Map<string, number>
  idleSince: number
  navigatedAt: number
  actedAt: number
}

export const describe = (c: WaitCondition) =>
  c.until === "selector"
    ? `selector ${c.selector} to be ${c.state}`
    : c.until === "text"
      ? `text "${c.text}"`
      : c.until === "url"
        ? `a URL containing "${c.url}"`
        : c.until

function expression(c: WaitCondition) {
  if (c.until === "text")
    return `!!document.body && document.body.innerText.includes(${JSON.stringify(c.text)})`
  if (c.until === "url")
    return `location.href.includes(${JSON.stringify(c.url)})`
  if (c.until !== "selector") throw new Error("Not a page condition")
  return `(() => {
    const el = document.querySelector(${JSON.stringify(c.selector)})
    const visible = !!el && (() => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"
    })()
    return { attached: !!el, detached: !el, visible, hidden: !visible }[${JSON.stringify(c.state)}]
  })()`
}

export async function met(
  c: WaitCondition,
  send: Send,
  contents: WebContents,
  activity: Activity,
  since: number
) {
  const now = Date.now()
  switch (c.until) {
    case "load":
      return !contents.isLoading()
    case "navigation":
      return activity.navigatedAt >= since && !contents.isLoading()
    case "networkIdle": {
      const open = [...activity.pending.values()].filter((t) => now - t < 30000)
      return (
        !contents.isLoading() &&
        !open.length &&
        now - activity.idleSince >= c.idleMs
      )
    }
    default:
      try {
        return (await evaluate(send, expression(c))) === true
      } catch {
        // The document can be swapping during a navigation.
        return false
      }
  }
}
