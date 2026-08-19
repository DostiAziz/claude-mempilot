# Mempilot: AI Development Instructions

Mempilot is a fork of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations, and injects relevant context into future sessions. This fork adds Ollama / generic-CLI providers and Antigravity CLI (`agy`) support.

## Build

```bash
npm run build-and-sync        # Build, sync to marketplace + cache, restart worker
```

If the build fails with *"Hand-edited shell string detected"*, you changed the
shell-template generator. Regenerate, then build again:

```bash
node scripts/build-hooks.js --write-shell-templates
npm run build
```

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin (marketplace)**: `~/.claude/plugins/marketplaces/thedotmack/`
- **Installed Plugin (cache — what Claude Code loads)**: `~/.claude/plugins/cache/thedotmack/mempilot/<version>/`
- **Database**: `~/.claude-mem/claude-mem.db`
- **Chroma**: `~/.claude-mem/chroma/`

The data dir keeps the `claude-mem` name on purpose — renaming it would orphan
existing memories.

## Plugin identity

The plugin id is **`mempilot`** and lives in exactly one place: the `name` field
of the root `package.json`. `npm run build` propagates it (and `version`) into
all four manifests via `scripts/sync-plugin-manifests.js`:

- `.claude-plugin/plugin.json`, `plugin/.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

Never hand-edit those — they are generated. Marketplace and plugin manifests
previously drifted apart (`claude-mem` vs `mempilot`), which is why generation
covers `marketplace.json` too.

Changing the id is not just a rename: it changes the cache directory, the
`enabledPlugins` key in `~/.claude/settings.json`, the skill prefix
(`mempilot:*`), and MCP server names (`mcp__plugin_mempilot_*`).

**Version scheme**: stay clearly *ahead* of upstream's 13.x line. Do not use a
prerelease suffix — the plugin resolver ranks hyphenated versions *below*
plain ones, so `13.15.2-mempilot` would lose to an upstream `13.15.2` dir.

## Installation model

This is a **local dev install**. `~/.claude/plugins/marketplaces/thedotmack/` is
a clone of *upstream* that `npm run sync-marketplace` rsyncs over; auto-update is
deliberately **off** in `~/.claude/plugins/known_marketplaces.json`
(`thedotmack.autoUpdate: false`). Turning it back on lets upstream overwrite this
fork on the next plugin update.

Antigravity (`agy`) invokes hooks by absolute path into the *marketplace* dir, so
it is unaffected by plugin-id changes — that path is keyed by marketplace name.

## Merging from upstream

```bash
git fetch upstream && git merge upstream/main
```

Expect conflicts in the identity files on **every** merge — upstream bumps the
version in each of them on each release. The recipe:

1. `package.json` — keep **our** `name`, take **their** `version` only if it is
   still behind ours, then re-bump so we stay ahead.
2. `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`,
   `.codex-plugin/plugin.json` — take **theirs**, then run `npm run build`;
   generation overwrites them from `package.json` anyway.
3. Everything else — keep **ours** where it is fork functionality (Ollama /
   generic-CLI providers, Antigravity adapter), merge normally otherwise.

Plugin cache roots are **additive** in `src/build/hook-shell-template.ts`
(`PLUGIN_CACHE_ROOTS`) and `scripts/build-hooks.js`: the upstream `claude-mem`
entry stays in the list alongside `mempilot`. Keep it that way — an insertion
merges far more cleanly than a modified line, and it keeps a half-migrated
machine resolvable.

## Antigravity CLI (`agy`) hook contract

`agy` is a Go binary. Hook stdout is parsed with **protojson** into a *different*
proto message per event, and protojson **rejects unknown fields** — emitting the
Claude Code envelope (`{"continue":true,...}`) fails every hook, which `agy`
surfaces as a hard tool failure. See the field table in
`src/cli/adapters/antigravity-cli.ts`; `{}` is the universally-valid no-op.

## Documentation

**Public Docs**: https://docs.claude-mem.ai (Mintlify)
**Source**: `docs/public/` - MDX files, edit `docs.json` for navigation

## Important

No need to edit the changelog ever, it's generated automatically.
