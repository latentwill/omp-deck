# Skills

The `/skills` view is the cockpit's read-only inventory of every skill exposed
by your installed marketplace plugins. It's the answer to "what's currently
available to my agent?" — a complement to `/marketplace`, which answers "what
can I install?"

## Concepts

A **skill** is a Markdown file (`SKILL.md`) plus any co-located scripts,
references, agents, or assets. Skills don't ship on their own — they're nested
inside **plugins**:

```
~/.omp/plugins/cache/plugins/<plugin>/
├── .claude-plugin/plugin.json
├── skills/
│   ├── <skill-a>/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   └── references/
│   └── <skill-b>/SKILL.md
├── commands/
├── hooks/
└── ...
```

The deck enumerates skills under `skills/*/SKILL.md` and parses the
frontmatter (`name`, `description`, optional `triggers`, `model`, `tags`) so
the cockpit can show what each skill actually does.

omp-deck and the omp CLI share the same plugin store (`~/.omp/plugins/`), so
anything you install through one shows up in the other immediately.

## What you see

### Left sidebar

- **Scope** — filter by `user` (installed under `~/.omp/`) vs `project`
  (installed under `<repo>/.omp/`, scoped to the active workspace).
- **Plugin** — filter to skills from a single owning plugin.

### Skill list (middle pane)

One row per skill. Each row carries:

- the skill name (from frontmatter, falls back to its directory name),
- a `Package` glyph + owning plugin + scope badge,
- the description (clamped to two lines).

Disabled plugins grey out their skills and tag them as `disabled`. Use the
search box at the top of the main pane to filter by name, description,
triggers, or tags.

### Detail pane

- Header with skill name, source plugin (`<name>@<marketplace>`), and scope.
- Description, triggers, tags.
- Rendered `SKILL.md` body (frontmatter stripped), reusing the chat's
  Markdown + `highlight.js` pipeline.

### Right inspector

Frontmatter as a definition list (name, dir, plugin, scope, enabled, model
when present, absolute SKILL.md path), followed by the list of co-located
files with their sizes. Symlinks, `node_modules`, `__pycache__`, `.git`,
`.venv`, `venv`, `dist`, and `build` are filtered out server-side.

## Lifecycle

- **Install / uninstall** continue to live on the
  [Marketplace](./marketplaces.md) view; the Skills view is read-only.
- **Enable / disable** is **plugin-level**, not skill-level. Toggling a
  plugin off in Marketplace greys out every skill it ships. The Skills view
  shows the inherited state but does not expose a toggle of its own — the
  SDK has no finer-grained on/off than the plugin.
- **Live updates**: the deck broadcasts a `skills_changed` WebSocket frame
  whenever a plugin install / uninstall / enable / disable lands, or when
  anything under `~/.omp/plugins/cache/plugins/` mutates on disk. Open
  `/skills` and watch the list update without polling. The watcher is
  debounced 250 ms to coalesce filesystem bursts during install.

## Environment

- `OMP_DECK_WATCH_SKILLS=0` disables the disk watcher (useful on filesystems
  that misbehave under recursive `fs.watch` — some VPNs, network drives,
  OneDrive shadowing). The view still works; it just won't auto-refresh when
  changes happen outside the deck's own REST endpoints.

## REST surface

The view consumes two endpoints:

- `GET /api/skills` → `{ skills: SkillSummary[], plugins: InstalledPluginInfo[] }`
- `GET /api/skills/:pluginId/:skillName` → `SkillSummary` + `body` (SKILL.md,
  frontmatter stripped) + `files` (recursive walk, capped at 500 entries and
  depth 6).

Path params can be either bare (`skill-creator@claude-plugins-official`) or
percent-encoded; Hono auto-decodes either way.

## What's next

The Skills view is Phase 1 of the
[Skills Cockpit proposal](./proposals/skills-cockpit.md). Phase 2 surfaces
`checkForUpdates` / `upgradePlugin` and adds a project-scope install toggle;
Phase 3 wires usage telemetry, a fork-to-project editor, and the eval /
description-tuner loop around the upstream `skill-creator` plugin.
