import type { LlmProvider } from '../../shared/LlmProvider.js';

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
    } catch {
      return false;
    }
  }

  async extract(input: { prompt: string }): Promise<string> {
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
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
    } catch {
      return { raw: text };
    }
  }

  getSpeed(): 'slow' {
    return 'slow';
  }
}
