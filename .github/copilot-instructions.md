<claude-mem-context>
# Mempilot: Cross-Session Memory

*No context yet. Complete your first session and context will appear here.*

Use Mempilot's MCP search tools for manual memory queries.
</claude-mem-context>

# GitHub Copilot Repository Instructions for Mempilot

Mempilot is a cross-session persistent memory plugin and background daemon for AI coding agents.

## Key Rules & Guidelines
- **Branching Policy**: For every new feature, create a new git branch (e.g., `feature/<name>`). Do not make unreviewed changes directly on main branches.
- **Plugin Identity**: The plugin identity is `mempilot` (`v16.0.0+`). Do not hand-edit files in `.claude-plugin/` or `.codex-plugin/`; run `npm run build` to synchronize them from `package.json`.
- **Antigravity CLI**: The standalone `gemini` CLI has been decommissioned by Google; all background and CLI tasks use Google Antigravity CLI (`agy`).
- **Scenario Routing**: Memory tasks are organized into 4 scenarios (`live-observation`, `session-summary`, `semantic-search`, `enrichment-format`) with primary/fallback routing via `executeWithFallback`.

## Build & Test Commands
```bash
npm run build                 # Build plugin and UI bundles
bun test                      # Run test suite
bun test tests/shared/ProviderRegistry.test.ts # Provider and scenario routing tests
bun test tests/services/agent-runner/run.test.ts # Agent runner tests
```
