import { DatabaseSync } from "node:sqlite"
import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import type { Annotation, BrowserEvent, PickedElement } from "../src/shared"
const sensitive =
  /authorization|cookie|password|passwd|secret|token|api[-_]?key/i
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        sensitive.test(k) ? "[redacted]" : redact(v),
      ])
    )
  return value
}
export function safeUrl(value: string) {
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    for (const k of [...url.searchParams.keys()])
      if (sensitive.test(k)) url.searchParams.set(k, "[redacted]")
    return url.toString()
  } catch {
    return value.slice(0, 4000)
  }
}
export class Store extends EventEmitter {
  db: DatabaseSync
  private closed = false
  constructor(path: string) {
    super()
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, tab TEXT, time INTEGER, payload TEXT);
      CREATE TABLE IF NOT EXISTS annotations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, payload TEXT);`)
    this.db
      .prepare("DELETE FROM events WHERE time < ?")
      .run(Date.now() - 7 * 86400000)
  }
  event(
    tabId: string,
    kind: BrowserEvent["kind"],
    level: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    if (this.closed) return
    const data = {
      tabId,
      time: Date.now(),
      kind,
      level,
      message: message.slice(0, 8000),
      details: redact(details),
    }
    const result = this.db
      .prepare("INSERT INTO events(tab,time,payload) VALUES(?,?,?)")
      .run(tabId, data.time, JSON.stringify(data))
    const id = Number(result.lastInsertRowid)
    if (id % 100 === 0)
      this.db.prepare("DELETE FROM events WHERE id <= ?").run(id - 3000)
    this.emit("change")
    return { id, ...data } as BrowserEvent
  }
  events(tabId?: string, limit = 150): BrowserEvent[] {
    const rows = tabId
      ? this.db
          .prepare(
            "SELECT id,payload FROM events WHERE tab=? ORDER BY id DESC LIMIT ?"
          )
          .all(tabId, limit)
      : this.db
          .prepare("SELECT id,payload FROM events ORDER BY id DESC LIMIT ?")
          .all(limit)
    return rows
      .map((r) => ({ ...JSON.parse(String(r.payload)), id: Number(r.id) }))
      .reverse()
  }
  annotations(): Annotation[] {
    return this.db
      .prepare(
        "SELECT sequence,payload FROM annotations ORDER BY sequence DESC LIMIT 300"
      )
      .all()
      .map((r) => ({
        ...JSON.parse(String(r.payload)),
        sequence: Number(r.sequence),
      }))
  }
  get(id: string): Annotation {
    const row = this.db
      .prepare("SELECT sequence,payload FROM annotations WHERE id=?")
      .get(id)
    if (!row) throw new Error("Annotation not found")
    return {
      ...JSON.parse(String(row.payload)),
      sequence: Number(row.sequence),
    }
  }
  add(
    tabId: string,
    comment: string,
    element: PickedElement,
    screenshot?: string,
    context = this.events(tabId, 30)
  ): Annotation {
    const item: Annotation = {
      id: randomUUID(),
      sequence: 0,
      tabId,
      comment,
      time: Date.now(),
      status: "pending",
      element,
      screenshot,
      replies: [],
      context,
    }
    const result = this.db
      .prepare("INSERT INTO annotations(id,payload) VALUES(?,?)")
      .run(item.id, JSON.stringify(item))
    item.sequence = Number(result.lastInsertRowid)
    this.emit("annotation", item)
    this.emit("change")
    return item
  }
  update(
    id: string,
    status?: Annotation["status"],
    reply?: string,
    author = "agent"
  ) {
    const item = this.get(id)
    if (status) item.status = status
    if (reply) {
      item.replies.push({
        author,
        text: reply.slice(0, 8000),
        time: Date.now(),
      })
      if (author === "user") item.status = "pending"
    }
    if (status === "pending" || (author === "user" && reply)) {
      const result = this.db
        .prepare("INSERT OR REPLACE INTO annotations(id,payload) VALUES(?,?)")
        .run(id, JSON.stringify(item))
      item.sequence = Number(result.lastInsertRowid)
    } else {
      this.db
        .prepare("UPDATE annotations SET payload=? WHERE id=?")
        .run(JSON.stringify(item), id)
    }
    if (item.status === "pending") this.emit("annotation", item)
    this.emit("change")
    return item
  }
  close() {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }
}
