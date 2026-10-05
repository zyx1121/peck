# Peck

Peck is a dedicated Chromium browser shared by a human and their existing
coding agent. Tagline: **Point it out.** By zyx.

## Accepted scope

- Electron and TypeScript, with one Chromium WebContentsView per page window.
  No tab strip: each page is its own window, and all windows share one local
  MCP and profile.
- The browser workspace fills the window. A single Safari-like toolbar row holds
  the traffic lights, navigation, the page title (the address while editing),
  element selection, toggles for the Comments, Network, and Console panels, a
  new window button, and a menu for low-frequency actions. The panels stack in
  one resizable sidebar. The page and sidebar extend to the bottom edge. The
  interface is English and black only, separated by hairlines, without gray
  layers or a light theme. No outer website template, product heading, corner
  links, status footer, or copyright footer.
- Visible and background modes preserve the same live page. No separate
  headless engine and no embedded model. Peck never starts a new agent. When
  the user opts a registered conversation in, new user feedback resumes it
  through the agent's official CLI if nothing is watching and no agent runs
  in that directory, with narrow permissions and never a permission bypass.
- A local MCP server ships in the desktop app, with a bundled stdio bridge.
- Pick a DOM element, leave feedback with a screenshot and debug context, and
  receive agent acknowledgement and replies in the same thread.
- Capture real console, exceptions, HTTP request/response records, and WebSocket
  frame metadata. Persist bounded event history and comments in SQLite.
- Public repository: zyx1121/peck. macOS Apple Silicon is the first target.

## Acceptance

- Actual Electron page interaction, not an iframe or a static browser mockup.
- Select an element through the UI and deliver its comment through the real MCP.
- MCP replies and status changes appear in the UI.
- Preserve in-page state across background/show; persist comments across restart.
- Reject unauthenticated MCP, hostile Origin, and non-loopback Host requests.
- Report measured artifact size and the limits of Linux versus macOS validation.

## Deferred

Area/multiple selection, source locations outside React, cross-origin iframe and
closed-shadow-root picking, navigation ownership arbitration, updater, and
performance guarantees.
