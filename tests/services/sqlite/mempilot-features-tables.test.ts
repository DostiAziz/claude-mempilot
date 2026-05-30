import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';

interface TableNameRow {
  name: string;
}

interface TableColumnInfo {
  name: string;
  type: string;
  notnull: number;
}

interface IndexInfo {
  name: string;
}

function getTableNames(db: Database): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as TableNameRow[];
  return rows.map(r => r.name);
}

function getColumns(db: Database, table: string): TableColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnInfo[];
}

function getIndexNames(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as IndexInfo[];
  return rows.map(r => r.name);
}

describe('MemPilot migration: features tables', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  describe('schema creation', () => {
    it('creates all four new tables and adds two columns to observations', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const tables = getTableNames(db);

      expect(tables).toContain('features');
      expect(tables).toContain('distilled_reflections');
      expect(tables).toContain('decisions');
      expect(tables).toContain('todos');
    });

    it('adds branch_name and feature_id columns to observations table', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const obsCols = getColumns(db, 'observations');
      const colNames = obsCols.map(c => c.name);

      expect(colNames).toContain('branch_name');
      expect(colNames).toContain('feature_id');
    });

    it('creates proper indexes on observations for branch_name and feature_id', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_observations_branch_feature'"
      ).all() as { name: string }[];

      expect(indexes.length).toBe(1);
    });

    it('creates features table with correct columns and constraints', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const cols = getColumns(db, 'features');
      const colNames = cols.map(c => c.name);

      expect(colNames).toContain('id');
      expect(colNames).toContain('project_id');
      expect(colNames).toContain('branch_name');
      expect(colNames).toContain('title');
      expect(colNames).toContain('status');
      expect(colNames).toContain('opened_at');
      expect(colNames).toContain('merged_at');

      const statusCol = cols.find(c => c.name === 'status');
      expect(statusCol).toBeDefined();
    });

    it('creates distilled_reflections table with correct columns', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const cols = getColumns(db, 'distilled_reflections');
      const colNames = cols.map(c => c.name);

      expect(colNames).toContain('id');
      expect(colNames).toContain('feature_id');
      expect(colNames).toContain('commit_sha_at_distill');
      expect(colNames).toContain('consumed_observation_ids');
      expect(colNames).toContain('superseded_by');
      expect(colNames).toContain('body_md');
      expect(colNames).toContain('llm_model_used');
      expect(colNames).toContain('created_at');
    });

    it('creates decisions table with correct columns', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const cols = getColumns(db, 'decisions');
      const colNames = cols.map(c => c.name);

      expect(colNames).toContain('id');
      expect(colNames).toContain('feature_id');
      expect(colNames).toContain('distilled_reflection_id');
      expect(colNames).toContain('topic');
      expect(colNames).toContain('choice');
      expect(colNames).toContain('alternatives_rejected');
      expect(colNames).toContain('reason');
      expect(colNames).toContain('created_at');
    });

    it('creates todos table with correct columns', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const cols = getColumns(db, 'todos');
      const colNames = cols.map(c => c.name);

      expect(colNames).toContain('id');
      expect(colNames).toContain('feature_id');
      expect(colNames).toContain('source_distilled_reflection_id');
      expect(colNames).toContain('body');
      expect(colNames).toContain('status');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('closed_at');
    });
  });

  describe('indexes', () => {
    it('creates index on distilled_reflections for current (non-superseded) items', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_distilled_feature_current'"
      ).all() as { name: string }[];

      expect(indexes.length).toBe(1);
    });

    it('creates index on decisions.topic for efficient filtering', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_decisions_topic'"
      ).all() as { name: string }[];

      expect(indexes.length).toBe(1);
    });

    it('creates index on open todos for efficient filtering', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_todos_open'"
      ).all() as { name: string }[];

      expect(indexes.length).toBe(1);
    });
  });

  describe('constraints', () => {
    it('enforces UNIQUE(project_id, branch_name) on features', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      db.prepare(
        "INSERT INTO features (project_id, branch_name, title) VALUES (1, 'main', 'Main Feature')"
      ).run();

      expect(() => {
        db.prepare(
          "INSERT INTO features (project_id, branch_name, title) VALUES (1, 'main', 'Another Feature')"
        ).run();
      }).toThrow();
    });

    it('enforces foreign key constraint on distilled_reflections.feature_id', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      expect(() => {
        db.prepare(`
          INSERT INTO distilled_reflections
          (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
          VALUES (999, 'abc123', '[]', 'test', 'claude-3-opus')
        `).run();
      }).toThrow();
    });

    it('enforces foreign key constraint on decisions.feature_id', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      expect(() => {
        db.prepare(`
          INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice)
          VALUES (999, 1, 'architecture', 'monolith')
        `).run();
      }).toThrow();
    });

    it('enforces foreign key constraint on todos.feature_id', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      expect(() => {
        db.prepare(`
          INSERT INTO todos (feature_id, body)
          VALUES (999, 'Write tests')
        `).run();
      }).toThrow();
    });
  });

  describe('data integrity', () => {
    it('allows inserting and querying features', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)'
      ).run(1, 'feat/auth', 'Add authentication');

      const result = db.prepare(
        'SELECT * FROM features WHERE branch_name = ?'
      ).get('feat/auth') as any;

      expect(result).toBeDefined();
      expect(result.project_id).toBe(1);
      expect(result.title).toBe('Add authentication');
      expect(result.status).toBe('open');
    });

    it('allows inserting and querying observations with branch_name and feature_id', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const now = new Date().toISOString();
      const epoch = Date.now();

      db.prepare(`
        INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('content-1', 'memory-1', 'test-project', now, epoch, 'active');

      db.prepare(`
        INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, branch_name, feature_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('memory-1', 'test-project', 'discovery', now, epoch, 'feat/auth', 1);

      const result = db.prepare(
        'SELECT branch_name, feature_id FROM observations WHERE memory_session_id = ?'
      ).get('memory-1') as { branch_name: string; feature_id: number };

      expect(result.branch_name).toBe('feat/auth');
      expect(result.feature_id).toBe(1);
    });

    it('allows cascading delete from features to dependent tables', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const featureId = db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)'
      ).run(1, 'test-feature', 'Test Feature').lastInsertRowid as number;

      const reflectionId = db.prepare(`
        INSERT INTO distilled_reflections (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
        VALUES (?, ?, ?, ?, ?)
      `).run(featureId, 'sha123', '[]', 'Reflection body', 'claude-3-opus').lastInsertRowid as number;

      db.prepare(`
        INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice)
        VALUES (?, ?, ?, ?)
      `).run(featureId, reflectionId, 'testing', 'unit-tests');

      db.prepare(`
        INSERT INTO todos (feature_id, source_distilled_reflection_id, body)
        VALUES (?, ?, ?)
      `).run(featureId, reflectionId, 'Write unit tests');

      db.prepare('DELETE FROM features WHERE id = ?').run(featureId);

      const reflections = db.prepare('SELECT COUNT(*) as count FROM distilled_reflections WHERE feature_id = ?').get(featureId) as { count: number };
      const decisions = db.prepare('SELECT COUNT(*) as count FROM decisions WHERE feature_id = ?').get(featureId) as { count: number };
      const todos = db.prepare('SELECT COUNT(*) as count FROM todos WHERE feature_id = ?').get(featureId) as { count: number };

      expect(reflections.count).toBe(0);
      expect(decisions.count).toBe(0);
      expect(todos.count).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('running migrations twice does not error', () => {
      const runner = new MigrationRunner(db);

      runner.runAllMigrations();
      expect(() => runner.runAllMigrations()).not.toThrow();
    });

    it('produces identical schema when run twice', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const tablesAfterFirst = getTableNames(db);
      const obsColsAfterFirst = getColumns(db, 'observations').map(c => c.name);

      runner.runAllMigrations();

      const tablesAfterSecond = getTableNames(db);
      const obsColsAfterSecond = getColumns(db, 'observations').map(c => c.name);

      expect(tablesAfterSecond).toEqual(tablesAfterFirst);
      expect(obsColsAfterSecond).toEqual(obsColsAfterFirst);
    });
  });

  describe('default values', () => {
    it('sets status to "open" by default on features', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)'
      ).run(1, 'test', 'Test');

      const result = db.prepare('SELECT status FROM features LIMIT 1').get() as { status: string };
      expect(result.status).toBe('open');
    });

    it('sets status to "open" by default on todos', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      const featureId = db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)'
      ).run(1, 'test', 'Test').lastInsertRowid as number;

      db.prepare('INSERT INTO todos (feature_id, body) VALUES (?, ?)').run(featureId, 'Do something');

      const result = db.prepare('SELECT status FROM todos LIMIT 1').get() as { status: string };
      expect(result.status).toBe('open');
    });

    it('sets created_at timestamp automatically', () => {
      const runner = new MigrationRunner(db);
      runner.runAllMigrations();

      db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)'
      ).run(1, 'test', 'Test');

      const result = db.prepare('SELECT opened_at FROM features LIMIT 1').get() as { opened_at: string };
      expect(result.opened_at).toBeDefined();
      expect(result.opened_at).not.toBeNull();
    });
  });
});
