import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { antigravityCliAdapter } from '../src/cli/adapters/antigravity-cli.js';

const INSTALLER_PATH = 'src/services/integrations/AntigravityCliHooksInstaller.ts';

describe('AntigravityCliHooksInstaller - event mapping (B0-confirmed 7-event map)', () => {
  const src = readFileSync(INSTALLER_PATH, 'utf-8');

  it('maps SessionStart to context', () => {
    expect(src).toContain("'SessionStart': 'context'");
  });

  it('maps BeforeAgent to session-init, not user-message', () => {
    expect(src).toContain("'BeforeAgent': 'session-init'");
  });

  it('maps AfterAgent, BeforeTool, AfterTool, and Notification to observation', () => {
    expect(src).toContain("'AfterAgent': 'observation'");
    expect(src).toContain("'BeforeTool': 'observation'");
    expect(src).toContain("'AfterTool': 'observation'");
    expect(src).toContain("'Notification': 'observation'");
  });

  it('maps PreCompress to summarize', () => {
    expect(src).toContain("'PreCompress': 'summarize'");
  });

  it('should not map SessionEnd (session-complete has no handler; worker self-completes)', () => {
    expect(src).not.toContain("'SessionEnd':");
  });

  it('uses the antigravity-cli hook command string, not gemini-cli', () => {
    expect(src).toContain('hook antigravity-cli');
    expect(src).not.toContain('hook gemini-cli');
  });

  it('targets the shared ~/.gemini config tree (settings.json + GEMINI.md), not a separate Antigravity-only file', () => {
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'settings.json')");
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'GEMINI.md')");
  });

  it('dual-writes MCP config to both B0-confirmed candidate paths', () => {
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'antigravity', 'mcp_config.json')");
    expect(src).toContain("path.join(GEMINI_CONFIG_DIR, 'config', 'mcp_config.json')");
  });

  it('reuses writeMcpJsonConfig from McpIntegrations.ts rather than reimplementing MCP config writing', () => {
    expect(src).toContain("from './McpIntegrations.js'");
    expect(src).toContain('writeMcpJsonConfig');
  });

  it('writes the rules/context placeholder to the plural, home-relative .agents/rules path', () => {
    expect(src).toContain("path.join(homedir(), '.agents', 'rules', 'claude-mem-context.md')");
  });
});

describe('antigravityCliAdapter - normalizeInput', () => {
  it('falls back to process.cwd() when no cwd and no GEMINI_*/CLAUDE_PROJECT_DIR env vars are set', () => {
    const savedCwd = process.env.GEMINI_CWD;
    const savedProjectDir = process.env.GEMINI_PROJECT_DIR;
    const savedClaudeDir = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.GEMINI_CWD;
    delete process.env.GEMINI_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      const result = antigravityCliAdapter.normalizeInput({});
      expect(result.cwd).toBe(process.cwd());
    } finally {
      if (savedCwd !== undefined) process.env.GEMINI_CWD = savedCwd;
      if (savedProjectDir !== undefined) process.env.GEMINI_PROJECT_DIR = savedProjectDir;
      if (savedClaudeDir !== undefined) process.env.CLAUDE_PROJECT_DIR = savedClaudeDir;
    }
  });

  it('prefers an explicit cwd over any env var fallback', () => {
    const result = antigravityCliAdapter.normalizeInput({ cwd: '/tmp/explicit-cwd' });
    expect(result.cwd).toBe('/tmp/explicit-cwd');
  });

  it('rejects an invalid (empty) cwd', () => {
    expect(() => antigravityCliAdapter.normalizeInput({ cwd: '' })).toThrow('adapter rejected input: invalid_cwd');
  });

  it('maps AfterAgent prompt_response into toolName/toolInput/toolResponse', () => {
    const result = antigravityCliAdapter.normalizeInput({
      cwd: '/tmp',
      hook_event_name: 'AfterAgent',
      prompt: 'hi',
      prompt_response: 'hello there',
    });
    expect(result.toolName).toBe('AntigravityProvider');
    expect(result.toolInput).toEqual({ prompt: 'hi' });
    expect(result.toolResponse).toEqual({ response: 'hello there' });
  });

  it('marks a BeforeTool call as pre-execution when no response is present', () => {
    const result = antigravityCliAdapter.normalizeInput({
      cwd: '/tmp',
      hook_event_name: 'BeforeTool',
      tool_name: 'Read',
    });
    expect(result.toolResponse).toEqual({ _preExecution: true });
  });

  it('maps Notification fields into toolName/toolInput/toolResponse', () => {
    const result = antigravityCliAdapter.normalizeInput({
      cwd: '/tmp',
      hook_event_name: 'Notification',
      notification_type: 'permission',
      message: 'allow?',
      details: { foo: 'bar' },
    });
    expect(result.toolName).toBe('AntigravityNotification');
    expect(result.toolInput).toEqual({ notification_type: 'permission', message: 'allow?' });
    expect(result.toolResponse).toEqual({ details: { foo: 'bar' } });
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

// Antigravity unmarshals hook stdout with protojson into the result message for
// the firing event. Two distinct failure modes live here:
//   1. protojson REJECTS unknown fields, so the Claude Code envelope blew up
//      every hook with `unknown field "continue"`.
//   2. PreToolHookResult fails CLOSED — an omitted `decision` is proto3's empty
//      string, which is not 'allow', so a bare `{}` DENIES the tool call
//      ("tool call denied by pre-tool hook: " with a blank reason).
// See the field table in antigravity-cli.ts.
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
    // The mistakes are asymmetric: a stray `decision` on a Post* hook is a
    // parse warning after the tool ran; a bare `{}` on PreToolUse blocks it.
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

// NOTE: an automated regression test for the B0 empty-mcp-config-file edge
// case (see AntigravityCliHooksInstaller.ts's seedEmptyMcpConfigFile /
// readMcpConfigTolerantly) was deliberately NOT added here. Bun's homedir()
// does not re-read a runtime-reassigned process.env.HOME within a single
// process, so a test attempting to redirect GEMINI_CONFIG_DIR that way
// silently operates on the REAL ~/.gemini instead of an isolated temp dir.
// That was verified by hand (as a one-off script run in a separate process
// with HOME set before start, which bun DOES respect) rather than as a
// committed test, specifically to avoid this footgun running unattended in
// CI/local `bun test` and mutating a real, live ~/.gemini tree every run.
