# Proposal: Skills Cockpit

Status: revised 2026-05-20 (omp-native pivot)
Author: omp-deck team
Tracks: post-v0.1 — "self-improving skills" gap noted in `README.md` "How it
compares" table. The original draft built against the Claude-plugin marketplace
path only; this revision puts **omp-native skills** at the center and treats
marketplace as one source among many.

## Why

The marketplace answers "what can I install?" It doesn't answer "what's
installed, what's it doing for me, and how do I make it better over time?"
Most of the perceived "self-improving" feel of adaptive agents comes from
**visibility + a one-click iteration loop** on the user's own skills, not
background autonomy.

This proposal turns omp-deck into the cockpit for that loop. **Native to omp,
not native to Claude Code.** Three shippable phases.

## How omp loads skills today (the substrate)

`omp` discovers skills from **multiple providers** through its capability
system. The SDK exposes `loadCapability(skillCapability.id, { cwd })` which
returns every skill across every provider, each tagged with
`_source: { provider, providerName, sourcePath }` plus a `level: "user" | "project"`.

Providers (from `@oh-my-pi/pi-coding-agent/discovery`):

| Provider          | User location                                | Project location                            | Notes                                                              |
|-------------------|----------------------------------------------|---------------------------------------------|--------------------------------------------------------------------|
| **`native` (OMP)** | `~/.omp/agent/skills/`                       | `<cwd>/.omp/skills/` (ancestor walk)        | omp's own home for skills the user authors                         |
| `claude-plugins`  | `~/.omp/plugins/cache/plugins/<plugin>/skills/` | same                                     | marketplace-installed plugins; Claude-plugin format used as interop |
| `claude`          | `~/.claude/skills/`                          | `<cwd>/.claude/skills/` (ancestor walk)     | shared with Claude Code config                                     |
| `codex`           | `~/.codex/skills/`                           | `<cwd>/.codex/skills/`                      | shared with Codex CLI                                              |
| `opencode`        | `~/.config/opencode/skills/`                 | `<cwd>/.opencode/skills/`                   |                                                                    |
| `cursor`, `windsurf`, `cline`, `gemini`, `agents` | various                  | various                                     | each agent tool's conventional dir                                 |

Each skill is `<dir>/SKILL.md` (+ optional co-located scripts/refs/assets).
Only the `description` (frontmatter) hits the system prompt at session start;
the SKILL.md body is injected on `/skill:<name>` invoke; co-located files are
**reachable on demand** (progressive disclosure) but never auto-loaded.

### Implication for the cockpit

omp is intentionally polyglot. The cockpit must reflect that — show every
provider, group by it, and **default the view to `native` first** so the
omp-authored surface is where the user lives. Marketplace plugins remain one
source among many, badged with portability caveats since Claude-plugin
ecosystem skills can hardcode `claude -p`, `.claude/commands/`, Task-tool
named subagents, and other Claude Code dependencies omp doesn't satisfy.

## Gap vs. the v0.1 deck

| Concern                                                       | State today                                  |
|---------------------------------------------------------------|----------------------------------------------|
| "What plugins are installed?"                                 | ✅ deck shows plugin-level list              |
| "What native omp skills do I have?"                           | ❌ SkillsService only walks marketplace      |
| "What other providers contribute skills?"                     | ❌ not surfaced                              |
| "What does this skill actually do?"                           | ⚠️ shown for marketplace skills only         |
| "Is this skill safe to install in omp?"                       | ❌ no portability signal                     |
| "Can I author a new omp-native skill?"                        | ❌ shell-out only                            |
| "Can I run an eval / description-tuner loop?"                 | ❌ upstream loop is Claude-Code-bound        |
| "Which skills fired in this session?"                         | ❌ no telemetry                              |

## Phases

Each phase ends in a usable feature; later phases assume the previous shipped.

### Phase 1 — Inventory (shipped, with a Phase 1.5 correction)

A `/skills` view that lists every skill exposed by every enabled provider,
with enough metadata to act on. Shipped in T-27..T-30 against the marketplace
provider only.

**Phase 1.5 (T-31)**: repoint `SkillsService` at `loadCapability(skillCapability.id, { cwd })`
so it returns the union across all providers. Surface `provider` and
`providerLabel` on each row. Default sort: `native` first, then
`claude-plugins`, then others. Widen the watcher to native + claude-plugins
roots (others on demand). Documented in `docs/skills.md`.

REST shape after 1.5:

- `GET /api/skills?cwd=<abs>` → `{ skills: SkillSummary[] }`. `cwd` defaults
  to the deck's `defaultCwd`; the web client passes the active session's
  `cwd` for project-scoped resolution.
- `GET /api/skills/:id` → detail. `id` is a server-issued composite
  (`<provider>__<level>__<pluginOrDir>`); URL-safe, opaque to clients, stable
  across reads.
- WS `skills_changed` broadcasts on any watched root mutating.

### Phase 2 — Lifecycle ("keep them fresh")

Turn the cockpit into a maintenance surface.

- `GET /api/marketplace/updates` → `MarketplaceManager.checkForUpdates()`.
- `POST /api/marketplace/plugins/:id/upgrade` → `upgradePlugin` /
  `upgradePluginAcrossScopes`.
- Skills nav badge: "N updates available"; per-row "Upgrade" action.
- Project-scope install toggle in the install dialog. Resolves project root
  via `resolveActiveProjectRegistryPath` against the active session's `cwd`.
- New built-in routine `skills:refresh` (template, not pre-installed):
  `refreshStaleMarketplaces` + `checkForUpdates`, fans the diff into Inbox.
- **Native-side housekeeping**: surface `~/.omp/agent/skills/` skills that
  have been edited but never invoked, plus a "convert to project scope"
  action that moves an authored skill into the active session's
  `.omp/skills/`.

### Phase 3 — Iteration ("make them better"), deck-native

This is the phase that changes most under the omp-native pivot. The original
plan wired upstream `skill-creator/scripts/run_eval.py` and
`improve_description.py`. Both shell out to `claude -p` and use
`.claude/commands/` — they measure Claude Code, not omp.

The replacement is a deck-native eval loop built around `InProcessAgentBridge`:

- **Targets**: `native` provider skills (the user's own under
  `~/.omp/agent/skills/` or `<project>/.omp/skills/`). Marketplace and other
  providers are read-only; iterate them by forking first.
- **"New skill"** opens a chat session prefilled with an omp-flavored
  authoring prompt (the *pattern* from upstream skill-creator, with
  `claude -p` references removed and replaced with omp idioms). Writes the
  result to `~/.omp/agent/skills/<name>/SKILL.md`.
- **"Fork to omp-native"** copies a skill from any non-native provider into
  the user's `~/.omp/agent/skills/` or the project's `.omp/skills/`. The
  source URL stays in a `_source` field for traceability. Now editable.
- **"Run eval"** spins up an omp session against a project-local
  `tests/prompts.jsonl` using `InProcessAgentBridge`. Captures trigger
  detection from the existing session event stream (no instrumentation
  changes required). Writes a review HTML in the same format as upstream.
  Zero subprocess. Works for every omp user.
- **"Tune description"** sends the SKILL.md + measured trigger rates back
  through `InProcessAgentBridge` with a tuning prompt. Returns a diff;
  "Apply" commits via the edit-in-place path.
- **Portability probe**: scan each skill's SKILL.md + co-located scripts for
  Claude-Code dependencies (`claude -p`, `.claude/commands/`,
  `Task(subagent_type=`, common subprocess shell-outs to `claude`). Flag
  risky installs with a row badge + "Why?" link to matching lines. Catches
  the common cases without becoming a full static analyzer.
- **Telemetry**: `skill_invocations(session_id, skill_id, ts, kind)` SQLite
  table. Attributed from existing session events (best-effort — see
  proposal v1; semantics unchanged). `GET /api/skills/:id/usage` returns
  counts + last-7-day sparkline.
- **Editor pane** reuses the existing CodeMirror surface (T-25). Saves
  through a server-side write that respects scope boundaries (refuses to
  write into `~/.claude/skills/` or `~/.omp/plugins/cache/plugins/...` —
  fork first).

## What this is NOT (yet)

- **Autonomous in-session skill refinement** (the Hermes pitch). Needs an
  SDK-side hook the omp agent loop doesn't expose, plus a budgeted
  refinement turn. v0.4+ research.
- **A wrapper around upstream skill-creator scripts.** We borrow the
  *pattern* — test prompts → trigger rate → description tuning — and
  reimplement against `InProcessAgentBridge`. We don't shell out to
  `claude -p`.
- **Skill-level enable/disable.** SDK granularity is plugin-level (for
  marketplace) or provider-level toggles in `loadSkills` options. The UI
  shows inheritance and lets you disable at the right knob, but doesn't lie
  about finer control.
- **Agent-initiated skill installs** (the OpenClaw model). Stays an explicit
  user action.
- **omp subagent registration.** Plugin-level subagents live at
  `<plugin>/agents/` and are managed by `omp agents`. Skill-nested
  `agents/<x>.md` files are NOT registered as omp subagents — they're prompt
  files that a skill's own scripts may pass over stdin. Worth its own doc;
  not this proposal.

## Risks / sharp edges

- `installed_plugins.json` is shared with the omp CLI. Always write through
  `MarketplaceManager`; never mutate the file directly.
- Watching `~/.omp/plugins/cache/plugins/`, `~/.omp/agent/skills/`, and
  project `.omp/skills/` with `fs.watch` misbehaves on OneDrive / network
  drives. Wrap each watch with try/catch; fall back to no-op + manual
  refresh on first error. `OMP_DECK_WATCH_SKILLS=0` still kills the watcher
  globally.
- "Fork to omp-native" needs to write somewhere safe. Refuse to write into
  any provider that's a mirror of an external tool's config
  (`~/.claude/skills/`, `~/.codex/skills/`, etc.). Allowed targets:
  `~/.omp/agent/skills/` (user) and `<active-session-cwd>/.omp/skills/`
  (project). Surface the chosen target before writing.
- Project-scope `cwd` resolution: when the deck has multiple active sessions
  with different cwds, the "project" providers will see different skills per
  session. The `/skills` view takes `?cwd=` so the user explicitly picks
  which project lens to use. Default to deck's `defaultCwd`.
- Portability probe must NOT be a hard block — it's advisory. Some skills
  reference `claude` in prose without depending on it.

## Tasks to file (deck kanban)

Phase 1.5 (the pivot):

- **T-31** Repoint `SkillsService` at `loadCapability(skillCapability.id)`;
  surface all providers; widen watcher; switch detail route to `/:id`;
  default sort native-first; update web view's filter rail to "Source".

Phase 2:

- `GET /api/marketplace/updates` + `POST .../upgrade`
- Skills nav "Updates available" badge + per-row upgrade
- Project-scope install toggle (uses active session cwd)
- `skills:refresh` routine template → Inbox digest
- Native-side housekeeping ("convert to project scope" action)

Phase 3:

- Portability probe + row badge ("safe to install in omp?")
- `skill_invocations` table + capture from session events
- `GET /api/skills/:id/usage` + Usage tab
- "Fork to omp-native" (writes into `~/.omp/agent/skills/` or
  `<project>/.omp/skills/` with safe-target enforcement)
- Project-scoped editor pane writing into `~/.omp/agent/skills/` /
  `<project>/.omp/skills/`
- "Run eval" reimplemented against `InProcessAgentBridge`
  (NOT shelling out to `skill-creator/scripts/run_eval.py`)
- "Tune description" via `InProcessAgentBridge`
- "New skill" CTA → chat session prefilled with omp-flavored authoring prompt

## Future (v0.4+ research)

- Push for an SDK hook `onSkillTriggered(skillId, ctx)` so telemetry stops
  being inferred and starts being authoritative.
- Per-session skill budget: limit how often a single skill can fire.
- Background "skill drift" routine: re-run evals for installed skills weekly,
  flag regressions caused by upstream plugin updates.
- Agent-driven refinement turn, gated behind explicit user opt-in per skill.
- First-class omp subagent integration with skills — when a skill names a
  subagent role, auto-resolve against `omp agents`' registry.
