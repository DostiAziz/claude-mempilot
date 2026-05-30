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
    throw new Error('not yet implemented');
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
