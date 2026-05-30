import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderRegistry } from '../../src/shared/ProviderRegistry.js';
import type { LlmProvider } from '../../src/shared/LlmProvider.js';
import type { SettingsDefaults } from '../../src/shared/SettingsDefaultsManager.js';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let mockGemini: LlmProvider;
  let mockOllama: LlmProvider;
  let defaultSettings: SettingsDefaults;

  beforeEach(() => {
    mockGemini = {
      name: 'gemini-cli',
      model: 'gemini-2.5-flash-lite',
      isAvailable: async () => true,
      extract: async (input) => '<distill/>',
      extractStructured: async (input) => ({}),
      getSpeed: () => 'fast',
    };

    mockOllama = {
      name: 'ollama',
      model: 'llama2',
      isAvailable: async () => true,
      extract: async (input) => 'response',
      extractStructured: async (input) => ({}),
      getSpeed: () => 'slow',
    };

    defaultSettings = {
      CLAUDE_MEM_TASKS: '{}',
      CLAUDE_MEM_PREFER_COST_OPTIMIZATION: 'false',
    } as unknown as SettingsDefaults;

    registry = new ProviderRegistry(defaultSettings);
    registry.registerProvider(mockGemini);
    registry.registerProvider(mockOllama);
  });

  it('returns preferred provider when available', async () => {
    const provider = await registry.getForTask('distill');
    expect(provider.name).toBe('gemini-cli');
  });

  it('falls back to next chain provider when preferred unavailable', async () => {
    const unavailableGemini: LlmProvider = {
      ...mockGemini,
      isAvailable: async () => false,
    };

    const newRegistry = new ProviderRegistry(defaultSettings);
    newRegistry.registerProvider(unavailableGemini);
    newRegistry.registerProvider(mockOllama);

    const provider = await newRegistry.getForTask('distill');
    expect(provider.name).toBe('ollama');
  });

  it('respects user task overrides', async () => {
    const overrideSettings = {
      ...defaultSettings,
      CLAUDE_MEM_TASKS: '{"distill":"ollama"}',
    } as unknown as SettingsDefaults;

    const overrideRegistry = new ProviderRegistry(overrideSettings);
    overrideRegistry.registerProvider(mockGemini);
    overrideRegistry.registerProvider(mockOllama);

    const provider = await overrideRegistry.getForTask('distill');
    expect(provider.name).toBe('ollama');
  });

  it('returns lowest-cost provider when cost optimization enabled', async () => {
    const costSettings = {
      ...defaultSettings,
      CLAUDE_MEM_PREFER_COST_OPTIMIZATION: 'true',
    } as unknown as SettingsDefaults;

    const costRegistry = new ProviderRegistry(costSettings);
    costRegistry.registerProvider(mockGemini);
    costRegistry.registerProvider(mockOllama);

    const provider = await costRegistry.getForTask('semantic-search');
    // semantic-search prefers ollama, so with cost optimization, should still get ollama
    expect(provider.name).toBe('ollama');
  });

  it('throws when no provider is available for task', async () => {
    const emptyRegistry = new ProviderRegistry(defaultSettings);

    try {
      await emptyRegistry.getForTask('distill');
      expect(false).toBe(true); // should not reach
    } catch (e: any) {
      expect(e.message).toContain('No available provider');
    }
  });
});
