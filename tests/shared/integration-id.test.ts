import { describe, expect, it } from 'bun:test';
import { canonicalIntegrationId } from '../../src/shared/integration-id.js';
import { getPlatformAdapter } from '../../src/cli/adapters/index.js';
import { claudeCodeAdapter } from '../../src/cli/adapters/claude-code.js';
import { detectInstalledIDEs } from '../../src/npx-cli/commands/ide-detection.js';

describe("'claude' is an alias for Claude Code (#2835)", () => {
  it('canonicalizes claude and common CLI aliases', () => {
    expect(canonicalIntegrationId('claude')).toBe('claude-code');
    expect(canonicalIntegrationId('claudecode-cli')).toBe('claude-code');
    expect(canonicalIntegrationId('claudecode')).toBe('claude-code');
    expect(canonicalIntegrationId('claude-cli')).toBe('claude-code');
    expect(canonicalIntegrationId('claude-code')).toBe('claude-code');
    expect(canonicalIntegrationId('cursor-cli')).toBe('cursor');
    expect(canonicalIntegrationId('cursor')).toBe('cursor');
    expect(canonicalIntegrationId('codex')).toBe('codex-cli');
    expect(canonicalIntegrationId('codex-cli')).toBe('codex-cli');
    expect(canonicalIntegrationId('copilot')).toBe('copilot-cli');
    expect(canonicalIntegrationId('copilot-cli')).toBe('copilot-cli');
    expect(canonicalIntegrationId('agy')).toBe('antigravity');
    expect(canonicalIntegrationId('antigravity-cli')).toBe('antigravity');
  });

  it('names an IDE the installer knows, so --ide claude is not an unknown IDE', () => {
    const ids = detectInstalledIDEs().map((ide) => ide.id);
    expect(ids).not.toContain('claude');
    expect(ids).toContain(canonicalIntegrationId('claude'));
  });

  it('uses the Claude Code adapter for hook claude', () => {
    expect(getPlatformAdapter('claude')).toBe(claudeCodeAdapter);
  });
});
