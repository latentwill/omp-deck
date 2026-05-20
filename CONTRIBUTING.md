# Contributing to omp-deck

Thanks for your interest. omp-deck is a small enough project that there is no
heavyweight process — but a few conventions keep the codebase tidy.

## Repo layout

```
apps/
  server/          # Bun + Hono backend that embeds @oh-my-pi/pi-coding-agent
  web/             # Vite + React + Tailwind frontend
  bridges/
    telegram/      # Standalone Bun process — long-poll Telegram bridge
packages/
  protocol/        # Dep-free shared types (REST + WS frames)
docs/              # Markdown documentation site
```

Workspaces are wired through Bun's `workspaces` field in the root `package.json`.

## Dev loop

```sh
bun install
bun run dev          # spawns server (8787) + vite (5173) in parallel
```

If you want them in separate terminals:

```sh
bun run dev:server
bun run dev:web
```

The telegram bridge only runs on demand (Settings → Messaging → Start, or `bun run dev:telegram`).

## Code quality

- `bun run typecheck` must pass before opening a PR.
- `bun run --filter '@omp-deck/web' build` must build clean.
- New REST routes go through `packages/protocol` types — no `any` at the wire.
- New SDK touchpoints go through `apps/server/src/bridge` — the route layer
  must not import `@oh-my-pi/pi-coding-agent` directly.
- WS broadcast frames go through `apps/server/src/broadcast-bus.ts`.
- Deck slash commands live in `apps/server/src/deck-slash-commands.ts`.

## Testing changes

Right now the project has no unit-test harness — verification is end-to-end
via:

1. `bun run typecheck`
2. Manual browser smoke against `http://127.0.0.1:5173`
3. API smokes — small PowerShell or curl scripts under `.logs/` (gitignored)

If you add a feature with non-trivial state, ship a short script in `.logs/`
that exercises it. Long-term we will introduce `bun test` for the bridge layer.

## Style

- TypeScript strict mode is on. No `// @ts-ignore` without a justification comment.
- Tailwind tokens through the theme system (`rgb(var(--token) / <alpha-value>)`).
  Do not introduce raw hex colors outside `apps/web/src/styles.css`.
- React: function components, hooks. No class components, no HOCs.
- Server: Hono + Bun. No Express.

## Commits

Conventional Commits welcome but not enforced. Keep messages descriptive —
"fix bug" is not enough; "fix: kanban refetch missed broadcast on inbox-promote"
is.

## Filing issues

If you hit a bug, a minimal repro plus your `bun --version`, OS, and
`@oh-my-pi/pi-coding-agent` version is all we need.

## License

By contributing you agree that your contributions are licensed under the MIT
license (see [LICENSE](./LICENSE)).
