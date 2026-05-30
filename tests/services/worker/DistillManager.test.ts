import { describe, it, expect, beforeEach } from 'bun:test';
import { DistillManager } from '../../../src/services/worker/DistillManager.js';
import { setupTestDb } from '../../helpers/test-db.js';
import type { ProviderRegistry } from '../../../src/shared/ProviderRegistry.js';
import type { Database } from 'bun:sqlite';

describe('DistillManager.processBranch', () => {
  let db: Database;
  let mockRegistry: ProviderRegistry;

  beforeEach(async () => {
    db = await setupTestDb();
    // Mock registry
    mockRegistry = {
      getForTask: async () => ({
        name: 'test',
        model: 'test',
        isAvailable: async () => true,
        extract: async () => '<distill/>',
        extractStructured: async () => ({}),
      }),
    } as any;
  });

  it('returns no-op when there are no observations on the branch', async () => {
    const manager = new DistillManager(db, mockRegistry);

    // Seed a project, no observations
    const now = Math.floor(Date.now() / 1000);
    await db.run("INSERT INTO projects (id, name, root_path, metadata, created_at_epoch, updated_at_epoch) VALUES (1, 'test', '/tmp/x', '{}', ?, ?)", [now, now]);

    const result = await manager.processBranch({
      projectId: 1,
      branch: 'feature/foo',
      commitSha: 'abc123',
    });

    expect(result.distillId).toBe(null);
    expect(result.consumedObservationIds).toEqual([]);

    // No distill row written
    const rows = db.query("SELECT * FROM distilled_reflections").all();
    expect(rows.length).toBe(0);
  });
});
