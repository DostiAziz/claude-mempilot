export interface LlmProvider {
  name: string;
  model: string;

  // Check if provider is available (can make requests)
  isAvailable(): Promise<boolean>;

  // Extract text response
  extract(input: {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;

  // Extract structured response (JSON schema)
  extractStructured(input: {
    prompt: string;
    schema: any;
    maxTokens?: number;
  }): Promise<any>;

  // Optional: streaming response
  extractStream?(input: {
    prompt: string;
    onChunk: (chunk: string) => void;
  }): Promise<string>;

  // Optional: cost information
  getCost?(): { inputTokenPrice: number; outputTokenPrice: number };

  // Optional: speed tier
  getSpeed?(): 'fast' | 'medium' | 'slow';
}
