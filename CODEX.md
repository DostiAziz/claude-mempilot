# Codex Guidelines: Mempilot

This file provides project-level instructions for **OpenAI Codex** (`codex exec` and Codex IDE extensions) when operating in this codebase.

Please follow the rules and architecture defined in [AGENTS.md](file:///Users/admin/PycharmProjects/claude-mempilot/AGENTS.md):

1. **Branch Isolation**: Always create a new git branch for any new feature.
2. **Build & Verify**:
   - `npm run build` to compile distribution bundles.
   - `bun test tests/shared/ProviderRegistry.test.ts` to verify scenario routing & fallbacks.
   - `bun test tests/services/agent-runner/run.test.ts` to test CLI agent execution.
3. **Identity**: Preserve the `mempilot` identity (version `16.0.0+`). Do not hand-edit manifests in `.claude-plugin/` or `.codex-plugin/`.
4. **Hooks Contract**: For Codex hooks, adhere to `codex-hooks.json` schema and avoid extraneous stdout output during execution.
