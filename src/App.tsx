import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Circle,
  Copy,
  ExternalLink,
  MessageSquare,
  MousePointer2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  SquareTerminal,
  Unplug,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  Annotation,
  BrowserEvent,
  PeckState,
  SourceLocation,
} from "./shared"

type Section = "comments" | "network" | "console"
const sections: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "comments", label: "Comments", icon: <MessageSquare /> },
  { id: "network", label: "Network", icon: <ArrowDownUp /> },
  { id: "console", label: "Console", icon: <SquareTerminal /> },
]
const time = (value: number) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
// "Header · /src/App.jsx:11"
const where = (location: SourceLocation) =>
  [
    location.component,
    location.file + (location.line ? `:${location.line}` : ""),
  ]
    .filter(Boolean)
    .join(" · ")
const agentNames: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
}
const statuses = {
  pending: "Pending",
  acknowledged: "In progress",
  resolved: "Resolved",
}

// Sidebar layout, remembered in this browser profile: which panels are
// open, the sidebar width, and each panel's share of the height.
interface Layout {
  open: Record<Section, boolean>
  width: number
  weights: Record<Section, number>
}
const defaultLayout: Layout = {
  open: { comments: true, network: true, console: true },
  width: 384,
  weights: { comments: 1, network: 1, console: 1 },
}
const layoutKey = "peck-layout"
function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey) ?? "null")
    if (saved && typeof saved.width === "number")
      return {
        open: { ...defaultLayout.open, ...saved.open },
        width: saved.width,
        weights: { ...defaultLayout.weights, ...saved.weights },
      }
  } catch {
    /* Storage is optional. */
  }
  return defaultLayout
}
const MIN_WIDTH = 280
const MIN_PANEL = 96

function IconButton({
  label,
  title = label,
  children,
  onClick,
  disabled = false,
  pressed,
}: {
  label: string
  title?: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

export default function App() {
  const [editingUrl, setEditingUrl] = useState(false)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const address = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<PeckState | null>(null)
  const [url, setUrl] = useState("")
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const panels = useRef<Partial<Record<Section, HTMLElement | null>>>({})
  useEffect(() => {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(layout))
    } catch {
      /* Storage is optional. */
    }
  }, [layout])
  const setOpen = useCallback(
    (id: Section, open: boolean) =>
      setLayout((current) => ({
        ...current,
        open: { ...current.open, [id]: open },
      })),
    []
  )
  // The native page view covers everything left of the sidebar, so notices
  // open the comments panel to stay visible.
  const showNotice = useCallback(
    (message: string) => {
      setNotice(message)
      setOpen("comments", true)
    },
    [setOpen]
  )
  const viewport = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selectionKey = useRef("")
  const activeUrl = useRef("")
  const call = useCallback(
    async (action: string, args: Record<string, unknown> = {}) => {
      try {
        return await window.peck.invoke(action, args)
      } catch (error) {
        showNotice(String(error).replace(/^Error:.*?Error: /, ""))
        return undefined
      }
    },
    [showNotice]
  )
  useEffect(() => {
    if (!window.peck) return
    const receive = (next: PeckState) => {
      setState(next)
      const value = next.page.url
      if (value !== activeUrl.current) {
        setUrl(value)
        activeUrl.current = value
      }
      const key = next.selection
        ? `${next.page.id}:${next.selection.selector}`
        : ""
      if (key && key !== selectionKey.current) {
        setMcpOpen(false)
        setOpen("comments", true)
        setTimeout(() => textarea.current?.focus(), 100)
      }
      selectionKey.current = key
    }
    void window.peck.state().then(receive)
    return window.peck.subscribe(receive)
  }, [setOpen])
  useEffect(() => {
    if (!window.peck) return
    return window.peck.onCommand((command) => {
      if (command === "connect") setMcpOpen(true)
      else if (command === "address") address.current?.focus()
      else if (command.startsWith("error:"))
        showNotice(command.slice(6).replace(/^Error: /, ""))
    })
  }, [showNotice])
  // An empty window is ready for a URL.
  const focusedEmpty = useRef(false)
  useEffect(() => {
    if (state?.page.url === "" && !focusedEmpty.current) {
      focusedEmpty.current = true
      address.current?.focus()
    }
  }, [state?.page.url])
  const ready = !!state
  useEffect(() => {
    if (!ready || !viewport.current) return
    const element = viewport.current
    const update = () => {
      const r = element.getBoundingClientRect()
      if (r.width && r.height)
        void call("layout", {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        })
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [ready, call])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(""), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  // Drag the sidebar's left edge to change its width.
  function resizeSidebar(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    // The rendered width, which CSS caps when the window is narrow.
    const startWidth = handle.parentElement?.getBoundingClientRect().width ?? 0
    setResizing(true)
    const move = (e: PointerEvent) => {
      const width = Math.round(
        Math.min(
          Math.max(startWidth - (e.clientX - startX), MIN_WIDTH),
          window.innerWidth * 0.7
        )
      )
      setLayout((current) => ({ ...current, width }))
    }
    const end = () => {
      setResizing(false)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }
  // Drag the divider between two panels to move height from one to the other.
  function resizePanels(
    event: ReactPointerEvent<HTMLDivElement>,
    above: Section,
    below: Section
  ) {
    event.preventDefault()
    const handle = event.currentTarget
    const top = panels.current[above]?.getBoundingClientRect().height ?? 0
    const bottom = panels.current[below]?.getBoundingClientRect().height ?? 0
    if (!top || !bottom) return
    handle.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const total = layout.weights[above] + layout.weights[below]
    const move = (e: PointerEvent) => {
      const height = Math.min(
        Math.max(top + e.clientY - startY, MIN_PANEL),
        top + bottom - MIN_PANEL
      )
      const share = height / (top + bottom)
      setLayout((current) => ({
        ...current,
        weights: {
          ...current.weights,
          [above]: total * share,
          [below]: total * (1 - share),
        },
      }))
    }
    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!comment.trim() || busy) return
    setBusy(true)
    const result = await call("comment", { comment })
    setBusy(false)
    if (result) {
      setComment("")
      showNotice("Comment sent")
    }
  }
  const annotations = state?.annotations ?? []
  const pending = annotations.filter((a) => a.status !== "resolved").length
  const events = state?.events ?? []
  const consoleEvents = events.filter((e) => e.kind !== "network")
  const networkEvents = events.filter((e) => e.kind === "network")
  const serverEvents = events.filter((e) => e.kind === "server")
  const waiting = !!state?.mcp.waiters
  const openSections = sections.filter((s) => layout.open[s.id])
  const sidebarOpen = mcpOpen || openSections.length > 0
  const counts: Record<Section, number> = {
    comments: pending,
    network: networkEvents.length,
    console: consoleEvents.filter((e) => e.level === "error").length,
  }
  function body(id: Section) {
    if (!state) return null
    if (id === "network" || id === "console")
      return (
        <EventList
          kind={id}
          events={id === "console" ? consoleEvents : networkEvents}
          server={serverEvents}
        />
      )
    return (
      <>
        {state.selection && (
          <form className="composer" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <span className="eyebrow">Selected element</span>
              <IconButton
                label="Clear selection"
                onClick={() => void call("clear-selection")}
              >
                <X />
              </IconButton>
            </div>
            <code className="selector">{state.selection.selector}</code>
            {state.selection.location && (
              <code className="source-location">
                {where(state.selection.location)}
              </code>
            )}
            <p className="selected-text">
              {state.selection.text.slice(0, 140) || `<${state.selection.tag}>`}
            </p>
            <Textarea
              ref={textarea}
              aria-label="Comment"
              placeholder="Comment"
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={4000}
            />
            <div className="composer-footer">
              <Button
                className="h-9"
                type="submit"
                disabled={busy || !comment.trim()}
              >
                <Send />
                Send
              </Button>
            </div>
          </form>
        )}
        {waiting && <div className="section-label">Agent waiting</div>}
        {annotations.map((item) => (
          <CommentCard key={item.id} item={item} call={call} />
        ))}
      </>
    )
  }
  return (
    <main
      className={`app-shell ${state?.platform === "darwin" ? "macos" : ""} ${state?.fullscreen ? "fullscreen" : ""}`}
      aria-label="Peck"
    >
      {!window.peck ? (
        <div className="empty">
          <Unplug />
          <h2>Open this in the Peck app</h2>
          <p>It needs Peck's Chromium and local MCP.</p>
        </div>
      ) : !state ? (
        <p role="status">Opening…</p>
      ) : (
        <section className="workspace" aria-label="Browser">
          <header className="address-bar" aria-label="Toolbar">
            <div className="navigation-controls">
              <IconButton
                label="Back"
                disabled={!state.page.canGoBack}
                onClick={() => void call("back")}
              >
                <ArrowLeft />
              </IconButton>
              <IconButton
                label="Forward"
                disabled={!state.page.canGoForward}
                onClick={() => void call("forward")}
              >
                <ArrowRight />
              </IconButton>
            </div>
            <form
              className="location"
              onSubmit={(event) => {
                event.preventDefault()
                void call("navigate", { url })
                address.current?.blur()
              }}
            >
              <Input
                ref={address}
                className={`location-input ${editingUrl ? "editing" : ""}`}
                aria-label="Address"
                title={state.page.url}
                value={editingUrl ? url : state.page.title || state.page.url}
                onFocus={() => {
                  setUrl(state.page.url)
                  setEditingUrl(true)
                  requestAnimationFrame(() => {
                    // Chromium's select() also focuses, so skip it after Escape.
                    if (document.activeElement === address.current)
                      address.current?.select()
                  })
                }}
                onBlur={() => setEditingUrl(false)}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setUrl(state.page.url)
                    address.current?.blur()
                  }
                }}
                placeholder="Enter URL"
                spellCheck={false}
                autoComplete="off"
              />
              <IconButton label="Reload" onClick={() => void call("reload")}>
                <RefreshCw
                  className={
                    state.page.loading ? "motion-safe:animate-spin" : ""
                  }
                />
              </IconButton>
            </form>
            <div className="window-actions">
              <IconButton
                label="Select element"
                title={
                  state.picking
                    ? "Click an element on the page"
                    : "Select element (⌘⇧C)"
                }
                pressed={state.picking}
                onClick={() => {
                  setMcpOpen(false)
                  setOpen("comments", true)
                  void call("pick", { enabled: !state.picking })
                }}
              >
                <MousePointer2 />
              </IconButton>
              {sections.map((s) => (
                <IconButton
                  key={s.id}
                  label={s.label}
                  pressed={!mcpOpen && layout.open[s.id]}
                  onClick={() => {
                    // Local MCP covers the panels: leave it and show this one.
                    if (mcpOpen) {
                      setMcpOpen(false)
                      setOpen(s.id, true)
                    } else setOpen(s.id, !layout.open[s.id])
                  }}
                >
                  {s.icon}
                </IconButton>
              ))}
              <IconButton
                label="New window"
                onClick={() => void call("new-window")}
              >
                <Plus />
              </IconButton>
              <IconButton label="More" onClick={() => void call("menu")}>
                <MoreHorizontal />
              </IconButton>
            </div>
          </header>
          <div className="work-area">
            <div ref={viewport} className="page-viewport" aria-label="Page" />
            <aside
              className={`inspector ${sidebarOpen ? "" : "closed"} ${resizing ? "resizing" : ""}`}
              style={{ "--inspector-width": `${layout.width}px` } as never}
              aria-label="Inspector"
              aria-hidden={!sidebarOpen}
              inert={!sidebarOpen}
            >
              <div
                className="sidebar-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                onPointerDown={resizeSidebar}
              />
              <div className="inspector-body">
                {mcpOpen ? (
                  <section className="panel" aria-label="Local MCP">
                    <header className="panel-header">
                      <span>Local MCP</span>
                      <IconButton
                        label="Close Local MCP"
                        onClick={() => setMcpOpen(false)}
                      >
                        <X />
                      </IconButton>
                    </header>
                    <div className="panel-body">
                      <McpPanel
                        state={state}
                        waiting={waiting}
                        call={call}
                        showNotice={showNotice}
                      />
                    </div>
                  </section>
                ) : (
                  openSections.map((s, index) => (
                    <Fragment key={s.id}>
                      {index > 0 && (
                        <div
                          className="panel-resizer"
                          role="separator"
                          aria-orientation="horizontal"
                          aria-label={`Resize ${openSections[index - 1].label} and ${s.label}`}
                          onPointerDown={(event) =>
                            resizePanels(
                              event,
                              openSections[index - 1].id,
                              s.id
                            )
                          }
                        />
                      )}
                      <section
                        ref={(element) => {
                          panels.current[s.id] = element
                        }}
                        className="panel"
                        style={{ flexGrow: layout.weights[s.id] }}
                        aria-label={s.label}
                      >
                        <header className="panel-header">
                          <span>{s.label}</span>
                          {counts[s.id] > 0 && (
                            <span className="count">{counts[s.id]}</span>
                          )}
                        </header>
                        <div className="panel-body">{body(s.id)}</div>
                      </section>
                    </Fragment>
                  ))
                )}
              </div>
            </aside>
          </div>
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
function McpPanel({
  state,
  waiting,
  call,
  showNotice,
}: {
  state: PeckState
  waiting: boolean
  call: (action: string, args?: Record<string, unknown>) => Promise<unknown>
  showNotice: (message: string) => void
}) {
  return (
    <div className="connect">
      <code>{state.mcp.url}</code>
      <Button
        className="mt-5 h-9"
        onClick={async () => {
          const copied = await call("copy-config")
          if (copied) showNotice("Copied MCP config")
        }}
      >
        <Copy />
        Copy MCP config
      </Button>
      <div className="connection-state">
        <Circle className="size-3" fill={waiting ? "currentColor" : "none"} />
        <span>
          {waiting
            ? "Agent waiting for comments"
            : state.mcp.clients
              ? "Agent connected"
              : "No agent connected"}
        </span>
      </div>
      {state.agents.map((a) => (
        <div className="agent-session" key={a.sessionId}>
          <div>
            <p>
              {agentNames[a.agent] ?? a.agent} · {a.sessionId.slice(0, 8)}
            </p>
            <span>{a.cwd}</span>
            <span>
              {a.watching ? "Watching" : a.running ? "Running" : "Ended"} ·{" "}
              {time(a.lastSeen)}
            </span>
            {a.command && (
              <label className="auto-resume">
                <input
                  type="checkbox"
                  checked={!!a.autoResume}
                  onChange={(event) =>
                    void call("auto-resume", {
                      sessionId: a.sessionId,
                      enabled: event.target.checked,
                    })
                  }
                />
                Resume on new comments
              </label>
            )}
            {a.autoResume && a.command && (
              <code className="agent-command">{a.command}</code>
            )}
            {a.lastRun && (
              <span>
                Last resume · {time(a.lastRun.at)} ·{" "}
                {a.lastRun.running
                  ? "Running"
                  : a.lastRun.exitCode === 0
                    ? "Done"
                    : "Failed"}
              </span>
            )}
          </div>
          <IconButton
            label="Remove"
            onClick={() =>
              void call("forget-agent", {
                sessionId: a.sessionId,
              })
            }
          >
            <X />
          </IconButton>
        </div>
      ))}
      <a
        href="https://github.com/zyx1121/peck"
        className="inline-flex items-center gap-2 text-sm"
      >
        Setup guide
        <ExternalLink className="size-4" />
      </a>
    </div>
  )
}
function CommentCard({
  item,
  call,
}: {
  item: Annotation
  call: (action: string, args?: Record<string, unknown>) => Promise<unknown>
}) {
  const [reply, setReply] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [image, setImage] = useState("")
  const icon =
    item.status === "resolved" ? (
      <CheckCheck />
    ) : item.status === "acknowledged" ? (
      <Check />
    ) : (
      <Circle />
    )
  return (
    <article className="comment-card">
      <div className="comment-meta">
        <span className={`status status-${item.status}`}>
          {icon}
          {statuses[item.status]}
        </span>
        <time>{time(item.time)}</time>
      </div>
      <p className="comment-text">{item.comment}</p>
      <code className="selector">{item.element.selector}</code>
      {item.element.location && (
        <code className="source-location">{where(item.element.location)}</code>
      )}
      <button
        className="context-button"
        onClick={async () => {
          setExpanded(!expanded)
          if (!image) {
            const result = await call("annotation-image", { id: item.id })
            if (typeof result === "string") setImage(result)
          }
        }}
      >
        {expanded ? "Hide screenshot" : "Show screenshot"}
        <span>
          {Math.round(item.element.rect.width)} ×{" "}
          {Math.round(item.element.rect.height)}
        </span>
      </button>
      {expanded && (
        <div className="context-image">
          {image ? (
            <img
              alt="The page when the comment was made"
              src={`data:image/jpeg;base64,${image}`}
            />
          ) : (
            <p>No screenshot for this comment.</p>
          )}
          <p>{item.element.url}</p>
        </div>
      )}
      {item.replies.map((r, i) => (
        <div className="reply" key={i}>
          <span>
            {r.author === "agent" ? "Agent" : "You"} · {time(r.time)}
          </span>
          <p>{r.text}</p>
          {r.hasImage && <ReplyImage id={item.id} index={i} call={call} />}
        </div>
      ))}
      {item.replies.length > 0 && (
        <form
          className="reply-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (reply.trim()) {
              await call("reply", { id: item.id, text: reply })
              setReply("")
            }
          }}
        >
          <Input
            className="h-9 text-xs"
            aria-label="Reply"
            placeholder="Reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <IconButton
            label="Send reply"
            disabled={!reply.trim()}
            onClick={() => {
              void call("reply", { id: item.id, text: reply })
              setReply("")
            }}
          >
            <Send />
          </IconButton>
        </form>
      )}
      {item.status === "resolved" && (
        <button
          className="context-button"
          onClick={() => void call("reopen", { id: item.id })}
        >
          Reopen
        </button>
      )}
    </article>
  )
}
function ReplyImage({
  id,
  index,
  call,
}: {
  id: string
  index: number
  call: (action: string, args?: Record<string, unknown>) => Promise<unknown>
}) {
  const [expanded, setExpanded] = useState(false)
  const [image, setImage] = useState("")
  return (
    <>
      <button
        className="context-button"
        onClick={async () => {
          setExpanded(!expanded)
          if (!image) {
            const result = await call("reply-image", { id, index })
            if (typeof result === "string") setImage(result)
          }
        }}
      >
        {expanded ? "Hide after screenshot" : "Show after screenshot"}
      </button>
      {expanded && image && (
        <div className="context-image">
          <img
            alt="The element after the fix"
            src={`data:image/jpeg;base64,${image}`}
          />
        </div>
      )}
    </>
  )
}
function ServerRecords({ records }: { records: BrowserEvent[] }) {
  if (!records.length) return null
  return (
    <div className="server-records">
      <span>Server</span>
      {records.map((r) => (
        <p className={`event-${r.level}`} key={r.id}>
          {r.message}
        </p>
      ))}
    </div>
  )
}
function EventList({
  kind,
  events,
  server,
}: {
  kind: "console" | "network"
  events: BrowserEvent[]
  // Dev server records, linked to network records by peckRequestId.
  server: BrowserEvent[]
}) {
  return (
    <div className="event-list">
      {[...events].reverse().map((event) => (
        <details className={`event event-${event.level}`} key={event.id}>
          <summary>
            <span className="event-time">{time(event.time)}</span>
            {kind === "network" ? (
              <>
                <span className="http-status">
                  {String(event.details.status ?? "ERR")}
                </span>
                <span className="event-message">{event.message}</span>
                <span className="duration">
                  {String(event.details.durationMs ?? 0)} ms
                </span>
              </>
            ) : (
              <>
                <span className="level">
                  {event.kind === "server"
                    ? `server ${event.level}`
                    : event.level}
                </span>
                <span className="event-message">{event.message}</span>
              </>
            )}
          </summary>
          {kind === "network" && (
            <ServerRecords
              records={server.filter(
                (s) =>
                  !!event.details.peckRequestId &&
                  s.details.peckRequestId === event.details.peckRequestId
              )}
            />
          )}
          <pre>{JSON.stringify(event.details, null, 2)}</pre>
        </details>
      ))}
    </div>
  )
}
