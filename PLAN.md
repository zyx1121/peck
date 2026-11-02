# Peck

Peck is a dedicated Chromium browser shared by a human and their existing
coding agent. Tagline: **Point it out.** By zyx.

## Accepted scope

- Electron and TypeScript, with one Chromium WebContentsView per page window.
  No tab strip: each page is its own window, and all windows share one local
  MCP and profile.
- The browser workspace fills the window. A single toolbar row holds only the
  traffic lights, the page title (the address while editing), element
  selection, and a menu. Agents drive Peck, so everything else (panel toggles,
  new window, back, forward, reload) lives in the menu or a shortcut. The panels stack in
  one resizable sidebar. The page and sidebar extend to the bottom edge. The
  interface is English and black only, separated by hairlines, without gray
  layers or a light theme. No outer website template, product heading, corner
  links, status footer, or copyright footer.
- Visible and background modes preserve the same live page. When an agent's
  bridge opens Peck, it runs headless: windows stay hidden and Peck stays out
  of the Dock until someone shows a window. No separate headless engine and no embedded model. Peck never starts a new agent. When
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
