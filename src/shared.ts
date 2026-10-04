export interface PickedElement {
  selector: string
  tag: string
  text: string
  url: string
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number; devicePixelRatio: number }
  styles: Record<string, string>
  source?: string
}
export interface TabInfo {
  id: string
  title: string
  url: string
  loading: boolean
}
export interface BrowserEvent {
  id: number
  tabId: string
  time: number
  kind: "console" | "network" | "system"
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
  replies: { author: string; text: string; time: number }[]
  screenshot?: string
  context: BrowserEvent[]
}
export interface PeckState {
  tabs: TabInfo[]
  activeTabId: string
  picking: boolean
  selection: PickedElement | null
  annotations: Annotation[]
  events: BrowserEvent[]
  mcp: { url: string; clients: number; waiters: number; lastActivity: number }
  version: string
  visible: boolean
  dataPath: string
}
export interface PeckApi {
  invoke: (action: string, args?: Record<string, unknown>) => Promise<unknown>
  state: () => Promise<PeckState>
  subscribe: (callback: (state: PeckState) => void) => () => void
}
declare global {
  interface Window {
    peck: PeckApi
  }
}
