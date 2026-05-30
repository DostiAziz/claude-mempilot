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

  const seedProject = () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO projects (id, name, root_path, metadata, created_at_epoch, updated_at_epoch) VALUES (?, ?, ?, ?, ?, ?)")
      .run(1, 'test', '/tmp/x', '{}', now, now);
  };

  const seedSession = () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO sdk_sessions (id, content_session_id, memory_session_id, project, started_at, started_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(1, 'content_session_1', 'memory_session_1', 'test', new Date().toISOString(), now);
  };

  it('returns no-op when there are no observations on the branch', async () => {
    const manager = new DistillManager(db, mockRegistry);

    // Seed a project, no observations
    seedProject();

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

  it('writes a distilled row and claims observations when there is no prior distill', async () => {
    const mockProvider = {
      name: 'test',
      model: 'test',
      isAvailable: async () => true,
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
      extractStructured: async (input: any) => ({ decisions: [] }),
    };

    const mockRegistry2 = {
      getForTask: async (task: string) => mockProvider,
    } as any;

    const manager = new DistillManager(db, mockRegistry2);

    seedProject();
    seedSession();

    // Seed observations
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(10, '1', 'feature/foo', 'obs1', 'content1', 'observation', now, nowEpoch, 'memory_session_1');

    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(11, '1', 'feature/foo', 'obs2', 'content2', 'observation', now, nowEpoch, 'memory_session_1');

    const result = await manager.processBranch({
      projectId: 1,
      branch: 'feature/foo',
      commitSha: 'abc123',
    });

    expect(result.distillId).not.toBe(null);
    expect(result.consumedObservationIds).toEqual([10, 11]);
    expect(result.newDecisionIds.length).toBe(1);
    expect(result.newTodoIds.length).toBe(1);

    // Observations are now claimed
    const obs = db.query("SELECT id, feature_id FROM observations ORDER BY id").all() as any[];
    expect(obs[0].feature_id).not.toBe(null);
    expect(obs[1].feature_id).toBe(obs[0].feature_id);

    // Feature title was updated
    const feature = db.query("SELECT * FROM features WHERE id = ?").get(obs[0].feature_id) as any;
    expect(feature.title).toBe('Add foo feature');
  });
});
