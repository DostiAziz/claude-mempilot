import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';

import { ensureServerStorageSchema } from '../../src/storage/sqlite/schema.js';

export async function setupTestDb(): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), 'mempilot-test-'));
  const dbPath = join(dir, 'db.sqlite');

  // SessionStore constructor runs all migrations automatically
  const store = new SessionStore(dbPath);
  ensureServerStorageSchema(store.db as Database);
  return store.db as Database;
}
