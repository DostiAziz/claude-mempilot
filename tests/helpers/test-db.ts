import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../src/services/sqlite/migrations/runner.js';

export async function setupTestDb(): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), 'mempilot-test-'));
  const dbPath = join(dir, 'db.sqlite');

  const db = new Database(dbPath);

  // Run all migrations including MemPilot's
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();

  return db;
}
