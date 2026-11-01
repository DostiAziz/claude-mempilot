import { describe, it, expect, beforeEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { setupTestDb } from '../../helpers/test-db.js';
import { runDistillationMigrations } from '../../../src/services/sqlite/migrations/runner.js';
import {
  renderBriefingExtensions,
  queryKnowledgeGraphFeatures,
  queryKnowledgeGraphDecisions,
  queryKnowledgeGraphTodos,
  queryFeatureHistory,
  formatFeaturesMcpText,
  formatDecisionsMcpText,
  formatTodosMcpText,
  formatFeatureHistoryMcpText,
} from '../../../src/services/context/sections/BriefingExtensions.js';

describe('BriefingExtensions and Knowledge Graph queries', () => {
  let db: Database;

  beforeEach(async () => {
    db = await setupTestDb();
    runDistillationMigrations(db);

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'INSERT INTO projects (id, name, root_path, metadata, created_at_epoch, updated_at_epoch) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('proj-1', 'claude-mempilot', '/repo/claude-mempilot', '{}', now, now);
  });

  it('returns empty string when Knowledge Graph tables have no rows', () => {
    const rendered = renderBriefingExtensions(db, ['claude-mempilot']);
    expect(rendered).toBe('');
  });

  it('renders Open features, Recent decisions, and Open TODOs for the active project', () => {
    const fRes = db
      .prepare('INSERT INTO features (project_id, branch_name, title, status) VALUES (?, ?, ?, ?)')
      .run('proj-1', 'feature/kg-pipeline', 'Knowledge Graph Pipeline', 'open');
    const featureId = Number(fRes.lastInsertRowid);

    const drRes = db
      .prepare(
        `INSERT INTO distilled_reflections
          (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(featureId, 'abcdef1234567', '[1,2]', 'Implemented KG distillation and MCP tools.', 'OllamaProvider');
    const distillId = Number(drRes.lastInsertRowid);

    db.prepare(
      `INSERT INTO decisions
        (feature_id, distilled_reflection_id, topic, choice, reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(featureId, distillId, 'storage', 'SQLite additive tables', 'Zero external dependencies');

    db.prepare(
      `INSERT INTO todos
        (feature_id, source_distilled_reflection_id, body, status)
       VALUES (?, ?, ?, ?)`,
    ).run(featureId, distillId, 'Add UI tab for decisions', 'open');

    const rendered = renderBriefingExtensions(db, ['claude-mempilot']);
    expect(rendered).toContain('## Open features (1)');
    expect(rendered).toContain('feature/kg-pipeline');
    expect(rendered).toContain('Knowledge Graph Pipeline');
    expect(rendered).toContain('## Recent decisions (1)');
    expect(rendered).toContain('SQLite additive tables');
    expect(rendered).toContain('## Open TODOs (1)');
    expect(rendered).toContain('Add UI tab for decisions');
  });

  it('truncates TODOs first, then decisions, then features when over character budget', () => {
    const fRes = db
      .prepare('INSERT INTO features (project_id, branch_name, title, status) VALUES (?, ?, ?, ?)')
      .run('proj-1', 'feature/budget', 'Budget Test Feature', 'open');
    const featureId = Number(fRes.lastInsertRowid);

    db.prepare(
      'INSERT INTO decisions (feature_id, topic, choice, reason) VALUES (?, ?, ?, ?)',
    ).run(featureId, 'routing', 'Scenario fallback', 'Resilience');

    db.prepare(
      'INSERT INTO todos (feature_id, body, status) VALUES (?, ?, ?)',
    ).run(featureId, 'Very long TODO item that will push the total size over a small character budget', 'open');

    // Tight budget that fits features + decisions but not TODOs
    const tight = renderBriefingExtensions(db, ['claude-mempilot'], { maxChars: 380 });
    expect(tight).toContain('## Open features');
    expect(tight).not.toContain('## Open TODOs');
  });

  it('queries and formats feature history, decisions, and todos for MCP tools', () => {
    const fRes = db
      .prepare('INSERT INTO features (project_id, branch_name, title, status) VALUES (?, ?, ?, ?)')
      .run('proj-1', 'feature/mcp-tools', 'MCP Knowledge Graph Tools', 'open');
    const featureId = Number(fRes.lastInsertRowid);

    const r1 = db
      .prepare(
        `INSERT INTO distilled_reflections
          (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(featureId, '1111111', '[10]', 'Initial reflection', 'OllamaProvider');
    const r2 = db
      .prepare(
        `INSERT INTO distilled_reflections
          (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(featureId, '2222222', '[11,12]', 'Updated reflection', 'OllamaProvider');
    db.prepare('UPDATE distilled_reflections SET superseded_by = ? WHERE id = ?').run(
      r2.lastInsertRowid,
      r1.lastInsertRowid,
    );

    db.prepare(
      'INSERT INTO decisions (feature_id, distilled_reflection_id, topic, choice, reason) VALUES (?, ?, ?, ?, ?)',
    ).run(featureId, r2.lastInsertRowid, 'mcp-transport', 'worker HTTP routes', 'Reuses existing worker connection');

    db.prepare(
      'INSERT INTO todos (feature_id, source_distilled_reflection_id, body, status) VALUES (?, ?, ?, ?)',
    ).run(featureId, r2.lastInsertRowid, 'Verify MCP tool output in Antigravity', 'open');

    const features = queryKnowledgeGraphFeatures(db, ['claude-mempilot']);
    expect(features.length).toBe(1);
    expect(formatFeaturesMcpText(features)).toContain('MCP Knowledge Graph Tools');

    const decisions = queryKnowledgeGraphDecisions(db, ['claude-mempilot'], { topic: 'mcp' });
    expect(decisions.length).toBe(1);
    expect(formatDecisionsMcpText(decisions)).toContain('worker HTTP routes');

    const todos = queryKnowledgeGraphTodos(db, ['claude-mempilot']);
    expect(todos.length).toBe(1);
    expect(formatTodosMcpText(todos)).toContain('Verify MCP tool output in Antigravity');

    const history = queryFeatureHistory(db, 'feature/mcp-tools', ['claude-mempilot']);
    expect(history.feature?.id).toBe(featureId);
    expect(history.reflections.length).toBe(2);
    const historyText = formatFeatureHistoryMcpText(history);
    expect(historyText).toContain('Initial reflection');
    expect(historyText).toContain('Updated reflection');
    expect(historyText).toContain('superseded by');
    expect(historyText).toContain('CURRENT');
  });
});
