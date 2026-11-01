import { describe, it, expect, mock } from 'bun:test';
import { OllamaProvider } from '../../../src/services/worker/OllamaProvider.js';

describe('OllamaProvider', () => {
  it('uses configured model when provided', async () => {
    const provider = new OllamaProvider({ endpoint: 'http://localhost:11434', model: 'llama3.2:latest' });
    const model = await provider.resolveModel();
    expect(model).toBe('llama3.2:latest');
  });

  it('auto-discovers model from /api/tags when model is empty', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async (url: any) => {
        return {
          ok: true,
          json: async () => ({
            models: [
              { name: 'qwen2.5:7b', size: 4500000000 },
            ],
          }),
        } as unknown as globalThis.Response;
      });

      const provider = new OllamaProvider({ endpoint: 'http://localhost:11434', model: '' });
      const model = await provider.resolveModel();
      expect(model).toBe('qwen2.5:7b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('checks availability via /api/tags', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async (url: any) => {
        return { ok: true } as unknown as globalThis.Response;
      });

      const provider = new OllamaProvider({ endpoint: 'http://localhost:11434', model: 'gemma4:latest' });
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles offline endpoint gracefully on isAvailable', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async () => {
        throw new Error('Connection refused');
      });

      const provider = new OllamaProvider({ endpoint: 'http://localhost:11434', model: 'gemma4:latest' });
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
