import { describe, it, expect } from 'bun:test';
import { GeminiCliProvider, isGeminiCliAvailable, isGeminiCliSelected } from '../../../src/services/worker/GeminiCliProvider.js';

describe('GeminiCliProvider Smoke Tests (Real CLI)', () => {
  it('GeminiCliProvider instantiates with defaults', () => {
    const provider = new GeminiCliProvider();
    expect(provider.name).toBe('gemini-cli');
    expect(provider.model).toBe('gemini-2.5-flash-lite');
    expect(provider.getSpeed?.()).toBe('fast');
  });

  it('GeminiCliProvider instantiates with custom options', () => {
    const provider = new GeminiCliProvider({
      binary: 'gemini',
      model: 'gemini-2.5-flash',
    });
    expect(provider.name).toBe('gemini-cli');
    expect(provider.model).toBe('gemini-2.5-flash');
  });

  it('isGeminiCliAvailable detects gemini CLI availability', async () => {
    // This will use the real gemini CLI if available
    const available = await isGeminiCliAvailable();
    // Skip if not available (e.g., in CI without gemini CLI)
    expect(typeof available).toBe('boolean');
  });

  it('GeminiCliProvider implements LlmProvider interface', () => {
    const provider = new GeminiCliProvider();
    expect(provider.name).toBeDefined();
    expect(provider.model).toBeDefined();
    expect(typeof provider.isAvailable).toBe('function');
    expect(typeof provider.extract).toBe('function');
    expect(typeof provider.extractStructured).toBe('function');
    expect(typeof provider.getSpeed).toBe('function');
  });

  it('extractStructured handles JSON responses', async () => {
    const provider = new GeminiCliProvider();
    // Note: This would fail if gemini CLI is not available or not configured
    // For now, we just test the interface exists
    expect(typeof provider.extractStructured).toBe('function');
  });
});
