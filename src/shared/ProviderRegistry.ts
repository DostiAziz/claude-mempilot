import type { LlmProvider } from './LlmProvider.js';
import {
  MemoryTaskType,
  MEMORY_TASK_DEFAULTS,
  ProviderName,
  ScenarioType,
  ScenarioConfig,
  SCENARIO_TASK_MAP,
  DEFAULT_SCENARIOS,
} from './MemoryTaskRegistry.js';
import type { SettingsDefaults } from './SettingsDefaultsManager.js';
import { OllamaProvider } from '../services/worker/OllamaProvider.js';
import { GeminiCliProvider } from '../services/worker/GeminiCliProvider.js';
import { GenericCliProvider } from '../services/worker/GenericCliProvider.js';
import { logger } from '../utils/logger.js';

class GeminiApiLlmProvider implements LlmProvider {
  name = 'gemini-api';
  constructor(private apiKey: string, public model: string = 'gemini-2.5-flash') {}
  async isAvailable() { return !!this.apiKey; }
  async extract(input: { prompt: string }) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }] })
    });
    if (!res.ok) throw new Error(`Gemini API error: ${res.statusText}`);
    const data = await res.json() as any;
    return data.candidates[0].content.parts[0].text;
  }
  async extractStructured(input: { prompt: string }) {
    const text = await this.extract(input);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  getSpeed() { return 'fast' as const; }
}

class OpenRouterLlmProvider implements LlmProvider {
  name = 'openrouter';
  constructor(private apiKey: string, public model: string = 'google/gemini-2.5-flash') {}
  async isAvailable() { return !!this.apiKey; }
  async extract(input: { prompt: string }) {
    const res = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: input.prompt }] })
    });
    if (!res.ok) throw new Error(`OpenRouter API error: ${res.statusText}`);
    const data = await res.json() as any;
    return data.choices[0].message.content;
  }
  async extractStructured(input: { prompt: string }) {
    const text = await this.extract(input);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  getSpeed() { return 'fast' as const; }
}

class ClaudeLlmProvider implements LlmProvider {
  name = 'claude';
  constructor(private apiKey: string, public model: string = 'claude-3-haiku-20240307') {}
  async isAvailable() { return !!this.apiKey; }
  async extract(input: { prompt: string }) {
    const res = await fetch(`https://api.anthropic.com/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 4096, messages: [{ role: 'user', content: input.prompt }] })
    });
    if (!res.ok) throw new Error(`Claude API error: ${res.statusText}`);
    const data = await res.json() as any;
    return data.content[0].text;
  }
  async extractStructured(input: { prompt: string }) {
    const text = await this.extract(input);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  getSpeed() { return 'fast' as const; }
}

export class ProviderRegistry {
  private providers: Map<ProviderName, LlmProvider> = new Map();
  private taskOverrides: Map<MemoryTaskType, ProviderName> = new Map();
  private scenarios: Map<ScenarioType, ScenarioConfig> = new Map();
  private costOptimization: boolean;

  constructor(settings: SettingsDefaults) {
    this.registerProviders(settings);
    this.loadTaskOverrides(settings);
    this.loadScenarios(settings);
    this.costOptimization =
      settings.CLAUDE_MEM_PREFER_COST_OPTIMIZATION === 'true' ||
      (settings.CLAUDE_MEM_PREFER_COST_OPTIMIZATION as any) === true;
  }

  private registerProviders(settings: SettingsDefaults) {
    const ollamaEndpoint = (settings.OLLAMA_ENDPOINT as string | undefined)?.trim();
    if (ollamaEndpoint) {
      const ollamaModel = (settings.OLLAMA_MODEL as string | undefined)?.trim() || 'gpt-oss:20b';
      this.registerProvider(new OllamaProvider({ endpoint: ollamaEndpoint, model: ollamaModel }));
    }
    const geminiCliBinary = settings.CLAUDE_MEM_GEMINI_CLI_BINARY?.trim() || 'gemini';
    const geminiCliModel = settings.CLAUDE_MEM_GEMINI_CLI_MODEL?.trim() || 'gemini-2.5-flash-lite';
    this.registerProvider(new GeminiCliProvider({ binary: geminiCliBinary, model: geminiCliModel }));

    const claudeCliBinary = settings.CLAUDE_MEM_CLAUDE_CLI_BINARY?.trim() || 'claude';
    this.registerProvider(new GenericCliProvider({ name: 'claude-cli', binary: claudeCliBinary, model: settings.CLAUDE_MEM_CLAUDE_CLI_MODEL?.trim() || 'default' }));

    const codexCliBinary = settings.CLAUDE_MEM_CODEX_CLI_BINARY?.trim() || 'codex';
    this.registerProvider(new GenericCliProvider({ name: 'codex-cli', binary: codexCliBinary, model: settings.CLAUDE_MEM_CODEX_CLI_MODEL?.trim() || 'default' }));

    const copilotCliBinary = settings.CLAUDE_MEM_COPILOT_CLI_BINARY?.trim() || 'copilot';
    this.registerProvider(new GenericCliProvider({ name: 'copilot-cli', binary: copilotCliBinary, model: settings.CLAUDE_MEM_COPILOT_CLI_MODEL?.trim() || 'default' }));

    const opencodeCliBinary = settings.CLAUDE_MEM_OPENCODE_CLI_BINARY?.trim() || 'opencode';
    this.registerProvider(new GenericCliProvider({ name: 'opencode-cli', binary: opencodeCliBinary, model: settings.CLAUDE_MEM_OPENCODE_CLI_MODEL?.trim() || 'default' }));

    const thermisCliBinary = settings.CLAUDE_MEM_THERMIS_CLI_BINARY?.trim() || 'thermis';
    this.registerProvider(new GenericCliProvider({ name: 'thermis-cli', binary: thermisCliBinary, model: settings.CLAUDE_MEM_THERMIS_CLI_MODEL?.trim() || 'default' }));

    const geminiApiKey = settings.CLAUDE_MEM_GEMINI_API_KEY?.trim();
    if (geminiApiKey) {
      this.registerProvider(new GeminiApiLlmProvider(geminiApiKey));
    }

    const openrouterApiKey = settings.CLAUDE_MEM_OPENROUTER_API_KEY?.trim();
    if (openrouterApiKey) {
      this.registerProvider(new OpenRouterLlmProvider(openrouterApiKey));
    }

    const claudeApiKey = (settings as any).CLAUDE_MEM_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
    if (claudeApiKey) {
      this.registerProvider(new ClaudeLlmProvider(claudeApiKey));
    }
  }

  private loadTaskOverrides(settings: SettingsDefaults) {
    try {
      const tasksStr = settings.CLAUDE_MEM_TASKS;
      if (tasksStr && typeof tasksStr === 'string' && tasksStr !== '{}') {
        const parsed = JSON.parse(tasksStr);
        for (const [task, provider] of Object.entries(parsed)) {
          this.taskOverrides.set(
            task as MemoryTaskType,
            provider as ProviderName
          );
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  private loadScenarios(settings: SettingsDefaults) {
    try {
      const scenariosStr = settings.CLAUDE_MEM_SCENARIOS;
      if (scenariosStr && typeof scenariosStr === 'string' && scenariosStr !== '{}') {
        const parsed = JSON.parse(scenariosStr);
        for (const [scenario, config] of Object.entries(parsed)) {
          if (config && typeof config === 'object') {
            this.scenarios.set(scenario as ScenarioType, config as ScenarioConfig);
          }
        }
      }
    } catch {
      // Ignore parsing errors, defaults will apply
    }
  }

  getScenario(scenarioType: ScenarioType): ScenarioConfig {
    return this.scenarios.get(scenarioType) ?? DEFAULT_SCENARIOS[scenarioType];
  }

  getTimeoutForTask(task: MemoryTaskType): number {
    const scenarioType = SCENARIO_TASK_MAP[task];
    const scenario = this.getScenario(scenarioType);
    return scenario?.timeoutMs ?? 15000;
  }

  /**
   * Resolve an ordered list of candidate providers for a given task:
   * 1. Explicit task override (if any)
   * 2. Scenario Primary provider
   * 3. Scenario Fallback provider (if configured)
   * 4. Task default chain
   */
  async getCandidateProviders(task: MemoryTaskType): Promise<LlmProvider[]> {
    const result: LlmProvider[] = [];
    const seen = new Set<string>();

    const addProvider = async (name?: ProviderName | 'none') => {
      if (!name || name === 'none' || seen.has(name)) return;
      seen.add(name);
      const p = this.providers.get(name as ProviderName);
      if (p && (await p.isAvailable())) {
        result.push(p);
      }
    };

    // 1. Explicit task override
    const override = this.taskOverrides.get(task);
    if (override) {
      await addProvider(override);
    }

    // 2. Scenario primary and fallback (user configured scenario takes precedence)
    const scenarioType = SCENARIO_TASK_MAP[task];
    if (scenarioType) {
      const scenario = this.getScenario(scenarioType);
      if (scenario) {
        await addProvider(scenario.primary);
        if (scenario.fallback) {
          await addProvider(scenario.fallback);
        }
      }
    }

    // 3. Cost optimization check
    if (this.costOptimization) {
      const lowestCost = this.getLowestCostProvider(task);
      if (lowestCost) {
        await addProvider(lowestCost.name as ProviderName);
      }
    }

    // 4. Default task fallback chain
    const taskConfig = MEMORY_TASK_DEFAULTS[task];
    if (taskConfig) {
      await addProvider(taskConfig.preferredProvider);
      for (const fallback of taskConfig.fallbackChain) {
        await addProvider(fallback);
      }
    }

    return result;
  }

  // Get first available provider for a specific memory task
  async getForTask(task: MemoryTaskType): Promise<LlmProvider> {
    const candidates = await this.getCandidateProviders(task);
    if (candidates.length > 0) {
      return candidates[0];
    }
    throw new Error(`No available provider for task: ${task}`);
  }

  /**
   * Execute an operation on the primary provider with automatic runtime
   * failover to configured fallback providers if timeout or errors occur.
   */
  async executeWithFallback<T>(
    task: MemoryTaskType,
    runner: (provider: LlmProvider) => Promise<T>
  ): Promise<T> {
    const candidates = await this.getCandidateProviders(task);
    if (!candidates.length) {
      throw new Error(`No available providers configured for task: ${task}`);
    }

    let lastError: Error | null = null;
    const timeoutMs = this.getTimeoutForTask(task);

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];
      try {
        const result = await Promise.race([
          runner(provider),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        return result;
      } catch (err: any) {
        lastError = err;
        const next = candidates[i + 1];
        if (next) {
          logger.warn(
            'DISTILL',
            `Provider '${provider.name}' failed on task '${task}' (${err.message}). Failing over to '${next.name}'...`
          );
        }
      }
    }

    throw lastError ?? new Error(`All candidate providers failed for task: ${task}`);
  }

  // Get lowest-cost provider from task's chain
  private getLowestCostProvider(task: MemoryTaskType): LlmProvider | null {
    const taskConfig = MEMORY_TASK_DEFAULTS[task];
    const candidates = [
      taskConfig.preferredProvider,
      ...taskConfig.fallbackChain,
    ];
    const costOrder: ProviderName[] = [
      'ollama',
      'gemini-cli',
      'claude-cli',
      'codex-cli',
      'copilot-cli',
      'opencode-cli',
      'thermis-cli',
      'openrouter',
      'gemini-api',
      'claude',
    ];

    for (const providerName of costOrder) {
      if (candidates.includes(providerName)) {
        const provider = this.providers.get(providerName);
        if (provider) {
          return provider;
        }
      }
    }

    // Fallback to preferred if no candidates matched cost order
    return this.providers.get(taskConfig.preferredProvider) ?? null;
  }

  registerProvider(provider: LlmProvider): void {
    this.providers.set(provider.name as ProviderName, provider);
  }
}
