import type { PlatformAdapter } from '../types.js';
import { AdapterRejectedInput, isValidCwd } from './errors.js';

export const antigravityCliAdapter: PlatformAdapter = {

  normalizeInput(raw) {
    require('fs').appendFileSync('/tmp/hook_dump.log', JSON.stringify(raw) + '\n');
    const r = (raw ?? {}) as any;


    // unverified: confirm Antigravity sets GEMINI_* env vars on first real hook firing
    const cwd = r.cwd
      ?? process.env.GEMINI_CWD
      ?? process.env.GEMINI_PROJECT_DIR
      ?? process.env.CLAUDE_PROJECT_DIR
      ?? process.cwd();
    if (!isValidCwd(cwd)) {
      throw new AdapterRejectedInput('invalid_cwd');
    }

    const sessionId = r.session_id
      ?? r.conversationId
      ?? process.env.GEMINI_SESSION_ID
      ?? undefined;

    const hookEventName: string | undefined = r.hook_event_name ?? r.hookEventName;

    let toolName: string | undefined = r.tool_name ?? r.toolName;
    let toolInput: unknown = r.tool_input ?? r.toolInput;
    let toolResponse: unknown = r.tool_response ?? r.toolResponse;

    if ((hookEventName === 'AfterAgent' || hookEventName === 'PostInvocation') && (r.prompt_response || r.promptResponse)) {
      toolName = toolName ?? 'AntigravityProvider';
      toolInput = toolInput ?? { prompt: r.prompt };
      toolResponse = toolResponse ?? { response: r.prompt_response ?? r.promptResponse };
    }

    if ((hookEventName === 'BeforeTool' || hookEventName === 'PreToolUse') && toolName && !toolResponse) {
      toolResponse = { _preExecution: true };
    }

    if (hookEventName === 'Notification') {
      toolName = toolName ?? 'AntigravityNotification';
      toolInput = toolInput ?? {
        notification_type: r.notification_type ?? r.notificationType,
        message: r.message,
      };
      toolResponse = toolResponse ?? { details: r.details };
    }

    return {
      sessionId,
      cwd,
      prompt: r.prompt,
      toolName,
      toolInput,
      toolResponse,
      transcriptPath: r.transcript_path ?? r.transcriptPath,
    };
  },

  formatOutput(result) {
    const output: Record<string, unknown> = {};

    output.continue = result.continue ?? true;

    if (result.suppressOutput !== undefined) {
      output.suppressOutput = result.suppressOutput;
    }

    if (result.systemMessage) {
      const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
      output.systemMessage = result.systemMessage.replace(ansiRegex, '');
    }

    if (result.hookSpecificOutput) {
      output.hookSpecificOutput = {
        additionalContext: result.hookSpecificOutput.additionalContext,
      };
    }

    return output;
  }
};
