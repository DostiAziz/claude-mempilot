export type ProviderId =
  | 'ollama'
  | 'gemini-cli'
  | 'claude-cli'
  | 'codex-cli'
  | 'copilot-cli'
  | 'opencode-cli'
  | 'thermis-cli'
  | 'openrouter'
  | 'gemini-api'
  | 'claude'
  | 'none';

export type ScenarioId =
  | 'live-observation'
  | 'session-summary'
  | 'semantic-search'
  | 'enrichment-format';

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  icon: string;
  description: string;
  tasks: string[];
}

export interface ScenarioConfigState {
  primary: ProviderId;
  fallback: ProviderId;
  timeoutMs: number;
}

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'live-observation',
    title: 'Live Tool Observations',
    icon: '⚡',
    description: 'Compresses file edits, terminal runs, diffs, and decisions in real time.',
    tasks: ['observation-analysis', 'distill', 'decision-extraction', 'todo-extraction', 'file-impact-analysis'],
  },
  {
    id: 'session-summary',
    title: 'Session Summaries & Reports',
    icon: '📝',
    description: 'Generates end-of-session reviews, feature summaries, and briefing notes.',
    tasks: ['session-summary', 'feature-summary', 'branch-summary', 'briefing-generation'],
  },
  {
    id: 'semantic-search',
    title: 'Semantic Search & Embeddings',
    icon: '🔍',
    description: 'Computes vector embeddings, semantic ranking, and memory deduplication.',
    tasks: ['semantic-search', 'embeddings-generation', 'similarity-scoring'],
  },
  {
    id: 'enrichment-format',
    title: 'Formatting & Concept Enrichment',
    icon: '🏷️',
    description: 'Formats context injection tables and tags programming concepts.',
    tasks: ['context-formatting', 'decision-formatting', 'todo-formatting', 'metadata-enrichment', 'concept-extraction'],
  },
];

export const PROVIDER_SELECT_OPTIONS: { id: ProviderId; label: string; badge?: string }[] = [
  { id: 'ollama', label: '🦙 Ollama (Local)', badge: 'Free / Offline' },
  { id: 'gemini-cli', label: '✨ Antigravity CLI (agy)', badge: 'Active Subscription' },
  { id: 'claude-cli', label: '🤖 Claude Code CLI', badge: 'Subscription' },
  { id: 'codex-cli', label: '💻 Codex CLI', badge: 'Subscription' },
  { id: 'copilot-cli', label: '✈️ Copilot CLI', badge: 'CLI' },
  { id: 'opencode-cli', label: '⚡ OpenCode CLI', badge: 'CLI' },
  { id: 'openrouter', label: '🌐 OpenRouter API', badge: 'API Key' },
  { id: 'gemini-api', label: '🔑 Gemini API', badge: 'API Key' },
  { id: 'claude', label: '🔑 Claude API', badge: 'API Key' },
];

export const DEFAULT_SCENARIOS_STATE: Record<ScenarioId, ScenarioConfigState> = {
  'live-observation': {
    primary: 'ollama',
    fallback: 'gemini-cli',
    timeoutMs: 12000,
  },
  'session-summary': {
    primary: 'gemini-cli',
    fallback: 'claude-cli',
    timeoutMs: 25000,
  },
  'semantic-search': {
    primary: 'ollama',
    fallback: 'gemini-cli',
    timeoutMs: 10000,
  },
  'enrichment-format': {
    primary: 'gemini-cli',
    fallback: 'ollama',
    timeoutMs: 10000,
  },
};
