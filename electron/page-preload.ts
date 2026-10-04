import { ipcRenderer } from "electron"
let picking = false
let overlay: HTMLDivElement | null = null
let label: HTMLDivElement | null = null
function selector(element: Element) {
  if (element.id) return `#${CSS.escape(element.id)}`
  const path: string[] = []
  for (
    let node: Element | null = element;
    node && path.length < 6;
    node = node.parentElement
  ) {
    if (node.id) {
      path.unshift(`#${CSS.escape(node.id)}`)
      break
    }
    const parent: Element | null = node.parentElement
    const siblings = parent
      ? [...parent.children].filter((x) => x.tagName === node!.tagName)
      : []
    path.unshift(
      node.localName +
        (siblings.length > 1
          ? `:nth-of-type(${siblings.indexOf(node) + 1})`
          : "")
    )
  }
  return path.join(" > ")
}
function cleanup() {
  overlay?.remove()
  label?.remove()
  overlay = label = null
}
function highlight(element: Element) {
  if (!overlay) {
    overlay = document.createElement("div")
    label = document.createElement("div")
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #b5f5d0;background:rgba(181,245,208,.10);border-radius:4px;"
    label!.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;background:#132b20;color:#dcffe9;padding:4px 8px;font:12px/20px monospace;border-radius:4px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    document.documentElement.append(overlay, label!)
  }
  const r = element.getBoundingClientRect()
  Object.assign(overlay.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  })
  label!.textContent = `${selector(element)}  ${Math.round(r.width)} × ${Math.round(r.height)}`
  Object.assign(label!.style, {
    left: `${Math.max(0, r.x)}px`,
    top: `${r.y > 32 ? r.y - 32 : r.bottom + 4}px`,
  })
}
ipcRenderer.on("peck:pick", (_, active: boolean) => {
  picking = active
  if (!active) cleanup()
})
window.addEventListener(
  "mousemove",
  (event) => {
    if (picking && event.target instanceof Element) highlight(event.target)
  },
  true
)
window.addEventListener(
  "click",
  (event) => {
    if (!picking || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = event.target
    // A one-time marker lets the main world find this exact element to
    // resolve its source; it is removed there, or here as a fallback.
    const nonce = crypto.randomUUID()
    element.setAttribute("data-peck-picked", nonce)
    setTimeout(() => {
      if (element.getAttribute("data-peck-picked") === nonce)
        element.removeAttribute("data-peck-picked")
    }, 3000)
    const r = element.getBoundingClientRect()
    const css = getComputedStyle(element)
    const styles = Object.fromEntries(
      [
        "display",
        "position",
        "color",
        "background-color",
        "font-size",
        "font-family",
        "padding",
        "margin",
        "gap",
        "border-radius",
      ].map((k) => [k, css.getPropertyValue(k)])
    )
    ipcRenderer.send("peck:picked", {
      selector: selector(element),
      tag: element.localName,
      text: (element.textContent ?? "").trim().slice(0, 1200),
      url: location.href,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      styles,
      source: element.getAttribute("data-source") ?? undefined,
      nonce,
    })
    picking = false
    cleanup()
  },
  true
)
window.addEventListener(
  "keydown",
  (event) => {
    if (picking && event.key === "Escape") {
      picking = false
      cleanup()
      ipcRenderer.send("peck:pick-cancel")
    }
  },
  true
)
