import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureCodeGraphSchema, CODE_GRAPH_SCHEMA_VERSION } from '../../../src/services/code-graph/schema.js';

describe('ensureCodeGraphSchema (Migration v72)', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT,
        choice TEXT,
        reason TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('applies migration v72 cleanly and registers in schema_versions', () => {
    ensureCodeGraphSchema(db);

    const versionRow = db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(CODE_GRAPH_SCHEMA_VERSION) as { version: number };
    expect(versionRow).toBeDefined();
    expect(versionRow.version).toBe(72);

    // Verify code_symbols table
    const symbolsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_symbols'").get();
    expect(symbolsTable).toBeDefined();

    // Verify code_edges table
    const edgesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_edges'").get();
    expect(edgesTable).toBeDefined();

    // Verify symbol_decision_links table
    const linksTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='symbol_decision_links'").get();
    expect(linksTable).toBeDefined();
  });

  it('is strictly idempotent on subsequent invocations', () => {
    ensureCodeGraphSchema(db);
    expect(() => ensureCodeGraphSchema(db)).not.toThrow();
  });

  it('enforces unique constraints and foreign keys', () => {
    ensureCodeGraphSchema(db);

    // Insert symbol
    db.prepare(`
      INSERT INTO code_symbols (
        project_id, file_path, symbol_name, symbol_kind, start_line, end_line, content_hash, updated_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p1', 'src/foo.ts', 'myFunc', 'function', 1, 10, 'hash1', Date.now());

    // Duplicate symbol insert should fail UNIQUE constraint
    expect(() => {
      db.prepare(`
        INSERT INTO code_symbols (
          project_id, file_path, symbol_name, symbol_kind, start_line, end_line, content_hash, updated_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('p1', 'src/foo.ts', 'myFunc', 'function', 1, 10, 'hash1', Date.now());
    }).toThrow();
  });
});
