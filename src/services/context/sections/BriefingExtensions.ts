import type { Database } from 'bun:sqlite';
import { runDistillationMigrations } from '../../sqlite/migrations/runner.js';

export const BRIEFING_EXTENSION_CHAR_LIMIT = 3_500;

export interface KnowledgeGraphFeatureRow {
  id: number;
  project_id: string;
  project_name: string | null;
  branch_name: string;
  title: string;
  status: string;
  opened_at: string;
  merged_at: string | null;
  last_distill_at: string | null;
  last_distill_body: string | null;
  consumed_observation_ids: string | null;
}

export interface KnowledgeGraphDecisionRow {
  id: number;
  feature_id: number;
  branch_name: string;
  feature_title: string;
  distilled_reflection_id: number | null;
  topic: string;
  choice: string;
  alternatives_rejected: string | null;
  reason: string | null;
  created_at: string;
}

export interface KnowledgeGraphTodoRow {
  id: number;
  feature_id: number | null;
  branch_name: string | null;
  feature_title: string | null;
  source_distilled_reflection_id: number | null;
  body: string;
  status: string;
  created_at: string;
  closed_at: string | null;
}

export interface KnowledgeGraphReflectionRow {
  id: number;
  feature_id: number;
  commit_sha_at_distill: string | null;
  consumed_observation_ids: string | null;
  superseded_by: number | null;
  body_md: string;
  llm_model_used: string | null;
  created_at: string;
}

export interface FeatureHistoryResult {
  feature: KnowledgeGraphFeatureRow | null;
  reflections: KnowledgeGraphReflectionRow[];
  decisions: KnowledgeGraphDecisionRow[];
  todos: KnowledgeGraphTodoRow[];
}

function hasKnowledgeGraphTables(db: Database): boolean {
  try {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='features'")
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

export function ensureKnowledgeGraphReady(db: Database): boolean {
  if (hasKnowledgeGraphTables(db)) return true;
  try {
    runDistillationMigrations(db);
    return hasKnowledgeGraphTables(db);
  } catch {
    return false;
  }
}

function buildProjectFilterSql(
  projects: string[],
  featureAlias: string = 'f',
  projectAlias: string = 'p',
): { clause: string; params: string[] } {
  const clean = projects.map(p => p.trim()).filter(Boolean);
  if (clean.length === 0) {
    return { clause: '1=1', params: [] };
  }
  const placeholders = clean.map(() => '?').join(', ');
  return {
    clause: `(${projectAlias}.name IN (${placeholders}) OR ${featureAlias}.project_id IN (${placeholders}))`,
    params: [...clean, ...clean],
  };
}

export function queryKnowledgeGraphFeatures(
  db: Database,
  projects: string[] = [],
  options: { status?: string; limit?: number } = {},
): KnowledgeGraphFeatureRow[] {
  if (!hasKnowledgeGraphTables(db)) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const { clause, params } = buildProjectFilterSql(projects, 'f', 'p');
  const statusFilter = options.status && options.status !== 'all' ? 'AND f.status = ?' : '';
  const statusParams = options.status && options.status !== 'all' ? [options.status] : [];

  try {
    return db
      .prepare(
        `SELECT
          f.id,
          f.project_id,
          p.name AS project_name,
          f.branch_name,
          f.title,
          f.status,
          f.opened_at,
          f.merged_at,
          dr.created_at AS last_distill_at,
          dr.body_md AS last_distill_body,
          dr.consumed_observation_ids AS consumed_observation_ids
        FROM features f
        LEFT JOIN projects p ON p.id = f.project_id
        LEFT JOIN distilled_reflections dr
          ON dr.id = (
            SELECT MAX(id) FROM distilled_reflections
            WHERE feature_id = f.id AND superseded_by IS NULL
          )
        WHERE ${clause} ${statusFilter}
        ORDER BY COALESCE(dr.created_at, f.opened_at) DESC, f.id DESC
        LIMIT ?`,
      )
      .all(...params, ...statusParams, limit) as KnowledgeGraphFeatureRow[];
  } catch {
    return [];
  }
}

export function queryKnowledgeGraphDecisions(
  db: Database,
  projects: string[] = [],
  options: { topic?: string; limit?: number } = {},
): KnowledgeGraphDecisionRow[] {
  if (!hasKnowledgeGraphTables(db)) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const { clause, params } = buildProjectFilterSql(projects, 'f', 'p');
  const topicFilter = options.topic?.trim()
    ? 'AND (LOWER(d.topic) LIKE LOWER(?) OR LOWER(d.choice) LIKE LOWER(?) OR LOWER(COALESCE(d.reason, \'\')) LIKE LOWER(?))'
    : '';
  const topicPattern = options.topic?.trim() ? `%${options.topic.trim()}%` : '';
  const topicParams = topicPattern ? [topicPattern, topicPattern, topicPattern] : [];

  try {
    return db
      .prepare(
        `SELECT
          d.id,
          d.feature_id,
          f.branch_name,
          f.title AS feature_title,
          d.distilled_reflection_id,
          d.topic,
          d.choice,
          d.alternatives_rejected,
          d.reason,
          d.created_at
        FROM decisions d
        INNER JOIN features f ON f.id = d.feature_id
        LEFT JOIN projects p ON p.id = f.project_id
        WHERE ${clause} ${topicFilter}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT ?`,
      )
      .all(...params, ...topicParams, limit) as KnowledgeGraphDecisionRow[];
  } catch {
    return [];
  }
}

export function queryKnowledgeGraphTodos(
  db: Database,
  projects: string[] = [],
  options: { status?: string; limit?: number } = {},
): KnowledgeGraphTodoRow[] {
  if (!hasKnowledgeGraphTables(db)) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const status = options.status ?? 'open';
  const { clause, params } = buildProjectFilterSql(projects, 'f', 'p');
  const statusClause = status === 'all' ? '' : 'AND t.status = ?';
  const statusParams = status === 'all' ? [] : [status];

  try {
    return db
      .prepare(
        `SELECT
          t.id,
          t.feature_id,
          f.branch_name,
          f.title AS feature_title,
          t.source_distilled_reflection_id,
          t.body,
          t.status,
          t.created_at,
          t.closed_at
        FROM todos t
        LEFT JOIN features f ON f.id = t.feature_id
        LEFT JOIN projects p ON p.id = f.project_id
        WHERE (${clause} OR t.feature_id IS NULL) ${statusClause}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ?`,
      )
      .all(...params, ...statusParams, limit) as KnowledgeGraphTodoRow[];
  } catch {
    return [];
  }
}

export function queryFeatureHistory(
  db: Database,
  featureName: string,
  projects: string[] = [],
): FeatureHistoryResult {
  if (!hasKnowledgeGraphTables(db)) {
    return { feature: null, reflections: [], decisions: [], todos: [] };
  }
  const normalized = featureName.trim();
  const numericIdMatch = normalized.match(/^(?:F#)?(\d+)$/i);
  const { clause, params } = buildProjectFilterSql(projects, 'f', 'p');

  try {
    let feature: KnowledgeGraphFeatureRow | null = null;
    if (numericIdMatch) {
      feature = db
        .prepare(
          `SELECT
            f.id, f.project_id, p.name AS project_name, f.branch_name, f.title,
            f.status, f.opened_at, f.merged_at,
            dr.created_at AS last_distill_at, dr.body_md AS last_distill_body,
            dr.consumed_observation_ids AS consumed_observation_ids
          FROM features f
          LEFT JOIN projects p ON p.id = f.project_id
          LEFT JOIN distilled_reflections dr ON dr.id = (
            SELECT MAX(id) FROM distilled_reflections
            WHERE feature_id = f.id AND superseded_by IS NULL
          )
          WHERE f.id = ? AND ${clause}
          LIMIT 1`,
        )
        .get(Number(numericIdMatch[1]), ...params) as KnowledgeGraphFeatureRow | null;
    }

    if (!feature) {
      feature = db
        .prepare(
          `SELECT
            f.id, f.project_id, p.name AS project_name, f.branch_name, f.title,
            f.status, f.opened_at, f.merged_at,
            dr.created_at AS last_distill_at, dr.body_md AS last_distill_body,
            dr.consumed_observation_ids AS consumed_observation_ids
          FROM features f
          LEFT JOIN projects p ON p.id = f.project_id
          LEFT JOIN distilled_reflections dr ON dr.id = (
            SELECT MAX(id) FROM distilled_reflections
            WHERE feature_id = f.id AND superseded_by IS NULL
          )
          WHERE (f.branch_name = ? OR LOWER(f.title) = LOWER(?) OR f.branch_name LIKE ?)
            AND ${clause}
          ORDER BY f.id DESC
          LIMIT 1`,
        )
        .get(normalized, normalized, `%${normalized}%`, ...params) as KnowledgeGraphFeatureRow | null;
    }

    if (!feature) {
      return { feature: null, reflections: [], decisions: [], todos: [] };
    }

    const reflections = db
      .prepare(
        `SELECT id, feature_id, commit_sha_at_distill, consumed_observation_ids,
                superseded_by, body_md, llm_model_used, created_at
         FROM distilled_reflections
         WHERE feature_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(feature.id) as KnowledgeGraphReflectionRow[];

    const decisions = db
      .prepare(
        `SELECT d.id, d.feature_id, ? AS branch_name, ? AS feature_title,
                d.distilled_reflection_id, d.topic, d.choice,
                d.alternatives_rejected, d.reason, d.created_at
         FROM decisions d
         WHERE d.feature_id = ?
         ORDER BY d.created_at ASC, d.id ASC`,
      )
      .all(feature.branch_name, feature.title, feature.id) as KnowledgeGraphDecisionRow[];

    const todos = db
      .prepare(
        `SELECT t.id, t.feature_id, ? AS branch_name, ? AS feature_title,
                t.source_distilled_reflection_id, t.body, t.status, t.created_at, t.closed_at
         FROM todos t
         WHERE t.feature_id = ?
         ORDER BY t.created_at ASC, t.id ASC`,
      )
      .all(feature.branch_name, feature.title, feature.id) as KnowledgeGraphTodoRow[];

    return { feature, reflections, decisions, todos };
  } catch {
    return { feature: null, reflections: [], decisions: [], todos: [] };
  }
}

export function formatFeaturesMcpText(features: KnowledgeGraphFeatureRow[]): string {
  if (features.length === 0) {
    return 'No features found in the Knowledge Graph for this project.';
  }
  const lines = [
    `# Features (${features.length})`,
    '',
    '| ID | Branch | Title | Status | Last Distill |',
    '|----|--------|-------|--------|--------------|',
  ];
  for (const f of features) {
    const lastDistill = f.last_distill_at ? f.last_distill_at.slice(0, 16).replace('T', ' ') : 'never';
    lines.push(`| F#${f.id} | \`${f.branch_name}\` | ${f.title} | ${f.status} | ${lastDistill} |`);
  }
  lines.push('', '*Use `get_feature_history({feature_name: "<branch or F#id>"})` to inspect distilled reflections, decisions, and TODOs.*');
  return lines.join('\n');
}

export function formatDecisionsMcpText(decisions: KnowledgeGraphDecisionRow[]): string {
  if (decisions.length === 0) {
    return 'No architectural decisions recorded yet for this query.';
  }
  const lines = [
    `# Architectural Decisions (${decisions.length})`,
    '',
    '| ID | Topic | Choice | Reason | Feature | Date |',
    '|----|-------|--------|--------|---------|------|',
  ];
  for (const d of decisions) {
    const date = d.created_at ? d.created_at.slice(0, 10) : '-';
    const reason = d.reason || '-';
    lines.push(`| D#${d.id} | ${d.topic} | ${d.choice} | ${reason} | F#${d.feature_id} (\`${d.branch_name}\`) | ${date} |`);
  }
  return lines.join('\n');
}

export function formatTodosMcpText(todos: KnowledgeGraphTodoRow[]): string {
  if (todos.length === 0) {
    return 'No open TODOs in the Knowledge Graph for this project.';
  }
  const lines = [
    `# Open TODOs (${todos.length})`,
    '',
    '| ID | Status | Task | Feature | Created |',
    '|----|--------|------|---------|---------|',
  ];
  for (const t of todos) {
    const date = t.created_at ? t.created_at.slice(0, 10) : '-';
    const featureRef = t.feature_id ? `F#${t.feature_id} (\`${t.branch_name ?? ''}\`)` : 'project-wide';
    lines.push(`| T#${t.id} | ${t.status} | ${t.body} | ${featureRef} | ${date} |`);
  }
  return lines.join('\n');
}

export function formatFeatureHistoryMcpText(history: FeatureHistoryResult): string {
  if (!history.feature) {
    return 'Feature not found. Use `list_features` to see available branches and feature IDs.';
  }
  const { feature, reflections, decisions, todos } = history;
  const lines: string[] = [
    `# Feature F#${feature.id}: ${feature.title}`,
    `- **Branch**: \`${feature.branch_name}\``,
    `- **Status**: ${feature.status}`,
    `- **Opened**: ${feature.opened_at}${feature.merged_at ? ` | **Merged**: ${feature.merged_at}` : ''}`,
    '',
  ];

  if (reflections.length === 0) {
    lines.push('No distilled reflections recorded yet for this feature.');
  } else {
    lines.push(`## Distilled Reflections (${reflections.length})`);
    for (const r of reflections) {
      const stateTag = r.superseded_by ? `superseded by R#${r.superseded_by}` : 'CURRENT';
      const sha = r.commit_sha_at_distill ? ` @ \`${r.commit_sha_at_distill.slice(0, 7)}\`` : '';
      const obsIds = r.consumed_observation_ids ? ` (observations: ${r.consumed_observation_ids})` : '';
      lines.push(`### R#${r.id} [${stateTag}] — ${r.created_at}${sha}${obsIds}`);
      lines.push(r.body_md || '(empty reflection)');
      lines.push('');
    }
  }

  if (decisions.length > 0) {
    lines.push(`## Decisions (${decisions.length})`);
    for (const d of decisions) {
      lines.push(`- **D#${d.id} [${d.topic}]**: ${d.choice}${d.reason ? ` — *${d.reason}*` : ''}`);
    }
    lines.push('');
  }

  if (todos.length > 0) {
    lines.push(`## TODOs (${todos.length})`);
    for (const t of todos) {
      lines.push(`- [${t.status === 'open' ? ' ' : 'x'}] **T#${t.id}**: ${t.body}`);
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Renders the SessionStart Knowledge Graph briefing extension:
 * - Open features ( preferring distilled features first )
 * - Recent decisions
 * - Open TODOs
 * Respects `maxChars` (~1K tokens default), truncating TODOs first, then
 * decisions, then features. Returns '' if all three sections are empty.
 */
export function renderBriefingExtensions(
  db: Database,
  projects: string[],
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? BRIEFING_EXTENSION_CHAR_LIMIT;
  if (maxChars <= 200 || !hasKnowledgeGraphTables(db)) return '';

  const allOpenFeatures = queryKnowledgeGraphFeatures(db, projects, { status: 'open', limit: 8 });
  // Prefer features that either have a distilled reflection or a meaningful title
  const distilledFeatures = allOpenFeatures.filter(
    f => f.last_distill_at !== null || f.title !== f.branch_name,
  );
  const featuresToShow = (distilledFeatures.length > 0 ? distilledFeatures : allOpenFeatures).slice(0, 5);
  const decisions = queryKnowledgeGraphDecisions(db, projects, { limit: 5 });
  const todos = queryKnowledgeGraphTodos(db, projects, { status: 'open', limit: 5 });

  if (featuresToShow.length === 0 && decisions.length === 0 && todos.length === 0) {
    return '';
  }

  const buildFeatureBlock = (items: KnowledgeGraphFeatureRow[]): string => {
    if (items.length === 0) return '';
    const rows = items.map(f => {
      const distillStatus = f.last_distill_at ? f.last_distill_at.slice(0, 10) : 'pending';
      return `| F#${f.id} | ${f.branch_name} | ${f.title} | ${distillStatus} |`;
    });
    return [
      `## Open features (${items.length})`,
      '| ID | Branch | Title | Last distill |',
      '|----|--------|-------|--------------|',
      ...rows,
      '*Use list_features / get_feature_history for details.*',
    ].join('\n');
  };

  const buildDecisionBlock = (items: KnowledgeGraphDecisionRow[]): string => {
    if (items.length === 0) return '';
    const rows = items.map(d => `| D#${d.id} | ${d.topic} | ${d.choice} | F#${d.feature_id} | ${d.reason || '-'} |`);
    return [
      `## Recent decisions (${items.length})`,
      '| ID | Topic | Choice | Feature | Reason |',
      '|----|-------|--------|---------|--------|',
      ...rows,
      '*Use list_decisions for details.*',
    ].join('\n');
  };

  const buildTodoBlock = (items: KnowledgeGraphTodoRow[]): string => {
    if (items.length === 0) return '';
    const rows = items.map(t => `| T#${t.id} | ${t.body} | ${t.feature_id ? `F#${t.feature_id}` : '-'} |`);
    return [
      `## Open TODOs (${items.length})`,
      '| ID | Body | Feature |',
      '|----|------|---------|',
      ...rows,
      '*Use list_open_todos for details.*',
    ].join('\n');
  };

  let curFeatures = [...featuresToShow];
  let curDecisions = [...decisions];
  let curTodos = [...todos];

  const assemble = (): string =>
    [buildFeatureBlock(curFeatures), buildDecisionBlock(curDecisions), buildTodoBlock(curTodos)]
      .filter(Boolean)
      .join('\n\n');

  let rendered = assemble();
  // Truncate order per spec: TODOs first, then decisions, then features
  while (rendered.length > maxChars && curTodos.length > 0) {
    curTodos.pop();
    rendered = assemble();
  }
  while (rendered.length > maxChars && curDecisions.length > 0) {
    curDecisions.pop();
    rendered = assemble();
  }
  while (rendered.length > maxChars && curFeatures.length > 0) {
    curFeatures.pop();
    rendered = assemble();
  }

  return rendered.length <= maxChars ? rendered : '';
}
