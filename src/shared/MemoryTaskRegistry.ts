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

export type ProviderName = 'claude' | 'gemini-api' | 'gemini-cli' | 'openrouter' | 'ollama';

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
