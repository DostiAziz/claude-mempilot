import type { Database } from 'bun:sqlite';
import type { ProviderRegistry } from '../../shared/ProviderRegistry.js';
import { logger } from '../../utils/logger.js';

export interface DistillInput {
  projectId: number;
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
    const prompt = this.buildDistillPrompt(candidates);
    const xml = await this.distillObservations(candidates);
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
      ).run(feature.id, input.commitSha, JSON.stringify(candidates.map((c: any) => c.id)), parsed.body, 'gemini-cli');

      distillId = (insertResult.lastInsertRowid as number) || null;

      if (priorDistill && distillId) {
        this.db.prepare(
          'UPDATE distilled_reflections SET superseded_by = ? WHERE id = ?',
        ).run(distillId, priorDistill.id);
      }

      // Claim observations
      for (const obs of candidates) {
        this.db.prepare(
          'UPDATE observations SET feature_id = ? WHERE id = ?',
        ).run(feature.id, obs.id);
      }

      // Insert decisions
      for (const d of parsed.decisions) {
        const r = this.db.prepare(
          `INSERT INTO decisions
            (feature_id, distilled_reflection_id, topic, choice, alternatives_rejected, reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(feature.id, distillId, d.topic, d.choice, JSON.stringify(d.alternatives_rejected ?? []), d.reason ?? null);
        newDecisionIds.push((r.lastInsertRowid as number) || 0);
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
    const body = (xml.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').trim();
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

  private async findOrCreateFeature(projectId: number, branch: string): Promise<any> {
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

  private async unclaimedObservationsSince(projectId: number, branch: string, since?: string): Promise<any[]> {
    if (since) {
      return this.db.prepare(
        `SELECT * FROM observations
          WHERE project = ? AND branch_name = ? AND feature_id IS NULL AND created_at > ?
          ORDER BY created_at`,
      ).all(String(projectId), branch, since) as any[];
    }
    return this.db.prepare(
      `SELECT * FROM observations
        WHERE project = ? AND branch_name = ? AND feature_id IS NULL
        ORDER BY created_at`,
    ).all(String(projectId), branch) as any[];
  }

  private async allObservationsForBranch(projectId: number, branch: string): Promise<any[]> {
    return this.db.prepare(
      'SELECT * FROM observations WHERE project = ? AND branch_name = ? ORDER BY created_at',
    ).all(String(projectId), branch) as any[];
  }

  private async distillObservations(observations: any[]): Promise<string> {
    const provider = await this.providerRegistry.getForTask('distill');
    const prompt = this.buildDistillPrompt(observations);
    return await provider.extract({ prompt });
  }

  private async extractDecisions(body: string): Promise<any[]> {
    const provider = await this.providerRegistry.getForTask('decision-extraction');
    return await provider.extractStructured({
      prompt: `Extract architectural decisions from: ${body}`,
      schema: { decisions: { type: 'array' } },
    });
  }

  private async extractTodos(body: string): Promise<string[]> {
    const provider = await this.providerRegistry.getForTask('todo-extraction');
    const response = await provider.extract({
      prompt: `Extract actionable items from: ${body}`,
    });
    return response.split('\n').filter(line => line.trim());
  }

  private buildDistillPrompt(observations: any[]): string {
    return observations.map(o => `- ${o.title}: ${o.text}`).join('\n');
  }
}
