import type { Database } from 'bun:sqlite';
import type { ProviderRegistry } from '../../shared/ProviderRegistry.js';
import { logger } from '../../utils/logger.js';

export interface DistillInput {
  projectId: string;
  branch: string;
  commitSha: string;
  force?: boolean;
}

export interface DistillOutput {
  distillId: number | null;
  consumedObservationIds: number[];
  newDecisionIds: number[];
  newTodoIds: number[];
}

export interface DistillManagerOptions {
  debounceSeconds?: number;
  debounceMinObservations?: number;
  isReachableFromMain?: (commitSha: string) => Promise<boolean>;
}

export class DistillManager {
  constructor(
    private db: Database,
    private providerRegistry: ProviderRegistry,
    private opts: DistillManagerOptions = {},
  ) {}

  async processBranch(input: DistillInput): Promise<DistillOutput> {
    // 1. Find or create feature
    const feature = await this.findOrCreateFeature(input.projectId, input.branch);

    // 2. Find prior current distill (if any)
    const priorDistill = await this.currentDistillFor(feature.id);

    // 3. Find candidate observations
    const candidates = input.force
      ? await this.allObservationsForBranch(input.projectId, input.branch)
      : await this.unclaimedObservationsSince(input.projectId, input.branch, priorDistill?.created_at);

    // 4. Empty case: no-op
    if (candidates.length === 0 && !input.force) {
      return { distillId: null, consumedObservationIds: [], newDecisionIds: [], newTodoIds: [] };
    }

    // 4b. Debounce: skip if too few observations and prior distill is recent
    if (!input.force && priorDistill && candidates.length < (this.opts.debounceMinObservations ?? 3)) {
      const ageSeconds = (Date.now() - new Date(priorDistill.created_at).getTime()) / 1000;
      if (ageSeconds < (this.opts.debounceSeconds ?? 60)) {
        return { distillId: null, consumedObservationIds: [], newDecisionIds: [], newTodoIds: [] };
      }
    }

    // 5. Call provider to distill observations
    const { xml, providerName } = await this.distillObservationsWithProvider(candidates);
    const parsed = this.parseDistillOutput(xml);

    // 5b. Check if commit is on main before the transaction
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(input.projectId) as any;
    const isMerged = project && await this.isCommitOnMain(project.root_path, input.commitSha);

    // 6. Write in a transaction
    let distillId: number | null = null;
    const newDecisionIds: number[] = [];
    const newTodoIds: number[] = [];

    this.db.exec('BEGIN');
    try {
      const insertResult = this.db.prepare(
        `INSERT INTO distilled_reflections
          (feature_id, commit_sha_at_distill, consumed_observation_ids, body_md, llm_model_used)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(feature.id, input.commitSha, JSON.stringify(candidates.map((c: any) => c.id)), parsed.body, providerName);

      distillId = (insertResult.lastInsertRowid as number) || null;

      if (distillId) {
        this.db.prepare(
          'UPDATE distilled_reflections SET superseded_by = ? WHERE feature_id = ? AND id != ? AND superseded_by IS NULL',
        ).run(distillId, feature.id, distillId);
      }

      // Claim observations (and backfill branch_name if it was null)
      for (const obs of candidates) {
        this.db.prepare(
          'UPDATE observations SET feature_id = ?, branch_name = COALESCE(branch_name, ?) WHERE id = ?',
        ).run(feature.id, input.branch, obs.id);
      }

      // Insert decisions
      for (const d of parsed.decisions) {
        const r = this.db.prepare(
          `INSERT INTO decisions
            (feature_id, distilled_reflection_id, topic, choice, alternatives_rejected, reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(feature.id, distillId, d.topic, d.choice, JSON.stringify(d.alternatives_rejected ?? []), d.reason ?? null);
        const decisionId = (r.lastInsertRowid as number) || 0;
        newDecisionIds.push(decisionId);

        this.linkDecisionToSymbols(input.projectId, feature.id, decisionId, d);
      }

      // Insert todos
      for (const t of parsed.todos) {
        const r = this.db.prepare(
          `INSERT INTO todos (feature_id, source_distilled_reflection_id, body)
           VALUES (?, ?, ?)`,
        ).run(feature.id, distillId, t);
        newTodoIds.push((r.lastInsertRowid as number) || 0);
      }

      // Update feature title if still placeholder
      if (feature.title === feature.branch_name && parsed.suggestedTitle) {
        this.db.prepare(
          'UPDATE features SET title = ? WHERE id = ?',
        ).run(parsed.suggestedTitle, feature.id);
      }

      // Mark feature as merged if commit is on main
      if (isMerged) {
        this.db.prepare(
          "UPDATE features SET status = 'merged', merged_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'merged'",
        ).run(feature.id);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return {
      distillId,
      consumedObservationIds: candidates.map((c: any) => c.id),
      newDecisionIds,
      newTodoIds,
    };
  }

  private async isCommitOnMain(projectPath: string, commitSha: string): Promise<boolean> {
    if (this.opts.isReachableFromMain) {
      return await this.opts.isReachableFromMain(commitSha);
    }
    try {
      const { execSync } = await import('child_process');
      const out = execSync(`git -C "${projectPath}" branch --contains ${commitSha}`, { encoding: 'utf8' });
      return /(^|\n)\*?\s*main$/.test(out);
    } catch {
      return false;
    }
  }

  private parseDistillOutput(xml: string) {
    let body = (xml.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').trim();
    if (!body && !xml.includes('<distill')) {
      body = xml.replace(/<[^>]+>/g, '').trim();
    }
    const suggestedTitle = (xml.match(/<suggested-title>([\s\S]*?)<\/suggested-title>/)?.[1] ?? '').trim() || undefined;

    const decisions: any[] = [];
    const decisionMatches = xml.matchAll(/<decision\s+topic="([^"]*)"\s+choice="([^"]*)"(?:\s+reason="([^"]*)")?\s*\/?>/g);
    for (const m of decisionMatches) {
      decisions.push({ topic: m[1], choice: m[2], reason: m[3] });
    }

    const todos: string[] = [];
    const todoMatches = xml.matchAll(/<todo>([\s\S]*?)<\/todo>/g);
    for (const m of todoMatches) {
      todos.push(m[1].trim());
    }

    return { body, decisions, todos, suggestedTitle };
  }

  private async findOrCreateFeature(projectId: string, branch: string): Promise<any> {
    let row = this.db.prepare('SELECT * FROM features WHERE project_id = ? AND branch_name = ?').get(projectId, branch) as any;
    if (!row) {
      const result = this.db.prepare(
        'INSERT INTO features (project_id, branch_name, title) VALUES (?, ?, ?)',
      ).run(projectId, branch, branch);
      row = this.db.prepare('SELECT * FROM features WHERE id = ?').get(result.lastInsertRowid) as any;
    }
    return row;
  }

  private async currentDistillFor(featureId: number): Promise<any> {
    return this.db.prepare(
      'SELECT * FROM distilled_reflections WHERE feature_id = ? AND superseded_by IS NULL',
    ).get(featureId) as any;
  }

  private async unclaimedObservationsSince(projectId: string, branch: string, since?: string): Promise<any[]> {
    const project = this.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return [];

    if (since) {
      const rows = this.db.prepare(
        `SELECT * FROM observations
          WHERE project = ? AND branch_name = ? AND feature_id IS NULL AND created_at > ?
          ORDER BY created_at`,
      ).all(project.name, branch, since) as any[];
      if (rows.length > 0) return rows;
      const fallbackRows = this.db.prepare(
        `SELECT * FROM observations
          WHERE project = ? AND branch_name IS NULL AND feature_id IS NULL AND created_at > ?
          ORDER BY created_at DESC LIMIT 20`,
      ).all(project.name, since) as any[];
      return fallbackRows.reverse();
    }
    const rows = this.db.prepare(
      `SELECT * FROM observations
        WHERE project = ? AND branch_name = ? AND feature_id IS NULL
        ORDER BY created_at`,
    ).all(project.name, branch) as any[];
    if (rows.length > 0) return rows;
    const fallbackRows = this.db.prepare(
      `SELECT * FROM observations
        WHERE project = ? AND branch_name IS NULL AND feature_id IS NULL
        ORDER BY created_at DESC LIMIT 20`,
    ).all(project.name) as any[];
    return fallbackRows.reverse();
  }

  private async allObservationsForBranch(projectId: string, branch: string): Promise<any[]> {
    const project = this.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return [];
    const rows = this.db.prepare(
      'SELECT * FROM observations WHERE project = ? AND branch_name = ? ORDER BY created_at',
    ).all(project.name, branch) as any[];
    if (rows.length > 0) return rows;
    const fallbackRows = this.db.prepare(
      'SELECT * FROM observations WHERE project = ? AND branch_name IS NULL ORDER BY created_at DESC LIMIT 20',
    ).all(project.name) as any[];
    return fallbackRows.reverse();
  }

  private async distillObservationsWithProvider(observations: any[]): Promise<{ xml: string; providerName: string }> {
    const prompt = this.buildDistillPrompt(observations);
    let usedProviderName = 'unknown';
    if (typeof this.providerRegistry.executeWithFallback === 'function') {
      const xml = await this.providerRegistry.executeWithFallback('distill', async p => {
        usedProviderName = p.name || (p as any).constructor?.name || 'unknown';
        return await p.extract({ prompt });
      });
      return { xml, providerName: usedProviderName };
    }
    const provider = await this.providerRegistry.getForTask('distill');
    usedProviderName = provider.name || (provider as any).constructor?.name || 'unknown';
    const xml = await provider.extract({ prompt });
    return { xml, providerName: usedProviderName };
  }

  private async distillObservations(observations: any[]): Promise<string> {
    return (await this.distillObservationsWithProvider(observations)).xml;
  }

  private async extractDecisions(body: string): Promise<any[]> {
    if (typeof this.providerRegistry.executeWithFallback === 'function') {
      return await this.providerRegistry.executeWithFallback('decision-extraction', p => p.extractStructured({
        prompt: `Extract architectural decisions from: ${body}`,
        schema: { decisions: { type: 'array' } },
      }));
    }
    const provider = await this.providerRegistry.getForTask('decision-extraction');
    return await (provider as any).extractStructured({
      prompt: `Extract architectural decisions from: ${body}`,
      schema: { decisions: { type: 'array' } },
    });
  }

  private async extractTodos(body: string): Promise<string[]> {
    if (typeof this.providerRegistry.executeWithFallback === 'function') {
      const response = await this.providerRegistry.executeWithFallback('todo-extraction', p => p.extract({
        prompt: `Extract actionable items from: ${body}`,
      }));
      return response.split('\n').filter(line => line.trim());
    }
    const provider = await this.providerRegistry.getForTask('todo-extraction');
    const response = await provider.extract({
      prompt: `Extract actionable items from: ${body}`,
    });
    return response.split('\n').filter(line => line.trim());
  }

  private buildDistillPrompt(observations: any[]): string {
    const items = observations.map(o => {
      const content = o.narrative || o.subtitle || o.text || '(no content)';
      return `- ${o.type}: ${o.title}\n  ${content}`;
    }).join('\n\n');

    return `Distill the following coding observations into a concise architectural reflection in XML format:
<distill>
  <suggested-title>Short feature title</suggested-title>
  <body>Concise markdown summary of what was built, fixed, and learned.</body>
  <decisions>
    <decision topic="area" choice="selected approach" reason="why this was chosen"/>
  </decisions>
  <todos>
    <todo>Remaining actionable follow-up item</todo>
  </todos>
</distill>

Observations:
${items}`;
  }

  private linkDecisionToSymbols(projectId: string, featureId: number, decisionId: number, d: any): void {
    if (!decisionId) return;
    try {
      const textToScan = `${d.topic || ''} ${d.choice || ''} ${d.reason || ''}`;
      const backticked = Array.from(textToScan.matchAll(/`([a-zA-Z0-9_$.:-]+)`/g), m => m[1]);
      const identifiers = Array.from(textToScan.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g), m => m[0]);

      const STOPWORDS = new Set([
        'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'true', 'false',
        'null', 'undefined', 'const', 'function', 'class', 'import', 'export', 'return',
        'async', 'await', 'using', 'service', 'manager', 'handler', 'table', 'query',
        'update', 'create', 'delete', 'select', 'where', 'each', 'file', 'code',
      ]);

      const candidateNames = Array.from(new Set([...backticked, ...identifiers]))
        .filter(name => name.length >= 3 && !STOPWORDS.has(name.toLowerCase()))
        .slice(0, 10);

      if (candidateNames.length === 0) return;

      const placeholders = candidateNames.map(() => '?').join(', ');
      const candidates = this.db.prepare(`
        SELECT id, symbol_name FROM code_symbols
        WHERE project_id = ? AND symbol_name IN (${placeholders})
        LIMIT 5
      `).all(projectId, ...candidateNames) as Array<{ id: number; symbol_name: string }>;

      const insertLink = this.db.prepare(`
        INSERT OR IGNORE INTO symbol_decision_links (symbol_id, decision_id, feature_id, relation_type)
        VALUES (?, ?, ?, 'modified')
      `);

      for (const cand of candidates) {
        insertLink.run(cand.id, decisionId, featureId);
      }
    } catch {
      // Ignore if code graph tables are not queried
    }
  }
}
