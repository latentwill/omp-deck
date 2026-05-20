# Changelog

All notable changes to omp-deck. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — Initial public release

First release. End-to-end verified against a live omp turn.

### Chat
- Multi-session sidebar with workspace filter.
- Live streaming text, thinking blocks, tool-call lifecycle with per-tool
  renderers (`read` / `write` / `edit` / `bash` / `search` / `lsp` / `task` /
  `web_search` / `eval` / `todo_write` / `generate_image` / `browser` /
  `ast_grep` / `ast_edit`).
- Hashline-diff renderer for the `edit` tool.
- Todos panel from `todo_reminder`.
- Cost/usage rollup (input/output/cache/reasoning, USD).
- Image paste / drag / attach with thumbnail strip and `[Image #N]` placeholder.
- Compaction, retry, and TTSR indicators inline.
- Slash command picker with four scopes — `deck` (kanban operations),
  `builtin` (omp SDK), `user`, `project`.
- Built-in slash command dispatch in-process (no model round-trip) for SDK
  commands with text-mode handlers: `/context`, `/usage`, `/tools`, `/compact`,
  `/rename`, `/dump`, `/memory *`, `/mcp *`, etc.
- Deck-native slash commands: `/task add`, `/task list`, `/task done`,
  `/task move`. Operate directly on the kanban; zero token cost.
- `@filepath` mention autocomplete in the composer.
- Copy buttons on every code block.
- Context-window indicator with manual `/compact` popover.
- Streaming caret, blink-on-idle.

### Tasks (kanban)
- Backlog / Active / Blocked / Done with drag-and-drop.
- User-configurable columns with reorder + recolor.
- Human-friendly display IDs (`T-1`, `T-2`, ...) via a monotonic sequence.
- Promote-from-inbox flow.
- Live WS broadcast — any mutation (UI, deck slash, agent REST) refetches all
  open kanbans without polling.

### Routines
- Cron scheduler (`croner`) for `bash` / `prompt` / `script` actions.
- Run history with stdout/stderr excerpts.
- Manual fire-now.

### Inbox
- Quick-capture with kind taxonomy (email / ticket / idea / decision /
  investigation / capture).
- Promote-to-task one-click flow.

### Settings
- **Env** — masked secret list, replace-or-unset modal, atomic `.env` write
  to `<dataDir>/.env`, append-only audit log, hot-apply for
  `LOG_LEVEL` / `OMP_DECK_IDLE_TIMEOUT_MS` / `OMP_DECK_AUTO_START` /
  `OMP_DECK_DEFAULT_CWD` / `OMP_DECK_WORKSPACES`, restart-required banner with
  one-click restart.
- **Messaging** — Telegram credential rows, bridge supervisor with Start /
  Stop / Restart buttons, live logs panel, status pill (running / stopped /
  crashed).
- **Appearance** — Paper (warm cream) and Slate (dark) themes with swatch
  previews, system-preference following, FOUC-free pre-paint applied before
  React mounts. `data-theme` attribute on `<html>` swaps every Tailwind color
  + font token via CSS custom properties.

### Marketplace
- Three-panel browser over the SDK's `MarketplaceManager`.
- Suggested empty-state seeds with `anthropics/claude-plugins-official`.
- Install / uninstall / refresh per plugin or per source.
- Capability badges (`cmds` / `agents` / `hooks` / `mcp` / `lsp`).

### Native model picker
- Header label opens a modal listing every SDK model.
- Available (369) / All (2587) toggle.
- Provider grouping with the active model's provider floated to the top.
- Auth gating — picks against an unauthed model surface the SDK error inline.

### Messaging
- Standalone Telegram bridge in `apps/bridges/telegram/`.
- Long-poll, allowlist-gated, per-chat session map persisted to SQLite.
- Image attachments downloaded and forwarded as omp `ImageAttachment`.
- Debounced `editMessageText` to avoid Telegram rate-limits.
- Supervised by the deck server — Start / Stop / Restart from the Settings UI.

### First-run UX
- Auto-start (`OMP_DECK_AUTO_START`) **disabled by default**. Opt in by
  writing `~/.omp/agent/commands/start.md` and setting the env var.
- Empty `tasks` table seeds a `T-1: Welcome to omp-deck` backlog task with
  orientation pointers (nav rail, themes, deck slash commands, docs links).

### Deployment
- Loopback-only by default. Tailscale Serve, Docker, and SSH-tunnel patterns
  documented in `docs/deployment.md`.
- `POST /api/server/restart` graceful restart endpoint.

### Architecture
- Bun + Hono backend embedding `@oh-my-pi/pi-coding-agent`.
- `AgentBridge` interface so a subprocess-per-session impl can drop in later.
- WS event passthrough (`session_event`) with deck-side synthetic events for
  context-usage, slash-command round-trips, and model swaps.
- Dep-free `@omp-deck/protocol` package owns the wire types.
