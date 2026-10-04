import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
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
  PanelRight,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Unplug,
  X,
} from "lucide-react"
import { useTaskTheme } from "@/components/task-theme"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  Annotation,
  BrowserEvent,
  PeckState,
  SourceLocation,
} from "./shared"

type Panel = "comments" | "console" | "network" | "connect"
const time = (value: number) =>
  new Date(value).toLocaleTimeString("zh-TW", {
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
const statuses = {
  pending: "待處理",
  acknowledged: "處理中",
  resolved: "已完成",
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

export default function App() {
  const { toggle } = useTaskTheme()
  const [editingUrl, setEditingUrl] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const address = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<PeckState | null>(null)
  const [url, setUrl] = useState("")
  const [panel, setPanel] = useState<Panel>("comments")
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  // The native page view covers everything left of the inspector, so notices
  // open the inspector to stay visible.
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    setInspectorOpen(true)
  }, [])
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
        setPanel("comments")
        setInspectorOpen(true)
        setTimeout(() => textarea.current?.focus(), 100)
      }
      selectionKey.current = key
    }
    void window.peck.state().then(receive)
    return window.peck.subscribe(receive)
  }, [])
  useEffect(() => {
    if (!window.peck) return
    return window.peck.onCommand((command) => {
      if (command === "connect") {
        setPanel("connect")
        setInspectorOpen(true)
      } else if (command === "theme") toggle()
      else if (command === "address") address.current?.focus()
      else if (command.startsWith("error:"))
        showNotice(command.slice(6).replace(/^Error: /, ""))
    })
  }, [toggle, showNotice])
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
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!comment.trim() || busy) return
    setBusy(true)
    const result = await call("comment", { comment })
    setBusy(false)
    if (result) {
      setComment("")
      showNotice("留言已送出，會出現在 agent 的回饋佇列。")
    }
  }
  const annotations = state?.annotations ?? []
  const pending = annotations.filter((a) => a.status !== "resolved").length
  const events = state?.events ?? []
  const consoleEvents = events.filter((e) => e.kind !== "network")
  const networkEvents = events.filter((e) => e.kind === "network")
  const waiting = !!state?.mcp.waiters
  return (
    <main
      className={`app-shell ${state?.platform === "darwin" ? "macos" : ""} ${state?.fullscreen ? "fullscreen" : ""}`}
      aria-label="Peck"
    >
      {!window.peck ? (
        <div className="empty">
          <Unplug />
          <h2>請在 Peck 桌面 app 開啟</h2>
          <p>此介面需要內建的 Chromium 與 local MCP。</p>
        </div>
      ) : !state ? (
        <p role="status">正在開啟工作區…</p>
      ) : (
        <section className="workspace" aria-label="瀏覽器工作區">
          <header className="address-bar" aria-label="瀏覽器工具列">
            <div className="navigation-controls">
              <IconButton
                label="上一頁"
                disabled={!state.page.canGoBack}
                onClick={() => void call("back")}
              >
                <ArrowLeft />
              </IconButton>
              <IconButton
                label="下一頁"
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
                aria-label="網址"
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
                spellCheck={false}
                autoComplete="off"
              />
              <IconButton label="重新整理" onClick={() => void call("reload")}>
                <RefreshCw
                  className={
                    state.page.loading ? "motion-safe:animate-spin" : ""
                  }
                />
              </IconButton>
            </form>
            <div className="window-actions">
              <Button
                variant={state.picking ? "secondary" : "ghost"}
                size="icon-lg"
                aria-label="選取元件"
                aria-pressed={state.picking}
                title={state.picking ? "點選畫面中的元件" : "選取元件 (⌘⇧C)"}
                onClick={() => {
                  setInspectorOpen(true)
                  void call("pick", { enabled: !state.picking })
                }}
              >
                <MousePointer2 />
              </Button>
              <IconButton
                label={inspectorOpen ? "隱藏檢查面板" : "顯示檢查面板"}
                onClick={() => setInspectorOpen(!inspectorOpen)}
              >
                <PanelRight />
              </IconButton>
              <IconButton
                label="新增視窗"
                onClick={() => void call("new-window")}
              >
                <Plus />
              </IconButton>
              <IconButton label="更多選項" onClick={() => void call("menu")}>
                <MoreHorizontal />
              </IconButton>
            </div>
          </header>
          <div className="work-area">
            <div
              ref={viewport}
              className="page-viewport"
              aria-label="專案網頁"
            />
            <aside
              className="inspector"
              aria-label="檢查與回饋"
              hidden={!inspectorOpen}
            >
              <div className="panel-tabs" role="tablist" aria-label="檢查面板">
                {(
                  [
                    ["comments", "留言", pending],
                    [
                      "console",
                      "Console",
                      consoleEvents.filter((e) => e.level === "error").length,
                    ],
                    ["network", "Network", networkEvents.length],
                  ] as const
                ).map(([id, label, count]) => (
                  <button
                    role="tab"
                    aria-selected={panel === id}
                    key={id}
                    onClick={() => setPanel(id)}
                  >
                    {label}
                    {count > 0 && <span>{count}</span>}
                  </button>
                ))}
              </div>
              <div className="panel-body" role="tabpanel">
                {panel === "comments" && (
                  <>
                    {state.selection ? (
                      <form className="composer" onSubmit={submit}>
                        <div className="flex items-center justify-between">
                          <span className="eyebrow">已選取元件</span>
                          <IconButton
                            label="取消選取"
                            onClick={() => void call("clear-selection")}
                          >
                            <X />
                          </IconButton>
                        </div>
                        <code className="selector">
                          {state.selection.selector}
                        </code>
                        {state.selection.location && (
                          <code className="source-location">
                            {where(state.selection.location)}
                          </code>
                        )}
                        <p className="selected-text">
                          {state.selection.text.slice(0, 140) ||
                            `<${state.selection.tag}>`}
                        </p>
                        <Textarea
                          ref={textarea}
                          aria-label="修改意見"
                          placeholder="這裡想怎麼改？"
                          rows={4}
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          maxLength={4000}
                        />
                        <div className="composer-footer">
                          <span>附上畫面與除錯紀錄</span>
                          <Button
                            className="h-9"
                            type="submit"
                            disabled={busy || !comment.trim()}
                          >
                            <Send />
                            送出留言
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="pick-prompt">
                        <MousePointer2 />
                        <div>
                          <p>指一下，說清楚。</p>
                          <span>選取網頁中的元件，留下修改意見。</span>
                        </div>
                      </div>
                    )}
                    <div className="section-label">
                      <span>
                        {annotations.length
                          ? `${annotations.length} 則留言`
                          : "回饋紀錄"}
                      </span>
                      <span>
                        {waiting ? "Agent 等待中" : "由原本的 agent 對話處理"}
                      </span>
                    </div>
                    {!annotations.length && (
                      <div className="empty">
                        <MessageSquare />
                        <p>你的第一則留言，從畫面開始。</p>
                        <span>
                          截圖、元件位置和當下的錯誤
                          <br />
                          會一起交給 agent。
                        </span>
                      </div>
                    )}
                    {annotations.map((item) => (
                      <CommentCard key={item.id} item={item} call={call} />
                    ))}
                  </>
                )}
                {(panel === "console" || panel === "network") && (
                  <EventList
                    kind={panel}
                    events={panel === "console" ? consoleEvents : networkEvents}
                  />
                )}
                {panel === "connect" && (
                  <div className="connect">
                    <div className="section-label">接上你的 agent</div>
                    <h2>同一個畫面，同一段對話。</h2>
                    <p>
                      Peck 內建 local MCP。Codex 或 Claude Code
                      連線後，就能讀取留言、截圖與除錯紀錄。
                    </p>
                    <code>{state.mcp.url}</code>
                    <Button
                      className="mt-5 h-9"
                      onClick={async () => {
                        const copied = await call("copy-config")
                        if (copied) showNotice("MCP 設定已複製，不含連線密鑰。")
                      }}
                    >
                      <Copy />
                      複製 MCP 設定
                    </Button>
                    <div className="connection-state">
                      <Circle
                        className="size-3"
                        fill={waiting ? "currentColor" : "none"}
                      />
                      <span>
                        {waiting
                          ? "Agent 正在等待新留言"
                          : state.mcp.clients
                            ? "已收到 agent 呼叫"
                            : "等待 agent 連線"}
                      </span>
                    </div>
                    <p className="text-xs">
                      連線後，對 agent 說：「用 Peck
                      持續等我的留言，修改後回覆驗證結果。」
                    </p>
                    <p className="text-xs">
                      選單中的「移至背景」會保留目前網頁。關閉視窗會結束該頁，使用「結束
                      Peck」才會停止 MCP。
                    </p>
                    <a
                      href="https://github.com/zyx1121/peck"
                      className="inline-flex items-center gap-2 text-sm"
                    >
                      設定說明
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
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
        {expanded ? "收起畫面" : "查看當時畫面"}
        <span>
          {Math.round(item.element.rect.width)} ×{" "}
          {Math.round(item.element.rect.height)}
        </span>
      </button>
      {expanded && (
        <div className="context-image">
          {image ? (
            <img
              alt="留言當時的網頁截圖"
              src={`data:image/jpeg;base64,${image}`}
            />
          ) : (
            <p>這則留言沒有截圖。</p>
          )}
          <p>{item.element.url}</p>
        </div>
      )}
      {item.replies.map((r, i) => (
        <div className="reply" key={i}>
          <span>
            {r.author === "agent" ? "Agent" : "你"} · {time(r.time)}
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
            aria-label="回覆留言"
            placeholder="繼續回覆…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <IconButton
            label="送出回覆"
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
          還需要調整，重新開啟
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
        {expanded ? "收起修改後畫面" : "查看修改後畫面"}
      </button>
      {expanded && image && (
        <div className="context-image">
          <img alt="修改後的元件截圖" src={`data:image/jpeg;base64,${image}`} />
        </div>
      )}
    </>
  )
}
function EventList({
  kind,
  events,
}: {
  kind: "console" | "network"
  events: BrowserEvent[]
}) {
  return (
    <div className="event-list">
      <div className="section-label">
        <span>{kind === "console" ? "Console 與錯誤" : "網路請求"}</span>
        <span>跨頁保留</span>
      </div>
      {events.length === 0 ? (
        <div className="empty">
          <Terminal />
          <p>尚無紀錄</p>
          <span>操作網頁後，紀錄會出現在這裡。</span>
        </div>
      ) : (
        [...events].reverse().map((event) => (
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
                  <span className="level">{event.level}</span>
                  <span className="event-message">{event.message}</span>
                </>
              )}
            </summary>
            <pre>{JSON.stringify(event.details, null, 2)}</pre>
          </details>
        ))
      )}
    </div>
  )
}
