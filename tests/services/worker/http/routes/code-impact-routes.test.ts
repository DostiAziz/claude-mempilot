import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureCodeGraphSchema } from '../../../../../src/services/code-graph/schema.js';
import { getDirtyFilesBuffer } from '../../../../../src/services/code-graph/DirtyFilesBuffer.js';
import { formatCodeImpactMcpText } from '../../../../../src/services/context/sections/BriefingExtensions.js';

describe('Code Impact MCP & API Route Logic', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT);
      CREATE TABLE IF NOT EXISTS features (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, choice TEXT, reason TEXT);
    `);
    ensureCodeGraphSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('formats an informative Markdown report when blast radius and decisions are present', () => {
    const report = {
      symbolName: 'SessionStore',
      filePath: 'src/services/sqlite/SessionStore.ts',
      directCallers: [
        {
          depth: 1,
          file: 'src/services/worker/DistillManager.ts',
          symbol: 'DistillManager.processBranch',
          relation: 'calls' as const,
          referenceCount: 3,
        },
      ],
      outwardDependencies: [
        {
          depth: 1,
          file: 'src/services/sqlite/connection.ts',
          symbol: 'LATEST_SCHEMA_VERSION',
          relation: 'imports' as const,
          referenceCount: 1,
        },
      ],
      linkedDecisions: [
        {
          decisionId: 9,
          topic: 'Git Branch Stamping',
          choice: 'projects.root_path fallback',
          reason: 'Avoid detached HEAD errors',
          featureTitle: 'Knowledge Graph End-to-End',
        },
      ],
    };

    const text = formatCodeImpactMcpText(report);
    expect(text).toContain('# Code Impact Report: `SessionStore`');
    expect(text).toContain('src/services/worker/DistillManager.ts');
    expect(text).toContain('DistillManager.processBranch');
    expect(text).toContain('Decision #9: Git Branch Stamping');
    expect(text).toContain('projects.root_path fallback');
  });

  it('formats cleanly when a symbol has no callers yet (leaf or new)', () => {
    const report = {
      symbolName: 'BrandNewUtil',
      directCallers: [],
      outwardDependencies: [],
      linkedDecisions: [],
    };

    const text = formatCodeImpactMcpText(report);
    expect(text).toContain('# Code Impact Report: `BrandNewUtil`');
    expect(text).toContain('No callers recorded in code graph');
    expect(text).toContain('No outward dependencies recorded');
    expect(text).toContain('No past architectural decisions specifically linked');
  });
});
