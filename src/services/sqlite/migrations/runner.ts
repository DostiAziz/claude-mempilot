import type { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';

export function runDistillationMigrations(db: Database): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        opened_at TEXT DEFAULT (datetime('now')),
        merged_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(project_id, branch_name)
      );

      CREATE TABLE IF NOT EXISTS distilled_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        commit_sha_at_distill TEXT,
        consumed_observation_ids TEXT,
        superseded_by INTEGER,
        body_md TEXT NOT NULL,
        llm_model_used TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        distilled_reflection_id INTEGER,
        topic TEXT NOT NULL,
        choice TEXT NOT NULL,
        alternatives_rejected TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        source_distilled_reflection_id INTEGER,
        body TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT
      );
    `);

    // Add feature_id to observations if it doesn't exist
    const cols = db.query('PRAGMA table_info(observations)').all() as any[];
    if (!cols.some(c => c.name === 'feature_id')) {
      db.exec('ALTER TABLE observations ADD COLUMN feature_id INTEGER REFERENCES features(id) ON DELETE SET NULL;');
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_distilled_feature_current ON distilled_reflections(feature_id) WHERE superseded_by IS NULL;
      CREATE INDEX IF NOT EXISTS idx_decisions_topic ON decisions(topic);
      CREATE INDEX IF NOT EXISTS idx_todos_open ON todos(feature_id) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS idx_observations_branch_feature ON observations(branch_name, feature_id);
    `);

    db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(64, new Date().toISOString());

    db.exec('COMMIT;');
    logger.debug('DB', 'Distillation migrations ran successfully');
  } catch (error) {
    db.exec('ROLLBACK;');
    logger.error('DB', 'Failed to run distillation migrations', undefined, { error });
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}
