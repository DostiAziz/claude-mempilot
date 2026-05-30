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

export class DistillManager {
  constructor(
    private db: Database,
    private providerRegistry: ProviderRegistry,
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

    throw new Error('not yet implemented: non-empty case');
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
    return observations.map(o => `- ${o.title}: ${o.body}`).join('\n');
  }
}
