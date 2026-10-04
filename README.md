# peck

> Point it out.

A Chromium desktop browser for you and your coding agent. Point at an element,
leave a comment, and give your existing Codex or Claude Code conversation the
screenshot, selector, console errors, and network context it needs.

[![CI](https://github.com/zyx1121/peck/actions/workflows/ci.yml/badge.svg)](https://github.com/zyx1121/peck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Peck keeps its own browser profile. Hide the window while your agent works,
then show the same live page when you want to review it. Your everyday browser
stays separate. No model account or API key is required by Peck itself.

Each page opens in its own window with one compact toolbar row: navigation,
the page title (click it to edit the address), element selection, the
inspector toggle, a new window button, and a menu for Local MCP, theme, and
background mode. Closing a window closes its page. **移至背景** (Cmd+H) hides the
window and keeps the page alive. The local MCP runs until you quit Peck.

## Try the demo

Download the Apple Silicon app from [Releases](https://github.com/zyx1121/peck/releases).
Open Peck, then use the built-in Fieldnotes playground or enter your own dev URL.
The demo is unsigned and not notarized.

1. Click the pointer button (**選取元件**) or press **Cmd+Shift+C**, then click a
   page element.
2. Write a comment in the right panel and send it.
3. Connect your agent through local MCP. Ask it to watch and process Peck feedback.
4. Read its reply in the original comment. Reply again to queue another pass.

The playground's save button deliberately returns HTTP 422. Use it to inspect
real request and response details in Network and an error in Console.
The playground does not run a simulated agent or automatically pretend to fix code.

## Connect your existing agent

Peck includes an authenticated loopback HTTP MCP server and a stdio bridge.
The bridge discovers the running app's port and token from its local connection
file. You do not need a separate Node.js installation or a second browser.

Choose **Local MCP…** from the toolbar menu or the Peck menu, then copy the
client configuration. For an app at
`/Applications/Peck.app`, the generic MCP configuration is:

```json
{
  "mcpServers": {
    "peck": {
      "command": "/Applications/Peck.app/Contents/MacOS/Peck",
      "args": ["/Applications/Peck.app/Contents/Resources/app.asar/dist-electron/bridge.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

For Codex:

```sh
codex mcp add peck --env ELECTRON_RUN_AS_NODE=1 -- \
  /Applications/Peck.app/Contents/MacOS/Peck \
  /Applications/Peck.app/Contents/Resources/app.asar/dist-electron/bridge.cjs
```

For Claude Code:

```sh
claude mcp add --scope user peck --env ELECTRON_RUN_AS_NODE=1 -- \
  /Applications/Peck.app/Contents/MacOS/Peck \
  /Applications/Peck.app/Contents/Resources/app.asar/dist-electron/bridge.cjs
```

Use the actual install path. Start a new agent session after registering MCP.
The optional [Peck skill](skills/peck/SKILL.md) describes the feedback loop.

> Use Peck to watch my comments. Read each item's screenshot and debug context,
> fix the current project's source, verify the result, and reply in the comment.

`peck_watch_annotations` waits for feedback in the current conversation. A
closed conversation is not automatically restarted. Unprocessed feedback stays
in SQLite for the next session. Peck never runs an additional coding agent.

## Dev plugin

For a backend bug, add Peck's dev plugin to the project for the debugging
session. Ask your agent to call `peck_dev_plugin` with `next` or `vite`; it
returns one file, `peck-dev.mjs`, and the exact edits. The plugin serves
`/__peck/events` on the dev server with server console output, uncaught
errors, and failed requests, each tagged with the request that caused it.
Requests need Peck's local token.

It runs only in development: Vite applies it to `vite dev` only, and the
Next.js instrumentation hooks load it only in `next dev` without bundling it.
Remove it when the problem is solved with `peck_dev_plugin` and
`action: "remove"`, and keep it out of commits. Production monitoring belongs
in your usual observability backend.

## Tools

| Tool | Purpose |
| --- | --- |
| `peck_status` | Inspect page windows, connection activity, and pending comments |
| `peck_tabs` | List, open, activate, and close page windows |
| `peck_navigate` | Open an HTTP(S) URL in a specific page window |
| `peck_snapshot` | Read page text and interactive elements |
| `peck_evaluate` | Inspect or interact with a page using JavaScript |
| `peck_click` | Click an element with real, trusted mouse events |
| `peck_type` | Focus an element and type with real key events |
| `peck_press` | Press a key or a combination such as `Escape` or `Meta+A` |
| `peck_wait` | Wait for a load, navigation, element, text, URL, or network idle |
| `peck_screenshot` | Capture a page image |
| `peck_events` | Query captured console, network, and system records |
| `peck_annotations` | List feedback and status |
| `peck_annotation_get` | Fetch one comment, screenshot, and frozen context |
| `peck_annotation_update` | Acknowledge, reply, or resolve with a summary |
| `peck_watch_annotations` | Wait for new or reopened feedback |
| `peck_dev_server` | List and call the dev server's own MCP tools, such as Next.js `/_next/mcp` |
| `peck_dev_plugin` | Get the removable dev plugin and the steps to add or remove it |
| `peck_window` | Show or hide a page window without reloading it |

Page contents are untrusted evidence. Temporary DOM edits are not source fixes.
The coding agent remains responsible for locating, changing, and verifying the
actual project using its existing tools and permissions.

## How it works

Electron provides Chromium and the Node.js runtime. Each page window holds the
toolbar shell and a sandboxed, context-isolated WebContentsView. CDP captures browser events; a small isolated
preload provides the DOM picker. UI and MCP read the same SQLite data.

- Local data: `~/Library/Application Support/Peck` on macOS.
- The HTTP listener binds only to `127.0.0.1`, validates Host, rejects Origin,
  and requires a random token. The connection file is written with mode 600.
- Sensitive header and JSON field names are redacted. Plain-text responses,
  console messages, screenshots, and page text can still contain private data.
- Events keep up to approximately 3,000 records and expire after seven days on
  startup. Text bodies are captured only for small responses and truncated to
  16,000 characters. Binary response bodies are omitted.
- Comments record where the element is written: a build-time `data-insp-path`
  or `data-source` attribute, or a React dev build's owner stack mapped
  through the dev server's source maps (Vite, and Next.js including server
  components). The project needs no changes. Peck fetches scripts and maps
  only from the page's own origin.
- Comments keep a screenshot and the 30 most recent records at selection time.
  Comments persist until their local data is removed. They are not sent to a
  cloud service by Peck unless an agent explicitly reads them through MCP.

Optional operational traces use `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SERVICE_NAME`. Unset means disabled.
Only operation names, IDs, success state, and timing are exported, not comments,
URLs, tokens, screenshots, or response bodies.

## Develop

Node.js 22.12+ is required for build tools. The packaged app bundles its runtime.
In Loki's environment, all commands below run on the sandbox VM, not the MacBook.

```sh
npm ci
npm run build
npm start
# Linux integration verification with a virtual desktop:
xvfb-run -a -s '-screen 0 1600x1100x24' npm run smoke
# Build the macOS Apple Silicon app from Linux or macOS:
npm run package:mac
```

The smoke script drives actual Electron windows and the actual MCP protocol. It
checks element selection, screenshot/context delivery, real HTTP failures,
redaction, authentication, reply synchronization, background state, multiple
windows, the stdio bridge, and persistence across restart. Artifacts are written to
`output/playwright/`. See [AGENTS.md](AGENTS.md) for project rules.

## Demo limits

- DOM picking targets the top-level document. Cross-origin frames, closed
  shadow roots, and area selection are future work. Source locations cover
  React dev builds and build-time attributes; other frameworks fall back to
  the selector. Canvas content can be selected only as a canvas element.
- Up to eight page windows share one dedicated Peck profile. Windows are not
  restored after fully quitting. Comments are restored.
- No automatic source edits, model runtime, closed-session wakeup, updater,
  signed distribution, or macOS performance guarantees are included.
- WebSocket entries contain frame metadata, not message bodies. Backend logs
  require a separate integration. Browser permission requests are denied in
  the demo, including camera, microphone, and location.
- Human/agent navigation arbitration is not implemented. Agents should avoid
  moving the page while the user selects or writes feedback.

## Contributing

Issues and PRs are welcome. Follow [CONTRIBUTING.md](https://github.com/zyx1121/.github/blob/main/CONTRIBUTING.md).
The UI uses the [ui.zyx.tw](https://ui.zyx.tw) theme in a full-window desktop
browser layout: one compact toolbar per page window and an inspector.

## License

[MIT](LICENSE). By zyx.
