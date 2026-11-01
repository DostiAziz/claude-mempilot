# Mempilot: Multi-Agent Guidelines & Instructions

This repository is **Mempilot** (fork of `thedotmack/claude-mem`), a universal cross-session persistent memory engine for coding agents including **Google Antigravity**, **Claude Code**, **OpenAI Codex**, **Cursor**, **Windsurf**, and **GitHub Copilot**.

---

## 1. Core Operating Principles

* **Branch Isolation**: For every new feature, a new git branch MUST be created (e.g. `feature/<name>`) to ensure the main codebase remains stable and avoid interfering with working code.
* **Plugin Identity & Versioning**: The plugin identity is `mempilot` (`v16.0.0+`). Manifests in `.claude-plugin/` and `.codex-plugin/` are automatically generated from `package.json` by `scripts/sync-plugin-manifests.js`. Do not hand-edit generated manifests.
* **Preserve Injected Context Blocks**: In files containing `<claude-mem-context> ... </claude-mem-context>` (e.g. rules files, `.cursor/rules/`, `.github/copilot-instructions.md`), never remove or corrupt the context tags.

---

## 2. Architecture Overview

Mempilot operates on a 3-tier lifecycle architecture:

```
┌────────────────────────────────────────────────────────┐
│             HOST CODING AGENT LIFECYCLE                │
│  Antigravity CLI (agy) • Claude Code • Codex • Cursor   │
└───────────────────────────┬────────────────────────────┘
                            │ Hooks (SessionStart, PostToolUse, etc.)
                            ▼
┌────────────────────────────────────────────────────────┐
│             NON-BLOCKING HOOK SPOOLING                 │
│  Fast serialization to ~/.claude-mem/state/spool/ (≤20ms)│
└───────────────────────────┬────────────────────────────┘
                            │ Asynchronous Drain
                            ▼
┌────────────────────────────────────────────────────────┐
│             BACKGROUND WORKER DAEMON                   │
│  • Memory Distillation & Vector Indexing               │
│  • Scenario-Based Routing Engine with Auto Fallback    │
│  • Web UI Viewer & REST API (port 37701)               │
└────────────────────────────────────────────────────────┘
```

---

## 3. Scenario-Based LLM Routing & Automatic Fallback

The 17 granular memory tasks are categorized into **4 Logical Scenarios** configured in `CLAUDE_MEM_SCENARIOS`:

1. **⚡ Live Tool Observations (`live-observation`)**: `distill`, `observation-analysis`, `decision-extraction`, `todo-extraction`, `file-impact-analysis`
2. **📝 Session Summaries & Reports (`session-summary`)**: `session-summary`, `feature-summary`, `branch-summary`, `briefing-generation`
3. **🔍 Semantic Search & Embeddings (`semantic-search`)**: `semantic-search`, `embeddings-generation`, `similarity-scoring`
4. **🏷️ Formatting & Concept Enrichment (`enrichment-format`)**: `context-formatting`, `decision-formatting`, `todo-formatting`, `metadata-enrichment`, `concept-extraction`

### Fallback Execution (`ProviderRegistry.executeWithFallback`)
* Every scenario defines:
  * **Primary Provider**: e.g., `ollama` (Local) or `gemini-cli` (Antigravity CLI).
  * **Fallback Provider**: e.g., `gemini-cli`, `claude-cli`, or `none`.
  * **Timeout**: Configurable threshold (5s, 10s, 12s, 15s, 25s, 40s, 60s).
* When a primary provider fails (timeout, network error, OOM), MemPilot automatically executes the task on the fallback provider without failing the user's session.

---

## 4. Antigravity CLI (`agy`) Integration

* **Deprecation Notice**: The legacy standalone `gemini` CLI has been decommissioned by Google. All references to `gemini-cli` in configuration execute Google Antigravity CLI (`agy` v1.1.27+).
* **Protobuf / Protojson Contract**:
  * `agy` communicates using Protobuf protojson over stdin/stdout.
  * Unknown fields are strictly rejected by `agy`. The Claude Code envelope (`{"continue":true}`) must NEVER be returned to `agy`.
  * `{}` is the universal valid no-op response for `agy`.
  * On `PreToolUse`, `agy` requires `{"decision":"allow"}` to permit tool execution.
* **Background Work View Agent**:
  * Controlled via `CLAUDE_MEM_WORK_VIEW_AGENT`:
    * `'antigravity-cli'`: Enforces `agy` background runs.
    * `'claude-code'`: Enforces Claude Code SDK runs.
    * `'codex'`: Enforces Codex CLI runs.
    * `'auto'`: Discovers available agents (`agy` → Claude Code → Codex).
    * `'disabled'`: Disables background worker execution.

---

## 5. Host Integrations & Hook Contracts

* **OpenAI Codex**:
  * Reads `AGENTS.md` at repo root for workspace guidelines and tool instructions.
  * Uses `plugin/hooks/codex-hooks.json` for hook lifecycle registration.
  * During hook execution, stdout is strictly reserved for JSON payloads; never output stray log messages to stdout.
* **Google Antigravity CLI (`agy`)**:
  * Reads `AGENTS.md` at repo root.
  * Communicates using protojson (`injectSteps`, `PreToolUse` allow).
* **Claude Code**:
  * Reads `CLAUDE.md`.
  * Injects context using `hookSpecificOutput.additionalContext`.
* **Cursor & Windsurf**:
  * Read `.cursorrules` and `.windsurf/rules/` for editor-level guidelines.

---

## 6. Fresh System Setup & Quickstart

For full onboarding and multi-agent setup on a new computer, refer to:
* **[New Computer Quickstart Guide](docs/quickstart-new-computer.md)**
* Quick setup command:
  ```bash
  npm run setup
  ```

---

## 7. Build, Test, and Verification

```bash
# Build all plugin bundles and React Viewer
npm run build

# Build, sync to marketplace + cache, and restart worker
npm run build-and-sync

# Run unit tests
bun test

# Run provider and fallback routing tests
bun test tests/shared/ProviderRegistry.test.ts

# Run agent runner and CLI tests
bun test tests/services/agent-runner/run.test.ts
```
