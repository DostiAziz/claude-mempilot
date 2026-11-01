import type { LlmProvider } from '../../shared/LlmProvider.js';
import { logger } from '../../utils/logger.js';

export interface OllamaProviderOptions {
  endpoint: string;   // e.g., 'http://localhost:11434'
  model: string;      // e.g., 'llama2'
}

export class OllamaProvider implements LlmProvider {
  name = 'ollama';
  model: string;
  private endpoint: string;

  constructor(opts: OllamaProviderOptions) {
    this.endpoint = opts.endpoint;
    this.model = opts.model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (err: any) {
      logger.debug('WORKER', 'Ollama provider availability check failed', { endpoint: this.endpoint, error: err.message });
      return false;
    }
  }

  async resolveModel(): Promise<string> {
    if (this.model && this.model.trim()) {
      return this.model.trim();
    }
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const json = (await response.json()) as any;
        if (Array.isArray(json?.models) && json.models.length > 0) {
          this.model = json.models[0].name;
          return this.model;
        }
      }
    } catch {
      // Fallback if discovery fails
    }
    return this.model || 'gemma4:latest';
  }

  async extract(input: { prompt: string }): Promise<string> {
    const targetModel = await this.resolveModel();
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: targetModel,
        prompt: input.prompt,
        stream: false,
      }),
    });
    const json = (await response.json()) as any;
    return json.response || '';
  }

  async extractStructured(input: {
    prompt: string;
    schema: any;
  }): Promise<any> {
    // For v1, reuse extract and parse as JSON
    const text = await this.extract({ prompt: input.prompt });
    try {
      return JSON.parse(text);
    } catch (err: any) {
      logger.debug('WORKER', 'Ollama failed to parse structured response as JSON', { error: err.message });
      return { raw: text };
    }
  }

  getSpeed(): 'slow' {
    return 'slow';
  }
}
