export interface PickedElement {
  selector: string
  tag: string
  text: string
  url: string
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number; devicePixelRatio: number }
  styles: Record<string, string>
  source?: string
  // Where the element is written, resolved after picking.
  location?: SourceLocation
}
export interface SourceLocation {
  file: string
  line?: number
  column?: number
  component?: string
  via: "attribute" | "react"
}
export interface TabInfo {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}
export interface BrowserEvent {
  id: number
  tabId: string
  time: number
  kind: "console" | "network" | "system" | "server"
  level: string
  message: string
  details: Record<string, unknown>
}
export interface Annotation {
  id: string
  sequence: number
  tabId: string
  time: number
  comment: string
  status: "pending" | "acknowledged" | "resolved"
  element: PickedElement
  // image is the after screenshot an agent attached; lists send hasImage.
  replies: {
    author: string
    text: string
    time: number
    image?: string
    hasImage?: boolean
  }[]
  screenshot?: string
  context: BrowserEvent[]
}
// An agent conversation that used Peck's MCP through the bridge.
export interface AgentSession {
  agent: string
  sessionId: string
  cwd: string
  pid?: number
  client?: string
  firstSeen?: number
  lastSeen: number
  lastWatch?: number
  running?: boolean
  watching?: boolean
  // Resume on new comments, set per project directory.
  autoResume?: boolean
  command?: string
  lastRun?: { at: number; running: boolean; exitCode?: number | null }
}
export interface PeckState {
  page: TabInfo
  platform: string
  fullscreen: boolean
  picking: boolean
  selection: PickedElement | null
  annotations: Annotation[]
  agents: AgentSession[]
  events: BrowserEvent[]
  mcp: { url: string; clients: number; waiters: number; lastActivity: number }
  version: string
  visible: boolean
  dataPath: string
}
export interface PeckApi {
  invoke: (action: string, args?: Record<string, unknown>) => Promise<unknown>
  state: () => Promise<PeckState>
  onCommand: (callback: (command: string) => void) => () => void
  subscribe: (callback: (state: PeckState) => void) => () => void
}
declare global {
  interface Window {
    peck: PeckApi
  }
}
