import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { antigravityCliAdapter } from '../src/cli/adapters/antigravity-cli.js';
import { extractLastMessage } from '../src/shared/transcript-parser.js';
import {
  buildAntigravityHooksConfig,
  describeAntigravityHooks,
  mergeHooksIntoConfig,
  removeClaudeMemHooks,
  toSpaceFreePath,
} from '../src/services/integrations/AntigravityCliHooksInstaller.js';

const INSTALLER_PATH = 'src/services/integrations/AntigravityCliHooksInstaller.ts';

// These assertions lock in the REAL agy 1.2.1 hook contract (issue #4057).
// The prior version of this file asserted the legacy Gemini-CLI event map
// (BeforeTool/AfterTool/BeforeAgent/SessionStart) written into settings.json —
// none of which agy actually fires — so it "passed" while recording zero
// observations. Do not reintroduce those names.
describe('AntigravityCliHooksInstaller - agy event map', () => {
  // A Windows-style bun path: agy splits the command on spaces and keeps quotes,
  // so the paths must come out bare and forward-slashed.
  const config = buildAntigravityHooksConfig(String.raw`C:\bun\bun.exe`, '/plugin/worker-service.cjs') as Record<string, any>;
  const claudeMem = config['claude-mem'];
  const commandFor = (event: string): string => {
    const [entry] = claudeMem[event];
    return (entry.hooks ? entry.hooks[0] : entry).command;
  };

  it.each([
    // SessionStart is the injectSteps startup context-injection point (issue #4911).
    ['SessionStart', 'context'],
    ['PreInvocation', 'session-init'],
    ['PostToolUse', 'observation'],
    ['PostInvocation', 'observation'],
    ['Stop', 'summarize'],
  ])('maps %s to %s through the antigravity-cli hook command', (event, internalEvent) => {
    expect(commandFor(event)).toBe(`C:/bun/bun.exe /plugin/worker-service.cjs hook antigravity-cli ${internalEvent}`);
  });

  it('registers only the agy event names, none of the legacy Gemini-CLI ones', () => {
    expect(Object.keys(claudeMem).sort()).toEqual(['PostInvocation', 'PostToolUse', 'PreInvocation', 'SessionStart', 'Stop']);
  });

  // agy reads a PreToolUse "allow" as auto-approval, so registering it skipped
  // the permission prompt for every tool and recorded each call twice (#5078).
  it('does not register PreToolUse', () => {
    expect(claudeMem.PreToolUse).toBeUndefined();
  });
});

// The files agy reads. Install writes under the real home directory, so these
// external paths are pinned in the source rather than exercised.
describe('AntigravityCliHooksInstaller - hooks.json target (not settings.json)', () => {
  const src = readFileSync(INSTALLER_PATH, 'utf-8');

  it('writes hooks to ~/.gemini/config/hooks.json (the file agy loads)', () => {
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'config', 'hooks.json')");
    expect(src).toContain('writeAntigravityHooksConfig');
  });

  it('still targets the shared ~/.gemini GEMINI.md context file', () => {
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'GEMINI.md')");
  });

  it('dual-writes MCP config to both B0-confirmed candidate paths', () => {
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'antigravity', 'mcp_config.json')");
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'config', 'mcp_config.json')");
  });

  it('writes the rules/context placeholder to the plural, home-relative .agents/rules path', () => {
    expect(src).toContain("path.join(homedir(), '.agents', 'rules', 'claude-mem-context.md')");
  });
});

// Issue #4196: the pre-fix installer wrote top-level EVENT keys, wrapped every
// event in a {matcher, hooks} group, tagged each handler with name:'claude-mem',
// and used timeout:10000. agy's builtin `agy-customizations/docs/hooks.md`
// (verified against 1.2.13) requires top-level HOOK names, grouped shape only
// for PreToolUse/PostToolUse, flat handler arrays for the rest, and timeout in
// seconds. These tests assert the real JSON shape (not source strings).
describe('AntigravityCliHooksInstaller - agy hooks.json schema (issue #4196)', () => {
  const BUN = '/usr/local/bin/bun';
  const WORKER = '/home/u/.claude/plugins/marketplaces/thedotmack/plugin/scripts/worker-service.cjs';
  const config = buildAntigravityHooksConfig(BUN, WORKER) as Record<string, any>;
  const claudeMem = config['claude-mem'];

  it('nests every event under the "claude-mem" hook name (not event names)', () => {
    expect(Object.keys(config)).toEqual(['claude-mem']);
    for (const event of ['SessionStart', 'PreInvocation', 'PostToolUse', 'PostInvocation', 'Stop']) {
      expect(Array.isArray(claudeMem[event])).toBe(true);
    }
  });

  it('uses the grouped (matcher + hooks) shape for PostToolUse', () => {
    for (const event of ['PostToolUse']) {
      const groups = claudeMem[event];
      expect(groups).toHaveLength(1);
      expect(groups[0].matcher).toBe('*');
      expect(Array.isArray(groups[0].hooks)).toBe(true);
      expect(groups[0].hooks[0].command).toContain('hook antigravity-cli');
    }
  });

  it('uses flat handler arrays for SessionStart/PreInvocation/PostInvocation/Stop', () => {
    for (const event of ['SessionStart', 'PreInvocation', 'PostInvocation', 'Stop']) {
      const handlers = claudeMem[event];
      expect(handlers).toHaveLength(1);
      expect(handlers[0].command).toContain('hook antigravity-cli');
      expect(handlers[0].matcher).toBeUndefined();
      expect(handlers[0].hooks).toBeUndefined();
    }
  });

  it('writes timeout in seconds (agy default 30), never the old 10000', () => {
    const handlers = [
      claudeMem.SessionStart[0],
      claudeMem.PreInvocation[0],
      claudeMem.PostToolUse[0].hooks[0],
      claudeMem.PostInvocation[0],
      claudeMem.Stop[0],
    ];
    for (const handler of handlers) {
      expect(handler.timeout).toBe(30);
      expect(handler.timeout).not.toBe(10000);
      expect(handler.type).toBe('command');
    }
  });

  it('keeps the hook name on the top-level key, not on individual handlers', () => {
    expect(claudeMem.SessionStart[0].name).toBeUndefined();
    expect(claudeMem.PostToolUse[0].hooks[0].name).toBeUndefined();
  });
});

describe('AntigravityCliHooksInstaller - merge/uninstall migrate and preserve', () => {
  const BUN = '/usr/local/bin/bun';
  const WORKER = '/home/u/.claude/plugins/marketplaces/thedotmack/plugin/scripts/worker-service.cjs';

  it('preserves other named hooks and replaces claude-mem idempotently', () => {
    const existing = {
      'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ command: './lint.sh' }] }] },
      'claude-mem': {
        SessionStart: [{ command: 'stale-command' }],
        PreInvocation: [{ command: 'legacy-pre-inv' }],
        PreToolUse: [{ matcher: '*', hooks: [{ command: 'legacy-pre-tool' }] }],
      },
    } as unknown as Parameters<typeof mergeHooksIntoConfig>[0];

    const merged = mergeHooksIntoConfig(existing, buildAntigravityHooksConfig(BUN, WORKER)) as Record<string, any>;

    expect(merged['lint-checker']).toEqual(existing['lint-checker']);
    expect(merged['claude-mem'].SessionStart).toHaveLength(1);
    expect(merged['claude-mem'].SessionStart[0].command).not.toBe('stale-command');
    expect(merged['claude-mem'].PreInvocation).toHaveLength(1);
    expect(merged['claude-mem'].PreInvocation[0].command).toContain('session-init');
    expect(merged['claude-mem'].PreInvocation[0].command).not.toContain('legacy-pre-inv');
    expect(merged['claude-mem'].PreToolUse).toBeUndefined();

    const twice = mergeHooksIntoConfig(
      merged as unknown as Parameters<typeof mergeHooksIntoConfig>[0],
      buildAntigravityHooksConfig(BUN, WORKER),
    ) as Record<string, any>;
    expect(twice['claude-mem'].SessionStart).toHaveLength(1);
    expect(twice['claude-mem'].PostToolUse).toHaveLength(1);
  });

  it('migrates legacy event-keyed claude-mem entries and keeps others', () => {
    const existing = {
      PreInvocation: [{ matcher: '*', hooks: [{ name: 'claude-mem', type: 'command', command: 'old', timeout: 10000 }] }],
      PreToolUse: [{ matcher: '*', hooks: [{ name: 'claude-mem', type: 'command', command: 'old' }] }],
      'other-tool': { Stop: [{ command: './other.sh' }] },
    } as unknown as Parameters<typeof mergeHooksIntoConfig>[0];

    const merged = mergeHooksIntoConfig(existing, buildAntigravityHooksConfig(BUN, WORKER)) as Record<string, any>;

    expect(merged.PreInvocation).toBeUndefined();
    expect(merged.PreToolUse).toBeUndefined();
    expect(merged['other-tool']).toEqual(existing['other-tool']);
    expect(merged['claude-mem'].SessionStart).toHaveLength(1);
  });

  it('uninstall removes only claude-mem (named + legacy) and keeps other hooks', () => {
    const config = {
      'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ command: './lint.sh' }] }] },
      'claude-mem': {
        SessionStart: [{ command: 'a' }],
        PreToolUse: [{ matcher: '*', hooks: [{ command: 'b' }] }],
      },
      PreToolUse: [{ matcher: '*', hooks: [{ name: 'claude-mem', command: 'c' }, { name: 'other', command: 'd' }] }],
    } as unknown as Parameters<typeof removeClaudeMemHooks>[0];

    const { config: cleaned, removed } = removeClaudeMemHooks(config) as { config: Record<string, any>; removed: number };

    expect(cleaned['claude-mem']).toBeUndefined();
    expect(cleaned['lint-checker']).toEqual((config as Record<string, any>)['lint-checker']);
    expect(cleaned.PreToolUse).toHaveLength(1);
    expect(cleaned.PreToolUse[0].hooks).toHaveLength(1);
    expect(cleaned.PreToolUse[0].hooks[0].name).toBe('other');
    expect(removed).toBe(3);
  });
});

describe('AntigravityCliHooksInstaller - status sees leftover legacy hooks (issue #4196)', () => {
  const BUN = '/usr/local/bin/bun';
  const WORKER = '/home/u/.claude/plugins/marketplaces/thedotmack/plugin/scripts/worker-service.cjs';

  it('counts legacy claude-mem handlers next to a current install, without touching the config', () => {
    const config = {
      ...buildAntigravityHooksConfig(BUN, WORKER),
      PreToolUse: [{ matcher: '*', hooks: [{ name: 'claude-mem', command: 'old' }, { name: 'other', command: 'keep' }] }],
      Stop: [{ matcher: '*', hooks: [{ name: 'claude-mem', command: 'old', timeout: 10000 }] }],
    } as unknown as Parameters<typeof describeAntigravityHooks>[0];

    const { installedEvents, legacyHandlerCount, hasStalePreInvocation } = describeAntigravityHooks(config);

    expect(installedEvents).toEqual(['SessionStart', 'PreInvocation', 'PostToolUse', 'PostInvocation', 'Stop']);
    expect(legacyHandlerCount).toBe(2);
    expect(hasStalePreInvocation).toBe(false);
    expect((config as Record<string, any>).PreToolUse[0].hooks).toHaveLength(2);
    expect((config as Record<string, any>).Stop).toHaveLength(1);
  });

  it('flags stale PreInvocation handler in named claude-mem config (issue #4911, #4912)', () => {
    const config = {
      'claude-mem': {
        PreInvocation: [{ command: 'bun worker-service.cjs hook antigravity-cli context' }],
        PostToolUse: [{ matcher: '*', hooks: [{ command: 'bun worker-service.cjs hook antigravity-cli observation' }] }],
      },
    } as unknown as Parameters<typeof describeAntigravityHooks>[0];

    const { installedEvents, legacyHandlerCount, hasStalePreInvocation } = describeAntigravityHooks(config);

    expect(hasStalePreInvocation).toBe(true);
    // The stale context handler is not the session-init mapping, so it isn't installed.
    expect(installedEvents).toEqual(['PostToolUse']);
    expect(legacyHandlerCount).toBe(0);
  });

  it('treats a PreInvocation routed to session-init as current, not stale (#5078)', () => {
    const config = {
      'claude-mem': {
        PreInvocation: [{ command: 'bun worker-service.cjs hook antigravity-cli session-init' }],
      },
    } as unknown as Parameters<typeof describeAntigravityHooks>[0];

    const { installedEvents, hasStalePreInvocation } = describeAntigravityHooks(config);

    expect(hasStalePreInvocation).toBe(false);
    expect(installedEvents).toEqual(['PreInvocation']);
  });

  it("does not count another tool's top-level event arrays as claude-mem leftovers", () => {
    const config = {
      Stop: [{ matcher: '*', hooks: [{ name: 'other', command: './other.sh' }] }],
    } as unknown as Parameters<typeof describeAntigravityHooks>[0];

    expect(describeAntigravityHooks(config)).toEqual({ installedEvents: [], legacyHandlerCount: 0, hasStalePreInvocation: false });
  });
});

describe('antigravityCliAdapter - normalizeInput (protojson HookArgs)', () => {
  const common = {
    conversationId: 'conv-1',
    workspacePaths: ['/tmp/ws'],
    transcriptPath: '/tmp/ws/transcript.json',
    modelName: 'gemini-3',
    lastUserInput: 'what does this do?',
  };

  it('reads session, cwd, transcript and prompt out of the common block', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common,
      sessionStartHookArgs: {},
    });
    expect(result.sessionId).toBe('conv-1');
    expect(result.cwd).toBe('/tmp/ws');
    expect(result.transcriptPath).toBe('/tmp/ws/transcript.json');
    expect(result.prompt).toBe('what does this do?');
    expect(result.model).toBe('gemini-3');
  });

  it('falls back to executionId when the conversation has no id yet', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common: { workspacePaths: ['/tmp/ws'], executionId: 'exec-9' },
      stopHookArgs: {},
    });
    expect(result.sessionId).toBe('exec-9');
  });

  it('maps preToolHookArgs.toolCall into toolName/toolInput and marks it pre-execution', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common,
      preToolHookArgs: { toolCall: { name: 'run_command', args: { command: 'ls -la' } }, stepIdx: 3 },
    });
    expect(result.toolName).toBe('run_command');
    expect(result.toolInput).toEqual({ command: 'ls -la' });
    expect(result.toolResponse).toEqual({ _preExecution: true });
  });

  it('maps postToolHookArgs result/error into toolResponse', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common,
      postToolHookArgs: { toolCall: { name: 'run_command', args: {} }, result: 'total 0', stepIdx: 3 },
    });
    expect(result.toolName).toBe('run_command');
    expect(result.toolResponse).toEqual({ result: 'total 0' });
  });

  it('records a postInvocation model turn as a synthetic provider tool call', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common,
      postInvocationHookArgs: { invocationNum: 1, modelOutput: 'here you go', modelThinking: 'hmm' },
    });
    expect(result.toolName).toBe('AntigravityProvider');
    expect(result.toolInput).toEqual({ prompt: 'what does this do?' });
    expect(result.toolResponse).toEqual({ response: 'here you go', thinking: 'hmm' });
  });

  it('accepts a flattened payload (common merged with the inner args)', () => {
    const result = antigravityCliAdapter.normalizeInput({
      ...common,
      toolCall: { name: 'read_file', args: { path: 'a.ts' } },
      stepIdx: 0,
    });
    expect(result.sessionId).toBe('conv-1');
    expect(result.cwd).toBe('/tmp/ws');
    expect(result.toolName).toBe('read_file');
    expect(result.toolResponse).toEqual({ _preExecution: true });
  });

  it('accepts proto snake_case field names as well as protojson camelCase', () => {
    const result = antigravityCliAdapter.normalizeInput({
      common: { conversation_id: 'conv-2', workspace_paths: ['/tmp/ws'], last_user_input: 'hi' },
      pre_tool_hook_args: { tool_call: { name: 'grep', args: {} } },
    });
    expect(result.sessionId).toBe('conv-2');
    expect(result.cwd).toBe('/tmp/ws');
    expect(result.prompt).toBe('hi');
    expect(result.toolName).toBe('grep');
  });
});

describe('antigravityCliAdapter - formatOutput (protojson result messages)', () => {
  const FORBIDDEN = ['continue', 'suppressOutput', 'systemMessage', 'hookSpecificOutput'];

  it('never emits Claude Code envelope fields, whatever the handler returned', () => {
    const noisy = {
      continue: true,
      suppressOutput: true,
      systemMessage: 'terminal hint',
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ctx' },
    };
    const hosts = ['SessionStart', 'PreInvocation', 'PreToolUse', 'PostToolUse', 'PostInvocation', 'Stop', undefined];
    for (const host of hosts) {
      for (const event of ['context', 'session-init', 'observation', 'summarize', undefined]) {
        const output = antigravityCliAdapter.formatOutput(noisy, event, host) as Record<string, unknown>;
        for (const field of FORBIDDEN) expect(output).not.toHaveProperty(field);
      }
    }
  });

  it('says allow OUT LOUD on PreToolUse — an empty result is a deny, not a no-op', () => {
    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'observation', 'PreToolUse'))
      .toEqual({ decision: 'allow' });
    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'observation', 'BeforeTool'))
      .toEqual({ decision: 'allow' });
  });

  it('emits the empty envelope on PostToolUse (PostToolHookResult declares no fields)', () => {
    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'observation', 'PostToolUse')).toEqual({});
    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'observation', 'PostInvocation')).toEqual({});
  });

  it('biases an UNKNOWN host event toward allow for observation hooks', () => {
    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'observation', undefined))
      .toEqual({ decision: 'allow' });
    expect(antigravityCliAdapter.formatOutput({ continue: true }, undefined, undefined)).toEqual({});
  });

  it('derives the host event from the internal event for the unambiguous hooks', () => {
    expect(antigravityCliAdapter.formatOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'past work' },
    }, 'context')).toEqual({ injectSteps: [{ systemMessage: { systemMessage: 'past work' } }] });

    expect(antigravityCliAdapter.formatOutput({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'recalled' },
    }, 'session-init')).toEqual({ injectSteps: [{ systemMessage: { systemMessage: 'recalled' } }] });

    expect(antigravityCliAdapter.formatOutput({ continue: true }, 'summarize')).toEqual({});
  });

  it('strips ANSI escape codes from injected context', () => {
    const output = antigravityCliAdapter.formatOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '\u001b[31mRed text\u001b[0m' },
    }, 'context') as { injectSteps: Array<{ systemMessage: { systemMessage: string } }> };
    expect(output.injectSteps[0].systemMessage.systemMessage).toBe('Red text');
  });

  it('emits no inject step when there is no context to inject', () => {
    expect(antigravityCliAdapter.formatOutput({ continue: true, suppressOutput: true }, 'context')).toEqual({});
    expect(antigravityCliAdapter.formatOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '   ' },
    }, 'context')).toEqual({});
  });

  it('drops systemMessage: Antigravity has no terminal-hint channel', () => {
    expect(antigravityCliAdapter.formatOutput({ systemMessage: 'View Observations Live' }, 'context')).toEqual({});
  });

  it('maps a blocking summarize result onto StopHookResult decision/reason', () => {
    expect(antigravityCliAdapter.formatOutput({ decision: 'block', reason: 'still compressing' }, 'summarize'))
      .toEqual({ decision: 'block', reason: 'still compressing' });
  });
});

describe('antigravityCliAdapter - resolveHostEvent', () => {
  it('recovers the host event from a raw payload so error paths stay correctly shaped', () => {
    expect(antigravityCliAdapter.resolveHostEvent!({ preToolHookArgs: { toolCall: { name: 'ls' } } })).toBe('PreToolUse');
    expect(antigravityCliAdapter.resolveHostEvent!({ postToolHookArgs: { result: 'ok' } })).toBe('PostToolUse');
    expect(antigravityCliAdapter.resolveHostEvent!({ sessionStartHookArgs: {} })).toBe('SessionStart');
  });

  it('never throws on junk input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      expect(() => antigravityCliAdapter.resolveHostEvent!(junk)).not.toThrow();
    }
  });
});

describe('transcript-parser - Antigravity PLANNER_RESPONSE / USER_INPUT nodes', () => {
  function writeTranscript(lines: object[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'agy-parser-'));
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return p;
  }

  it('extracts the last PLANNER_RESPONSE as the assistant message', () => {
    const p = writeTranscript([
      { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'hello' },
      { type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'first answer' },
      { type: 'RUN_COMMAND', source: 'MODEL', content: 'ls -la' },
      { type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'final answer' },
    ]);
    expect(extractLastMessage(p, 'assistant')).toBe('final answer');
  });

  it('extracts the last USER_INPUT as the user message', () => {
    const p = writeTranscript([
      { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'first request' },
      { type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'ok' },
      { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'second request' },
    ]);
    expect(extractLastMessage(p, 'user')).toBe('second request');
  });

  it('does not treat MODEL-sourced tool nodes as assistant text', () => {
    const p = writeTranscript([
      { type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'the real answer' },
      { type: 'VIEW_FILE', source: 'MODEL', content: 'file contents that must be ignored' },
    ]);
    expect(extractLastMessage(p, 'assistant')).toBe('the real answer');
  });
});

describe.skipIf(process.platform !== 'win32')('toSpaceFreePath on Windows', () => {
  it('returns the 8.3 short path Windows reports for a path with a space', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-short-'));
    try {
      const dir = join(root, 'with space');
      mkdirSync(dir);
      const file = join(dir, 'bun.exe');
      writeFileSync(file, '');
      const expected = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:P).ShortPath'],
        { encoding: 'utf-8', env: { ...process.env, P: file } }).stdout.trim();
      expect(toSpaceFreePath(file).toLowerCase()).toBe((expected.includes(' ') ? file : expected).toLowerCase());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
