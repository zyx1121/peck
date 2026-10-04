# Peck demo

Peck is a dedicated Chromium browser shared by a human and their existing
coding agent. Tagline: **Point it out.** By zyx.

## Accepted scope

- Electron and TypeScript, with Chromium WebContentsView tabs.
- Visible and background modes preserve the same live page. No separate
  headless engine and no embedded model or agent orchestration runtime.
- A local MCP server ships in the desktop app, with a bundled stdio bridge.
- Pick a DOM element, leave feedback with a screenshot and debug context, and
  receive agent acknowledgement and replies in the same thread.
- Capture real console, exceptions, HTTP request/response records, and WebSocket
  frame metadata. Persist bounded event history and comments in SQLite.
- Public repository: zyx1121/peck. macOS Apple Silicon is the first demo target.

## Demo acceptance

- Actual Electron page interaction, not an iframe or a static browser mockup.
- Select an element through the UI and deliver its comment through the real MCP.
- MCP replies and status changes appear in the UI.
- Preserve in-page state across background/show; persist comments across restart.
- Reject unauthenticated MCP, hostile Origin, and non-loopback Host requests.
- Report measured artifact size and the limits of Linux versus macOS validation.

## Deferred

Area/multiple selection, framework source plugins, cross-origin iframe and
closed-shadow-root picking, navigation ownership arbitration, server log
connectors, signed/notarized distribution, updater, and performance guarantees.
