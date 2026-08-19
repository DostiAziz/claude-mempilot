import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { PlatformAdapter, HookResult } from '../types.js';
import { AdapterRejectedInput, isValidCwd } from './errors.js';

/**
 * Antigravity CLI (`agy`) hook contract.
 *
 * Antigravity is a Go binary that speaks protobuf, not the Claude Code hook
 * envelope. Both sides of a command hook are protojson:
 *
 *  - stdin is a protojson `exa.hooks_pb.HookArgs`: a `common` block plus a
 *    oneof naming the event (`preToolHookArgs`, `postInvocationHookArgs`, ...).
 *    There is no `hook_event_name`, `session_id`, `tool_name`, or `cwd` field
 *    anywhere in the binary — the earlier Claude-Code-shaped keys never
 *    matched anything.
 *  - stdout is unmarshalled into the result message for the firing event, and
 *    protojson REJECTS unknown fields. Emitting `{"continue":true,
 *    "suppressOutput":true}` fails every hook with
 *      failed to unmarshal result from hook ... unknown field "continue"
 *    which Antigravity surfaces as a hard tool failure, so every Bash/Read in
 *    the host session errors out until the hook stops saying "continue".
 *
 * The result messages (third_party/jetski/hooks_pb/hooks.proto) are the whole
 * output vocabulary:
 *
 *   SessionStart    SessionStartHookResult    injectSteps
 *   PreInvocation   PreInvocationHookResult   injectSteps
 *   PostInvocation  PostInvocationHookResult  injectSteps, terminationBehavior
 *   PreToolUse      PreToolHookResult         decision, reason, overwrite,
 *                                             permissionOverrides
 *   PostToolUse     PostToolHookResult        (no fields at all)
 *   Stop            StopHookResult            decision, reason
 *
 * `{}` unmarshals cleanly into every one of them — but on PreToolUse it is a
 * DENY, not a no-op. Per the binary's own schema text, `decision` is "'allow'
 * to proceed, 'deny' to block, 'ask' to request user confirmation", and
 * `reason` is "required if decision is not 'allow'". An omitted `decision` is
 * proto3's empty string, which is not 'allow', so an empty PreToolHookResult
 * blocks the tool with a blank reason ("tool call denied by pre-tool hook: ").
 * PreToolUse must therefore say `{"decision":"allow"}` explicitly.
 *
 * That is why the host event matters and the internal event is not enough:
 * `observation` fires on PreToolUse (needs `decision`), PostToolUse (accepts NO
 * field whatsoever) and PostInvocation, so one payload cannot serve all three.
 */

type AnyRecord = Record<string, any>;

/** Internal events whose Antigravity result message accepts `injectSteps`. */
const CONTEXT_INJECT_EVENTS = new Set(['context', 'session-init']);

/** HookArgs oneof key (camelCase and proto snake_case) -> Antigravity event. */
const HOOK_ARGS_ONEOF: ReadonlyArray<readonly [string, string, string]> = [
  ['preToolHookArgs', 'pre_tool_hook_args', 'PreToolUse'],
  ['postToolHookArgs', 'post_tool_hook_args', 'PostToolUse'],
  ['preInvocationHookArgs', 'pre_invocation_hook_args', 'PreInvocation'],
  ['postInvocationHookArgs', 'post_invocation_hook_args', 'PostInvocation'],
  ['stopHookArgs', 'stop_hook_args', 'Stop'],
  ['sessionStartHookArgs', 'session_start_hook_args', 'SessionStart'],
];

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, '');
}

function pick(source: AnyRecord | undefined, ...keys: string[]): any {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Opt-in raw-payload capture. The HookArgs shape above was read out of the
 * `agy` binary's embedded descriptor rather than observed live, so leave a way
 * to confirm it against a real session without another binary dig:
 * CLAUDE_MEM_DEBUG_HOOK_INPUT=1 appends every raw payload to
 * ~/.claude-mem/logs/antigravity-hook-input.jsonl. Never allowed to throw — a
 * debug aid must not be able to break the hook it is instrumenting.
 */
function captureRawInput(raw: unknown): void {
  if (process.env.CLAUDE_MEM_DEBUG_HOOK_INPUT !== '1') return;
  try {
    const dir = join(homedir(), '.claude-mem', 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'antigravity-hook-input.jsonl'), JSON.stringify(raw) + '\n');
  } catch {
    // debug-only path
  }
}

/**
 * Resolve the Antigravity event plus its inner args block. Handles the nested
 * protojson form (`{common, preToolHookArgs}`) and a flattened form (common +
 * inner merged into one object), and still honours the legacy
 * `hook_event_name` key so older fixtures and non-Antigravity callers keep
 * working.
 */
function resolveEvent(r: AnyRecord): { event: string | undefined; inner: AnyRecord } {
  for (const [camel, snake, event] of HOOK_ARGS_ONEOF) {
    const args = pick(r, camel, snake);
    if (args !== undefined) {
      return { event, inner: typeof args === 'object' ? args : {} };
    }
  }

  const declared: string | undefined = pick(r, 'hook_event_name', 'hookEventName');
  if (declared) return { event: declared, inner: r };

  // Flattened payload: infer the event from fields only that event carries.
  if (r.modelOutput !== undefined || r.model_output !== undefined) return { event: 'PostInvocation', inner: r };
  if (r.terminationReason !== undefined || r.termination_reason !== undefined) return { event: 'Stop', inner: r };
  if (r.result !== undefined || r.error !== undefined) return { event: 'PostToolUse', inner: r };
  if (r.toolCall !== undefined || r.tool_call !== undefined) return { event: 'PreToolUse', inner: r };
  if (r.invocationNum !== undefined || r.invocation_num !== undefined) return { event: 'PreInvocation', inner: r };

  return { event: undefined, inner: r };
}

/**
 * Internal claude-mem event -> the single Antigravity event it fires on.
 * `observation` is deliberately absent: it is registered on PreToolUse,
 * PostToolUse AND PostInvocation, whose result messages accept different
 * fields, so it can only be resolved from the payload.
 */
const HOST_EVENT_BY_INTERNAL_EVENT: Record<string, string> = {
  'context': 'SessionStart',
  'session-init': 'PreInvocation',
  'summarize': 'Stop',
};

/**
 * SessionStart / PreInvocation results carry `injectSteps`. systemMessage is a
 * USER_HINT for the human's terminal and Antigravity has no channel for one
 * (HookSystemMessage lands in the conversation, not the terminal), so only the
 * real context is injected.
 */
function injectContextSteps(result: HookResult): Record<string, unknown> {
  const additionalContext = result.hookSpecificOutput?.additionalContext?.trim();
  if (!additionalContext) return {};
  return {
    injectSteps: [
      { systemMessage: { systemMessage: stripAnsi(additionalContext) } },
    ],
  };
}

export const antigravityCliAdapter: PlatformAdapter = {

  resolveHostEvent(raw) {
    try {
      return resolveEvent((raw ?? {}) as AnyRecord).event;
    } catch {
      return undefined;
    }
  },

  normalizeInput(raw) {
    captureRawInput(raw);
    const r = (raw ?? {}) as AnyRecord;

    // HookArgsCommon lives under `common` in the nested form and inline in the
    // flattened one; falling back to `r` covers both without branching.
    const common: AnyRecord = (typeof r.common === 'object' && r.common !== null) ? r.common : r;
    const { event, inner } = resolveEvent(r);

    const workspacePaths = pick(common, 'workspacePaths', 'workspace_paths');
    const cwd = pick(r, 'cwd')
      ?? (Array.isArray(workspacePaths) ? workspacePaths[0] : undefined)
      ?? process.env.GEMINI_CWD
      ?? process.env.GEMINI_PROJECT_DIR
      ?? process.env.CLAUDE_PROJECT_DIR
      ?? process.cwd();
    if (!isValidCwd(cwd)) {
      throw new AdapterRejectedInput('invalid_cwd');
    }

    const sessionId = pick(common, 'conversationId', 'conversation_id')
      ?? pick(r, 'session_id')
      ?? pick(common, 'executionId', 'execution_id')
      ?? process.env.GEMINI_SESSION_ID
      ?? undefined;

    const prompt = pick(common, 'lastUserInput', 'last_user_input') ?? pick(r, 'prompt');

    // HookToolCall is {name, args}; `args` is a google.protobuf.Struct, which
    // protojson renders as a plain JSON object — usable as toolInput as-is.
    const toolCall = pick(inner, 'toolCall', 'tool_call');
    let toolName: string | undefined = (toolCall && toolCall.name) ?? pick(r, 'tool_name', 'toolName');
    let toolInput: unknown = (toolCall && toolCall.args) ?? pick(r, 'tool_input', 'toolInput');
    let toolResponse: unknown = pick(r, 'tool_response', 'toolResponse');

    if (event === 'PostToolUse' || event === 'AfterTool') {
      const toolResult = pick(inner, 'result');
      const toolError = pick(inner, 'error');
      toolResponse = toolResponse ?? {
        ...(toolResult !== undefined ? { result: toolResult } : {}),
        ...(toolError !== undefined ? { error: toolError } : {}),
      };
    }

    // A model turn is recorded as a synthetic tool call so the observation
    // pipeline sees prompt-in / response-out like it does on every platform.
    if (event === 'PostInvocation' || event === 'AfterAgent') {
      const modelOutput = pick(inner, 'modelOutput', 'model_output')
        ?? pick(r, 'prompt_response', 'promptResponse');
      const modelThinking = pick(inner, 'modelThinking', 'model_thinking');
      if (modelOutput !== undefined) {
        toolName = toolName ?? 'AntigravityProvider';
        toolInput = toolInput ?? { prompt };
        toolResponse = toolResponse ?? {
          response: modelOutput,
          ...(modelThinking !== undefined ? { thinking: modelThinking } : {}),
        };
      }
    }

    if ((event === 'PreToolUse' || event === 'BeforeTool') && toolName && !toolResponse) {
      toolResponse = { _preExecution: true };
    }

    if (event === 'Notification') {
      toolName = toolName ?? 'AntigravityNotification';
      toolInput = toolInput ?? {
        notification_type: pick(r, 'notification_type', 'notificationType'),
        message: pick(r, 'message'),
      };
      toolResponse = toolResponse ?? { details: pick(r, 'details') };
    }

    return {
      sessionId,
      cwd,
      prompt,
      toolName,
      toolInput,
      toolResponse,
      transcriptPath: pick(common, 'transcriptPath', 'transcript_path')
        ?? pick(r, 'transcript_path', 'transcriptPath'),
      model: pick(common, 'modelName', 'model_name'),
      hostEvent: event,
    };
  },

  /**
   * Antigravity validates hook output against the result message for the
   * FIRING event, so the payload is chosen by host event. `hostEvent` comes
   * from the stdin payload; the internal `event` only pins it down for the
   * hooks that map one-to-one, which is why `observation` is absent from
   * HOST_EVENT_BY_INTERNAL_EVENT — it fires on three different host events.
   */
  formatOutput(result: HookResult, event?: string, hostEvent?: string) {
    const host = hostEvent ?? HOST_EVENT_BY_INTERNAL_EVENT[event ?? ''];

    switch (host) {
      case 'SessionStart':
      case 'PreInvocation':
      case 'BeforeAgent':
        return injectContextSteps(result);

      // PreToolHookResult: omitting `decision` is proto3's empty string, which
      // is not 'allow', and Antigravity fails CLOSED — the tool is blocked with
      // an empty reason. Permission is the pre-tool hook's whole purpose, so it
      // must say allow out loud. claude-mem only observes; it never blocks.
      case 'PreToolUse':
      case 'BeforeTool':
        return { decision: 'allow' };

      // PostToolHookResult declares no fields at all — `{}` is the only legal
      // payload. The Post* and Notification hooks all run after the fact, so
      // there is no decision left to make.
      case 'PostToolUse':
      case 'AfterTool':
      case 'PostInvocation':
      case 'AfterAgent':
      case 'Notification':
        return {};

      // StopHookResult: 'stop' allows termination, 'continue'/'block' keep the
      // agent running. Unlike the pre-tool hook this one fails OPEN — an empty
      // decision matches neither blocking value, so the session terminates
      // normally, which is what summarize wants.
      case 'Stop':
      case 'SessionEnd':
      case 'PreCompress':
        return result.decision === 'block' && result.reason
          ? { decision: 'block', reason: stripAnsi(result.reason) }
          : {};

      default:
        // Host event unknown — normalizeInput threw, or the payload had no
        // recognisable event. The two possible mistakes are NOT symmetric: a
        // stray `decision` on a Post* hook is a parse warning logged after the
        // tool already ran, while a bare `{}` on PreToolUse blocks the user's
        // tool outright. So bias toward allow for the hooks that can fire
        // pre-tool, and stay empty for everything else.
        return event === 'observation' ? { decision: 'allow' } : {};
    }
  }
};
