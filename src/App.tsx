import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Circle,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  MessageSquare,
  MousePointer2,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  Unplug,
  X,
} from "lucide-react"
import { TaskShell } from "@/components/task-shell"
import { TaskThemeToggle } from "@/components/task-theme"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Annotation, BrowserEvent, PeckState } from "./shared"

type Panel = "comments" | "console" | "network" | "connect"
const time = (value: number) =>
  new Date(value).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
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
  const [state, setState] = useState<PeckState | null>(null)
  const [url, setUrl] = useState("")
  const [panel, setPanel] = useState<Panel>("comments")
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const viewport = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selectionKey = useRef("")
  const activeUrl = useRef("")
  const call = useCallback(
    async (action: string, args: Record<string, unknown> = {}) => {
      try {
        return await window.peck.invoke(action, args)
      } catch (error) {
        setNotice(String(error).replace(/^Error:.*?Error: /, ""))
        return undefined
      }
    },
    []
  )
  useEffect(() => {
    if (!window.peck) return
    const receive = (next: PeckState) => {
      setState(next)
      const value = next.tabs.find((t) => t.id === next.activeTabId)?.url ?? ""
      if (value !== activeUrl.current) {
        setUrl(value)
        activeUrl.current = value
      }
      const key = next.selection
        ? `${next.activeTabId}:${next.selection.selector}`
        : ""
      if (key && key !== selectionKey.current) {
        setPanel("comments")
        setTimeout(() => textarea.current?.focus(), 100)
      }
      selectionKey.current = key
    }
    void window.peck.state().then(receive)
    return window.peck.subscribe(receive)
  }, [])
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
      setNotice("留言已送出，會出現在 agent 的回饋佇列。")
    }
  }
  const annotations = state?.annotations ?? []
  const pending = annotations.filter((a) => a.status !== "resolved").length
  const events = state?.events ?? []
  const consoleEvents = events.filter((e) => e.kind !== "network")
  const networkEvents = events.filter((e) => e.kind === "network")
  const waiting = !!state?.mcp.waiters
  return (
    <TaskShell
      desktop
      lang="zh-TW"
      title="peck"
      description="Point it out."
      actions={
        <>
          <button
            className="connection-indicator"
            onClick={() => setPanel("connect")}
          >
            <Circle
              className="size-3"
              fill={waiting ? "currentColor" : "none"}
            />
            {waiting ? "Agent 正在等你" : "Local MCP"}
          </button>
          <TaskThemeToggle lang="zh-TW" />
          <Button variant="ghost" size="sm" onClick={() => void call("hide")}>
            <ArrowDownLeft />
            背景
          </Button>
        </>
      }
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
          <div className="tab-strip" aria-label="瀏覽器分頁">
            {state.tabs.map((tab) => (
              <div
                className={`browser-tab ${tab.id === state.activeTabId ? "active" : ""}`}
                key={tab.id}
              >
                <button
                  onClick={() => void call("activate", { id: tab.id })}
                  title={tab.url}
                >
                  <Globe2 className="size-4 shrink-0" />
                  <span>{tab.title}</span>
                </button>
                <IconButton
                  label={`關閉 ${tab.title}`}
                  disabled={state.tabs.length < 2}
                  onClick={() => void call("close-tab", { id: tab.id })}
                >
                  <X />
                </IconButton>
              </div>
            ))}
            <IconButton label="新增分頁" onClick={() => void call("new-tab")}>
              <Plus />
            </IconButton>
            <span className="version">DEMO {state.version.split("-")[0]}</span>
          </div>
          <div className="address-bar">
            <div className="flex gap-1">
              <IconButton label="上一頁" onClick={() => void call("back")}>
                <ArrowLeft />
              </IconButton>
              <IconButton label="下一頁" onClick={() => void call("forward")}>
                <ArrowRight />
              </IconButton>
              <IconButton label="重新整理" onClick={() => void call("reload")}>
                <RefreshCw
                  className={
                    state.tabs.find((t) => t.id === state.activeTabId)?.loading
                      ? "motion-safe:animate-spin"
                      : ""
                  }
                />
              </IconButton>
            </div>
            <form
              className="grow"
              onSubmit={(event) => {
                event.preventDefault()
                void call("navigate", { url })
              }}
            >
              <Input
                className="h-9 text-xs"
                aria-label="網址"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                spellCheck={false}
              />
            </form>
            <Button
              className="h-9 px-3"
              variant={state.picking ? "default" : "secondary"}
              onClick={() => void call("pick", { enabled: !state.picking })}
              title="⌘⇧C"
            >
              <MousePointer2 />
              {state.picking ? "點選畫面中的元件" : "選取元件"}
            </Button>
          </div>
          <div className="work-area">
            <div
              ref={viewport}
              className="page-viewport"
              aria-label="專案網頁"
            />
            <aside className="inspector" aria-label="檢查與回饋">
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
                        if (copied) setNotice("MCP 設定已複製，不含連線密鑰。")
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
                      關閉視窗會保留背景服務。使用「結束 Peck」才會停止。
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
              <div className="panel-footer">
                <span>
                  <Circle className="size-2" fill="currentColor" />
                  紀錄儲存在本機
                </span>
                <button onClick={() => setPanel("connect")}>
                  <Code2 className="size-4" />
                  MCP
                </button>
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
    </TaskShell>
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
