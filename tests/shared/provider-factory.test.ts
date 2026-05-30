import { describe, it, expect, beforeEach } from 'bun:test';
import { GeminiCliProvider } from '../../src/services/worker/GeminiCliProvider.js';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';

describe('Provider Factory', () => {
  it('creates GeminiCliProvider when configured', () => {
    const settings = SettingsDefaultsManager.getAllDefaults();

    const provider = new GeminiCliProvider({
      binary: settings.CLAUDE_MEM_GEMINI_CLI_BINARY,
      model: settings.CLAUDE_MEM_GEMINI_CLI_MODEL,
    });

    expect(provider.name).toBe('gemini-cli');
    expect(provider.model).toBe(settings.CLAUDE_MEM_GEMINI_CLI_MODEL);
  });

  it('GeminiCliProvider defaults to gemini-2.5-flash-lite model', () => {
    const provider = new GeminiCliProvider();
    expect(provider.model).toBe('gemini-2.5-flash-lite');
  });

  it('GeminiCliProvider name is gemini-cli', () => {
    const provider = new GeminiCliProvider();
    expect(provider.name).toBe('gemini-cli');
  });

  it('GeminiCliProvider getSpeed returns fast', () => {
    const provider = new GeminiCliProvider();
    expect(provider.getSpeed?.()).toBe('fast');
  });
});
