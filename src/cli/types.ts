export interface NormalizedHookInput {
  sessionId: string;
  cwd: string;
  platform?: string;   
  prompt?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  /**
   * Provider-assigned id for THIS tool call. Already honoured downstream (the
   * pending_messages dedupe index and the durable `tool_uses` side index both
   * key on it); adapters simply never forwarded it from the hook payload, so
   * only the transcript-watch path populated it. Optional everywhere: a
   * platform that omits it still ingests, it just cannot be de-duplicated.
   */
  toolUseId?: string;
  transcriptPath?: string;
  /** Claude Code SubagentStop only: the finished subagent's own transcript (agent_transcript_path). */
  agentTranscriptPath?: string;
  lastAssistantMessage?: string;
  reason?: string;
  turnId?: string;
  /** Codex only; the Claude Code adapter deliberately leaves it unset (see claude-code.ts). */
  stopHookActive?: boolean;
  permissionMode?: string;
  model?: string;
  sessionSource?: 'startup' | 'resume' | 'clear' | 'compact';
  /** Raw hook event name from the payload (e.g. Kimi binds both Stop and PreCompact to the same internal event — handlers use this to tell them apart). */
  hookEventName?: string;
  filePath?: string;
  edits?: unknown[];
  agentId?: string;
  agentType?: string;
  /**
   * The HOST's own event name (e.g. Antigravity's `PreToolUse`), as opposed to
   * the claude-mem internal event. Only set by platforms whose hook OUTPUT
   * schema varies per event, where one internal event maps to several host
   * events that accept different fields.
   */
  hostEvent?: string;
  /**
   * Text the human actually submitted, when the host can tell.
   *
   * Qwen Code sends `submitted_prompt` and fires `UserPromptSubmit` for
   * supported model invocations, which on the core/headless path also covers
   * ToolResult and Hook sends. Those carry no user text, and the host's own
   * guidance is that absence of the field means "unavailable" rather than
   * "fall back to prompt". Three states, all meaningful:
   *
   *   - `undefined` - the host did not send the field; legacy handling stands
   *   - `string`   - the host sent real user-submitted text
   *   - `null`     - the host sent the field with no text: not a user turn
   */
  submittedPrompt?: string | null;
}

export interface HookResult {
  /** Internal measurement hint; stripped before platform formatting/output. */
  workStateTelemetry?: 'measure' | 'excluded' | 'unknown';
  continue?: boolean;
  suppressOutput?: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
    permissionDecision?: 'allow' | 'deny';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
  systemMessage?: string;
  decision?: 'block' | 'approve';
  reason?: string;
  exitCode?: number;
}

export interface PlatformAdapter {
  normalizeInput(raw: unknown): NormalizedHookInput;
  /**
   * `event` is the claude-mem internal event name (`context`,
   * `observation`, ...) the hook command was registered with. Adapters
   * whose host validates hook output per event — Antigravity unmarshals it
   * into a different proto message for every event — need it to pick a
   * legal payload; adapters with one flat output envelope can ignore it.
   */
  formatOutput(result: HookResult, event?: string, hostEvent?: string): unknown;

  /**
   * Recover the host's event name straight from the raw stdin payload.
   *
   * Exists so the error paths can still emit a correctly-shaped envelope: if
   * normalizeInput throws or the worker is unreachable there is no
   * NormalizedHookInput to read `hostEvent` from, and on Antigravity a
   * wrongly-shaped fallback DENIES the user's tool call. Must be pure and must
   * never throw.
   */
  resolveHostEvent?(raw: unknown): string | undefined;
}

export interface EventHandler {
  execute(input: NormalizedHookInput): Promise<HookResult>;
}
