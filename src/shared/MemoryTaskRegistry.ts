export type MemoryTaskType =
  // Observation processing
  | 'observation-analysis'

  // Distillation core
  | 'distill'
  | 'decision-extraction'
  | 'todo-extraction'

  // Summarization
  | 'session-summary'
  | 'feature-summary'
  | 'branch-summary'

  // Context & briefing
  | 'briefing-generation'
  | 'context-formatting'
  | 'decision-formatting'
  | 'todo-formatting'

  // Semantic
  | 'semantic-search'
  | 'embeddings-generation'
  | 'similarity-scoring'

  // Enrichment
  | 'metadata-enrichment'
  | 'concept-extraction'
  | 'file-impact-analysis';

export type ProviderName = 'claude' | 'gemini-api' | 'gemini-cli' | 'openrouter' | 'ollama' | 'claude-cli' | 'codex-cli' | 'copilot-cli' | 'opencode-cli' | 'thermis-cli';

export type ScenarioType =
  | 'live-observation'     // Tool analysis, distill, decisions, todos, file impacts
  | 'session-summary'      // End-of-session: summaries, feature/branch summaries, briefings
  | 'semantic-search'      // Vector indexing: semantic search, embeddings, similarity
  | 'enrichment-format';   // Formatting & tags: context formatting, todo/decision formatting, metadata, concepts

export interface ScenarioConfig {
  primary: ProviderName;
  fallback?: ProviderName | 'none';
  timeoutMs?: number;
}

export const SCENARIO_TASK_MAP: Record<MemoryTaskType, ScenarioType> = {
  'observation-analysis': 'live-observation',
  'distill': 'live-observation',
  'decision-extraction': 'live-observation',
  'todo-extraction': 'live-observation',
  'file-impact-analysis': 'live-observation',

  'session-summary': 'session-summary',
  'feature-summary': 'session-summary',
  'branch-summary': 'session-summary',
  'briefing-generation': 'session-summary',

  'semantic-search': 'semantic-search',
  'embeddings-generation': 'semantic-search',
  'similarity-scoring': 'semantic-search',

  'context-formatting': 'enrichment-format',
  'decision-formatting': 'enrichment-format',
  'todo-formatting': 'enrichment-format',
  'metadata-enrichment': 'enrichment-format',
  'concept-extraction': 'enrichment-format',
};

export const DEFAULT_SCENARIOS: Record<ScenarioType, ScenarioConfig> = {
  'live-observation': {
    primary: 'gemini-cli',
    fallback: 'ollama',
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

export interface ProviderOption {
  id: ProviderName;
  label: string;
  kind: 'local' | 'cli' | 'api';
  description: string;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'ollama', label: '🦙 Ollama', kind: 'local', description: 'Local on-device inference (free, private)' },
  { id: 'gemini-cli', label: '✨ Antigravity CLI (agy)', kind: 'cli', description: 'Google Antigravity CLI subscription' },
  { id: 'claude-cli', label: '🤖 Claude Code CLI', kind: 'cli', description: 'Claude Code CLI subscription' },
  { id: 'codex-cli', label: '💻 Codex CLI', kind: 'cli', description: 'OpenAI Codex CLI subscription' },
  { id: 'copilot-cli', label: '✈️ Copilot CLI', kind: 'cli', description: 'GitHub Copilot CLI' },
  { id: 'opencode-cli', label: '⚡ OpenCode CLI', kind: 'cli', description: 'OpenCode Agent CLI' },
  { id: 'openrouter', label: '🌐 OpenRouter API', kind: 'api', description: 'Cloud models via OpenRouter key' },
  { id: 'gemini-api', label: '🔑 Gemini API', kind: 'api', description: 'Google AI Studio API key' },
  { id: 'claude', label: '🔑 Claude API', kind: 'api', description: 'Anthropic API key' },
];

export const MEMORY_TASK_DEFAULTS: Record<MemoryTaskType, {
  preferredProvider: ProviderName;
  fallbackChain: ProviderName[];
  costSensitive: boolean;
}> = {
  'observation-analysis': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api', 'openrouter'],
    costSensitive: true,
  },
  'distill': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api', 'openrouter'],
    costSensitive: true,
  },
  'decision-extraction': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'openrouter', 'gemini-api'],
    costSensitive: true,
  },
  'todo-extraction': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'openrouter', 'gemini-api'],
    costSensitive: true,
  },
  'session-summary': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api'],
    costSensitive: true,
  },
  'feature-summary': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api'],
    costSensitive: true,
  },
  'branch-summary': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api'],
    costSensitive: true,
  },
  'briefing-generation': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'gemini-api'],
    costSensitive: true,
  },
  'context-formatting': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama'],
    costSensitive: false,
  },
  'decision-formatting': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama'],
    costSensitive: false,
  },
  'todo-formatting': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama'],
    costSensitive: false,
  },
  'semantic-search': {
    preferredProvider: 'ollama',
    fallbackChain: ['gemini-cli', 'openrouter', 'gemini-api'],
    costSensitive: false,
  },
  'embeddings-generation': {
    preferredProvider: 'ollama',
    fallbackChain: ['gemini-cli', 'openrouter'],
    costSensitive: false,
  },
  'similarity-scoring': {
    preferredProvider: 'ollama',
    fallbackChain: ['gemini-cli'],
    costSensitive: false,
  },
  'metadata-enrichment': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'openrouter'],
    costSensitive: true,
  },
  'concept-extraction': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'openrouter'],
    costSensitive: true,
  },
  'file-impact-analysis': {
    preferredProvider: 'gemini-cli',
    fallbackChain: ['ollama', 'openrouter', 'gemini-api'],
    costSensitive: true,
  },
};
