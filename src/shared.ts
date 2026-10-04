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
  canGoBack: boolean
  canGoForward: boolean
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
export interface PeckState {
  page: TabInfo
  platform: string
  fullscreen: boolean
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
  onCommand: (callback: (command: string) => void) => () => void
  subscribe: (callback: (state: PeckState) => void) => () => void
}
declare global {
  interface Window {
    peck: PeckApi
  }
}
