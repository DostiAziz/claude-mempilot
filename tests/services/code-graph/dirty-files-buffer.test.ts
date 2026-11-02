import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureCodeGraphSchema } from '../../../src/services/code-graph/schema.js';
import { DirtyFilesBuffer } from '../../../src/services/code-graph/DirtyFilesBuffer.js';

describe('DirtyFilesBuffer (Staged Stability & Code Graph Persistence)', () => {
  let db: Database;
  let testDir: string;
  let buffer: DirtyFilesBuffer;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT);
      CREATE TABLE IF NOT EXISTS features (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, choice TEXT, reason TEXT);
    `);
    ensureCodeGraphSchema(db);

    testDir = join(tmpdir(), `claude-mem-cg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    buffer = new DirtyFilesBuffer(db, 50); // fast 50ms debounce for tests
  });

  afterEach(() => {
    db.close();
    try {
      if (existsSync(testDir)) {
        rmdirSync(testDir, { recursive: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('indexes symbols and edges when a file is marked dirty and flushed', async () => {
    const filePath = 'src/service.ts';
    const absPath = join(testDir, filePath);
    mkdirSync(join(testDir, 'src'), { recursive: true });

    const code = `
export class AuthService {
  public login(user: string): boolean {
    return true;
  }
}
`;
    writeFileSync(absPath, code, 'utf8');

    buffer.markDirty(filePath, 'p1', testDir);
    await buffer.flushAll();

    const symbols = db.prepare('SELECT symbol_name, symbol_kind FROM code_symbols WHERE project_id = ?').all('p1') as any[];
    expect(symbols.length).toBeGreaterThanOrEqual(2);
    expect(symbols.some(s => s.symbol_name === 'AuthService')).toBe(true);
    expect(symbols.some(s => s.symbol_name === 'AuthService.login')).toBe(true);
  });

  it('detects revert and zero-diff changes, aborting with 0 SQLite operations', async () => {
    const filePath = 'src/service.ts';
    const absPath = join(testDir, filePath);
    mkdirSync(join(testDir, 'src'), { recursive: true });

    const initialCode = `
export class AuthService {
  public login(): void {}
}
`;
    writeFileSync(absPath, initialCode, 'utf8');

    buffer.markDirty(filePath, 'p1', testDir);
    await buffer.flushAll();

    const initialUpdateEpoch = (db.prepare('SELECT updated_at_epoch FROM code_symbols WHERE symbol_name = ?').get('AuthService') as any).updated_at_epoch;

    // Simulate agent trying an edit, then immediately reverting back to original code
    writeFileSync(absPath, initialCode, 'utf8');
    buffer.markDirty(filePath, 'p1', testDir);
    await buffer.flushAll();

    const postRevertEpoch = (db.prepare('SELECT updated_at_epoch FROM code_symbols WHERE symbol_name = ?').get('AuthService') as any).updated_at_epoch;
    expect(postRevertEpoch).toBe(initialUpdateEpoch); // Did not re-write to DB!
  });

  it('computes recursive blast radius of dependent callers', async () => {
    const fileA = 'src/util.ts';
    const fileB = 'src/caller.ts';
    const absA = join(testDir, fileA);
    const absB = join(testDir, fileB);
    mkdirSync(join(testDir, 'src'), { recursive: true });

    writeFileSync(absA, `
export function formatData(d: string): string {
  return d.trim();
}
`, 'utf8');

    writeFileSync(absB, `
import { formatData } from './util.js';

export function runProcess(input: string): string {
  return formatData(input);
}
`, 'utf8');

    buffer.markDirty(fileA, 'p1', testDir);
    buffer.markDirty(fileB, 'p1', testDir);
    await buffer.flushAll();

    // Query blast radius: who calls formatData?
    const blast = buffer.getBlastRadius('p1', 'formatData');
    expect(blast.length).toBeGreaterThan(0);
    expect(blast.some(b => b.symbol === 'runProcess')).toBe(true);
  });

  it('generates a unified Code Impact Report bridging code symbols to episodic decisions', async () => {
    const fileA = 'src/auth.ts';
    const absA = join(testDir, fileA);
    mkdirSync(join(testDir, 'src'), { recursive: true });

    writeFileSync(absA, `
export class UserAuth {
  public authenticate(): void {}
}
`, 'utf8');

    buffer.markDirty(fileA, 'p1', testDir);
    await buffer.flushAll();

    const sym = db.prepare('SELECT id FROM code_symbols WHERE symbol_name = ?').get('UserAuth') as { id: number };
    expect(sym).toBeDefined();

    // Seed feature & decision
    db.prepare("INSERT INTO features (id, name, status) VALUES (1, 'RBAC Migration', 'completed')").run();
    db.prepare("INSERT INTO decisions (id, topic, choice, reason) VALUES (10, 'Auth Pattern', 'UserAuth Class', 'Unified multi-tenant auth')").run();

    // Link symbol to decision
    db.prepare(`
      INSERT INTO symbol_decision_links (symbol_id, decision_id, feature_id, relation_type)
      VALUES (?, ?, ?, ?)
    `).run(sym.id, 10, 1, 'introduced');

    // Generate report
    const report = buffer.getCodeImpactReport('p1', 'UserAuth');
    expect(report.symbolName).toBe('UserAuth');
    expect(report.linkedDecisions.length).toBe(1);
    expect(report.linkedDecisions[0].choice).toBe('UserAuth Class');
    expect(report.linkedDecisions[0].featureTitle).toBe('RBAC Migration');
  });
});
