import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeMemDatabase } from '../../../../src/services/sqlite/Database.js';
import { storeObservation } from '../../../../src/services/sqlite/Observations.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../../../src/services/sqlite/Sessions.js';
import type { ObservationInput } from '../../../../src/services/sqlite/observations/types.js';
import type { Database } from 'bun:sqlite';

describe('observation writer: branch_name stamping', () => {
  let db: Database;
  let repoPath: string;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;

    // Create a git repo with two branches
    repoPath = mkdtempSync(join(tmpdir(), 'obs-repo-'));
    try {
      execSync(`git -C "${repoPath}" init -b main`);
      writeFileSync(join(repoPath, 'f'), 'x');
      execSync(`git -C "${repoPath}" add . && git -C "${repoPath}" commit -m init`);
      execSync(`git -C "${repoPath}" checkout -b feature/foo`);
    } catch (e) {
      console.error('Failed to setup test repo:', e);
      throw e;
    }
  });

  afterEach(() => {
    db.close();
  });

  function createObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
    return {
      type: 'discovery',
      title: 'Test Observation',
      subtitle: 'Subtitle',
      facts: ['fact1'],
      narrative: 'Narrative body',
      concepts: ['concept1'],
      files_read: ['/path/to/file1.ts'],
      files_modified: [],
      ...overrides,
    };
  }

  function createSessionWithMemoryId(
    contentSessionId: string,
    memorySessionId: string,
    project = 'test-project'
  ): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  it('stamps the current git branch onto the new observation', () => {
    const memorySessionId = createSessionWithMemoryId('content-branch-1', 'mem-branch-1', repoPath);

    const result = storeObservation(db, memorySessionId, repoPath, createObservationInput({
      title: 'Test observation',
      narrative: 'This is a test',
    }));

    // Verify observation has branch_name = 'feature/foo'
    const obs = db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(result.id) as { branch_name: string | null } | null;

    expect(obs).not.toBeNull();
    expect(obs?.branch_name).toBe('feature/foo');
  });

  it('stamps different branches when observations are written from different branches', () => {
    const memorySessionId = createSessionWithMemoryId('content-dedup-1', 'mem-dedup-1', repoPath);

    // Write from feature/foo
    const result1 = storeObservation(
      db,
      memorySessionId,
      repoPath,
      createObservationInput({
        title: 'Obs 1',
        narrative: 'From foo',
      })
    );

    // Switch to main
    execSync(`git -C "${repoPath}" checkout main`);

    // Write from main
    const result2 = storeObservation(
      db,
      memorySessionId,
      repoPath,
      createObservationInput({
        title: 'Obs 2',
        narrative: 'From main',
      })
    );

    const obs1 = db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(result1.id) as { branch_name: string | null };
    const obs2 = db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(result2.id) as { branch_name: string | null };

    expect(obs1.branch_name).toBe('feature/foo');
    expect(obs2.branch_name).toBe('main');
  });

  it('handles detached HEAD state (stamps NULL for branch_name)', () => {
    const memorySessionId = createSessionWithMemoryId('content-detached-1', 'mem-detached-1', repoPath);

    // Get a commit SHA and detach HEAD
    const commitSha = execSync(`git -C "${repoPath}" rev-parse HEAD`).toString().trim();
    execSync(`git -C "${repoPath}" checkout ${commitSha}`);

    const result = storeObservation(
      db,
      memorySessionId,
      repoPath,
      createObservationInput({
        title: 'Detached HEAD obs',
        narrative: 'Written while detached',
      })
    );

    const obs = db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(result.id) as { branch_name: string | null };

    // Detached HEAD should result in NULL branch_name
    expect(obs.branch_name).toBeNull();
  });

  it('handles non-git projects (stamps NULL for branch_name)', () => {
    // Use a non-git directory
    const nonGitPath = mkdtempSync(join(tmpdir(), 'non-git-'));
    const memorySessionId = createSessionWithMemoryId('content-nongit-1', 'mem-nongit-1', nonGitPath);

    const result = storeObservation(
      db,
      memorySessionId,
      nonGitPath,
      createObservationInput({
        title: 'Non-git obs',
        narrative: 'Written in non-git project',
      })
    );

    const obs = db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(result.id) as { branch_name: string | null };

    expect(obs.branch_name).toBeNull();
  });
});
