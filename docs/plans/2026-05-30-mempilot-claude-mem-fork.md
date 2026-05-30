# MemPilot — claude-mem fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork claude-mem and add five additive features — GeminiCliProvider, per-feature distill on git post-commit, features/todos/decisions tables, four new MCP tools, and a briefing-index extension — while leaving claude-mem's SQLite+Chroma storage and observation capture pipeline untouched.

**Architecture:** Soft fork from a pinned upstream tag. All new code lives in new files; modifications to existing files are limited to registries (providers, MCP tools, briefing renderer) and a small change to the observation writer to stamp `branch_name`. Distill is idempotent via a claim-and-supersede pattern: each scratch observation gets claimed by exactly one distill, prior distills are marked `superseded_by`. Auditable, re-runnable.

**Tech Stack:** TypeScript / Node.js (claude-mem), SQLite (existing claude-mem store), MCP protocol (existing claude-mem server), git hooks, Gemini CLI subprocess. Test framework and build tool to be confirmed in Phase 0 (likely Vitest based on the `bunfig.toml` and TS shape, but verify).

**Spec reference:** [`docs/superpowers/specs/2026-05-30-mempilot-claude-mem-fork-design.md`](../specs/2026-05-30-mempilot-claude-mem-fork-design.md)

---

## Phase 0 — Fork setup and reconnaissance

This phase exists because the spec was written without local access to claude-mem's source. Every implementation task in later phases references findings from Phase 0. Complete this phase before starting Phase 1.

### Task 0.1: Pin upstream release and fork

**Files:** none yet (creates a new git repo)

- [ ] **Step 1: Identify latest stable upstream tag**

```bash
gh release view --repo thedotmack/claude-mem --json tagName,publishedAt
```

Expected: a tag like `v13.x.y` published within the last week.

- [ ] **Step 2: Record the pinned tag for the fork**

Write the tag to a temporary note. You'll commit it into the fork README in Task 0.5.

- [ ] **Step 3: Fork on GitHub (manual or via gh CLI)**

```bash
gh repo fork thedotmack/claude-mem --clone=false --org=<your-account>
```

Expected: a new repo at `https://github.com/<your-account>/claude-mem` (or `claude-mem-pilot` if you renamed during fork).

- [ ] **Step 4: Clone the fork locally**

```bash
cd ~/projects
git clone git@github.com:<your-account>/claude-mem-pilot.git
cd claude-mem-pilot
```

Expected: clean clone, current on `main`.

- [ ] **Step 5: Check out the pinned tag and create the fork base branch**

```bash
git checkout <tag-from-step-1>
git checkout -b mempilot-main
git push -u origin mempilot-main
```

Expected: `mempilot-main` exists locally and on origin, pointed at the pinned tag.

- [ ] **Step 6: Commit**

(nothing to commit yet — the branch creation IS the commit operation. Next task.)

### Task 0.2: Get the dev environment working

**Files:**
- Read: `README.md`, `package.json`, `bunfig.toml`, `CLAUDE.md`

- [ ] **Step 1: Read the contributor docs**

```bash
less README.md
less CLAUDE.md
less plugin/.claude-plugin/plugin.json
```

Capture in `~/mempilot-fork-notes.md`: required Node version, package manager (npm / bun), how to run tests, how to build, how to run locally without installing.

- [ ] **Step 2: Install dependencies**

```bash
# Whichever the project uses — verified in Step 1
npm install     # OR bun install
```

Expected: completes without errors.

- [ ] **Step 3: Run the existing test suite**

```bash
npm test        # OR whatever Step 1 revealed
```

Expected: all tests pass. If any fail, do not start writing new code until you've understood why — the upstream pinned tag should be green.

- [ ] **Step 4: Build the project**

```bash
npm run build
```

Expected: produces `dist/`. Confirm shape.

- [ ] **Step 5: Commit the fork-notes file (outside the repo)**

`~/mempilot-fork-notes.md` is your scratchpad. Don't commit it to the fork. Reference it during later phases.

### Task 0.3: Verify spec assumptions against actual source

**Files:**
- Read: `src/services/worker/`, `src/cli/handlers/context.ts`, `src/shared/EnvManager.ts`, `src/storage/`, `src/cli/commands/`, `plugin/hooks/`

- [ ] **Step 1: Confirm storage path**

```bash
grep -r "db.sqlite" src/ --include="*.ts" | head
grep -r "DATABASE_PATH\|databasePath" src/ --include="*.ts" | head
```

Note in fork-notes: the actual path of the SQLite file (likely `~/.claude-mem/db.sqlite` per the existing config docs).

- [ ] **Step 2: Confirm provider registry location**

```bash
grep -rn "GeminiProvider\|OpenRouterProvider\|ClaudeProvider" src/services/worker/ --include="*.ts"
grep -rn "createProvider\|providerFactory" src/ --include="*.ts"
```

Note in fork-notes: the file where the provider factory dispatches by `CLAUDE_MEM_PROVIDER`. This is where you'll register `gemini-cli`.

- [ ] **Step 3: Confirm MCP server tool registration**

```bash
find src -path '*mcp*' -name '*.ts' | head
grep -rn "addTool\|registerTool" src/ --include="*.ts" | head
```

Note in fork-notes: the file that registers MCP tools and the call shape (`{ name, description, handler }` or similar).

- [ ] **Step 4: Confirm migration runner**

```bash
ls src/storage/migrations/ 2>/dev/null || find src -type d -name migrations
grep -rn "migrate\|runMigrations" src/storage/ --include="*.ts" | head
```

Note in fork-notes: the migration numbering convention (`001_initial.sql` style? `2026-05-15_xxx.ts` style?) and how migrations get discovered.

- [ ] **Step 5: Confirm test framework**

```bash
cat package.json | grep -E '"(jest|vitest|mocha|tap)"' 
ls tests/ 2>/dev/null && head tests/*.test.ts 2>/dev/null
```

Note in fork-notes: the test framework, the test file naming convention, test helper imports.

- [ ] **Step 6: Confirm observation writer location (for branch_name stamping)**

```bash
grep -rn "INSERT INTO observations\|insertObservation" src/ --include="*.ts" | head
```

Note in fork-notes: the function that writes observation rows. This is where you'll stamp `branch_name`.

- [ ] **Step 7: Confirm context handler / briefing renderer**

```bash
cat src/cli/handlers/context.ts | head -60
grep -rn "api/context/inject" src/ --include="*.ts" | head
```

Note in fork-notes: the file that builds the markdown index. This is where you'll append the new sections.

- [ ] **Step 8: Confirm git-hook installer (used by existing `claude-mem install`)**

```bash
grep -rn "post-commit\|installHook\|hooks/post" src/ install/ --include="*.ts" --include="*.sh" 2>/dev/null | head
```

Note in fork-notes: whether claude-mem already installs any git hooks (probably not — its hooks are Claude Code lifecycle hooks). You will be the first to install a git hook here.

- [ ] **Step 9: Verify `gemini` CLI behavior**

```bash
which gemini && gemini --version
echo "hello world, give me 5 facts about ducks" | gemini -p
```

Note in fork-notes: whether `gemini -p` accepts prompt-via-stdin (above) or requires `-p <prompt-as-arg>`. Note the output format (raw text? structured?).

If `gemini -p` does not accept stdin, try:

```bash
gemini -p "hello world, give me 5 facts about ducks"
gemini --model gemini-2.5-flash-lite -p "..."
```

Whatever works becomes the contract for `GeminiCliProvider`.

- [ ] **Step 10: Commit**

Nothing to commit (read-only investigation). Proceed to Task 0.4 with `~/mempilot-fork-notes.md` populated.

### Task 0.4: Set up the development scratch repo

**Files:**
- Create: `~/projects/mempilot-testbed/` (a throwaway repo to test post-commit hooks during dev)

- [ ] **Step 1: Create a throwaway test repo**

```bash
mkdir -p ~/projects/mempilot-testbed
cd ~/projects/mempilot-testbed
git init
echo "# test" > README.md
git add README.md && git commit -m "init"
```

This is where you'll trigger `git commit` to exercise the post-commit hook during development.

- [ ] **Step 2: Confirm claude-mem points at a real claude-mem install (for end-to-end)**

```bash
ls ~/.claude-mem 2>/dev/null
```

If empty, install upstream once:

```bash
npx claude-mem install
```

Expected: `~/.claude-mem/` populated with `db.sqlite`, `settings.json`, etc.

This existing install gives you a reference to compare your fork's behavior against. Do NOT delete it.

- [ ] **Step 3: Decide where the fork's testbed install lives**

Option A: Override `CLAUDE_MEM_DATA_DIR` to point at a different directory for the fork tests (`~/.claude-mem-fork/`).
Option B: Use the existing `~/.claude-mem/` and rely on tests cleaning up after themselves.

Recommended: Option A. Document the choice in fork-notes.

- [ ] **Step 4: Commit**

Nothing in the fork to commit yet.

### Task 0.5: Copy design docs from InboxPilot into the fork

**Files:**
- Create: `docs/specs/2026-05-30-mempilot-claude-mem-fork-design.md` (copy of InboxPilot's spec)
- Create: `docs/specs/2026-05-28-mempilot-competitive-analysis.md` (copy)
- Create: `docs/plans/2026-05-30-mempilot-claude-mem-fork.md` (copy of this plan)

These docs were written in the InboxPilot repo during the brainstorming session.
They should travel with the code so an engineer (you or a subagent) reading the
fork has the design context without needing to flip repos.

- [ ] **Step 1: Create the doc directories in the fork**

```bash
# Working dir: the cloned fork (e.g. ~/projects/claude-mem-pilot/)
mkdir -p docs/specs docs/plans
```

- [ ] **Step 2: Copy the three docs from InboxPilot**

```bash
cp /Users/admin/PycharmProjects/InboxPilot/docs/superpowers/specs/2026-05-30-mempilot-claude-mem-fork-design.md docs/specs/
cp /Users/admin/PycharmProjects/InboxPilot/docs/superpowers/specs/2026-05-28-mempilot-competitive-analysis.md docs/specs/
cp /Users/admin/PycharmProjects/InboxPilot/docs/superpowers/plans/2026-05-30-mempilot-claude-mem-fork.md docs/plans/
```

- [ ] **Step 3: Verify the copies**

```bash
ls docs/specs/ docs/plans/
```

Expected: three .md files, sizes matching the InboxPilot originals.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: import MemPilot design spec, competitive analysis, and impl plan"
```

### Task 0.6: Add the fork's README addendum

**Files:**
- Modify: `README.md` (top of file, before existing content)

- [ ] **Step 1: Add fork header**

Modify `README.md`. Add at the very top (above existing content):

```markdown
# MemPilot — fork of claude-mem

This is a soft fork of [`thedotmack/claude-mem`](https://github.com/thedotmack/claude-mem)
pinned at upstream tag `<TAG-FROM-TASK-0.1>`. It adds:

1. `GeminiCliProvider` — uses the local `gemini` CLI binary instead of the Gemini HTTP API.
2. Per-feature distill on git post-commit — consolidates per-task observations into one per-feature reflection.
3. `features` / `todos` / `decisions` first-class tables.
4. Four new MCP tools: `list_decisions`, `get_feature_history`, `list_open_todos`, `list_features`.
5. Extended briefing index with sections for the new entity types.

See [the design spec](docs/specs/2026-05-30-mempilot-claude-mem-fork-design.md)
and the [implementation plan](docs/plans/2026-05-30-mempilot-claude-mem-fork.md)
for full architecture and step-by-step build sequence.

---

# Below: upstream claude-mem README
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add MemPilot fork header to README"
```

---

## Phase 1 — Schema migrations

All other phases depend on these tables existing. Do this first.

### Task 1.1: Write the migration SQL file

**Files:**
- Create: `src/storage/migrations/<NN>_mempilot_features_tables.sql`  
  (`<NN>` = next number in upstream's existing convention — confirmed in Task 0.3 step 4)

- [ ] **Step 1: Create the migration file**

Create `src/storage/migrations/<NN>_mempilot_features_tables.sql` (replace `<NN>` with the correct number from your fork-notes):

```sql
-- MemPilot fork: features, todos, decisions, distilled_reflections
-- Additive against upstream claude-mem schema.

ALTER TABLE observations ADD COLUMN branch_name TEXT;
ALTER TABLE observations ADD COLUMN feature_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_observations_branch_feature
  ON observations(branch_name, feature_id);

CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  merged_at TIMESTAMP,
  UNIQUE(project_id, branch_name)
);

CREATE TABLE IF NOT EXISTS distilled_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  commit_sha_at_distill TEXT NOT NULL,
  consumed_observation_ids TEXT NOT NULL,
  superseded_by INTEGER REFERENCES distilled_reflections(id),
  body_md TEXT NOT NULL,
  llm_model_used TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_distilled_feature_current
  ON distilled_reflections(feature_id) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  distilled_reflection_id INTEGER NOT NULL REFERENCES distilled_reflections(id),
  topic TEXT NOT NULL,
  choice TEXT NOT NULL,
  alternatives_rejected TEXT,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_decisions_topic ON decisions(topic);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER REFERENCES features(id),
  source_distilled_reflection_id INTEGER REFERENCES distilled_reflections(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_todos_open ON todos(status) WHERE status = 'open';
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/migrations/<NN>_mempilot_features_tables.sql
git commit -m "feat(schema): add features, todos, decisions, distilled_reflections tables"
```

### Task 1.2: Write integration test for the migration

**Files:**
- Create: `tests/storage/migrations/mempilot-features-tables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/migrations/mempilot-features-tables.test.ts`. Adapt imports and `describe`/`it` to whatever framework Task 0.3 step 5 revealed (Jest/Vitest). Below is Vitest shape — adjust if needed:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { open } from '../../../src/storage/db.js';     // verify path in Task 0.3
import { runMigrations } from '../../../src/storage/migrate.js';  // verify path
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemPilot migration: features tables', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'mempilot-mig-'));
    dbPath = join(dir, 'db.sqlite');
  });

  it('creates all four new tables and adds two columns to observations', async () => {
    const db = await open(dbPath);
    await runMigrations(db);

    // Tables exist
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.map((r: any) => r.name);
    expect(tableNames).toContain('features');
    expect(tableNames).toContain('distilled_reflections');
    expect(tableNames).toContain('decisions');
    expect(tableNames).toContain('todos');

    // Columns added to observations
    const obsCols = await db.all("PRAGMA table_info(observations)");
    const colNames = obsCols.map((c: any) => c.name);
    expect(colNames).toContain('branch_name');
    expect(colNames).toContain('feature_id');
  });

  it('is idempotent — running migrations twice does not error', async () => {
    const db = await open(dbPath);
    await runMigrations(db);
    await expect(runMigrations(db)).resolves.not.toThrow();
  });

  it('enforces UNIQUE(project_id, branch_name) on features', async () => {
    const db = await open(dbPath);
    await runMigrations(db);

    await db.run("INSERT INTO features (project_id, branch_name, title) VALUES (1, 'main', 'M')");
    await expect(
      db.run("INSERT INTO features (project_id, branch_name, title) VALUES (1, 'main', 'M2')")
    ).rejects.toThrow(/UNIQUE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/storage/migrations/mempilot-features-tables.test.ts
```

Expected: FAIL — runMigrations doesn't yet know about the new SQL file (or test imports may be wrong if Task 0.3 step 5 revealed a different framework — fix imports first).

- [ ] **Step 3: Verify the migration runner picks up the new file**

Depending on how migrations are discovered (Task 0.3 step 4):

- If discovery is automatic (e.g., glob over `src/storage/migrations/*.sql`): no code change needed; the SQL file will be picked up automatically.
- If discovery is manual (e.g., a list in `src/storage/migrate.ts`): add the new file to the list. Edit `src/storage/migrate.ts` (verify exact path).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/storage/migrations/mempilot-features-tables.test.ts
```

Expected: PASS (all three test cases).

- [ ] **Step 5: Commit**

```bash
git add tests/storage/migrations/mempilot-features-tables.test.ts src/storage/migrate.ts
git commit -m "test(schema): verify MemPilot tables exist and migration is idempotent"
```

---

## Phase 2 — GeminiCliProvider

Independent of Phase 1 — can be developed in parallel. Listed second because schema work is foundational.

### Task 2.1: Write contract test for GeminiCliProvider

**Files:**
- Create: `tests/services/worker/GeminiCliProvider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/services/worker/GeminiCliProvider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GeminiCliProvider } from '../../../src/services/worker/GeminiCliProvider.js';
import { spawn } from 'child_process';

vi.mock('child_process');

describe('GeminiCliProvider', () => {
  it('spawns gemini with -p and -m flags', async () => {
    const mockProcess: any = {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'close') setImmediate(() => cb(0));
      }),
    };
    (spawn as any).mockReturnValue(mockProcess);

    const provider = new GeminiCliProvider({
      binary: 'gemini',
      model: 'gemini-2.5-flash-lite',
    });

    const promise = provider.extract({ prompt: 'extract observations from: ...' });

    // Simulate XML output on stdout
    const dataCb = mockProcess.stdout.on.mock.calls.find((c: any) => c[0] === 'data')[1];
    dataCb(Buffer.from('<observations><observation>x</observation></observations>'));

    await promise;

    expect(spawn).toHaveBeenCalledWith('gemini', ['-p', '-m', 'gemini-2.5-flash-lite'], expect.any(Object));
  });

  it('returns the XML output as the result', async () => {
    const mockProcess: any = {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'close') setImmediate(() => cb(0));
      }),
    };
    (spawn as any).mockReturnValue(mockProcess);

    const provider = new GeminiCliProvider({ binary: 'gemini', model: 'gemini-2.5-flash-lite' });
    const promise = provider.extract({ prompt: 'hi' });
    const dataCb = mockProcess.stdout.on.mock.calls.find((c: any) => c[0] === 'data')[1];
    dataCb(Buffer.from('<observations/>'));

    const result = await promise;
    expect(result).toBe('<observations/>');
  });

  it('throws ClassifiedProviderError when gemini exits non-zero', async () => {
    const mockProcess: any = {
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') setImmediate(() => cb(Buffer.from('Invalid API key')));
      }) },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'close') setImmediate(() => cb(1));
      }),
    };
    (spawn as any).mockReturnValue(mockProcess);

    const provider = new GeminiCliProvider({ binary: 'gemini', model: 'gemini-2.5-flash-lite' });

    await expect(provider.extract({ prompt: 'hi' })).rejects.toMatchObject({
      kind: 'auth_invalid',
    });
  });

  it('throws unrecoverable error when gemini binary is missing', async () => {
    (spawn as any).mockImplementation(() => {
      const err: any = new Error('spawn gemini ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const provider = new GeminiCliProvider({ binary: 'gemini', model: 'gemini-2.5-flash-lite' });
    await expect(provider.extract({ prompt: 'hi' })).rejects.toMatchObject({
      kind: 'unrecoverable',
    });
  });
});
```

**Note:** if Task 0.3 step 9 revealed `gemini -p` requires the prompt as an argument (not stdin), revise the test: spawn call becomes `spawn('gemini', ['-p', PROMPT, '-m', MODEL])` and stdin handling drops.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/worker/GeminiCliProvider.test.ts
```

Expected: FAIL with "Cannot find module GeminiCliProvider".

- [ ] **Step 3: Commit the test (red)**

```bash
git add tests/services/worker/GeminiCliProvider.test.ts
git commit -m "test(provider): GeminiCliProvider contract (red)"
```

### Task 2.2: Implement GeminiCliProvider

**Files:**
- Read first: `src/services/worker/GeminiProvider.ts` (the existing HTTP-based provider) and `src/services/worker/provider-errors.ts`. Mirror their structure.
- Create: `src/services/worker/GeminiCliProvider.ts`

- [ ] **Step 1: Read the HTTP-based GeminiProvider for the contract shape**

```bash
less src/services/worker/GeminiProvider.ts
less src/services/worker/provider-errors.ts
```

Note in fork-notes: the exact method signatures the provider interface requires (likely `extract`, possibly with init/shutdown hooks). Mirror these.

- [ ] **Step 2: Implement the provider**

Create `src/services/worker/GeminiCliProvider.ts`. Below is the stdin-piping variant; switch to argv if Task 0.3 step 9 revealed that:

```typescript
import { spawn } from 'child_process';
import { ClassifiedProviderError } from './provider-errors.js';
import { logger } from '../../utils/logger.js';

export interface GeminiCliProviderOptions {
  binary: string;       // default: 'gemini'
  model: string;        // e.g. 'gemini-2.5-flash-lite'
}

export class GeminiCliProvider {
  private binary: string;
  private model: string;

  constructor(opts: GeminiCliProviderOptions) {
    this.binary = opts.binary;
    this.model = opts.model;
  }

  async extract(input: { prompt: string }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let proc;
      try {
        proc = spawn(this.binary, ['-p', '-m', this.model], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return reject(new ClassifiedProviderError(
            `gemini CLI binary not found: ${this.binary}`,
            { kind: 'unrecoverable', cause: err },
          ));
        }
        return reject(new ClassifiedProviderError(err.message, { kind: 'unrecoverable', cause: err }));
      }

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(classifyGeminiCliError(stderr, code));
        }
      });

      proc.on('error', (err: any) => {
        reject(new ClassifiedProviderError(err.message, { kind: 'unrecoverable', cause: err }));
      });

      // Pipe the prompt
      proc.stdin.write(input.prompt);
      proc.stdin.end();
    });
  }
}

function classifyGeminiCliError(stderr: string, code: number): ClassifiedProviderError {
  const msg = stderr.trim() || `gemini exited with code ${code}`;
  if (/Invalid API key|API key|unauthorized|authentication/i.test(stderr)) {
    return new ClassifiedProviderError(msg, { kind: 'auth_invalid' });
  }
  if (/rate limit|429/i.test(stderr)) {
    return new ClassifiedProviderError(msg, { kind: 'rate_limit' });
  }
  if (/quota/i.test(stderr)) {
    return new ClassifiedProviderError(msg, { kind: 'quota_exhausted' });
  }
  if (code === 0) {
    return new ClassifiedProviderError(msg, { kind: 'transient' });
  }
  return new ClassifiedProviderError(msg, { kind: 'unrecoverable' });
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test -- tests/services/worker/GeminiCliProvider.test.ts
```

Expected: PASS (all four cases).

- [ ] **Step 4: Commit**

```bash
git add src/services/worker/GeminiCliProvider.ts
git commit -m "feat(provider): implement GeminiCliProvider that spawns gemini CLI"
```

### Task 2.3: Register GeminiCliProvider in the factory

**Files:**
- Modify: the provider factory file identified in Task 0.3 step 2 (likely `src/services/worker/index.ts` or `src/services/worker/createProvider.ts`)

- [ ] **Step 1: Write a failing test for the factory**

Add a test case to whatever existing test covers `createProvider` (find it via grep). If no test exists, create `tests/services/worker/createProvider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createProvider } from '../../../src/services/worker/createProvider.js';  // verify path
import { GeminiCliProvider } from '../../../src/services/worker/GeminiCliProvider.js';

describe('createProvider', () => {
  it('returns GeminiCliProvider when CLAUDE_MEM_PROVIDER=gemini-cli', () => {
    const provider = createProvider({
      CLAUDE_MEM_PROVIDER: 'gemini-cli',
      CLAUDE_MEM_GEMINI_CLI_BINARY: 'gemini',
      CLAUDE_MEM_GEMINI_CLI_MODEL: 'gemini-2.5-flash-lite',
    });
    expect(provider).toBeInstanceOf(GeminiCliProvider);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/worker/createProvider.test.ts
```

Expected: FAIL — factory doesn't yet recognize `gemini-cli`.

- [ ] **Step 3: Modify the factory**

Open the factory file (from Task 0.3 step 2). Add a branch:

```typescript
import { GeminiCliProvider } from './GeminiCliProvider.js';

// inside createProvider(settings):
if (settings.CLAUDE_MEM_PROVIDER === 'gemini-cli') {
  return new GeminiCliProvider({
    binary: settings.CLAUDE_MEM_GEMINI_CLI_BINARY ?? 'gemini',
    model: settings.CLAUDE_MEM_GEMINI_CLI_MODEL ?? 'gemini-2.5-flash-lite',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS (full suite — make sure no upstream tests broke).

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/createProvider.test.ts src/services/worker/createProvider.ts
git commit -m "feat(provider): register gemini-cli provider in factory"
```

### Task 2.4: End-to-end smoke against real gemini

**Files:** none (manual verification)

- [ ] **Step 1: Configure the fork-testbed claude-mem to use gemini-cli**

Edit `~/.claude-mem-fork/settings.json` (or wherever Task 0.4 step 3 set):

```json
{
  "CLAUDE_MEM_PROVIDER": "gemini-cli",
  "CLAUDE_MEM_GEMINI_CLI_BINARY": "gemini",
  "CLAUDE_MEM_GEMINI_CLI_MODEL": "gemini-2.5-flash-lite"
}
```

- [ ] **Step 2: Trigger an observation extraction manually**

Use the fork's existing CLI to trigger extraction on a saved transcript. Exact command depends on what `npm run worker:logs` or similar exposes. If unclear, run a real session:

```bash
# In a separate terminal, watch the worker log:
npm run worker:logs

# In a Claude Code session, do a small task, then end it.
```

Expected: the worker log shows the gemini CLI being spawned and observations being extracted successfully.

- [ ] **Step 3: Inspect the SQLite DB to confirm an observation row landed**

```bash
sqlite3 ~/.claude-mem-fork/db.sqlite "SELECT id, title FROM observations ORDER BY id DESC LIMIT 3"
```

Expected: at least one new observation row.

- [ ] **Step 4: Commit nothing**

This was a smoke test. No code changes.

---

## Phase 3 — DistillManager (the algorithm core)

The hardest piece. Build it incrementally: each idempotency property gets its own test before moving to the next.

### Task 3.1: Create the DistillManager module skeleton

**Files:**
- Create: `src/services/worker/DistillManager.ts`

- [ ] **Step 1: Write the module skeleton**

```typescript
import type { Database } from '../../storage/db.js';      // verify path
import type { Provider } from './provider-interface.js';   // verify name
import { logger } from '../../utils/logger.js';

export interface DistillInput {
  projectId: number;
  branch: string;
  commitSha: string;
  force?: boolean;
}

export interface DistillOutput {
  distillId: number | null;     // null when no-op
  consumedObservationIds: number[];
  newDecisionIds: number[];
  newTodoIds: number[];
}

export class DistillManager {
  constructor(private db: Database, private provider: Provider) {}

  async processBranch(input: DistillInput): Promise<DistillOutput> {
    throw new Error('not yet implemented');
  }
}
```

- [ ] **Step 2: Commit (skeleton)**

```bash
git add src/services/worker/DistillManager.ts
git commit -m "feat(distill): DistillManager skeleton"
```

### Task 3.2: Implement empty-case path (no observations → no-op)

**Files:**
- Create: `tests/services/worker/DistillManager.test.ts`
- Modify: `src/services/worker/DistillManager.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { DistillManager } from '../../../src/services/worker/DistillManager.js';
import { setupTestDb } from '../../helpers/test-db.js';  // create helper if missing — see below

describe('DistillManager.processBranch', () => {
  let db: any;
  let mockProvider: any;

  beforeEach(async () => {
    db = await setupTestDb();
    mockProvider = { extract: async () => '<distill/>', model: 'mock-model' };
  });

  it('returns no-op when there are no observations on the branch', async () => {
    const manager = new DistillManager(db, mockProvider);
    // Seed a project, no observations
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");

    const result = await manager.processBranch({
      projectId: 1,
      branch: 'feature/foo',
      commitSha: 'abc123',
    });

    expect(result.distillId).toBeNull();
    expect(result.consumedObservationIds).toEqual([]);

    // No distill row written
    const rows = await db.all("SELECT * FROM distilled_reflections");
    expect(rows).toEqual([]);

    // Provider was NOT called
    // (mockProvider doesn't track calls — extend if needed; for now this is implicit)
  });
});
```

You'll also need a `tests/helpers/test-db.ts` if one doesn't exist:

```typescript
import { open } from '../../src/storage/db.js';
import { runMigrations } from '../../src/storage/migrate.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export async function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'mempilot-test-'));
  const db = await open(join(dir, 'db.sqlite'));
  await runMigrations(db);
  return db;
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: FAIL — `not yet implemented`.

- [ ] **Step 3: Implement the empty-case path**

Modify `processBranch` in `src/services/worker/DistillManager.ts`:

```typescript
async processBranch(input: DistillInput): Promise<DistillOutput> {
  // 1. Find or create feature
  const feature = await this.findOrCreateFeature(input.projectId, input.branch);

  // 2. Find prior current distill (if any)
  const priorDistill = await this.currentDistillFor(feature.id);

  // 3. Find candidate observations
  const candidates = input.force
    ? await this.allObservationsForBranch(input.projectId, input.branch)
    : await this.unclaimedObservationsSince(input.projectId, input.branch, priorDistill?.created_at);

  // 4. Empty case: no-op
  if (candidates.length === 0 && !input.force) {
    return { distillId: null, consumedObservationIds: [], newDecisionIds: [], newTodoIds: [] };
  }

  throw new Error('not yet implemented: non-empty case');
}

private async findOrCreateFeature(projectId: number, branch: string) {
  let row = await this.db.get(
    "SELECT * FROM features WHERE project_id = ? AND branch_name = ?",
    [projectId, branch],
  );
  if (!row) {
    const result = await this.db.run(
      "INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)",
      [projectId, branch, branch],   // initial title = branch_name
    );
    row = await this.db.get("SELECT * FROM features WHERE id = ?", [result.lastID]);
  }
  return row;
}

private async currentDistillFor(featureId: number) {
  return await this.db.get(
    "SELECT * FROM distilled_reflections WHERE feature_id = ? AND superseded_by IS NULL",
    [featureId],
  );
}

private async unclaimedObservationsSince(projectId: number, branch: string, since?: string) {
  if (since) {
    return await this.db.all(
      `SELECT * FROM observations
        WHERE project_id = ? AND branch_name = ? AND feature_id IS NULL AND created_at > ?
        ORDER BY created_at`,
      [projectId, branch, since],
    );
  }
  return await this.db.all(
    `SELECT * FROM observations
      WHERE project_id = ? AND branch_name = ? AND feature_id IS NULL
      ORDER BY created_at`,
    [projectId, branch],
  );
}

private async allObservationsForBranch(projectId: number, branch: string) {
  return await this.db.all(
    "SELECT * FROM observations WHERE project_id = ? AND branch_name = ? ORDER BY created_at",
    [projectId, branch],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts tests/helpers/test-db.ts src/services/worker/DistillManager.ts
git commit -m "feat(distill): empty-case no-op path"
```

### Task 3.3: Implement first-distill case (no prior distill exists)

**Files:**
- Modify: `tests/services/worker/DistillManager.test.ts`
- Modify: `src/services/worker/DistillManager.ts`

- [ ] **Step 1: Add failing test for first-distill case**

Append to `DistillManager.test.ts`:

```typescript
it('writes a distilled row and claims observations when there is no prior distill', async () => {
  const provider = {
    extract: async (input: any) => `<distill>
      <body>First feature distill</body>
      <decisions>
        <decision topic="approach" choice="X" reason="simpler"/>
      </decisions>
      <todos>
        <todo>Add tests</todo>
      </todos>
      <suggested-title>Add foo feature</suggested-title>
    </distill>`,
    model: 'mock-model',
  };

  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run(
    "INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'obs1', '...')",
  );
  await db.run(
    "INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (11, 1, 'feature/foo', 'obs2', '...')",
  );

  const manager = new DistillManager(db, provider);
  const result = await manager.processBranch({
    projectId: 1,
    branch: 'feature/foo',
    commitSha: 'abc123',
  });

  expect(result.distillId).not.toBeNull();
  expect(result.consumedObservationIds).toEqual([10, 11]);
  expect(result.newDecisionIds.length).toBe(1);
  expect(result.newTodoIds.length).toBe(1);

  // Observations are now claimed
  const obs = await db.all("SELECT id, feature_id FROM observations ORDER BY id");
  expect(obs[0].feature_id).not.toBeNull();
  expect(obs[1].feature_id).toBe(obs[0].feature_id);

  // Feature title was updated from branch_name to suggested title
  const feature = await db.get("SELECT * FROM features WHERE id = ?", [obs[0].feature_id]);
  expect(feature.title).toBe('Add foo feature');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: FAIL — `not yet implemented: non-empty case`.

- [ ] **Step 3: Implement the first-distill path**

In `DistillManager.ts`, replace the `throw new Error('not yet implemented: non-empty case')` with:

```typescript
  // 5. Call provider
  const prompt = this.buildDistillPrompt(priorDistill, candidates, input.commitSha);
  const xml = await this.provider.extract({ prompt });
  const parsed = this.parseDistillOutput(xml);

  // 6. Write in a transaction
  let distillId: number = 0;
  const newDecisionIds: number[] = [];
  const newTodoIds: number[] = [];

  await this.db.exec('BEGIN');
  try {
    const insertResult = await this.db.run(
      `INSERT INTO distilled_reflections
        (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
       VALUES (?, ?, ?, ?, ?)`,
      [feature.id, input.commitSha, JSON.stringify(candidates.map(c => c.id)), parsed.body, this.provider.model],
    );
    distillId = insertResult.lastID!;

    if (priorDistill) {
      await this.db.run(
        "UPDATE distilled_reflections SET superseded_by = ? WHERE id = ?",
        [distillId, priorDistill.id],
      );
    }

    // Claim observations
    for (const obs of candidates) {
      await this.db.run(
        "UPDATE observations SET feature_id = ? WHERE id = ?",
        [feature.id, obs.id],
      );
    }

    // Insert decisions
    for (const d of parsed.decisions) {
      const r = await this.db.run(
        `INSERT INTO decisions
          (feature_id, distilled_reflection_id, topic, choice, alternatives_rejected, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [feature.id, distillId, d.topic, d.choice, JSON.stringify(d.alternatives_rejected ?? []), d.reason ?? null],
      );
      newDecisionIds.push(r.lastID!);
    }

    // Insert todos
    for (const t of parsed.todos) {
      const r = await this.db.run(
        `INSERT INTO todos (feature_id, source_distilled_reflection_id, body)
         VALUES (?, ?, ?)`,
        [feature.id, distillId, t],
      );
      newTodoIds.push(r.lastID!);
    }

    // Update feature title if still placeholder
    if (feature.title === feature.branch_name && parsed.suggestedTitle) {
      await this.db.run(
        "UPDATE features SET title = ? WHERE id = ?",
        [parsed.suggestedTitle, feature.id],
      );
    }

    await this.db.exec('COMMIT');
  } catch (err) {
    await this.db.exec('ROLLBACK');
    throw err;
  }

  return {
    distillId,
    consumedObservationIds: candidates.map(c => c.id),
    newDecisionIds,
    newTodoIds,
  };
```

And add helper methods:

```typescript
private buildDistillPrompt(prior: any, candidates: any[], commitSha: string): string {
  return [
    prior ? `Prior distill:\n${prior.body_md}\n\n` : '',
    `Commit SHA: ${commitSha}\n\n`,
    `New observations:\n${candidates.map(c => `- ${c.title}: ${c.body}`).join('\n')}\n\n`,
    `Produce an XML distill with body, decisions, todos, suggested-title.`,
  ].join('');
}

private parseDistillOutput(xml: string): {
  body: string;
  decisions: { topic: string; choice: string; alternatives_rejected?: string[]; reason?: string }[];
  todos: string[];
  suggestedTitle?: string;
} {
  // Minimal XML parsing — for v1 use a simple regex; swap for a real parser later.
  const body = (xml.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').trim();
  const suggestedTitle = (xml.match(/<suggested-title>([\s\S]*?)<\/suggested-title>/)?.[1] ?? '').trim() || undefined;

  const decisions: any[] = [];
  const decisionMatches = xml.matchAll(/<decision\s+topic="([^"]*)"\s+choice="([^"]*)"(?:\s+reason="([^"]*)")?\s*\/?>/g);
  for (const m of decisionMatches) {
    decisions.push({ topic: m[1], choice: m[2], reason: m[3] });
  }

  const todos: string[] = [];
  const todoMatches = xml.matchAll(/<todo>([\s\S]*?)<\/todo>/g);
  for (const m of todoMatches) {
    todos.push(m[1].trim());
  }

  return { body, decisions, todos, suggestedTitle };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: both test cases PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts src/services/worker/DistillManager.ts
git commit -m "feat(distill): first-distill case writes distill, claims obs, populates tables"
```

### Task 3.4: Implement incremental distill (prior distill exists)

**Files:**
- Modify: `tests/services/worker/DistillManager.test.ts`

- [ ] **Step 1: Add failing test for incremental case**

Append to the test file:

```typescript
it('on second distill, processes only new observations and supersedes the prior', async () => {
  const provider = {
    extract: async (input: any) => `<distill>
      <body>Updated distill</body>
      <suggested-title>Add foo feature</suggested-title>
    </distill>`,
    model: 'mock-model',
  };

  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'o1', '')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (11, 1, 'feature/foo', 'o2', '')");

  const manager = new DistillManager(db, provider);

  // First distill
  const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });
  expect(first.distillId).not.toBeNull();

  // Add a new observation
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (12, 1, 'feature/foo', 'o3', '')");

  // Second distill
  const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
  expect(second.distillId).not.toBe(first.distillId);
  expect(second.consumedObservationIds).toEqual([12]);   // only the new one

  // Prior distill is now superseded
  const priorRow = await db.get("SELECT superseded_by FROM distilled_reflections WHERE id = ?", [first.distillId]);
  expect(priorRow.superseded_by).toBe(second.distillId);

  // New distill is current (superseded_by IS NULL)
  const currentRow = await db.get("SELECT superseded_by FROM distilled_reflections WHERE id = ?", [second.distillId]);
  expect(currentRow.superseded_by).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS. (Implementation already covers this case via the prior-distill query.)

- [ ] **Step 3: Add a test that the second call is a no-op when nothing new exists**

Append:

```typescript
it('is a no-op when called twice in a row with no new observations', async () => {
  let extractCallCount = 0;
  const provider = {
    extract: async () => { extractCallCount++; return `<distill><body>d</body></distill>`; },
    model: 'mock-model',
  };

  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'o1', '')");

  const manager = new DistillManager(db, provider);
  await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });

  const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
  expect(second.distillId).toBeNull();
  expect(extractCallCount).toBe(1);    // LLM was NOT called the second time
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts
git commit -m "test(distill): incremental + no-op idempotency"
```

### Task 3.5: Implement debounce

**Files:**
- Modify: `tests/services/worker/DistillManager.test.ts`
- Modify: `src/services/worker/DistillManager.ts`

- [ ] **Step 1: Add failing test for debounce**

```typescript
it('skips distill when below debounce thresholds', async () => {
  const provider = {
    extract: async () => `<distill><body>d</body></distill>`,
    model: 'mock-model',
  };
  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'o1', '')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (11, 1, 'feature/foo', 'o2', '')");

  const manager = new DistillManager(db, provider, { debounceSeconds: 60, debounceMinObservations: 3 });

  // First distill always runs
  const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });
  expect(first.distillId).not.toBeNull();

  // Add just 1 new observation, immediately
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (12, 1, 'feature/foo', 'o3', '')");

  // Second call: debounced (only 1 new obs, < 60s since last)
  const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
  expect(second.distillId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — debounce not implemented yet.

- [ ] **Step 3: Implement debounce**

Modify `DistillManager` constructor to accept options, and add the debounce check after the empty-case branch:

```typescript
export interface DistillManagerOptions {
  debounceSeconds?: number;
  debounceMinObservations?: number;
}

export class DistillManager {
  constructor(
    private db: Database,
    private provider: Provider,
    private opts: DistillManagerOptions = {},
  ) {}

  async processBranch(input: DistillInput): Promise<DistillOutput> {
    // ... existing code through "no-op when empty" ...

    // Debounce: skip if too few new observations and prior distill is recent
    if (!input.force && priorDistill && candidates.length < (this.opts.debounceMinObservations ?? 3)) {
      const ageSeconds = (Date.now() - new Date(priorDistill.created_at).getTime()) / 1000;
      if (ageSeconds < (this.opts.debounceSeconds ?? 60)) {
        return { distillId: null, consumedObservationIds: [], newDecisionIds: [], newTodoIds: [] };
      }
    }

    // ... rest of processBranch ...
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts src/services/worker/DistillManager.ts
git commit -m "feat(distill): debounce for low-volume rapid commits"
```

### Task 3.6: Implement force mode

**Files:**
- Modify: `tests/services/worker/DistillManager.test.ts`

- [ ] **Step 1: Add failing test for force mode**

```typescript
it('force=true re-processes all observations even when none are unclaimed', async () => {
  let extractCallCount = 0;
  const provider = {
    extract: async () => { extractCallCount++; return `<distill><body>d${extractCallCount}</body></distill>`; },
    model: 'mock-model',
  };
  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'o1', '')");

  const manager = new DistillManager(db, provider);
  const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });

  // Second call with force=true: should re-process the same observation and produce a NEW distill that supersedes the first
  const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2', force: true });
  expect(second.distillId).not.toBeNull();
  expect(second.distillId).not.toBe(first.distillId);
  expect(extractCallCount).toBe(2);

  // Prior distill is superseded
  const prior = await db.get("SELECT superseded_by FROM distilled_reflections WHERE id = ?", [first.distillId]);
  expect(prior.superseded_by).toBe(second.distillId);
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS (force-mode wiring already in place from Task 3.2 via `allObservationsForBranch`; the empty-case bail also already checks `!input.force`).

- [ ] **Step 3: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts
git commit -m "test(distill): force=true re-distills full history"
```

### Task 3.7: Implement merge-to-main detection

**Files:**
- Modify: `tests/services/worker/DistillManager.test.ts`
- Modify: `src/services/worker/DistillManager.ts`

- [ ] **Step 1: Add failing test for merge-to-main**

```typescript
it('marks feature as merged when commit is reachable from main', async () => {
  const provider = {
    extract: async () => `<distill><body>d</body></distill>`,
    model: 'mock-model',
  };
  await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/tmp/x', 'x')");
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (10, 1, 'feature/foo', 'o1', '')");

  const manager = new DistillManager(db, provider, {
    // Fake the merge detector for the test
    isReachableFromMain: async (sha: string) => sha === 'merged-sha',
  } as any);

  // First distill on feature branch — not yet merged
  await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'feature-sha' });
  let feature = await db.get("SELECT * FROM features WHERE branch_name = 'feature/foo'");
  expect(feature.status).toBe('open');
  expect(feature.merged_at).toBeNull();

  // Add a new obs and call again with merged-sha — branch now merged
  await db.run("INSERT INTO observations (id, project_id, branch_name, title, body) VALUES (11, 1, 'feature/foo', 'o2', '')");
  await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'merged-sha' });
  feature = await db.get("SELECT * FROM features WHERE branch_name = 'feature/foo'");
  expect(feature.status).toBe('merged');
  expect(feature.merged_at).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — merge detection not implemented.

- [ ] **Step 3: Implement the merge detector**

Extend `DistillManagerOptions`:

```typescript
export interface DistillManagerOptions {
  debounceSeconds?: number;
  debounceMinObservations?: number;
  isReachableFromMain?: (commitSha: string) => Promise<boolean>;
}
```

Default the function (when not injected):

```typescript
import { execSync } from 'child_process';

private async isCommitOnMain(projectPath: string, commitSha: string): Promise<boolean> {
  if (this.opts.isReachableFromMain) {
    return await this.opts.isReachableFromMain(commitSha);
  }
  try {
    const out = execSync(`git -C "${projectPath}" branch --contains ${commitSha}`, { encoding: 'utf8' });
    return /(^|\n)\*?\s*main$/.test(out);
  } catch {
    return false;
  }
}
```

After the COMMIT step (inside processBranch), add:

```typescript
  // After successful distill, check whether the branch is now merged.
  const projectPath = (await this.db.get("SELECT path FROM projects WHERE id = ?", [input.projectId]))?.path;
  if (projectPath && await this.isCommitOnMain(projectPath, input.commitSha)) {
    await this.db.run(
      "UPDATE features SET status = 'merged', merged_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'merged'",
      [feature.id],
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/worker/DistillManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/services/worker/DistillManager.test.ts src/services/worker/DistillManager.ts
git commit -m "feat(distill): mark feature merged when commit reachable from main"
```

---

## Phase 4 — Branch stamping at scratch write time

The distill code assumes observations have `branch_name` set. We need the observation writer to stamp it.

### Task 4.1: Test that observation writer stamps branch_name

**Files:**
- Read first: the observation writer file from Task 0.3 step 6 (probably `src/services/worker/SessionManager.ts` or a sibling).
- Create or modify: a test next to that file.

- [ ] **Step 1: Read the existing writer**

Open the file from Task 0.3 step 6. Identify the function that inserts rows into `observations`. Note its signature.

- [ ] **Step 2: Write a failing test**

In `tests/services/worker/observation-writer.test.ts` (adapt to upstream's convention):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { writeObservation } from '../../../src/services/worker/<EXACT_FILE>.js';  // from Task 0.3
import { setupTestDb } from '../../helpers/test-db.js';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('observation writer: branch_name stamping', () => {
  let db: any;
  let repoPath: string;

  beforeEach(async () => {
    db = await setupTestDb();
    repoPath = mkdtempSync(join(tmpdir(), 'obs-repo-'));
    execSync(`git -C "${repoPath}" init -b main`);
    writeFileSync(join(repoPath, 'f'), 'x');
    execSync(`git -C "${repoPath}" add . && git -C "${repoPath}" commit -m init`);
    execSync(`git -C "${repoPath}" checkout -b feature/foo`);
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, ?, 'x')", [repoPath]);
  });

  it('stamps the current git branch onto the new observation', async () => {
    await writeObservation(db, {
      projectId: 1,
      title: 'something',
      body: '...',
      // ... other required fields per the actual signature
    });
    const row = await db.get("SELECT branch_name FROM observations ORDER BY id DESC LIMIT 1");
    expect(row.branch_name).toBe('feature/foo');
  });

  it('leaves branch_name NULL when the project is not a git repo', async () => {
    const nonGitPath = mkdtempSync(join(tmpdir(), 'not-git-'));
    await db.run("INSERT INTO projects (id, path, name) VALUES (2, ?, 'y')", [nonGitPath]);

    await writeObservation(db, {
      projectId: 2,
      title: 'something',
      body: '...',
    });
    const row = await db.get("SELECT branch_name FROM observations ORDER BY id DESC LIMIT 1");
    expect(row.branch_name).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — writer doesn't stamp branch_name yet.

- [ ] **Step 4: Modify the writer**

In the writer file:

```typescript
import { execSync } from 'child_process';

function detectBranch(projectPath: string): string | null {
  try {
    const out = execSync(`git -C "${projectPath}" branch --show-current`, { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Inside writeObservation, before INSERT:
const projectRow = await db.get("SELECT path FROM projects WHERE id = ?", [input.projectId]);
const branchName = projectRow?.path ? detectBranch(projectRow.path) : null;

// Modify the INSERT statement to include branch_name and bind it.
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/services/worker/observation-writer.test.ts
```

Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add tests/services/worker/observation-writer.test.ts src/services/worker/<EXACT_FILE>.ts
git commit -m "feat(observations): stamp branch_name on scratch writes"
```

---

## Phase 5 — `claude-mem distill` CLI subcommand

### Task 5.1: Test the CLI subcommand wiring

**Files:**
- Create: `tests/cli/commands/distill.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runDistillCommand } from '../../../src/cli/commands/distill.js';

describe('distill CLI command', () => {
  it('parses --project, --commit, and --force flags', async () => {
    const calls: any[] = [];
    const fakeManager = {
      processBranch: async (input: any) => { calls.push(input); return { distillId: 1, consumedObservationIds: [], newDecisionIds: [], newTodoIds: [] }; },
    };

    await runDistillCommand({
      args: ['--project', '/tmp/x', '--commit', 'abc', '--force'],
      managerFactory: () => fakeManager as any,
      projectResolver: async (path: string) => ({ id: 99, branch: 'feature/y' }),
    });

    expect(calls).toEqual([{
      projectId: 99,
      branch: 'feature/y',
      commitSha: 'abc',
      force: true,
    }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the CLI command**

Create `src/cli/commands/distill.ts`:

```typescript
import { DistillManager } from '../../services/worker/DistillManager.js';
import { open } from '../../storage/db.js';
import { createProvider } from '../../services/worker/createProvider.js';
import { loadSettings } from '../../shared/settings.js';
import { getProjectIdAndBranch } from '../../utils/project-resolver.js';   // create if missing
import { logger } from '../../utils/logger.js';

export interface RunDistillInput {
  args: string[];
  managerFactory?: () => DistillManager;
  projectResolver?: (path: string) => Promise<{ id: number; branch: string }>;
}

export async function runDistillCommand(input: RunDistillInput): Promise<void> {
  const parsed = parseArgs(input.args);
  const resolve = input.projectResolver ?? getProjectIdAndBranch;
  const { id: projectId, branch } = await resolve(parsed.project);

  const manager = input.managerFactory
    ? input.managerFactory()
    : new DistillManager(await open(), createProvider(loadSettings()));

  const result = await manager.processBranch({
    projectId,
    branch,
    commitSha: parsed.commit,
    force: parsed.force,
  });

  if (result.distillId === null) {
    logger.info('DISTILL', `no-op (project=${projectId} branch=${branch})`);
  } else {
    logger.info('DISTILL', `wrote distill #${result.distillId}, consumed ${result.consumedObservationIds.length} observations`);
  }
}

function parseArgs(args: string[]) {
  let project = process.cwd();
  let commit = 'HEAD';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') project = args[++i];
    else if (args[i] === '--commit') commit = args[++i];
    else if (args[i] === '--force') force = true;
  }
  return { project, commit, force };
}
```

Also create `src/utils/project-resolver.ts` (stub for now — implementation in Task 6.1):

```typescript
export async function getProjectIdAndBranch(path: string): Promise<{ id: number; branch: string }> {
  throw new Error('not implemented — see Task 6.1');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/cli/commands/distill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register the subcommand in the CLI router**

Find the file that registers `claude-mem` subcommands (Task 0.3 may have found this; if not, `grep -rn 'commander\|yargs\|subcommand' src/cli/`). Add:

```typescript
import { runDistillCommand } from './commands/distill.js';

// Register 'distill' subcommand
program.command('distill').action(async (cmd: any) => {
  await runDistillCommand({ args: process.argv.slice(3) });
});
```

- [ ] **Step 6: Run end-to-end smoke**

```bash
# In the testbed:
cd ~/projects/mempilot-testbed
git checkout -b feature/test
echo "x" > a && git add a && git commit -m "add a"
node ~/projects/claude-mem-pilot/dist/cli/index.js distill --project "$(pwd)" --commit "$(git rev-parse HEAD)"
```

Expected: prints `no-op` (no observations yet) or distills if any exist.

- [ ] **Step 7: Commit**

```bash
git add tests/cli/commands/distill.test.ts src/cli/commands/distill.ts src/utils/project-resolver.ts src/cli/<router-file>.ts
git commit -m "feat(cli): add distill subcommand"
```

---

## Phase 6 — `claude-mem-pilot init` subcommand

### Task 6.1: Implement project resolver

**Files:**
- Modify: `src/utils/project-resolver.ts`
- Create: `tests/utils/project-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getProjectIdAndBranch, registerProject } from '../../src/utils/project-resolver.js';
import { setupTestDb } from '../helpers/test-db.js';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('project-resolver', () => {
  let db: any;
  let repoPath: string;

  beforeEach(async () => {
    db = await setupTestDb();
    repoPath = mkdtempSync(join(tmpdir(), 'resolver-'));
    execSync(`git -C "${repoPath}" init -b main`);
    writeFileSync(join(repoPath, 'f'), 'x');
    execSync(`git -C "${repoPath}" add . && git -C "${repoPath}" commit -m init`);
    execSync(`git -C "${repoPath}" remote add origin git@github.com:foo/bar.git`);
  });

  it('registerProject inserts a row and returns its id', async () => {
    const id = await registerProject(db, repoPath);
    const row = await db.get("SELECT * FROM projects WHERE id = ?", [id]);
    expect(row.path).toBe(repoPath);
    expect(row.git_remote_url).toBe('git@github.com:foo/bar.git');
  });

  it('registerProject is idempotent — second call returns same id', async () => {
    const id1 = await registerProject(db, repoPath);
    const id2 = await registerProject(db, repoPath);
    expect(id1).toBe(id2);
  });

  it('getProjectIdAndBranch returns id and current branch', async () => {
    await registerProject(db, repoPath);
    const result = await getProjectIdAndBranch(repoPath, db);
    expect(result.id).toBeTypeOf('number');
    expect(result.branch).toBe('main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `registerProject` not defined; `getProjectIdAndBranch` not implemented.

- [ ] **Step 3: Implement the resolver**

```typescript
import { execSync } from 'child_process';
import type { Database } from '../storage/db.js';
import { open } from '../storage/db.js';

export async function registerProject(db: Database, projectPath: string): Promise<number> {
  const remoteUrl = detectRemote(projectPath);
  const name = projectPath.split('/').pop() ?? 'unknown';

  const existing = await db.get(
    "SELECT id FROM projects WHERE path = ?",
    [projectPath],
  );
  if (existing) return existing.id;

  const result = await db.run(
    "INSERT INTO projects (path, name, git_remote_url) VALUES (?, ?, ?)",   // check existing schema for column names
    [projectPath, name, remoteUrl],
  );
  return result.lastID!;
}

export async function getProjectIdAndBranch(projectPath: string, db?: Database): Promise<{ id: number; branch: string }> {
  const database = db ?? await open();
  const row = await database.get("SELECT id FROM projects WHERE path = ?", [projectPath]);
  if (!row) throw new Error(`Project not registered: ${projectPath} — run 'claude-mem-pilot init' first`);
  const branch = execSync(`git -C "${projectPath}" branch --show-current`, { encoding: 'utf8' }).trim();
  return { id: row.id, branch };
}

function detectRemote(projectPath: string): string | null {
  try {
    return execSync(`git -C "${projectPath}" remote get-url origin`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
```

**Note:** the `projects` table may not have a `git_remote_url` column — check upstream's schema in Phase 0. If it doesn't, add an `ALTER TABLE projects ADD COLUMN git_remote_url TEXT;` to the migration in Task 1.1 and re-run Phase 1.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/utils/project-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/utils/project-resolver.test.ts src/utils/project-resolver.ts
git commit -m "feat(utils): project resolver and idempotent registration"
```

### Task 6.2: Implement `init` subcommand

**Files:**
- Create: `src/cli/commands/init.ts`
- Create: `tests/cli/commands/init.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { runInitCommand } from '../../../src/cli/commands/init.js';
import { setupTestDb } from '../../helpers/test-db.js';
import { execSync } from 'child_process';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('init command', () => {
  let db: any;
  let repoPath: string;

  beforeEach(async () => {
    db = await setupTestDb();
    repoPath = mkdtempSync(join(tmpdir(), 'init-'));
    execSync(`git -C "${repoPath}" init -b main`);
    execSync(`git -C "${repoPath}" commit --allow-empty -m init`);
  });

  it('registers the project and installs post-commit hook', async () => {
    await runInitCommand({ projectPath: repoPath, db });

    const project = await db.get("SELECT * FROM projects WHERE path = ?", [repoPath]);
    expect(project).toBeDefined();

    const hookPath = join(repoPath, '.git/hooks/post-commit');
    expect(existsSync(hookPath)).toBe(true);

    const hookContents = readFileSync(hookPath, 'utf8');
    expect(hookContents).toMatch(/claude-mem(-pilot)? distill/);
  });

  it('is idempotent — re-running does not error', async () => {
    await runInitCommand({ projectPath: repoPath, db });
    await expect(runInitCommand({ projectPath: repoPath, db })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the init command**

```typescript
import { registerProject } from '../../utils/project-resolver.js';
import type { Database } from '../../storage/db.js';
import { writeFileSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { open } from '../../storage/db.js';

export interface RunInitInput {
  projectPath: string;
  db?: Database;
}

export async function runInitCommand(input: RunInitInput): Promise<void> {
  const db = input.db ?? await open();
  const projectId = await registerProject(db, input.projectPath);

  const hookPath = join(input.projectPath, '.git/hooks/post-commit');
  const hookContent = `#!/bin/sh
# Installed by claude-mem-pilot init
claude-mem-pilot distill --project "$(git rev-parse --show-toplevel)" --commit "$(git rev-parse HEAD)" &
`;

  // If hook already exists and isn't ours, prepend; else write fresh.
  if (existsSync(hookPath)) {
    const existing = require('fs').readFileSync(hookPath, 'utf8');
    if (!existing.includes('claude-mem-pilot distill')) {
      writeFileSync(hookPath, existing + '\n' + hookContent);
    }
  } else {
    writeFileSync(hookPath, hookContent);
  }
  chmodSync(hookPath, 0o755);

  console.log(`Registered project ${projectId} at ${input.projectPath}`);
  console.log(`Installed post-commit hook at ${hookPath}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/cli/commands/init.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register the `init` subcommand in the CLI router**

Same pattern as Task 5.1 step 5. Add `program.command('init')...`.

- [ ] **Step 6: Smoke test in the testbed**

```bash
cd ~/projects/mempilot-testbed
node ~/projects/claude-mem-pilot/dist/cli/index.js init
ls -la .git/hooks/post-commit
```

Expected: post-commit hook exists and is executable.

- [ ] **Step 7: Commit**

```bash
git add tests/cli/commands/init.test.ts src/cli/commands/init.ts src/cli/<router-file>.ts
git commit -m "feat(cli): init subcommand registers project and installs post-commit hook"
```

### Task 6.3: End-to-end: a commit triggers distill

**Files:** none (manual verification)

- [ ] **Step 1: In the testbed, make a commit and verify distill fires**

```bash
cd ~/projects/mempilot-testbed
echo "change" >> a
git add a
git commit -m "another change"
sleep 5    # post-commit is backgrounded
sqlite3 ~/.claude-mem-fork/db.sqlite "SELECT id, feature_id FROM distilled_reflections ORDER BY id DESC LIMIT 1"
```

Expected: either a no-op (no observations to distill) or a distilled row.

If you want a real test with observations: run a Claude Code session in the testbed first to generate observations, then commit.

- [ ] **Step 2: Verify backgrounding doesn't slow commits**

```bash
time git commit --allow-empty -m "speed test"
```

Expected: commit completes in well under a second.

---

## Phase 7 — New MCP tools

Four small tools. Each follows the same pattern: test, implement query, register, smoke.

### Task 7.1: `list_decisions` tool

**Files:**
- Read first: the existing MCP tool file from Task 0.3 step 3 to learn the registration pattern.
- Create: `src/mcp/tools/list-decisions.ts`
- Create: `tests/mcp/tools/list-decisions.test.ts`

- [ ] **Step 1: Test the tool's query**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { listDecisions } from '../../../src/mcp/tools/list-decisions.js';
import { setupTestDb } from '../../helpers/test-db.js';

describe('list_decisions MCP tool', () => {
  let db: any;

  beforeEach(async () => {
    db = await setupTestDb();
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/x', 'x')");
    await db.run("INSERT INTO features (id, project_id, branch_name, title) VALUES (1, 1, 'b', 't')");
    await db.run("INSERT INTO distilled_reflections (id, feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used) VALUES (1, 1, 's', '[]', 'b', 'm')");
    await db.run("INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice, reason) VALUES (1, 1, 'auth', 'JWT', 'simpler')");
    await db.run("INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice, reason) VALUES (1, 1, 'storage', 'sqlite', 'embedded')");
  });

  it('lists all decisions when no filters', async () => {
    const result = await listDecisions(db, {});
    expect(result.length).toBe(2);
  });

  it('filters by topic LIKE', async () => {
    const result = await listDecisions(db, { topic: 'auth' });
    expect(result.length).toBe(1);
    expect(result[0].choice).toBe('JWT');
  });

  it('filters by project_id', async () => {
    const result = await listDecisions(db, { project_id: 1 });
    expect(result.length).toBe(2);
    const empty = await listDecisions(db, { project_id: 999 });
    expect(empty.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the tool**

```typescript
import type { Database } from '../../storage/db.js';

export interface ListDecisionsInput {
  topic?: string;
  project_id?: number;
  limit?: number;
}

export async function listDecisions(db: Database, input: ListDecisionsInput) {
  const limit = input.limit ?? 20;
  let sql = `
    SELECT d.*, f.project_id, f.title AS feature_title
    FROM decisions d
    JOIN features f ON d.feature_id = f.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (input.topic) {
    sql += ` AND d.topic LIKE ?`;
    params.push(`%${input.topic}%`);
  }
  if (input.project_id !== undefined) {
    sql += ` AND f.project_id = ?`;
    params.push(input.project_id);
  }
  sql += ` ORDER BY d.created_at DESC LIMIT ?`;
  params.push(limit);

  return await db.all(sql, params);
}
```

- [ ] **Step 4: Register the MCP tool**

In the MCP server registry file (Task 0.3 step 3), add:

```typescript
import { listDecisions } from './tools/list-decisions.js';

server.addTool({
  name: 'list_decisions',
  description: 'List decisions captured across distilled reflections. Filter by topic substring or project_id.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Optional substring filter on the decision topic.' },
      project_id: { type: 'number', description: 'Optional project filter.' },
      limit: { type: 'number', description: 'Max results (default 20).' },
    },
  },
  handler: async (args: any) => {
    const db = await open();
    return await listDecisions(db, args);
  },
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/mcp/tools/list-decisions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/mcp/tools/list-decisions.test.ts src/mcp/tools/list-decisions.ts src/mcp/<registry-file>.ts
git commit -m "feat(mcp): add list_decisions tool"
```

### Task 7.2: `get_feature_history` tool

**Files:**
- Create: `src/mcp/tools/get-feature-history.ts`
- Create: `tests/mcp/tools/get-feature-history.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getFeatureHistory } from '../../../src/mcp/tools/get-feature-history.js';
import { setupTestDb } from '../../helpers/test-db.js';

describe('get_feature_history', () => {
  let db: any;
  beforeEach(async () => {
    db = await setupTestDb();
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/x', 'x')");
    await db.run("INSERT INTO features (id, project_id, branch_name, title) VALUES (1, 1, 'feature/auth', 'Auth')");
    await db.run("INSERT INTO distilled_reflections (id, feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used, created_at) VALUES (1, 1, 's1', '[]', 'first distill', 'm', '2026-05-01')");
    await db.run("INSERT INTO distilled_reflections (id, feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used, created_at, superseded_by) VALUES (2, 1, 's2', '[]', 'second distill', 'm', '2026-05-02', NULL)");
    await db.run("UPDATE distilled_reflections SET superseded_by = 2 WHERE id = 1");
  });

  it('returns the full chain of distills for a feature, oldest first', async () => {
    const result = await getFeatureHistory(db, { feature: 'feature/auth' });
    expect(result.length).toBe(2);
    expect(result[0].body_md).toBe('first distill');
    expect(result[1].body_md).toBe('second distill');
  });

  it('accepts a feature_id instead of a name', async () => {
    const result = await getFeatureHistory(db, { feature_id: 1 });
    expect(result.length).toBe(2);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Database } from '../../storage/db.js';

export interface GetFeatureHistoryInput {
  feature?: string;      // branch_name or title
  feature_id?: number;
}

export async function getFeatureHistory(db: Database, input: GetFeatureHistoryInput) {
  let featureId = input.feature_id;
  if (!featureId && input.feature) {
    const row = await db.get(
      "SELECT id FROM features WHERE branch_name = ? OR title = ? LIMIT 1",
      [input.feature, input.feature],
    );
    if (!row) return [];
    featureId = row.id;
  }
  if (!featureId) throw new Error('feature or feature_id required');

  return await db.all(
    "SELECT * FROM distilled_reflections WHERE feature_id = ? ORDER BY created_at ASC",
    [featureId],
  );
}
```

- [ ] **Step 3: Register in MCP**

Same pattern as Task 7.1 step 4. Name `get_feature_history`.

- [ ] **Step 4: Run tests, commit**

```bash
npm test -- tests/mcp/tools/get-feature-history.test.ts
git add tests/mcp/tools/get-feature-history.test.ts src/mcp/tools/get-feature-history.ts src/mcp/<registry-file>.ts
git commit -m "feat(mcp): add get_feature_history tool"
```

### Task 7.3: `list_open_todos` tool

**Files:**
- Create: `src/mcp/tools/list-open-todos.ts`
- Create: `tests/mcp/tools/list-open-todos.test.ts`

- [ ] **Step 1: Test + implement + register, mirror Task 7.1 shape**

Query:

```typescript
export async function listOpenTodos(db: Database, input: { project_id?: number; limit?: number }) {
  const limit = input.limit ?? 20;
  let sql = `
    SELECT t.*, f.project_id, f.title AS feature_title, f.branch_name
    FROM todos t
    LEFT JOIN features f ON t.feature_id = f.id
    WHERE t.status = 'open'
  `;
  const params: any[] = [];
  if (input.project_id !== undefined) {
    sql += ` AND (f.project_id = ? OR t.feature_id IS NULL)`;
    params.push(input.project_id);
  }
  sql += ` ORDER BY t.created_at DESC LIMIT ?`;
  params.push(limit);
  return await db.all(sql, params);
}
```

- [ ] **Step 2: Test, register, commit**

```bash
git add tests/mcp/tools/list-open-todos.test.ts src/mcp/tools/list-open-todos.ts src/mcp/<registry-file>.ts
git commit -m "feat(mcp): add list_open_todos tool"
```

### Task 7.4: `list_features` tool

**Files:**
- Create: `src/mcp/tools/list-features.ts`
- Create: `tests/mcp/tools/list-features.test.ts`

- [ ] **Step 1: Test + implement + register**

Query:

```typescript
export async function listFeatures(db: Database, input: { status?: string; project_id?: number; limit?: number }) {
  const limit = input.limit ?? 20;
  let sql = `SELECT * FROM features WHERE 1=1`;
  const params: any[] = [];
  if (input.status) { sql += ` AND status = ?`; params.push(input.status); }
  if (input.project_id !== undefined) { sql += ` AND project_id = ?`; params.push(input.project_id); }
  sql += ` ORDER BY opened_at DESC LIMIT ?`;
  params.push(limit);
  return await db.all(sql, params);
}
```

- [ ] **Step 2: Test, register, commit**

```bash
git add tests/mcp/tools/list-features.test.ts src/mcp/tools/list-features.ts src/mcp/<registry-file>.ts
git commit -m "feat(mcp): add list_features tool"
```

---

## Phase 8 — Briefing extension

### Task 8.1: BriefingExtensions module

**Files:**
- Create: `src/services/worker/BriefingExtensions.ts`
- Create: `tests/services/worker/BriefingExtensions.test.ts`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderBriefingExtensions } from '../../../src/services/worker/BriefingExtensions.js';
import { setupTestDb } from '../../helpers/test-db.js';

describe('renderBriefingExtensions', () => {
  let db: any;
  beforeEach(async () => {
    db = await setupTestDb();
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, '/x', 'x')");
  });

  it('returns empty string when there are no features, decisions, or todos', async () => {
    const md = await renderBriefingExtensions(db, { projectIds: [1] });
    expect(md).toBe('');
  });

  it('renders three sections when data exists', async () => {
    await db.run("INSERT INTO features (id, project_id, branch_name, title, status) VALUES (1, 1, 'feature/auth', 'Auth refactor', 'open')");
    await db.run("INSERT INTO distilled_reflections (id, feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used) VALUES (1, 1, 's', '[]', 'b', 'm')");
    await db.run("INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice) VALUES (1, 1, 'trigger', 'post-commit')");
    await db.run("INSERT INTO todos (feature_id, source_distilled_reflection_id, body) VALUES (1, 1, 'Add tests')");

    const md = await renderBriefingExtensions(db, { projectIds: [1] });
    expect(md).toContain('## Open features');
    expect(md).toContain('Auth refactor');
    expect(md).toContain('## Recent decisions');
    expect(md).toContain('trigger');
    expect(md).toContain('## Open TODOs');
    expect(md).toContain('Add tests');
  });

  it('respects the token budget by truncating older entries', async () => {
    // Insert 100 features
    for (let i = 0; i < 100; i++) {
      await db.run(
        "INSERT INTO features (project_id, branch_name, title, status) VALUES (1, ?, ?, 'open')",
        [`feature/b${i}`, `Title ${i}`],
      );
    }
    const md = await renderBriefingExtensions(db, { projectIds: [1], maxTokens: 500 });
    // Rough estimate: 4 chars ≈ 1 token; 500 tokens ≈ 2000 chars
    expect(md.length).toBeLessThan(2500);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Database } from '../../storage/db.js';

export interface RenderBriefingInput {
  projectIds: number[];
  maxTokens?: number;
}

export async function renderBriefingExtensions(db: Database, input: RenderBriefingInput): Promise<string> {
  const maxTokens = input.maxTokens ?? 1000;
  const placeholders = input.projectIds.map(() => '?').join(',');

  const features = await db.all(
    `SELECT * FROM features WHERE project_id IN (${placeholders}) AND status = 'open' ORDER BY opened_at DESC LIMIT 10`,
    input.projectIds,
  );
  const decisions = await db.all(
    `SELECT d.*, f.branch_name FROM decisions d JOIN features f ON d.feature_id = f.id
     WHERE f.project_id IN (${placeholders}) ORDER BY d.created_at DESC LIMIT 10`,
    input.projectIds,
  );
  const todos = await db.all(
    `SELECT t.*, f.branch_name FROM todos t LEFT JOIN features f ON t.feature_id = f.id
     WHERE (f.project_id IN (${placeholders}) OR t.feature_id IS NULL) AND t.status = 'open'
     ORDER BY t.created_at DESC LIMIT 20`,
    input.projectIds,
  );

  if (features.length === 0 && decisions.length === 0 && todos.length === 0) return '';

  let md = '';
  if (features.length) {
    md += `## Open features (${features.length})\n\n`;
    md += `| ID | Branch | Title | Opened |\n|----|--------|-------|--------|\n`;
    for (const f of features) {
      md += `| F#${f.id} | ${f.branch_name} | ${f.title} | ${f.opened_at} |\n`;
    }
    md += `\n*Use list_features / get_feature_history for details.*\n\n`;
  }
  if (decisions.length) {
    md += `## Recent decisions (${decisions.length})\n\n`;
    md += `| ID | Topic | Choice | Branch |\n|----|-------|--------|--------|\n`;
    for (const d of decisions) {
      md += `| D#${d.id} | ${d.topic} | ${d.choice} | ${d.branch_name ?? ''} |\n`;
    }
    md += `\n*Use list_decisions for details.*\n\n`;
  }
  if (todos.length) {
    md += `## Open TODOs (${todos.length})\n\n`;
    md += `| ID | Body | Branch |\n|----|------|--------|\n`;
    for (const t of todos) {
      md += `| T#${t.id} | ${t.body} | ${t.branch_name ?? ''} |\n`;
    }
    md += `\n*Use list_open_todos for details.*\n\n`;
  }

  // Token budget enforcement (rough char ≈ 4 char/token)
  const maxChars = maxTokens * 4;
  if (md.length > maxChars) {
    md = md.slice(0, maxChars - 100) + '\n\n*…truncated by briefing token budget.*\n';
  }

  return md;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm test -- tests/services/worker/BriefingExtensions.test.ts
git add tests/services/worker/BriefingExtensions.test.ts src/services/worker/BriefingExtensions.ts
git commit -m "feat(briefing): renderBriefingExtensions appends features/decisions/todos sections"
```

### Task 8.2: Wire BriefingExtensions into the context handler

**Files:**
- Modify: `src/cli/handlers/context.ts` (or wherever the briefing markdown is finalized; verify in Task 0.3 step 7)

- [ ] **Step 1: Find where briefing markdown is finalized**

The hook handler in `src/cli/handlers/context.ts` already calls the worker via HTTP and reads back markdown. The actual rendering likely happens on the **worker side**, not the hook side. Find it:

```bash
grep -rn "/api/context/inject" src/ --include="*.ts"
```

This should point to a worker route file that produces the markdown. That's where extensions plug in.

- [ ] **Step 2: Add a settings check + append extensions**

In the worker route handler (wherever it builds the response markdown), after the existing index is built:

```typescript
import { renderBriefingExtensions } from '../services/worker/BriefingExtensions.js';

const settings = loadSettings();
if (settings.CLAUDE_MEM_BRIEFING_EXTENSIONS !== false) {  // default ON
  const projectIds = await resolveProjectIds(projectsParam);
  const extras = await renderBriefingExtensions(db, { projectIds });
  if (extras) {
    responseMarkdown += `\n\n${extras}`;
  }
}
```

- [ ] **Step 3: Add an integration test**

```typescript
// tests/integration/briefing-with-extensions.test.ts (sketch)
import { describe, it, expect } from 'vitest';
// ... seeds a DB, calls the worker route, asserts the markdown contains both
// the existing observation index AND the new "Open features" section.
```

- [ ] **Step 4: Run tests, commit**

```bash
npm test -- tests/integration/briefing-with-extensions.test.ts
git add tests/integration/briefing-with-extensions.test.ts src/<worker-route-file>.ts
git commit -m "feat(briefing): wire BriefingExtensions into context inject route"
```

### Task 8.3: Verify the feature flag disables extensions cleanly

**Files:** none (test only)

- [ ] **Step 1: Add a test case to the integration test**

```typescript
it('emits identical markdown to upstream when CLAUDE_MEM_BRIEFING_EXTENSIONS=false', async () => {
  // seed extensions data
  // set CLAUDE_MEM_BRIEFING_EXTENSIONS=false
  // call route
  // assert markdown matches upstream byte-for-byte (or contains no '## Open features')
});
```

- [ ] **Step 2: Run, commit**

```bash
npm test
git add tests/integration/briefing-with-extensions.test.ts
git commit -m "test(briefing): feature flag cleanly reverts to upstream behavior"
```

---

## Phase 9 — Top-level wiring and end-to-end scenario

### Task 9.1: Renamed binary and package metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rename the package and bin**

```json
{
  "name": "@<your-account>/claude-mem-pilot",
  "version": "0.1.0",
  "bin": {
    "claude-mem-pilot": "./dist/npx-cli/index.js"
  }
}
```

Keep `claude-mem` as a secondary bin alias if you want compatibility:

```json
"bin": {
  "claude-mem-pilot": "./dist/npx-cli/index.js",
  "claude-mem": "./dist/npx-cli/index.js"
}
```

- [ ] **Step 2: Update install scripts and any hardcoded `claude-mem` strings**

```bash
grep -rn "claude-mem" install/ scripts/ --include="*.sh" --include="*.js" | head
```

Replace `claude-mem` with `claude-mem-pilot` where appropriate (binary references; NOT brand mentions in user-facing prose).

- [ ] **Step 3: Build and link**

```bash
npm run build
npm link
```

- [ ] **Step 4: Verify**

```bash
claude-mem-pilot --version
claude-mem-pilot --help
```

Expected: shows version `0.1.0` and lists the new subcommands.

- [ ] **Step 5: Commit**

```bash
git add package.json install/ scripts/
git commit -m "chore: rename package to claude-mem-pilot, add binary alias"
```

### Task 9.2: End-to-end scripted scenario

**Files:**
- Create: `tests/scenarios/full-flow.test.ts`

- [ ] **Step 1: Write the end-to-end test**

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupTestDb } from '../helpers/test-db.js';
import { writeObservation } from '../../src/services/worker/<EXACT_FILE>.js';
import { runDistillCommand } from '../../src/cli/commands/distill.js';
import { renderBriefingExtensions } from '../../src/services/worker/BriefingExtensions.js';

describe('end-to-end: scratch → commit → distill → briefing', () => {
  it('captures the full lifecycle', async () => {
    const db = await setupTestDb();
    const repoPath = mkdtempSync(join(tmpdir(), 'e2e-'));
    execSync(`git -C "${repoPath}" init -b main`);
    writeFileSync(join(repoPath, 'README.md'), '# x');
    execSync(`git -C "${repoPath}" add . && git -C "${repoPath}" commit -m init`);
    execSync(`git -C "${repoPath}" checkout -b feature/foo`);
    await db.run("INSERT INTO projects (id, path, name) VALUES (1, ?, 'x')", [repoPath]);

    // 1. Simulate scratch observations being written
    await writeObservation(db, { projectId: 1, title: 'fixed timeout', body: 'changed 60s to 120s' });
    await writeObservation(db, { projectId: 1, title: 'added test', body: 'covers npm install case' });

    // 2. Simulate git commit + distill (in-process)
    writeFileSync(join(repoPath, 'change.txt'), 'x');
    execSync(`git -C "${repoPath}" add . && git -C "${repoPath}" commit -m "feature work"`);
    const commitSha = execSync(`git -C "${repoPath}" rev-parse HEAD`, { encoding: 'utf8' }).trim();

    const fakeProvider = {
      extract: async () => `<distill>
        <body>Increased hook timeout</body>
        <decisions><decision topic="timeout" choice="120s" reason="npm slow"/></decisions>
        <todos><todo>Document the new default</todo></todos>
        <suggested-title>Fix hook timeout</suggested-title>
      </distill>`,
      model: 'mock',
    };

    await runDistillCommand({
      args: ['--project', repoPath, '--commit', commitSha],
      managerFactory: () => {
        const { DistillManager } = require('../../src/services/worker/DistillManager.js');
        return new DistillManager(db, fakeProvider);
      },
      projectResolver: async () => ({ id: 1, branch: 'feature/foo' }),
    });

    // 3. Verify state
    const distill = await db.get("SELECT * FROM distilled_reflections WHERE superseded_by IS NULL");
    expect(distill).toBeDefined();
    expect(distill.body_md).toContain('Increased hook timeout');

    const feature = await db.get("SELECT * FROM features WHERE branch_name = 'feature/foo'");
    expect(feature.title).toBe('Fix hook timeout');

    const decisions = await db.all("SELECT * FROM decisions");
    expect(decisions.length).toBe(1);
    expect(decisions[0].topic).toBe('timeout');

    const todos = await db.all("SELECT * FROM todos");
    expect(todos.length).toBe(1);

    // 4. Render the briefing
    const briefing = await renderBriefingExtensions(db, { projectIds: [1] });
    expect(briefing).toContain('Fix hook timeout');
    expect(briefing).toContain('timeout');
    expect(briefing).toContain('Document the new default');
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm test -- tests/scenarios/full-flow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/scenarios/full-flow.test.ts
git commit -m "test(scenario): full lifecycle scratch → distill → briefing"
```

### Task 9.3: Real-world smoke

**Files:** none (manual)

- [ ] **Step 1: Set up a real Claude Code session against the fork**

```bash
cd ~/projects/mempilot-testbed
git checkout -b feature/smoke-test
claude-mem-pilot init
# Run a real Claude Code session — do a small task (e.g., add a function to a file)
# End the session.
sleep 10
sqlite3 ~/.claude-mem-fork/db.sqlite "SELECT id, title, branch_name FROM observations ORDER BY id DESC LIMIT 5"
```

Expected: observations from the session have `branch_name = 'feature/smoke-test'`.

- [ ] **Step 2: Commit + distill**

```bash
git add -A && git commit -m "test feature"
sleep 5
sqlite3 ~/.claude-mem-fork/db.sqlite "SELECT id, feature_id, body_md FROM distilled_reflections ORDER BY id DESC LIMIT 1"
```

Expected: a distilled reflection row exists for `feature/smoke-test`.

- [ ] **Step 3: Start a new session, verify the briefing**

Open Claude Code again in the same directory. Check that the SessionStart hook injects the new "Open features" / "Recent decisions" / "Open TODOs" sections.

- [ ] **Step 4: If everything works, tag a v0.1.0 release**

```bash
git tag v0.1.0
git push --tags
```

- [ ] **Step 5: Commit nothing further (release is a tag, not a commit)**

---

## Phase 10 — Documentation & rebase discipline

### Task 10.1: Document the fork

**Files:**
- Create: `docs/fork-overview.md`

- [ ] **Step 1: Write a short overview that points to the design spec**

```markdown
# MemPilot fork — overview

This fork pinned upstream `thedotmack/claude-mem` at tag `<TAG>` and adds:

- `GeminiCliProvider` (CLAUDE_MEM_PROVIDER=gemini-cli)
- Per-feature distill on git post-commit
- `features`, `todos`, `decisions`, `distilled_reflections` tables
- MCP tools: `list_decisions`, `get_feature_history`, `list_open_todos`, `list_features`
- Briefing extensions appended to Progressive Disclosure index

Full architecture: [design spec](specs/2026-05-30-mempilot-claude-mem-fork-design.md).

## Settings additions

```json
{
  "CLAUDE_MEM_PROVIDER": "gemini-cli",
  "CLAUDE_MEM_GEMINI_CLI_BINARY": "gemini",
  "CLAUDE_MEM_GEMINI_CLI_MODEL": "gemini-2.5-flash-lite",
  "CLAUDE_MEM_DISTILL_DEBOUNCE_SECONDS": 60,
  "CLAUDE_MEM_DISTILL_DEBOUNCE_MIN_OBSERVATIONS": 3,
  "CLAUDE_MEM_BRIEFING_EXTENSIONS": true
}
```

## New subcommands

- `claude-mem-pilot init` — register repo, install post-commit hook
- `claude-mem-pilot distill [--commit SHA] [--force]` — run distill manually

## Upstream rebase policy

- Rebase against `upstream/main` weekly during active dev, monthly after stabilization.
- Conflicts limited to: provider registry, MCP tool registry, briefing renderer, observation writer.
- If conflicts persist across two rebases: PR features upstream and shed the fork.
```

- [ ] **Step 2: Commit**

```bash
git add docs/fork-overview.md
git commit -m "docs: fork overview and rebase policy"
```

### Task 10.2: Set up upstream remote and first rebase rehearsal

**Files:** none

- [ ] **Step 1: Add upstream remote**

```bash
git remote add upstream https://github.com/thedotmack/claude-mem.git
git fetch upstream
```

- [ ] **Step 2: Rehearse rebase against current upstream main (don't push)**

```bash
git checkout -b rebase-rehearsal mempilot-main
git rebase upstream/main
```

Expected: some conflicts in registry files. Resolve them. Document the resolution patterns in `~/mempilot-fork-notes.md` for future rebases.

- [ ] **Step 3: Discard the rehearsal branch**

```bash
git rebase --abort  # or git checkout mempilot-main && git branch -D rebase-rehearsal
```

Don't push the rebase yet. Wait for the v0.1.0 to be stable in real use.

- [ ] **Step 4: Commit nothing**

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| GeminiCliProvider | Phase 2 (Tasks 2.1–2.4) |
| Schema additions (observations columns + 4 tables) | Phase 1 (Tasks 1.1, 1.2) |
| Per-feature distill algorithm | Phase 3 (Tasks 3.1–3.7) |
| Branch stamping at scratch time | Phase 4 (Task 4.1) |
| `distill` CLI subcommand | Phase 5 (Task 5.1) |
| `init` subcommand | Phase 6 (Tasks 6.1, 6.2) |
| Four new MCP tools | Phase 7 (Tasks 7.1–7.4) |
| Briefing extension | Phase 8 (Tasks 8.1–8.3) |
| Settings additions | Touched in 2.3, 8.2 (registered as opt-in/opt-out flags) |
| Bootstrap UX | Phase 9 (Task 9.1 — binary rename, alias) |
| Idempotency of distill | Phase 3 tests cover all 7 scenarios from the spec's idempotency table |
| Upstream-rebase discipline | Phase 10 (Task 10.2) |
| End-to-end acceptance criteria | Phase 9 (Task 9.2 scripted + 9.3 manual) |
| Open question 1 (pinned tag) | Phase 0 Task 0.1 |
| Open question 2 (gemini CLI behavior) | Phase 0 Task 0.3 step 9 |
| Open question 3, 4 (upstream PR potential) | Out of plan; revisit after Phase 9 |
| Open question 5 (migration numbering) | Phase 0 Task 0.3 step 4; Phase 1 Task 1.1 step 1 |
| Open question 6 (test harness) | Phase 0 Task 0.3 step 5 |
| Open question 7 (project resolver in upstream) | Phase 0 Task 0.3 step 2; Phase 6 Task 6.1 |
