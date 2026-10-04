import type { Store } from "./store"

interface DevEvent {
  id: number
  time: number
  kind: string
  level: string
  message: string
  requestId?: string
  status?: number
  durationMs?: number
  stack?: string
  routePath?: string
}

// Pulls events from dev servers that run Peck's dev plugin
// (plugin/peck-dev.mjs) and stores them as "server" events on the windows
// showing that origin. Each record keeps the request id Peck stamped on the
// request, which links it to the network record.
export class DevServers {
  private polls = new Map<
    string,
    { after: number; first: boolean; failures: number; timer?: NodeJS.Timeout }
  >()
  constructor(
    private store: Store,
    private token: string,
    private windowsOn: (origin: string) => string[],
    private stamped: (origin: string) => Set<string> | undefined,
    private forget: (origin: string) => void
  ) {}
  watch(origin: string) {
    if (this.polls.has(origin)) return
    const poll: {
      after: number
      first: boolean
      failures: number
      timer?: NodeJS.Timeout
    } = { after: 0, first: true, failures: 0 }
    this.polls.set(origin, poll)
    const stop = () => {
      this.polls.delete(origin)
      this.forget(origin)
    }
    const tick = async () => {
      const windows = this.windowsOn(origin)
      if (!windows.length) return stop()
      try {
        const response = await fetch(
          `${origin}/__peck/events?after=${poll.after}`,
          {
            headers: { "x-peck-token": this.token },
            signal: AbortSignal.timeout(3000),
          }
        )
        // The plugin was removed, or the token does not match.
        if (response.status === 404) return stop()
        const body = (await response.json()) as {
          last: number
          events: DevEvent[]
        }
        if (body.last < poll.after) {
          // The dev server restarted and its ids began again.
          poll.after = 0
        } else {
          let events = body.events
          if (poll.first) {
            // Older events are kept only when they belong to this page's
            // requests or happened in the server's last 30 s.
            const newest = Math.max(0, ...events.map((e) => e.time))
            const ids = this.stamped(origin)
            events = events.filter(
              (e) =>
                (e.requestId && ids?.has(e.requestId)) ||
                e.time >= newest - 30000
            )
            poll.first = false
          }
          for (const e of events)
            for (const id of windows)
              this.store.event(id, "server", e.level, e.message, {
                origin,
                peckRequestId: e.requestId,
                serverKind: e.kind,
                status: e.status,
                durationMs: e.durationMs,
                routePath: e.routePath,
                stack: e.stack,
              })
          poll.after = body.last
        }
        poll.failures = 0
      } catch {
        if (++poll.failures >= 10) return stop()
      }
      poll.timer = setTimeout(tick, 1000)
    }
    void tick()
  }
  close() {
    for (const poll of this.polls.values()) clearTimeout(poll.timer)
    this.polls.clear()
  }
}
