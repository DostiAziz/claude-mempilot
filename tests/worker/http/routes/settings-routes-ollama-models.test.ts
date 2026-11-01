import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { Request, Response } from 'express';
import { SettingsRoutes } from '../../../../src/services/worker/http/routes/SettingsRoutes.js';

function createMockRes(): {
  res: Partial<Response>;
  jsonSpy: ReturnType<typeof mock>;
} {
  const jsonSpy = mock(() => {});
  return {
    res: { json: jsonSpy, headersSent: false } as unknown as Partial<Response>,
    jsonSpy,
  };
}

function captureOllamaGetHandler(routes: SettingsRoutes): (req: Request, res: Response) => Promise<void> {
  let handler!: (req: Request, res: Response) => Promise<void>;
  const mockApp: any = {
    get: mock((path: string, ...handlers: Array<(req: Request, res: Response) => Promise<void>>) => {
      if (path === '/api/settings/ollama/models') {
        handler = handlers[handlers.length - 1];
      }
    }),
    post: mock(() => {}),
  };
  routes.setupRoutes(mockApp);
  return handler;
}

describe('SettingsRoutes — Ollama models discovery endpoint', () => {
  it('registers /api/settings/ollama/models and /api/ollama/models', () => {
    const registeredPaths: string[] = [];
    const mockApp: any = {
      get: mock((path: string) => {
        registeredPaths.push(path);
      }),
      post: mock(() => {}),
    };
    const routes = new SettingsRoutes({} as any);
    routes.setupRoutes(mockApp);

    expect(registeredPaths).toContain('/api/settings/ollama/models');
    expect(registeredPaths).toContain('/api/ollama/models');
  });

  it('handles unreachable endpoint gracefully without throwing 500', async () => {
    const routes = new SettingsRoutes({} as any);
    const handler = captureOllamaGetHandler(routes);
    const mockRes = createMockRes();

    await handler(
      { query: { endpoint: 'http://127.0.0.1:59999' } } as unknown as Request,
      mockRes.res as Response,
    );

    expect(mockRes.jsonSpy).toHaveBeenCalled();
    const result = mockRes.jsonSpy.mock.calls[0][0];
    expect(result.available).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('Could not connect to Ollama');
  });

  it('parses Ollama tags response into formatted models list', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async (url: any) => {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                name: 'gemma4:latest',
                size: 9461576343,
                details: { family: 'gemma4', parameter_size: '9B', quantization_level: 'Q4_0' },
              },
              {
                name: 'llama3.2:3b',
                size: 2019393189,
                details: { family: 'llama', parameter_size: '3B' },
              },
            ],
          }),
        } as unknown as globalThis.Response;
      });

      const routes = new SettingsRoutes({} as any);
      const handler = captureOllamaGetHandler(routes);
      const mockRes = createMockRes();

      await handler(
        { query: { endpoint: 'http://localhost:11434' } } as unknown as Request,
        mockRes.res as Response,
      );

      expect(mockRes.jsonSpy).toHaveBeenCalled();
      const result = mockRes.jsonSpy.mock.calls[0][0];
      expect(result.available).toBe(true);
      expect(result.models.length).toBe(2);
      expect(result.models[0].name).toBe('gemma4:latest');
      expect(result.models[0].sizeFormatted).toBe('8.8 GB');
      expect(result.models[0].parameterSize).toBe('9B');
      expect(result.models[1].name).toBe('llama3.2:3b');
      expect(result.models[1].sizeFormatted).toBe('1.9 GB');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
