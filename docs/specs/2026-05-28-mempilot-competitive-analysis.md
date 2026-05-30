# MemPilot — competitive analysis

**Date:** 2026-05-28
**Purpose:** Honest comparison of MemPilot's design against existing agent-memory
systems, to validate (or challenge) whether MemPilot is worth building given what
already exists.

> **Correction (2026-05-30):** This document asserts that claude-mem and
> agentmemory "both default to LLM-mediated retrieval at session-start"
> (see "MemPilot's genuine differentiators" #5 and "Where MemPilot is derivative").
> Verified after publication: **claude-mem's SessionStart briefing is pure
> SQL**, not LLM-mediated. "Progressive Disclosure" is a rendering strategy
> (markdown index with titles, IDs, types, token counts) that lets the agent
> decide what to fetch deeper via MCP — the LLM call happens at observation
> *extraction* time, not at briefing time. Differentiator #5 (pure-SQL read
> path) is therefore **not** unique to MemPilot. The overall recommendation
> (hybrid: adopt existing tool, contribute the remaining differentiators)
> still holds — see [the claude-mem fork design](2026-05-30-mempilot-claude-mem-fork-design.md)
> for the revised, smaller scope.

## TL;DR

**MemPilot, as currently designed, is largely a reinvention of `claude-mem`
(thedotmack), `agentmemory` (rohitg00), and to a lesser extent MemPalace.** Each
of those already supports Claude Code + Codex + Gemini + several other CLIs from
a single install, with auto-trigger on session lifecycle hooks, auto-briefing on
session start, structured reflections, and hybrid FTS+vector retrieval. They are
also significantly more mature (claude-mem: 65.8K stars; agentmemory: 18.9K;
MemPalace: 53K). The only spec items that are not already shipped by at least
one competitor are: (1) the **git post-commit "distill" tier** that consolidates
per-task scratches into one per-feature reflection, (2) the **`features` /
`todos` first-class entities with `superseded_by` chains**, and (3) the
**dedicated `decisions` JSONB with `list_decisions` MCP tool**. Everything else
— hooks, Postgres, hybrid search, cross-agent, briefing-on-start, structured
JSON observer — is already in the field. A reasonable engineer should adopt
`agentmemory` or `claude-mem` and contribute the three differentiated features
upstream, rather than building from scratch. Building from scratch only makes
sense if the goal is learning, or if those upstream projects are rejected for
specific reasons (license, architecture, dependency footprint) that this design
doc does not document.

## Landscape map

The agent-memory space in 2025-2026 has converged into roughly six categories.
MemPilot's current scope places it in **Category 2** alongside the most direct
competitors.

| # | Category | What it is | Representative projects |
|---|---|---|---|
| 1 | **Filesystem-only auto-memory** | Hooks edit a CLAUDE.md / MEMORY.md file in place. No DB. | `claude-code-auto-memory`, Hermes Agent's built-in MEMORY.md/USER.md, `claude-memory-compiler` |
| 2 | **Hook-driven local DB for coding CLIs** | Background DB (SQLite or Postgres+pgvector), hook-triggered writes, MCP-mediated reads. Cross-agent. **MemPilot's target category.** | `claude-mem` (thedotmack), `agentmemory` (rohitg00), MemPalace (MemPalace/mempalace), `memory-palace` (jeffpierce), `memory-mcp` (yuvalsuede), `claude-memory-mcp` (FirmengruppeViola) |
| 3 | **General-purpose memory SDK** | Library/server you embed in your own agent app. Not CLI-integrated by default. | Mem0, Cognee, Honcho |
| 4 | **Managed-cloud memory platform** | Hosted service, API key, SOC2 etc. Aimed at production agent deployments, not solo devs. | Zep / Graphiti, Supermemory, Mem0 Cloud |
| 5 | **Stateful-agent runtimes (memory + agent loop together)** | The memory is inside the agent server; you build agents on the platform. | Letta (ex-MemGPT), Hermes Agent |
| 6 | **Temporal knowledge graphs** | Memory is a fact graph with validity windows; sub-category that cuts across 3/4. | Zep/Graphiti, Cognee, Supermemory |

## Detailed comparison table

| Project | Backend | Cross-agent (out of the box) | Cross-project | Auto-trigger | Reflection structuring | Retrieval | Briefing-on-start | License | Maturity |
|---|---|---|---|---|---|---|---|---|---|
| **MemPilot** (this spec) | Postgres + pgvector | Yes (Claude/Codex/Gemini) | Yes | Stop hook + **git post-commit distill** | Structured JSON (title/what/why/decisions/lessons/files/terms) + `features` + `todos` + `superseded_by` chain | Hybrid FTS + pgvector (RRF) | Yes, pure-SQL, ≤2K tokens | (planned: MIT/Apache) | Design only |
| **claude-mem** (thedotmack) [link](https://github.com/thedotmack/claude-mem) | SQLite + Chroma | Yes (Claude, Codex, Gemini, OpenClaw, Hermes, Copilot, OpenCode) | Yes | 5 lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) | "Observations" + "summaries" (semantic compression), not feature/decision-typed | Hybrid (vector + FTS5), 3-layer progressive disclosure via 4 MCP tools | Yes (progressive disclosure) | Apache-2.0 | **65.8K stars, v13.3.0, May 2026** |
| **agentmemory** (rohitg00) [link](https://github.com/rohitg00/agentmemory) | SQLite + in-memory vector (Postgres optional) | Yes (20+ agents inc. Claude/Cursor/Codex/Gemini/Hermes/OpenClaw) | Yes (multi-instance via iii-pubsub) | 12 hooks (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PreCompact/Sub*/Stop/SessionEnd) | Slot-based (`persona`, `user_preferences`, `tool_guidelines`, `project_context`, `guidance`, `pending_items`, `session_patterns`, `self_notes`) + 4-tier consolidation (Working→Episodic→Semantic→Procedural) | Triple-stream hybrid: BM25 + vector + KG (RRF k=60) with session-level diversification | Yes (~2K-token budget) | Apache-2.0 | **18.9K stars, v0.9.22, May 2026** |
| **MemPalace** (MemPalace/mempalace) [link](https://github.com/MemPalace/mempalace) | SQLite + pluggable vector (ChromaDB default) | Partial (mining hooks for Claude Code; Gemini docs exist) | Yes | Auto-save hooks (periodic + pre-compaction); `mempalace mine` backfills Claude logs | Wings (people/projects) / Rooms (topics) / Drawers (verbatim content); temporal ER graph with validity windows | Raw semantic search (96.6% R@5) or hybrid v4 (98.4%) | Implicit via recall queries (no separate session-start briefing documented) | MIT | **53K stars, v3.3.5, May 2026; benchmarks controversial — hand-tuned 100%, honest 96.6%** |
| **memory-palace** (jeffpierce) [link](https://github.com/jeffpierce/memory-palace) | SQLite (personal) or Postgres+pgvector (teams); local Ollama for embeddings | Yes (any MCP client) | Yes (named DB domains) | **Manual MCP calls only — no auto-trigger** | KG with `memory_link` / `memory_unlink`; `memory_reflect` tool | Semantic + KG via 13 MCP tools | **No** — graph context included in recall results, not pre-injected | MIT | 43 stars, v2.0.1 (Feb 2026); small but well-designed |
| **claude-code-auto-memory** (severity1) [link](https://github.com/severity1/claude-code-auto-memory) | Filesystem (`.claude/auto-memory/`) | Claude Code only | Per-project | PostToolUse + Stop, or "gitmode" = on-commit-only | Marker-based CLAUDE.md updates (HTML comment regions) | N/A (file IS the context) | Yes (CLAUDE.md is loaded by Claude automatically) | MIT | 146 stars |
| **claude-memory-compiler** (coleam00) [link](https://github.com/coleam00/claude-memory-compiler) | Filesystem markdown index + daily logs | Claude Code only | Per-project | Session end / pre-compaction hooks + scheduled compile after 6 PM | Daily logs → concept articles compiled by Claude Agent SDK (Karpathy LLM-KB architecture) | Structured `index.md` (no RAG; LLM reads index directly) | Yes via SessionStart injecting index | (unstated) | 1.1K stars |
| **Hermes Agent** (NousResearch) [link](https://github.com/NousResearch/hermes-agent) | MEMORY.md/USER.md files + 8 pluggable providers (Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory) | **Hermes is itself an agent**, not a memory layer for other CLIs | N/A (per-agent install) | Self-edited at session boundaries; full reflection loop | Hard-capped files (2,200 / 1,375 chars) + provider-specific extensions | SQLite FTS5 `session_search` + provider-specific | Yes (system-prompt-injected, frozen at start) | (unstated, open-source) | 171K stars, v0.14.0 (May 2026); huge but **not a memory layer for Claude/Codex/Gemini — it IS its own agent** |
| **Mem0** (mem0ai) [link](https://github.com/mem0ai/mem0) | Vector + KV + graph (Qdrant default, 20+ vector backends) | Skills exist for Claude Code, Codex, Cursor; not hook-integrated by default | Yes (cloud or self-host) | Manual `mem0 add`; agent skills exist; **no native lifecycle-hook auto-capture** | Single-pass fact extraction → multi-signal retrieval; not "features/decisions" typed | Semantic + BM25 + entity matching | No native session-start briefing for CLIs; you must call skills | Apache-2.0 | 56.9K stars; LoCoMo 91.6 (2026 paper) |
| **Letta** (ex-MemGPT) [link](https://github.com/letta-ai/letta) | Postgres (alembic migrations) | **Letta is an agent runtime; not a memory layer for Claude Code** | Per-agent | OS-inspired memory hierarchy (core/archival/recall); agent self-edits | Persistent editable memory blocks + archival store | Tier-based hierarchy (in-context vs archival) | N/A (runtime owns the loop) | Apache-2.0 | Mature; well-known from MemGPT paper |
| **Zep / Graphiti** (getzep) [link](https://github.com/getzep/zep) | Managed cloud (community edition deprecated to `legacy/`) | API/SDK only — no CLI integration | Per-app | API call on each message | Temporal context graph with validity windows | <200ms KG-aware retrieval (DMR 94.8%) | API-driven (you assemble the prompt) | Apache-2.0 (SDK); cloud-only practically | Production-grade SaaS |
| **Supermemory** (supermemory.ai) [link](https://github.com/supermemoryai/supermemory) | Managed (also on-prem K8s/bare-metal) | API only | Per-app | API call | Five-layer stack (connectors, extractors, RAG, graph, profiles) | Hybrid + rerank, <300ms | API-driven | Apache-2.0 SDK | #1 on LongMemEval/LoCoMo/ConvoMem; 30+ enterprise users |
| **Cognee** (topoteretes) [link](https://github.com/topoteretes/cognee) | Graph + vector hybrid (LanceDB default; pgvector/Qdrant/Redis/etc supported) | MCP server exists; not coding-CLI-hook-integrated by default | Yes | Manual `cognify` / `memify` calls | ECL pipeline: classify → chunk → entity-extract → summarize → embed; pluggable graph schemas | Graph + vector hybrid via 5-line API | Not native | Apache-2.0 (presumed) | 6K+ stars; GitHub Secure Open Source graduate |
| **Honcho** (plastic-labs) [link](https://github.com/plastic-labs/honcho) | FastAPI server + DB | Provider for Hermes; Claude/OpenClaw integrations exist (claude-honcho, openclaw-honcho) | Per-app | API on each message | Peer-based: Conclusions, Representations, Peer Cards, Session summaries | Static representation endpoint (low-latency) + LLM-mediated | Via representation endpoint (must call) | Apache-2.0 | Active |

## Per-project deep dives

### 1. `claude-mem` (thedotmack) — the most-shipped direct competitor

**Architecture.** SQLite for structured data + Chroma for semantic search. Five
lifecycle hooks plus a pre-hook smart installer. Four MCP tools designed for
progressive disclosure (`search`, `timeline`, `get_observations`).

**What it does well.** Cross-agent claim is real: explicitly lists Claude Code,
OpenClaw, Codex, Gemini, Hermes, Copilot, OpenCode. Has 65.8K stars and an
extremely active release cadence (244 releases, v13.3.0 May 2026). Single `npx
claude-mem install` is unbeatable as a bootstrap experience. Apache-2.0.

**What it does poorly / where MemPilot would differ.** It compresses sessions
into "observations" and "summaries" — there is **no concept of
features/decisions/TODOs as first-class entities, no per-feature distill, no
`superseded_by` chain, no `list_decisions` tool**. Storage is SQLite, not
Postgres+pgvector — fine for single-machine but harder to grow into the
team-shared / multi-tenant direction MemPilot's schema explicitly anticipates.
Vector store is Chroma, not pgvector — two engines instead of one.

**Would MemPilot's users be better off using this?** For 80% of solo-dev use
cases: probably yes, today. The remaining 20% — users who want explicit
per-feature distill on git post-commit and queryable `decisions` — would need
to build that on top of claude-mem or fork it.

### 2. `agentmemory` (rohitg00) — the most architecturally similar

**Architecture.** Built on a custom "iii engine" (three primitives: workers,
functions, triggers). SQLite + in-memory vector + optional Postgres for scale.
Twelve lifecycle hooks (more than claude-mem). MCP surface is huge: 53 tools,
6 resources, 3 prompts, 8 skills.

**What it does well.** Cross-agent (20+ agents). Multi-machine via `iii-pubsub`
worker — a capability MemPilot defers to v1.2. Four-tier consolidation
(Working→Episodic→Semantic→Procedural) is more theoretically grounded than
MemPilot's scratch→distilled. Ebbinghaus decay is built in (MemPilot defers
`prune` to v1.1). LongMemEval-S R@5 of 95.2% is the highest claimed in the
field after MemPalace.

**What it does poorly / where MemPilot would differ.** **Massive tool surface
(53 MCP tools) is overkill** for MemPilot's stated philosophy ("five tools, not
more"). The "iii engine" runtime is a custom abstraction users have to learn
and trust — claude-mem and MemPilot both stick to standard stacks. No
git-commit trigger documented — same gap as claude-mem. Slot-based reflection
(persona/preferences/tool-guidelines/etc) is closer to user-profile shaping
than to per-feature reflections.

**Would MemPilot's users be better off using this?** Yes for most cases.
Reasons to reject: (a) skepticism of the iii-engine custom runtime;
(b) preference for Postgres-first as MemPilot specifies; (c) the 53-tool
surface area is unappealing.

### 3. MemPalace (MemPalace/mempalace) — the benchmark-leader with a metaphor

**Architecture.** SQLite knowledge graph + pluggable vector store (Chroma
default). Wings/rooms/drawers metaphor is the structural innovation: wings are
domains (project/person/topic), halls are repeating memory types across wings,
rooms are subjects, drawers store verbatim text. Temporal ER graph with
validity windows. 29 MCP tools.

**What it does well.** Benchmark dominance (96.6%–98.4% R@5 on LongMemEval).
Each specialist agent gets its own wing — clean isolation. Verbatim storage
philosophy ("does not summarize, extract, or paraphrase") is the opposite of
MemPilot's structured-JSON-observer approach and avoids the
hallucination-during-extraction risk.

**What it does poorly / where MemPilot would differ.** The 100% benchmark
score was hand-tuned — that controversy is documented in mainstream coverage
(`explainx.ai`, `artificiallyintimidating.com`) and matters for trust. MemPalace
is **not natively cross-CLI** — it has Claude-mining tooling and Gemini docs
but no documented single-install setup for Codex. The wings/rooms/halls
metaphor is cognitive overhead the design spec for MemPilot explicitly rejects.

**Would MemPilot's users be better off using this?** Probably not, unless the
LongMemEval R@5 score matters more than cross-agent install simplicity.

### 4. `memory-palace` (jeffpierce) — the disciplined small project

**Architecture.** SQLite (solo) or Postgres+pgvector (teams). Embeddings run
locally via Ollama. 13 MCP tools. Cleanly separated `memory_set`/`memory_recall`
/`memory_link`/`memory_reflect` etc.

**What it does well.** Clean architecture; honest scope; 100% Ollama-local;
multi-backend in the same project.

**What it does poorly / where MemPilot would differ.** **No auto-trigger** —
operations are manual MCP calls. **No briefing-on-start.** That's exactly the
two things MemPilot is trying to add. So MemPilot is roughly "`memory-palace`
+ Stop hook + git post-commit + auto-briefing", which is a reasonable framing.

**Would MemPilot's users be better off using this?** Only if they want full
manual control and don't want auto-capture.

### 5. Hermes Agent (NousResearch) — not a memory layer, an agent

**What it actually is.** A full general-purpose agent framework with its own
loop, subagent spawning, scheduled automation, multi-platform integration
(Telegram/Discord/Slack). The MEMORY.md/USER.md system is *inside* Hermes for
Hermes, not exposed to Claude Code / Codex / Gemini. There is an open issue
([#10835](https://github.com/NousResearch/hermes-agent/issues/10835)) requesting
exactly the bridge MemPilot would provide.

**Would MemPilot's users be better off using this?** No — different category.
But the Hermes design is a useful reference for the MEMORY.md/USER.md hard
char-cap approach (2,200 / 1,375) and the system-prompt-frozen-at-start
discipline. MemPilot's "≤2K token briefing, no LLM call" is essentially the
same insight.

### 6. Mem0, Letta, Zep, Cognee, Supermemory, Honcho — general-purpose

These are not aimed at CLI coding assistants. They are libraries/services you
embed in **your own agent application**, not memory layers that hook into
Claude Code's session lifecycle. Mem0 has the closest CLI surface (`mem0 init
--agent claude-code` + skills) but no native lifecycle-hook auto-capture.
Letta and Hermes own the agent loop. Zep, Supermemory, and Cognee are
managed/general-purpose. They are not direct MemPilot competitors except as
candidate **storage providers** under MemPilot's pluggable backend.

## MemPilot's genuine differentiators

Based on this research, the following are not implemented in any of the
direct competitors verified above:

1. **Per-feature distill via git post-commit hook with `superseded_by` chain.**
   Every competitor either (a) writes per-task only (claude-mem, agentmemory,
   MemPalace, memory-palace), (b) writes per-session only (Hermes), or (c)
   schedules-batch-compiles like claude-memory-compiler does at 6PM. None has a
   git-commit-triggered "consolidate the scratches for this feature into one
   distilled reflection and supersede the originals" workflow. This is
   defensible signature behavior.
2. **`decisions` JSONB as first-class queryable field + `list_decisions` MCP
   tool.** Other systems capture "summaries" or "observations" but do not
   expose `(topic, choice, alternatives_rejected, reason)` as a queryable
   schema. This is a small but real differentiator for users who want to
   answer "what did we decide about X, why, and what did we reject?" across
   projects.
3. **`features` and `todos` as separate tables with explicit
   open/merged/abandoned and open/done/cancelled lifecycles.** Competitors
   leave these inside the memory body. Promoting them to tables enables
   `get_feature_history(feature_name)` as a single-query MCP call instead of a
   semantic search.
4. **Postgres+pgvector as the primary store rather than SQLite+ChromaDB.**
   Of the hook-driven local-DB competitors, only `memory-palace` (jeffpierce)
   supports Postgres, and that one has no auto-triggers. Postgres-first opens
   a clean upgrade path to multi-tenant / team-shared (v2 in the spec) without
   re-platforming.
5. **No LLM call on the read path.** claude-mem and agentmemory both default
   to LLM-mediated retrieval at session-start; MemPilot's "pure SQL, <100ms"
   briefing is a real latency / cost difference. (Note: agentmemory also
   supports a `no-op` observer mode, so this isn't unique under all configs.)

None of these are individually revolutionary. Bundled together they are a
coherent thesis: **memory should be relational about software development
artifacts (features, decisions, TODOs), not just text-similar to past
sessions.**

## Where MemPilot is derivative

Don't claim novelty on any of these. They are all already shipping in
competitors:

- **Cross-agent install for Claude/Codex/Gemini.** Shipped in claude-mem
  (since 2025), agentmemory.
- **Stop / SessionEnd hook → background reflection.** Shipped in claude-mem,
  agentmemory, claude-code-auto-memory, claude-memory-compiler.
- **Cheap-LLM observer that reads transcript+diff and emits structured JSON.**
  Shipped in claude-mem (compresses to "observations" via AI), agentmemory
  (PostToolUse compression), claude-memory-compiler (Claude Agent SDK
  extraction).
- **Hybrid FTS + vector retrieval with RRF.** Shipped in agentmemory
  (BM25 + vector + KG with RRF k=60) and claude-mem (vector + FTS5).
- **Auto-inject briefing on SessionStart.** Shipped in claude-mem, agentmemory,
  claude-memory-compiler, Hermes Agent.
- **Single-package install per machine, multi-repo.** Shipped in claude-mem
  (`npx claude-mem install`), agentmemory (`npm i -g`).
- **MCP-mediated on-demand search.** Standard across the entire category.
- **Cross-project scope.** Shipped in agentmemory, claude-mem, MemPalace,
  memory-palace.

## Where MemPilot is weaker than competitors

Honest list:

- **No multi-machine sync (v1).** `agentmemory` ships `iii-pubsub` for
  multi-instance memory union; this matters for users who code from two
  machines.
- **No archival / decay policy (v1).** `agentmemory` implements Ebbinghaus
  decay; MemPilot defers `prune`.
- **No structural metaphor for navigation.** MemPalace's wings/rooms/halls
  give users a clear mental model. MemPilot's "flat table with filters" is
  simpler but harder to explain to non-engineers.
- **No web UI for browsing (v1).** `agentmemory` viewer auto-starts on port
  3113; users who want to browse reflections need to query SQL until v1.1.
- **No benchmark numbers.** claude-mem, agentmemory, MemPalace, Mem0,
  Supermemory all publish LongMemEval / LoCoMo / R@5 scores. MemPilot has
  none. For a new entrant in a benchmark-heavy field, this is a credibility
  gap.
- **Heavier dependency footprint (Postgres + Docker required).** claude-mem
  and agentmemory work from npm with SQLite alone. Users on locked-down
  machines or who want to avoid Docker will pick a competitor.
- **No verbatim-storage option.** MemPalace's "no summarize, no extract,
  no paraphrase" approach avoids LLM-hallucination-during-extraction. MemPilot
  trusts the cheap-LLM observer; that trust is not free.
- **Two-tier scratch/distilled requires git discipline.** Users who don't
  branch-per-feature or who squash-merge get a less-useful distill workflow.
- **Smaller MCP surface (5 vs 13–53 in competitors).** Defensible as a design
  choice, but users who want graph traversal, archive operations, audit
  tools, etc., will find MemPilot thin.

## Should you build MemPilot, or use X?

**Honest recommendation: hybrid — start by using `agentmemory` (or
`claude-mem`), then build only the three things that are actually
differentiated.**

The reasoning:

1. The largest cost in this project is not architecture — it's the integration
   surface (hooks for three CLIs, MCP server, observer, briefing pipeline,
   installer UX). Two competitors have already solved that and ship it. You
   should not pay that cost again.
2. The three real differentiators (per-feature distill on git post-commit;
   first-class `features`/`todos`/`decisions`; pure-SQL read path) are
   *implementable as additions to* either claude-mem or agentmemory. They do
   not require a from-scratch system.
3. Building from scratch will take weeks. The end result is unlikely to be
   meaningfully better than `agentmemory` for the first 6 months — and
   `agentmemory` will continue to release in that time.
4. If those three features are valuable, contributing them upstream gets you
   peer review, a user base, and a chance the maintainer accepts the
   architecture as canonical.

**Build-from-scratch is only the right call if:**

- You explicitly reject the npm/Node toolchain of claude-mem and agentmemory.
  (Justifiable for a Python shop; the InboxPilot codebase is already Python.)
- You explicitly want Postgres-first because team-shared v2 is a near-term
  goal.
- You consider the iii-engine custom runtime in `agentmemory` an architectural
  smell.
- You want this as a learning project. (Legitimate; just be honest about it.)
- License or governance concerns rule out using either upstream.

**Hybrid recommended path:**

1. Install `agentmemory` and live with it for two weeks. Confirm the gaps.
2. If the gaps are confirmed to be (a) git-commit distill, (b) decisions JSONB,
   (c) features/todos as tables — open three PRs upstream.
3. If those PRs are rejected or stagnate, fork.
4. If during step 1 you find the gaps are larger than expected (e.g.,
   agentmemory's iii-engine runtime is actually unmaintainable, or the 53-tool
   MCP surface is genuinely user-hostile), then build MemPilot from scratch
   with no apologies. The design spec is good enough to support that decision.

## Open questions raised by this research

1. **Should MemPilot publish benchmark numbers?** Every credible competitor
   publishes LongMemEval / LoCoMo / R@5. Not doing so on launch will hurt
   credibility. Plan budget for running these.
2. **Should the LLM observer mode be optional?** `agentmemory` defaults to
   no-op observer (zero LLM cost). MemPilot's design assumes an LLM call on
   every Stop hook. For users worried about cost or offline use, a `summarize:
   false` mode that stores raw transcript chunks + computed embeddings only
   (no LLM call) would be a useful addition.
3. **Why not adopt MemPalace's wing/room/hall metaphor as an
   optional view?** The flat `reflections` table + `kind` discriminator is
   simpler to query, but users may find it harder to navigate. A view layer
   that surfaces (project, feature, decision_topic) as a tree is cheap to
   add.
4. **Is the npm vs pipx packaging choice locking out users?** All three direct
   competitors ship via npm. The InboxPilot/Python preference is fine for
   the author but reduces install audience by an unknown amount. Worth
   measuring.
5. **What's the integration with Hermes Agent #10835?** That open issue is
   explicitly asking for the bridge MemPilot would provide. If you build,
   coordinate with NousResearch — a single MCP server adopted by both is a
   stronger ecosystem outcome than two parallel ones.
6. **How does the "5 MCP tools, not more" philosophy survive contact with
   real use?** claude-mem ships 4; memory-palace ships 13; MemPalace ships 29;
   agentmemory ships 53. The 4–13 range looks healthy; >13 looks bloated.
   MemPilot's 5 is defensible, but expect pressure to add (e.g.,
   `list_features`, `link_reflections`, `archive_reflection`).
7. **Have you confirmed Codex CLI and Gemini CLI actually fire `Stop` /
   `SessionEnd` / equivalent hooks?** The design spec lists this as an open
   question (item 4 / 5 in the implementation-planning section). The answer
   matters: if Codex doesn't expose a session-end hook, the cross-agent claim
   is reduced to "Claude + Gemini" until Codex adds one. Verify before
   committing the design.

## Sources

- [MemPalace/mempalace](https://github.com/MemPalace/mempalace) — SQLite + temporal ER graph, wings/rooms/halls metaphor, 29 MCP tools, 53K stars, MIT.
- [MemPalace benchmark controversy (explainx.ai)](https://explainx.ai/blog/mempalace-local-ai-memory-github) — hand-tuned 100% LongMemEval; honest 96.6%.
- [MemPalace review (artificiallyintimidating.com)](https://artificiallyintimidating.com/p/mempalace-ai-memory-review-benchmarks) — independent assessment of benchmark claims.
- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — general agent framework with MEMORY.md/USER.md + 8 external providers; 171K stars.
- [Hermes Agent memory docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) — MEMORY.md/USER.md char caps + system prompt freeze pattern.
- [Hermes Agent issue #10835](https://github.com/NousResearch/hermes-agent/issues/10835) — request to expose Hermes memory via MCP for use by other CLIs.
- [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) — iii-engine runtime, 53 MCP tools, 12 hooks, multi-instance via pubsub, 18.9K stars, Apache-2.0, v0.9.22 May 2026.
- [agentmemory deep guide (cognitionus.com)](https://www.cognitionus.com/blog/agentmemory-guide) — independent description of cross-agent install across Cursor/Cline/Goose/Aider/Windsurf.
- [jeffpierce/memory-palace](https://github.com/jeffpierce/memory-palace) — SQLite or Postgres+pgvector, 13 MCP tools, MIT, 43 stars, v2.0.1 Feb 2026.
- [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — SQLite + Chroma, 5 lifecycle hooks, 4 MCP tools, cross-agent, 65.8K stars, Apache-2.0, v13.3.0 May 2026.
- [customable/claude-mem](https://github.com/customable/claude-mem) — fork with Qdrant + OpenCode support.
- [Augment Code on claude-mem 65K stars](https://www.augmentcode.com/learn/claude-mem-65k-stars) — adoption context.
- [coleam00/claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler) — Karpathy LLM-KB architecture, daily logs + scheduled compile, 1.1K stars.
- [severity1/claude-code-auto-memory](https://github.com/severity1/claude-code-auto-memory) — filesystem CLAUDE.md auto-update via marker comments, 146 stars, MIT.
- [mem0ai/mem0](https://github.com/mem0ai/mem0) — vector + KV + graph universal memory layer, 56.9K stars, Apache-2.0.
- [Mem0 2026 architecture paper (arxiv 2504.19413)](https://arxiv.org/abs/2504.19413) — single-pass extraction + multi-signal retrieval algorithm.
- [letta-ai/letta](https://github.com/letta-ai/letta) — ex-MemGPT stateful agent runtime; agent loop + OS-inspired memory hierarchy.
- [getzep/zep](https://github.com/getzep/zep) — managed Graphiti temporal KG; community edition deprecated.
- [Zep / Graphiti paper (arxiv 2501.13956)](https://arxiv.org/abs/2501.13956) — temporal KG for agent memory.
- [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) — five-layer stack, managed + on-prem K8s, #1 on multiple benchmarks.
- [topoteretes/cognee](https://github.com/topoteretes/cognee) — ECL pipeline, graph + vector hybrid, 6K stars, GitHub Secure OSS graduate.
- [plastic-labs/honcho](https://github.com/plastic-labs/honcho) — peer-based representation/conclusions; provider for Hermes.
- [claude-code-workflow-examples-2026 (openaitoolshub.org)](https://www.openaitoolshub.org/en/blog/claude-code-workflow-examples) — survey of plugins/memory/hooks across 12 repos in 2026.
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) — official hook surface (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd).
- [Using git commits as Claude Code's memory (dev.to)](https://dev.to/henrywangxf/using-git-commits-as-claude-codes-memory-48e3) — prior art on the git-commit-as-trigger idea MemPilot adopts.
