// Trusted input through CDP. Synthetic DOM events such as element.click()
// miss focus, keyboard, and pointer behavior, so agents drive pages with
// these instead.

export type Send = (
  method: string,
  params?: Record<string, unknown>
) => Promise<Record<string, unknown>>

export async function evaluate(send: Send, expression: string) {
  const response = (await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: 10000,
  })) as {
    result: { value?: unknown }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text
    )
  return response.result.value ?? null
}

const modifierBits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const
export type Modifier = keyof typeof modifierBits
const modifierOrder: Modifier[] = ["Shift", "Control", "Alt", "Meta"]
const mask = (modifiers: Iterable<Modifier>) =>
  [...new Set(modifiers)].reduce((bits, m) => bits | modifierBits[m], 0)

interface Key {
  key: string
  code: string
  keyCode: number
  text?: string
}
const named: Record<string, Key> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
}
const modifierKeys: Record<Modifier, Key> = {
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
}
// macOS Chromium takes editing behavior from native key bindings, which CDP
// key events bypass, so these shortcuts must carry their editing command.
const macCommands: Record<string, string> = {
  Backspace: "deleteBackward",
  Delete: "deleteForward",
  Enter: "insertNewline",
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
  "Shift+ArrowLeft": "moveLeftAndModifySelection",
  "Shift+ArrowRight": "moveRightAndModifySelection",
  "Shift+ArrowUp": "moveUpAndModifySelection",
  "Shift+ArrowDown": "moveDownAndModifySelection",
  "Alt+ArrowLeft": "moveWordLeft",
  "Alt+ArrowRight": "moveWordRight",
  "Meta+ArrowLeft": "moveToLeftEndOfLine",
  "Meta+ArrowRight": "moveToRightEndOfLine",
  "Meta+ArrowUp": "moveToBeginningOfDocument",
  "Meta+ArrowDown": "moveToEndOfDocument",
  "Alt+Backspace": "deleteWordBackward",
  "Meta+Backspace": "deleteToBeginningOfLine",
  "Meta+KeyA": "selectAll",
  "Meta+KeyZ": "undo",
  "Shift+Meta+KeyZ": "redo",
}

function character(char: string, shift = false): Key | undefined {
  if (/^[a-z]$/i.test(char)) {
    const upper = char.toUpperCase()
    const key = shift ? upper : char
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key }
  }
  if (/^[0-9]$/.test(char))
    return {
      key: char,
      code: `Digit${char}`,
      keyCode: char.charCodeAt(0),
      text: char,
    }
  if (char === " ") return named.Space
}

async function stroke(send: Send, key: Key, held: Modifier[] = []) {
  const modifiers = mask(held)
  // Shortcuts with Control, Alt, or Meta do not insert text.
  const text = held.some((m) => m !== "Shift") ? undefined : key.text
  const shortcut = [
    ...modifierOrder.filter((m) => held.includes(m)),
    key.code,
  ].join("+")
  const command =
    process.platform === "darwin" ? macCommands[shortcut] : undefined
  const base = {
    modifiers,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
  }
  await send("Input.dispatchKeyEvent", {
    ...base,
    type: text ? "keyDown" : "rawKeyDown",
    text,
    unmodifiedText: text,
    ...(command ? { commands: [command] } : {}),
  })
  await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" })
}

export function parseKeys(input: string) {
  const parts = input.split("+").map((p) => p.trim())
  const name = parts.pop() ?? ""
  const held: Modifier[] = []
  for (const part of parts) {
    const modifier =
      (
        {
          Cmd: "Meta",
          Command: "Meta",
          Ctrl: "Control",
          Option: "Alt",
        } as Record<string, Modifier>
      )[part] ?? (part in modifierBits ? (part as Modifier) : undefined)
    if (!modifier) throw new Error(`Unknown modifier: ${part}`)
    held.push(modifier)
  }
  const shift = held.includes("Shift")
  // Shortcuts such as Meta+A report the lowercase key, as a keyboard does.
  const char =
    name.length !== 1 ? "" : held.length && !shift ? name.toLowerCase() : name
  const key = named[name] ?? character(char, shift)
  if (!key) throw new Error(`Unknown key: ${name}`)
  return { key, held }
}

export async function press(send: Send, input: string) {
  const { key, held } = parseKeys(input)
  const down: Modifier[] = []
  for (const m of held) {
    down.push(m)
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      modifiers: mask(down),
      key: modifierKeys[m].key,
      code: modifierKeys[m].code,
      windowsVirtualKeyCode: modifierKeys[m].keyCode,
    })
  }
  await stroke(send, key, held)
  for (const m of [...held].reverse()) {
    down.pop()
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: mask(down),
      key: modifierKeys[m].key,
      code: modifierKeys[m].code,
      windowsVirtualKeyCode: modifierKeys[m].keyCode,
    })
  }
}

// Scroll an element into view and return its center if nothing covers it.
function locate(selector: string) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return { error: "No element matches the selector" }
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return { error: "The element is not visible" }
    const x = Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1)
    const y = Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    const describe = (e) => e ? e.localName + (e.id ? "#" + e.id : "") : "nothing"
    if (!hit || (hit !== el && !el.contains(hit)))
      return { error: "The element is covered by " + describe(hit) }
    return { x, y, target: describe(el) }
  })()`
}

export async function click(
  send: Send,
  target: { selector?: string; x?: number; y?: number },
  options: {
    button: "left" | "right" | "middle"
    clickCount: number
    modifiers: Modifier[]
  }
) {
  let point: { x: number; y: number; target?: string }
  if (target.selector) {
    const found = (await evaluate(send, locate(target.selector))) as {
      x: number
      y: number
      target: string
      error?: string
    }
    if (found.error) throw new Error(found.error)
    point = found
  } else if (target.x !== undefined && target.y !== undefined) {
    point = { x: target.x, y: target.y }
  } else throw new Error("Provide a selector, or both x and y")
  const modifiers = mask(options.modifiers)
  const buttons = { left: 1, right: 2, middle: 4 }[options.button]
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    modifiers,
    button: "none",
  })
  for (let count = 1; count <= options.clickCount; count++) {
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      modifiers,
      button: options.button,
      buttons,
      clickCount: count,
    })
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      modifiers,
      button: options.button,
      buttons: 0,
      clickCount: count,
    })
  }
  return point
}

export async function type(
  send: Send,
  selector: string,
  text: string,
  clear: boolean
) {
  const focused = (await evaluate(
    send,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return "No element matches the selector"
      el.scrollIntoView({ block: "center", behavior: "instant" })
      el.focus()
      if (document.activeElement !== el && !el.contains(document.activeElement))
        return "The element cannot take focus"
      if (${clear}) {
        if (typeof el.select === "function") el.select()
        else getSelection()?.selectAllChildren(el)
      }
      return ""
    })()`
  )) as string
  if (focused) throw new Error(focused)
  if (clear) await press(send, "Backspace")
  for (const char of text) {
    if (char === "\n") await press(send, "Enter")
    else {
      const key = character(char, /[A-Z]/.test(char))
      if (key) await stroke(send, key, /[A-Z]/.test(char) ? ["Shift"] : [])
      else await send("Input.insertText", { text: char })
    }
  }
  return { typed: [...text].length }
}
