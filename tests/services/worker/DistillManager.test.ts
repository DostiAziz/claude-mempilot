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

  const createMockProvider = () => ({
    name: 'test',
    model: 'test',
    isAvailable: async () => true,
    extract: async (input: any) => `<distill>
      <body>Distill</body>
      <decisions/>
      <todos/>
    </distill>`,
    extractStructured: async (input: any) => ({ decisions: [] }),
  });

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

  it('on second distill, processes only new observations and supersedes the prior', async () => {
    const mockProvider = {
      name: 'test',
      model: 'test',
      isAvailable: async () => true,
      extract: async (input: any) => `<distill>
      <body>Updated distill</body>
      <decisions/>
      <todos/>
    </distill>`,
      extractStructured: async (input: any) => ({ decisions: [] }),
    };

    const mockRegistry2 = {
      getForTask: async (task: string) => mockProvider,
    } as any;

    const manager = new DistillManager(db, mockRegistry2);

    seedProject();
    seedSession();

    // First distill
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(10, '1', 'feature/foo', 'obs1', 'content1', 'observation', now, nowEpoch, 'memory_session_1');

    const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });
    expect(first.distillId).not.toBe(null);

    // Add new observations (enough to exceed default debounce threshold of 3)
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(12, '1', 'feature/foo', 'o3', 'c3', 'observation', now, nowEpoch, 'memory_session_1');
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(13, '1', 'feature/foo', 'o4', 'c4', 'observation', now, nowEpoch, 'memory_session_1');
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(14, '1', 'feature/foo', 'o5', 'c5', 'observation', now, nowEpoch, 'memory_session_1');

    const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
    expect(second.distillId).not.toBe(null);
    expect(second.distillId).not.toBe(first.distillId);
    expect(second.consumedObservationIds).toEqual([12, 13, 14]);

    // Prior distill is superseded
    const priorRow = db.query("SELECT superseded_by FROM distilled_reflections WHERE id = ?").get(first.distillId) as any;
    expect(priorRow.superseded_by).toBe(second.distillId);

    const currentRow = db.query("SELECT superseded_by FROM distilled_reflections WHERE id = ?").get(second.distillId) as any;
    expect(currentRow.superseded_by).toBe(null);
  });

  it('is a no-op when called twice in a row with no new observations', async () => {
    let extractCallCount = 0;
    const mockProvider = {
      name: 'test',
      model: 'test',
      isAvailable: async () => true,
      extract: async (input: any) => {
        extractCallCount++;
        return '<distill><body>d</body><decisions/><todos/></distill>';
      },
      extractStructured: async (input: any) => ({ decisions: [] }),
    };

    const mockRegistry2 = {
      getForTask: async (task: string) => mockProvider,
    } as any;

    const manager = new DistillManager(db, mockRegistry2);

    seedProject();
    seedSession();

    // First distill
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(10, '1', 'feature/foo', 'obs1', 'content1', 'observation', now, nowEpoch, 'memory_session_1');

    const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });

    const second = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
    expect(second.distillId).toBe(null);
    expect(extractCallCount).toBe(1);
  });

  it('skips distill when below debounce thresholds', async () => {
    const mockProvider = createMockProvider();
    const mockRegistry2 = {
      getForTask: async (task: string) => mockProvider,
    } as any;

    const debounceManager = new DistillManager(db, mockRegistry2, {
      debounceSeconds: 60,
      debounceMinObservations: 3,
    });

    seedProject();
    seedSession();

    // Add several observations first
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    for (let i = 10; i < 13; i++) {
      db.prepare(
        `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(i, '1', 'feature/foo', `obs${i}`, `content${i}`, 'observation', now, nowEpoch, 'memory_session_1');
    }

    // First distill
    const first = await debounceManager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });
    expect(first.distillId).not.toBe(null);

    // Add just 1 new obs immediately (within debounce window)
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(13, '1', 'feature/foo', 'o3', 'c3', 'observation', now, nowEpoch, 'memory_session_1');

    // Should be debounced
    const second = await debounceManager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha2' });
    expect(second.distillId).toBe(null);
  });

  it('force=true re-processes all observations even when none are unclaimed', async () => {
    const mockProvider = createMockProvider();
    const mockRegistry2 = {
      getForTask: async (task: string) => mockProvider,
    } as any;

    const manager = new DistillManager(db, mockRegistry2);

    seedProject();
    seedSession();

    // Add observations and first distill
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO observations (id, project, branch_name, title, text, type, created_at, created_at_epoch, memory_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(10, '1', 'feature/foo', 'obs1', 'content1', 'observation', now, nowEpoch, 'memory_session_1');

    const first = await manager.processBranch({ projectId: 1, branch: 'feature/foo', commitSha: 'sha1' });
    expect(first.distillId).not.toBe(null);

    // Second call with force=true
    const second = await manager.processBranch({
      projectId: 1,
      branch: 'feature/foo',
      commitSha: 'sha2',
      force: true,
    });
    expect(second.distillId).not.toBe(null);
    expect(second.distillId).not.toBe(first.distillId);
    expect(second.consumedObservationIds).toEqual([10]);
  });
});
