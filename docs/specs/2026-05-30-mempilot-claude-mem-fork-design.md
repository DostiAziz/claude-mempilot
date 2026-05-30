# MemPilot — claude-mem fork design

**Status:** design approved, ready for implementation planning
**Date:** 2026-05-30
**Author:** dosti + Claude (brainstorming session)
**Supersedes:** [2026-05-28-mempilot-design.md](2026-05-28-mempilot-design.md) (the from-scratch design)

---

## Context

The original from-scratch MemPilot design was scoped against an inaccurate read of
the agent-memory landscape. After researching 14 existing systems (see
[`2026-05-28-mempilot-competitive-analysis.md`](2026-05-28-mempilot-competitive-analysis.md)),
the picture became clearer:

- **`claude-mem`** by thedotmack (79K stars, actively maintained, daily releases)
  already implements the bulk of what MemPilot's from-scratch design proposed:
  cross-agent install for Claude / Codex / Gemini / OpenCode / OpenClaw, hook-driven
  observation capture, structured LLM extraction, hybrid retrieval, automatic
  briefing on SessionStart via a "Progressive Disclosure" markdown index.
- claude-mem **already supports** swappable LLM providers natively
  (`CLAUDE_MEM_PROVIDER=gemini`) and a LiteLLM gateway pattern for local Ollama
  or any OpenAI-compatible model. Two of the user's stated goals are zero-code
  configuration changes against upstream claude-mem.
- claude-mem's SessionStart briefing is **already pure SQL** — Progressive
  Disclosure is a rendering strategy, not an LLM-mediated retrieval step. (One
  of the original spec's five differentiators is therefore moot — see correction
  note in the competitive analysis.)

What claude-mem does not have:

1. A **per-feature distill tier** that consolidates per-task observations into a
   single canonical reflection on git commit and supersedes the originals.
2. **`features` / `todos` / `decisions`** as first-class queryable entities
   with explicit lifecycles. claude-mem stores everything in free-text
   observation bodies.
3. A native **`gemini` CLI subprocess provider** for users who would rather
   reuse their existing `gemini` CLI OAuth than provision an AI Studio API key.

This spec defines a fork of claude-mem that adds those three things plus
the MCP tools that surface the new entities. Storage stays as claude-mem's
existing SQLite + Chroma. Briefing stays as claude-mem's existing
Progressive Disclosure (extended additively with the new entity types).

## Goals

1. **GeminiCliProvider** — new provider that spawns the local `gemini` CLI
   binary as a subprocess (`gemini -p <prompt>`), parses output, and returns
   results compatible with claude-mem's existing provider interface. Selectable
   via `CLAUDE_MEM_PROVIDER=gemini-cli`.
2. **Per-feature distill on git post-commit** — new CLI subcommand
   `claude-mem distill` + worker job. Gathers unclaimed scratch observations
   for the current branch, calls the configured LLM, writes a `distilled_reflection`
   row, claims the consumed observations, and supersedes the prior distill for
   the same feature. Idempotent: no new observations → no-op, no LLM call.
3. **New first-class tables**: `features`, `todos`, `distilled_reflections`,
   `decisions`. Additive SQLite migrations against claude-mem's existing
   schema. No replacement of existing tables.
4. **New MCP tools** that query the new tables: `list_decisions(topic?, project?)`,
   `get_feature_history(feature_name)`, `list_open_todos(project?)`,
   `list_features(status?, project?)`.
5. **Extend the Progressive-Disclosure briefing** with additional index sections
   for "Open features", "Recent decisions", and "Open TODOs". Same agent-autonomy
   pattern — emit titles + IDs + retrieval costs, let the agent decide what to
   fetch deeper via MCP.

## Non-goals

- **No storage replacement.** SQLite + Chroma stay. No Postgres, no pgvector,
  no replacement of `DatabaseManager.ts`.
- **No replacement of the briefing path.** claude-mem's Progressive Disclosure
  is already SQL-only; we extend it, we don't rewrite it.
- **No new transport layers.** Existing HTTP API + MCP server are reused.
- **No re-engineering of the observation capture flow.** Scratch observations
  continue to be captured by claude-mem's existing Stop/PostToolUse hooks,
  written by its existing observer pipeline.
- **No replacement of the Claude Agent SDK integration.** We add `GeminiCliProvider`
  as a sibling to `ClaudeProvider` / `GeminiProvider` / `OpenRouterProvider`,
  not as a replacement.
- **No multi-machine sync, no multi-tenant, no web UI for the new tables in v1.**
  All deferred to v1.1+.

## Fork strategy

Soft fork. The fork branches from a pinned claude-mem release tag, adds the
five features as additive changes, and is rebased periodically against upstream
main.

**What "additive" means concretely:**

- All new code lives in new files (e.g. `src/services/worker/GeminiCliProvider.ts`,
  `src/cli/commands/distill.ts`, `src/services/worker/DistillManager.ts`,
  `src/storage/migrations/00X_add_features_tables.sql`).
- Modifications to existing files are limited to:
  - Provider registry (one entry added for `gemini-cli`)
  - MCP tool registry (four entries added)
  - Briefing index renderer (three new sections appended)
  - Schema bootstrap (one call to the new migration)
- No deletions and no behavioral changes to claude-mem's existing capture/observation
  flow.

This keeps `git rebase upstream/main` mostly mechanical. Conflicts will be
limited to the registry files and the briefing renderer. If those become
sticky, we PR the new features upstream and shed the fork.

## Architecture

```
                claude-mem (upstream, unchanged paths)
   ┌────────────────────────────────────────────────────────┐
   │  Stop / PostToolUse / SessionEnd  hooks                │
   │    → existing observer pipeline                        │
   │    → SQLite observations + Chroma vector store         │
   │                                                        │
   │  SessionStart hook                                     │
   │    → existing /api/context/inject                      │
   │    → Progressive-Disclosure markdown index             │
   │                                                        │
   │  MCP server: search / timeline / get_observations      │
   └────────────────────────────────────────────────────────┘

                        ▲     ▲     ▲
                        │     │     │
                        │     │     └────────────────────┐
                        │     │                          │
                        │     └─────────────────┐        │
                        │                       │        │
                        ▼                       ▼        ▼
   ┌────────────────────────────────────────────────────────┐
   │                MemPilot additive layer                 │
   │                                                        │
   │  git post-commit hook                                  │
   │    → claude-mem distill                                │
   │    → DistillManager.processBranch()                    │
   │       ▸ select unclaimed scratch observations          │
   │       ▸ call configured LLM (incl. new GeminiCli)      │
   │       ▸ INSERT distilled_reflections (+ supersede)     │
   │       ▸ UPDATE observations.feature_id (claim)         │
   │       ▸ INSERT/UPDATE features, decisions, todos       │
   │                                                        │
   │  Briefing extension: appends 3 new index sections      │
   │    ▸ Open features                                     │
   │    ▸ Recent decisions                                  │
   │    ▸ Open TODOs                                        │
   │                                                        │
   │  MCP tools: list_decisions, get_feature_history,       │
   │             list_open_todos, list_features             │
   │                                                        │
   │  GeminiCliProvider: spawn `gemini -p` subprocess       │
   └────────────────────────────────────────────────────────┘
```

The arrows up-left indicate the additive layer reads from the same SQLite
file (it adds new tables to the existing database) and registers into the
same MCP server (it adds tools to the existing registry).

## Schema additions

All migrations are additive. Applied via claude-mem's existing migration
runner.

```sql
-- Add stamping columns to the existing observations table.
ALTER TABLE observations ADD COLUMN branch_name TEXT;
ALTER TABLE observations ADD COLUMN feature_id INTEGER;
CREATE INDEX idx_observations_branch_feature
  ON observations(branch_name, feature_id);

-- One row per feature (loosely == git branch, materialized on first distill).
CREATE TABLE features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,                  -- existing projects table
  branch_name TEXT NOT NULL,
  title TEXT NOT NULL,                          -- LLM-derived from first distill
  status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'merged' | 'abandoned'
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  merged_at TIMESTAMP,
  UNIQUE(project_id, branch_name)
);

-- One row per distill run. Chain via superseded_by gives audit history.
CREATE TABLE distilled_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  commit_sha_at_distill TEXT NOT NULL,
  consumed_observation_ids TEXT NOT NULL,       -- JSON array of observation IDs
  superseded_by INTEGER REFERENCES distilled_reflections(id),  -- NULL = current
  body_md TEXT NOT NULL,
  llm_model_used TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_distilled_feature_current
  ON distilled_reflections(feature_id) WHERE superseded_by IS NULL;

-- One row per decision the distill identified.
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  distilled_reflection_id INTEGER NOT NULL REFERENCES distilled_reflections(id),
  topic TEXT NOT NULL,
  choice TEXT NOT NULL,
  alternatives_rejected TEXT,                   -- JSON array of strings
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_decisions_topic ON decisions(topic);

-- One row per actionable TODO mined from distills' "lessons" / "next steps".
CREATE TABLE todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER REFERENCES features(id),   -- nullable: cross-feature TODOs
  source_distilled_reflection_id INTEGER REFERENCES distilled_reflections(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'done' | 'cancelled'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);
CREATE INDEX idx_todos_status ON todos(status) WHERE status = 'open';
```

## Feature 1 — GeminiCliProvider

Mirrors `src/services/worker/GeminiProvider.ts` but invokes the local
`gemini` CLI as a subprocess instead of the Gemini HTTP API. Reuses the
user's existing `gemini` CLI OAuth — no API key needed.

**File:** `src/services/worker/GeminiCliProvider.ts`

**Settings:**

```json
{
  "CLAUDE_MEM_PROVIDER": "gemini-cli",
  "CLAUDE_MEM_GEMINI_CLI_BINARY": "gemini",      // optional, defaults to `gemini` on PATH
  "CLAUDE_MEM_GEMINI_CLI_MODEL": "gemini-2.5-flash-lite"  // passed via `-m`
}
```

**Behavior:**

- On observation extraction call, spawn:
  `gemini -p <stdin-prompt> -m <model>` with the prompt piped to stdin.
- Capture stdout, expect the same XML observation format used by the other providers
  (claude-mem's contract — every provider returns this format).
- Map non-zero exit codes and stderr lines to `ClassifiedProviderError` kinds
  in line with how other providers do it (auth_invalid, transient,
  rate_limit, unrecoverable).
- No streaming. Subprocess produces full output, then returns.
- Hot-swappable like the other providers — changing `CLAUDE_MEM_PROVIDER` takes
  effect on the next observation.

**Registry change:** one entry added to the provider factory in
`src/services/worker/index.ts` (or equivalent). One TypeScript file new,
~150–200 LOC.

## Feature 2 — Per-feature distill on git post-commit

### 2a. New CLI subcommand

`claude-mem distill [--feature <branch>] [--force]`

- Default: distill the current branch, no force.
- `--feature` to target a different branch (useful for cleanup).
- `--force` to ignore the "unclaimed scratches only" filter and re-distill
  from the full history — re-runs the LLM with the full set, supersedes
  the current distill.

### 2b. Per-repo install

`claude-mem init` (new subcommand) inside a repo:

1. Reads `git remote get-url origin`, falls back to absolute path. Registers
   the repo in claude-mem's existing `projects` table.
2. Installs `.git/hooks/post-commit`:
   ```sh
   #!/bin/sh
   claude-mem distill --project "$(git rev-parse --show-toplevel)" \
                      --commit "$(git rev-parse HEAD)" &
   ```
   Backgrounded so commits stay fast.

### 2c. Distill algorithm (idempotent claim-and-supersede)

```text
def distill(project, branch, commit_sha, force=False):
    feature = find_or_create_feature(project, branch)
    prior_distill = current_distill_for(feature)

    if force:
        candidate_obs = all_observations(project, branch)
    else:
        candidate_obs = observations
            .where(project_id == project.id)
            .where(branch_name == branch)
            .where(feature_id IS NULL)              # unclaimed
            .where(created_at > prior_distill.created_at if prior_distill else true)

    if not candidate_obs and not force:
        return                                       # no-op, no LLM call

    debounce_seconds = settings.CLAUDE_MEM_DISTILL_DEBOUNCE_SECONDS       # default 60
    min_observations = settings.CLAUDE_MEM_DISTILL_DEBOUNCE_MIN_OBSERVATIONS  # default 3
    if prior_distill and len(candidate_obs) < min_observations and
       seconds_since(prior_distill.created_at) < debounce_seconds:
        return                                       # wait for more scratches

    diff_summary = git_diff(branch, base='main')
    llm_input = build_distill_prompt(prior_distill, candidate_obs, diff_summary)
    llm_output = configured_provider.run(llm_input)
    parsed = parse_distill_output(llm_output)
        # { body_md, decisions[], lessons[], todos[], suggested_title }

    with sqlite_transaction:
        new_distill = INSERT distilled_reflections (
            feature_id=feature.id,
            commit_sha_at_distill=commit_sha,
            consumed_observation_ids=[o.id for o in candidate_obs],
            body_md=parsed.body_md,
            llm_model_used=configured_provider.model,
        )

        if prior_distill:
            UPDATE prior_distill SET superseded_by = new_distill.id

        UPDATE observations
            SET feature_id = feature.id
            WHERE id IN candidate_obs.ids

        for d in parsed.decisions:
            INSERT decisions (feature_id, distilled_reflection_id=new_distill.id, ...d)

        for t in parsed.todos:
            INSERT todos (feature_id, source_distilled_reflection_id=new_distill.id, body=t.text, status='open')

        # find_or_create_feature() creates new rows with title = branch_name.
        # First successful distill replaces it with the LLM's suggested title.
        if feature.title == feature.branch_name and parsed.suggested_title:
            UPDATE features SET title = parsed.suggested_title

        if git_branch_contains_main(commit_sha):
            UPDATE features SET status = 'merged', merged_at = now()

    return new_distill
```

### 2d. Idempotency properties

| Scenario | Outcome |
|---|---|
| 10 commits, no new scratches between any | First commit may distill once. Commits 2–10 find no unclaimed observations and exit. Zero LLM calls. Zero DB writes. |
| 10 commits with 1 new scratch between each | Each post-commit distill processes only the 1 new scratch + the prior distill. 10 chained distill rows, each `superseded_by`-linked. |
| Two post-commit hooks running concurrently | SQLite WAL + transaction serialization: one wins, the other sees claimed `feature_id` rows and exits. Worst case: brief blocking. Never duplication. |
| User runs `git reset --hard HEAD~1` | Distills already written stay as audit history. Observations stay claimed by their `feature_id`. The next commit picks up from the new HEAD. |
| Branch is squash-merged into main | post-commit on main detects via `git branch --contains` and fires a final distill that closes out any unclaimed scratches on the feature branch, then sets `Feature.status = 'merged'`. |
| `--force` flag passed | Ignores the "unclaimed only" filter, re-distills from the full history. Useful when the distill prompt is improved and you want a re-run. |
| User switches branches mid-work | Scratches are stamped with `branch_name` at write time. If you write a scratch on branch A then switch to B before committing, the scratch is tied to A. A's distill picks it up on A's next commit. |

### 2e. Branch detection at scratch write time

Modify the existing observation writer (small change in
`src/services/worker/SessionManager.ts` or equivalent) to call
`git -C <project_path> branch --show-current` and stamp the result on the
new `branch_name` column. If the project is not a git repo, leave NULL.

## Feature 3 — New tables

Covered above in the Schema additions section.

## Feature 4 — New MCP tools

Added to claude-mem's existing MCP server. The four new tools:

| Tool | Purpose | Query |
|---|---|---|
| `list_decisions(topic?, project?, limit=20)` | "What did we decide about X across projects?" | `SELECT * FROM decisions WHERE topic LIKE ? AND feature.project_id = ? ORDER BY created_at DESC` |
| `get_feature_history(feature_name)` | "Walk through how we got here for feature X." | `SELECT * FROM distilled_reflections WHERE feature_id = ? ORDER BY created_at ASC` (chronological, including superseded ones) |
| `list_open_todos(project?, limit=20)` | "What did past sessions say I still need to do?" | `SELECT * FROM todos WHERE status='open' AND (feature.project_id = ? OR feature_id IS NULL) ORDER BY created_at DESC` |
| `list_features(status?, project?)` | "What features are open / merged / abandoned?" | `SELECT * FROM features WHERE status = ? AND project_id = ? ORDER BY opened_at DESC` |

Each tool returns a compact JSON array. Each row includes an MCP-citation
URL pattern matching claude-mem's existing convention so the agent can deep-fetch
related observations via `get_observations(ids)`.

## Feature 5 — Briefing extension

claude-mem's `/api/context/inject` returns a markdown index. The fork
appends three new sections AFTER the existing observation index:

```markdown
## Open features ({count})

| ID | Branch | Title | Opened | Last distill | Tokens |
|----|--------|-------|--------|---------------|--------|
| F#12 | feature/auth-refactor | Refactor JWT middleware | 3d ago | 2h ago | ~340 |
| F#11 | feature/q22-decay | Add memory decay policy | 5d ago | 1d ago | ~280 |

*Use list_features / get_feature_history for details.*

## Recent decisions ({count})

| ID | Topic | Choice | Feature | Date |
|----|-------|--------|---------|------|
| D#87 | trigger | git post-commit not PR-close | F#12 | yesterday |
| D#86 | retrieval | hybrid FTS+vector RRF | F#11 | 2d ago |

*Use list_decisions for details.*

## Open TODOs ({count})

| ID | Body | Feature |
|----|------|---------|
| T#34 | Add reconnect with exponential backoff | F#12 |
| T#33 | Document the decay heuristic | F#11 |

*Use list_open_todos for details.*
```

Token budget guidelines:
- Hard cap of 1K tokens for these three sections combined (existing
  observation index keeps its own budget).
- Truncation order: TODOs first, then decisions, then features.
- The sections are skipped entirely if all three are empty (fresh project).

Implementation: extend the renderer in claude-mem's context handler
(`src/cli/handlers/context.ts` or its `worker`-side equivalent) to call
into a new `BriefingExtensions` module that queries the new tables and
emits the additional markdown.

## Settings additions

All additive against claude-mem's existing settings JSON:

```json
{
  "CLAUDE_MEM_PROVIDER": "gemini-cli",        // new value supported
  "CLAUDE_MEM_GEMINI_CLI_BINARY": "gemini",
  "CLAUDE_MEM_GEMINI_CLI_MODEL": "gemini-2.5-flash-lite",
  "CLAUDE_MEM_DISTILL_DEBOUNCE_SECONDS": 60,   // optional, default 60
  "CLAUDE_MEM_DISTILL_DEBOUNCE_MIN_OBSERVATIONS": 3,  // optional, default 3
  "CLAUDE_MEM_BRIEFING_EXTENSIONS": true       // optional, default true
}
```

Setting `CLAUDE_MEM_BRIEFING_EXTENSIONS=false` reverts to upstream
claude-mem briefing behavior — useful when debugging or comparing.

## Bootstrap UX

```bash
# One-time per machine
npm install -g @yourorg/claude-mem-pilot      # OR npx run
claude-mem-pilot install                       # wraps upstream installer, adds fork pieces
# Selects Gemini CLI provider if requested:
#   CLAUDE_MEM_PROVIDER=gemini-cli

# Per repo
cd ~/projects/some-repo
claude-mem-pilot init                          # registers project, installs git post-commit
```

`claude-mem-pilot install` runs upstream `claude-mem install` first
(handing it any flags), then:
- Runs the new migrations against `~/.claude-mem/db.sqlite`
- Registers the `gemini-cli` provider entry in settings
- Writes the post-commit hook installer

## Component-level acceptance criteria

| Component | "Done" means |
|---|---|
| GeminiCliProvider | Given a fixture transcript, returns a well-formed XML observation; tested against `gemini --version` mock and real binary; auth errors map to correct `ClassifiedProviderError`. |
| Schema migrations | Run idempotently against a fresh DB AND against a DB previously installed via upstream claude-mem; verified by integration test that bootstraps both shapes. |
| DistillManager | Unit-tested on the idempotency cases above (no new scratches, concurrent runs, branch switching, squash merge, `--force`). Each case has a fixture and an assertion on what should be written. |
| Briefing extension | Renders correctly with 0/1/many features, decisions, TODOs. Hard cap respected. Setting `CLAUDE_MEM_BRIEFING_EXTENSIONS=false` reverts to upstream output exactly. |
| MCP tools | Each tool tested via the MCP test harness claude-mem already ships. Queries pass on seed data; pagination works; empty-result responses are well-formed. |
| End-to-end | One coding task → scratch observations land → git commit → distill produces a row → next session's briefing shows the new entries → agent can `get_feature_history` to retrieve the chain. Verified by a single scripted scenario. |

## Compatibility with upstream

What kinds of upstream changes can the fork absorb safely:

- **New observation types / icons** — additive in upstream, doesn't touch our code paths.
- **New providers** — additive in upstream, our `gemini-cli` is just another sibling.
- **New MCP tools upstream** — additive in upstream, our four sit alongside.
- **Settings additions upstream** — additive, namespace `CLAUDE_MEM_*` is generous.
- **Storage migrations upstream** — likely additive; if they collide with our migration numbers, we shift ours.

What kinds of upstream changes would require fork-side rework:

- **Replacement of the storage engine** (e.g., SQLite → Postgres upstream).
  Unlikely but would force fork-side migration rewrite.
- **Rewrite of the briefing renderer** signature. Likely a small fix.
- **Rewrite of the provider interface.** Likely a small fix in GeminiCliProvider.

Cadence: rebase against upstream main weekly during active development;
monthly during steady state. If conflicts persist for two consecutive
rebases, evaluate PR'ing the features upstream and shedding the fork.

## Deferred / out of scope for v1

| Deferred to | What |
|---|---|
| v1.1 | Viewer UI sections for features / decisions / todos (read-only) |
| v1.1 | `claude-mem-pilot prune` command for archival |
| v1.2 | Multi-machine sync (today, single-machine via claude-mem's SQLite) |
| v2 | Multi-tenant / team-shared memory |
| v2 | Storage migration to Postgres (if scale ever demands) |
| Not planned | Secret redaction (user confirmed not needed) |
| Not planned | RBAC / per-row ACLs |

## Open questions for implementation planning

1. **Exact upstream tag to fork from.** claude-mem releases multiple times a day;
   we need to pin a specific release tag at fork creation and document it in
   the README.
2. **GeminiCliProvider's prompt-piping mechanism.** Does the `gemini` CLI accept
   stdin via `-p -`? Or do we need to write to a temp file? Verify by running
   the binary locally before writing the provider class.
3. **Whether to upstream the GeminiCliProvider.** It benefits anyone using the
   Gemini CLI, not just us. Worth opening a PR against thedotmack/claude-mem
   in parallel with the fork — if accepted upstream, that's one less thing to
   maintain.
4. **Whether to upstream the per-feature distill tier.** Larger, more opinionated
   feature; depends on maintainer's interest. Could try after the fork is
   working locally for 2-3 weeks and we've shaken out bugs.
5. **Migration numbering convention.** Need to check upstream's migration
   numbering scheme to pick non-colliding numbers for our additive migrations.
6. **Test-harness shape.** Upstream tests live in `tests/` — what framework, what
   helpers? Inspect before writing distill tests.
7. **Project resolution from `cwd`** in `claude-mem-pilot init`. Upstream
   `getProjectContext(cwd)` (seen in `src/cli/handlers/context.ts`) already
   does this. Confirm it surfaces the project_id our migrations expect.
