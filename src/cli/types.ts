export interface NormalizedHookInput {
  sessionId: string;
  cwd: string;
  platform?: string;   
  prompt?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  transcriptPath?: string;
  lastAssistantMessage?: string;
  turnId?: string;
  stopHookActive?: boolean;
  permissionMode?: string;
  model?: string;
  sessionSource?: 'startup' | 'resume' | 'clear';
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
}

export interface HookResult {
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
