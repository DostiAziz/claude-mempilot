import React, { useState, useCallback, useEffect, useId } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { Settings } from '../types';
import { TerminalPreview } from './TerminalPreview';
import { useContextPreview } from '../hooks/useContextPreview';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { DEFAULT_SETTINGS } from '../constants/settings';
import { isClaudeMemObserverBaseUrl } from '../utils/observer-endpoint';
import { claudeProviderOptionLabel } from '../utils/claude-auth-method';
import { OPENAI_COMPAT_PRESET_OPTIONS, openAICompatPresetOption } from '../constants/openai-compat-presets';
import {
  SCENARIO_DEFINITIONS,
  PROVIDER_SELECT_OPTIONS,
  DEFAULT_SCENARIOS_STATE,
  type ScenarioId,
  type ProviderId,
  type ScenarioConfigState,
} from '../constants/scenarios';

interface ContextSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  /** False until GET /api/settings succeeds; `settings` holds defaults until then. */
  isLoaded: boolean;
  /** Why the initial GET failed, or null. */
  loadError: string | null;
  onRetryLoad: () => void;
  onSave: (settings: Settings) => void;
  isSaving: boolean;
  saveStatus: string;
}

export function saveStatusClass(saveStatus: string): string {
  return saveStatus.includes('✗') ? 'error' : saveStatus.includes('✓') ? 'success' : '';
}

function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = true
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={`settings-section-collapsible ${isOpen ? 'open' : ''}`}>
      <button
        className="section-header-btn"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="section-header-content">
          <span className="section-title">{title}</span>
          {description && <span className="section-description">{description}</span>}
        </div>
        <svg
          className={`chevron-icon ${isOpen ? 'rotated' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div className="section-content" id={contentId}>{children}</div>}
    </div>
  );
}

function FormField({
  label,
  tooltip,
  children
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const fieldId = useId();
  const control = React.Children.map(children, child => {
    if (!React.isValidElement<{ id?: string; 'aria-describedby'?: string }>(child)
      || typeof child.type !== 'string' || !['input', 'select', 'textarea'].includes(child.type)) return child;
    return React.cloneElement(child, { id: fieldId, 'aria-describedby': tooltip ? `${fieldId}-hint` : undefined });
  });
  return (
    <div className="form-field">
      <label className="form-field-label" htmlFor={fieldId}>
        {label}
        {tooltip && (
          <span className="tooltip-trigger" title={tooltip}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
      </label>
      {control}
      {tooltip && <span className="visually-hidden" id={`${fieldId}-hint`}>{tooltip}</span>}
    </div>
  );
}

function ToggleSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <label htmlFor={id} className="toggle-label">{label}</label>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        className={`toggle-switch ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function formatEpochMs(epochMs: number | null | undefined): string {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return 'never';
  return new Date(epochMs).toLocaleString();
}

/** One label/value line in the backup status readout (toggle-row styling). */
function BackupStatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <span className="toggle-label">{label}</span>
      </div>
      <span className="toggle-description">{value}</span>
    </div>
  );
}

/**
 * Live backup status readout (GET /api/backup/status). Rendered inside the
 * Backups CollapsibleSection's content, so it mounts — and fetches — only
 * while the section is open.
 */
function BackupStatusPanel() {
  const { status, isLoading, error } = useBackupStatus();

  if (isLoading) {
    return <span className="toggle-description">Loading backup status...</span>;
  }
  if (error) {
    return <span className="toggle-description">{error}</span>;
  }
  if (!status) return null;

  if (!status.configured) {
    return (
      <span className="toggle-description">
        Backups are not running. Turn on automatic snapshots, save, and restart the worker.
      </span>
    );
  }

  return (
    <div className="toggle-group">
      <BackupStatusRow label="Last snapshot" value={formatEpochMs(status.lastSnapshotAt)} />
      <BackupStatusRow label="Snapshots on disk" value={String(status.snapshotCount ?? 0)} />
      {status.lastError && <BackupStatusRow label="Last error" value={status.lastError} />}
    </div>
  );
}

export function ContextSettingsModal({
  isOpen,
  onClose,
  settings,
  isLoaded,
  loadError,
  onRetryLoad,
  onSave,
  isSaving,
  saveStatus
}: ContextSettingsModalProps) {
  const dialogRef = useDialogFocus(isOpen);
  const [formState, setFormState] = useState<Settings>(settings);
  // From the saved settings, not the form: the field stays editable while a
  // user types any other URL, and read-only for the observer's own endpoint.
  const observerManagesBaseUrl = isClaudeMemObserverBaseUrl(settings.CLAUDE_MEM_OPENROUTER_BASE_URL);

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  const {
    preview,
    isLoading,
    error,
    projects,
    sources,
    selectedSource,
    setSelectedSource,
    selectedProject,
    setSelectedProject
  } = useContextPreview(formState);

  const updateSetting = useCallback((key: keyof Settings, value: string) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateMultipleSettings = useCallback((updates: Partial<Settings>) => {
    setFormState(prev => ({ ...prev, ...updates }));
  }, []);

  const [detectedOllamaModels, setDetectedOllamaModels] = useState<Array<{ name: string; sizeFormatted?: string; parameterSize?: string }>>([]);
  const [isDetectingOllama, setIsDetectingOllama] = useState<boolean>(false);
  const [ollamaDetectError, setOllamaDetectError] = useState<string | null>(null);
  const [isCustomOllamaModel, setIsCustomOllamaModel] = useState<boolean>(false);

  const fetchOllamaModels = useCallback(async (endpointUrl?: string) => {
    const ep = endpointUrl || formState.OLLAMA_ENDPOINT || 'http://localhost:11434';
    setIsDetectingOllama(true);
    setOllamaDetectError(null);
    try {
      const res = await fetch(`/api/settings/ollama/models?endpoint=${encodeURIComponent(ep)}`);
      const data = await res.json() as { available: boolean; models?: Array<{ name: string; sizeFormatted?: string; parameterSize?: string }>; error?: string };
      if (data.available && Array.isArray(data.models)) {
        setDetectedOllamaModels(data.models);
        if (data.models.length > 0) {
          const currentModel = formState.OLLAMA_MODEL?.trim();
          const hasCurrent = currentModel && data.models.some(m => m.name === currentModel);
          if (!hasCurrent && !isCustomOllamaModel) {
            if (!currentModel || currentModel === 'gpt-oss:20b') {
              updateSetting('OLLAMA_MODEL', data.models[0].name);
            } else {
              setIsCustomOllamaModel(true);
            }
          }
        }
      } else {
        setOllamaDetectError(data.error || 'Ollama is unreachable');
      }
    } catch (err: any) {
      setOllamaDetectError(err?.message || 'Failed to detect Ollama models');
    } finally {
      setIsDetectingOllama(false);
    }
  }, [formState.OLLAMA_ENDPOINT, formState.OLLAMA_MODEL, isCustomOllamaModel, updateSetting]);

  useEffect(() => {
    if (isOpen && (formState.OLLAMA_ENDPOINT ?? '') !== '') {
      fetchOllamaModels(formState.OLLAMA_ENDPOINT);
    }
  }, [isOpen, formState.OLLAMA_ENDPOINT]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(() => {
    onSave(formState);
  }, [formState, onSave]);

  const toggleBoolean = useCallback((key: keyof Settings) => {
    const currentValue = formState[key];
    const newValue = currentValue === 'true' ? 'false' : 'true';
    updateSetting(key, newValue);
  }, [formState, updateSetting]);

  const scenariosState: Record<ScenarioId, ScenarioConfigState> = (() => {
    try {
      if (formState.CLAUDE_MEM_SCENARIOS) {
        const parsed = JSON.parse(formState.CLAUDE_MEM_SCENARIOS);
        return {
          'live-observation': { ...DEFAULT_SCENARIOS_STATE['live-observation'], ...parsed['live-observation'] },
          'session-summary': { ...DEFAULT_SCENARIOS_STATE['session-summary'], ...parsed['session-summary'] },
          'semantic-search': { ...DEFAULT_SCENARIOS_STATE['semantic-search'], ...parsed['semantic-search'] },
          'enrichment-format': { ...DEFAULT_SCENARIOS_STATE['enrichment-format'], ...parsed['enrichment-format'] },
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SCENARIOS_STATE;
  })();

  const updateScenario = useCallback((scenarioId: ScenarioId, updates: Partial<ScenarioConfigState>) => {
    setFormState(prev => {
      let currentScenarios: Record<ScenarioId, ScenarioConfigState> = DEFAULT_SCENARIOS_STATE;
      try {
        if (prev.CLAUDE_MEM_SCENARIOS) {
          const parsed = JSON.parse(prev.CLAUDE_MEM_SCENARIOS);
          currentScenarios = {
            'live-observation': { ...DEFAULT_SCENARIOS_STATE['live-observation'], ...parsed['live-observation'] },
            'session-summary': { ...DEFAULT_SCENARIOS_STATE['session-summary'], ...parsed['session-summary'] },
            'semantic-search': { ...DEFAULT_SCENARIOS_STATE['semantic-search'], ...parsed['semantic-search'] },
            'enrichment-format': { ...DEFAULT_SCENARIOS_STATE['enrichment-format'], ...parsed['enrichment-format'] },
          };
        }
      } catch {}

      const nextConfig = { ...currentScenarios[scenarioId], ...updates };
      const nextScenarios = {
        ...currentScenarios,
        [scenarioId]: nextConfig,
      };

      let currentTasks: Record<string, string> = {};
      try {
        if (prev.CLAUDE_MEM_TASKS) {
          currentTasks = JSON.parse(prev.CLAUDE_MEM_TASKS);
        }
      } catch {}

      const def = SCENARIO_DEFINITIONS.find(s => s.id === scenarioId);
      if (def) {
        for (const task of def.tasks) {
          currentTasks[task] = nextConfig.primary;
        }
      }

      return {
        ...prev,
        CLAUDE_MEM_SCENARIOS: JSON.stringify(nextScenarios),
        CLAUDE_MEM_TASKS: JSON.stringify(currentTasks),
        CLAUDE_MEM_PREFER_COST_OPTIMIZATION: 'true',
      };
    });
  }, []);

  const applyPreset = useCallback((preset: 'ollama-all' | 'hybrid' | 'agy-first' | 'claude-cli-first') => {
    let newScenarios: Record<ScenarioId, ScenarioConfigState>;
    if (preset === 'ollama-all') {
      newScenarios = {
        'live-observation': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 12000 },
        'session-summary': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 25000 },
        'semantic-search': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 10000 },
        'enrichment-format': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 10000 },
      };
    } else if (preset === 'hybrid') {
      newScenarios = {
        'live-observation': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 12000 },
        'session-summary': { primary: 'gemini-cli', fallback: 'claude-cli', timeoutMs: 25000 },
        'semantic-search': { primary: 'ollama', fallback: 'gemini-cli', timeoutMs: 10000 },
        'enrichment-format': { primary: 'gemini-cli', fallback: 'ollama', timeoutMs: 10000 },
      };
    } else if (preset === 'agy-first') {
      newScenarios = {
        'live-observation': { primary: 'gemini-cli', fallback: 'claude-cli', timeoutMs: 15000 },
        'session-summary': { primary: 'gemini-cli', fallback: 'claude-cli', timeoutMs: 25000 },
        'semantic-search': { primary: 'gemini-cli', fallback: 'claude-cli', timeoutMs: 12000 },
        'enrichment-format': { primary: 'gemini-cli', fallback: 'claude-cli', timeoutMs: 12000 },
      };
    } else {
      newScenarios = {
        'live-observation': { primary: 'claude-cli', fallback: 'gemini-cli', timeoutMs: 15000 },
        'session-summary': { primary: 'claude-cli', fallback: 'gemini-cli', timeoutMs: 25000 },
        'semantic-search': { primary: 'claude-cli', fallback: 'gemini-cli', timeoutMs: 12000 },
        'enrichment-format': { primary: 'claude-cli', fallback: 'gemini-cli', timeoutMs: 12000 },
      };
    }

    const tasks: Record<string, string> = {};
    for (const def of SCENARIO_DEFINITIONS) {
      for (const t of def.tasks) {
        tasks[t] = newScenarios[def.id].primary;
      }
    }

    const updates: Partial<Settings> = {
      CLAUDE_MEM_SCENARIOS: JSON.stringify(newScenarios),
      CLAUDE_MEM_TASKS: JSON.stringify(tasks),
      CLAUDE_MEM_PROVIDER: newScenarios['live-observation'].primary,
      CLAUDE_MEM_PREFER_COST_OPTIMIZATION: 'true',
    };

    if ((preset === 'ollama-all' || preset === 'hybrid') && !formState.OLLAMA_ENDPOINT) {
      updates.OLLAMA_ENDPOINT = 'http://localhost:11434';
    }

    updateMultipleSettings(updates);
  }, [formState.OLLAMA_ENDPOINT, updateMultipleSettings]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="context-settings-modal" role="dialog" aria-modal="true" aria-labelledby="memory-settings-title" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="settings-heading"><h2 id="memory-settings-title">Settings</h2><p>Choose the context your next session receives.</p></div>
          <div className="header-controls">
            <label className="preview-selector">
              Source:
              <select
                value={selectedSource || ''}
                onChange={(e) => setSelectedSource(e.target.value)}
                disabled={sources.length === 0}
              >
                <option value="">All sources</option>
                {sources.map(source => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
            </label>
            <label className="preview-selector">
              Project:
              <select
                value={selectedProject || ''}
                onChange={(e) => setSelectedProject(e.target.value)}
                disabled={projects.length === 0}
              >
                {projects.map(project => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </label>
            <button
              onClick={onClose}
              className="modal-close-btn"
              title="Close (Esc)"
              aria-label="Close settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body - 2 columns */}
        <div className="modal-body">
          {/* Left column - Terminal Preview */}
          <div className="preview-column">
            <div className="settings-preview-heading"><h3>Saved context preview</h3><p>Preview the saved configuration for the selected source and project.</p></div>
            <div className="preview-content">
              {error ? (
                <div style={{ color: 'var(--color-accent-error)' }}>
                  Error loading preview: {error}
                </div>
              ) : (
                <TerminalPreview content={preview} isLoading={isLoading} />
              )}
            </div>
          </div>

          {/* Right column - Settings Panel. Before the initial load the form
              holds defaults; saving them would overwrite settings.json. */}
          <fieldset className="settings-column" disabled={isSaving || !isLoaded}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {/* Section 1: Loading */}
            <CollapsibleSection
              title="Loading"
              description="How many observations to inject"
            >
              <FormField
                label="Observations"
                tooltip="Number of recent observations to include in context (1-200)"
              >
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={formState.CLAUDE_MEM_CONTEXT_OBSERVATIONS || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_OBSERVATIONS', e.target.value || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS)}
                />
              </FormField>
              <ToggleSwitch
                id="session-start-all-sources"
                label="Include all sources at session start"
                description="Show observations from Claude, Codex, and other harnesses in startup context"
                checked={formState.CLAUDE_MEM_SESSION_START_INCLUDE_ALL_SOURCES === 'true'}
                onChange={() => toggleBoolean('CLAUDE_MEM_SESSION_START_INCLUDE_ALL_SOURCES')}
              />
              <FormField
                label="Sessions"
                tooltip="Number of recent sessions to pull observations from (1-50)"
              >
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formState.CLAUDE_MEM_CONTEXT_SESSION_COUNT || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SESSION_COUNT}
                  onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_SESSION_COUNT', e.target.value || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SESSION_COUNT)}
                />
              </FormField>
            </CollapsibleSection>

            {/* Section 2: Display */}
            <CollapsibleSection
              title="Display"
              description="What to show in context tables"
            >
              <div className="display-subsection">
                <span className="subsection-label">Full Observations</span>
                <FormField
                  label="Count"
                  tooltip="How many observations show expanded details (0-20)"
                >
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_COUNT || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_FULL_COUNT}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_COUNT', e.target.value || DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_FULL_COUNT)}
                  />
                </FormField>
                <FormField
                  label="Field"
                  tooltip="Which field to expand for full observations"
                >
                  <select
                    value={formState.CLAUDE_MEM_CONTEXT_FULL_FIELD || 'narrative'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CONTEXT_FULL_FIELD', e.target.value)}
                  >
                    <option value="narrative">Narrative</option>
                    <option value="facts">Facts</option>
                  </select>
                </FormField>
              </div>

              <div className="display-subsection">
                <span className="subsection-label">Token Economics</span>
                <div className="toggle-group">
                  <ToggleSwitch
                    id="show-read-tokens"
                    label="Read cost"
                    description="Tokens to read this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-work-tokens"
                    label="Work investment"
                    description="Tokens spent creating this observation"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS')}
                  />
                  <ToggleSwitch
                    id="show-savings-amount"
                    label="Savings"
                    description="Total tokens saved by reusing context"
                    checked={formState.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT === 'true'}
                    onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT')}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* Section 3: Backups */}
            <CollapsibleSection
              title="Backups"
              description="Automatic snapshots of your memory database"
              defaultOpen={false}
            >
              <div className="toggle-group">
                <ToggleSwitch
                  id="backup-enabled"
                  label="Automatic snapshots"
                  description="Snapshot the database on a schedule (restart the worker to apply)"
                  checked={formState.CLAUDE_MEM_BACKUP_ENABLED === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_BACKUP_ENABLED')}
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <FormField
                  label="Interval (hours)"
                  tooltip="Hours between automatic snapshots (1-168)"
                >
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={formState.CLAUDE_MEM_BACKUP_INTERVAL_HOURS || '24'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_BACKUP_INTERVAL_HOURS', e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Snapshots to keep"
                  tooltip="How many local snapshots to retain before old ones are deleted (1-100)"
                >
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formState.CLAUDE_MEM_BACKUP_RETAIN_COUNT || '7'}
                    onChange={(e) => updateSetting('CLAUDE_MEM_BACKUP_RETAIN_COUNT', e.target.value)}
                  />
                </FormField>
              </div>

              <div className="display-subsection" style={{ marginTop: '12px' }}>
                <span className="subsection-label">Status</span>
                <BackupStatusPanel />
              </div>

              <div style={{ marginTop: '12px' }}>
                <span className="toggle-description">
                  Restore from a snapshot: <code>npx claude-mem restore &lt;file&gt;</code>
                </span>
              </div>
            </CollapsibleSection>

            {/* Section 4: Providers & System Settings */}
            <CollapsibleSection
              title="Providers & System Settings"
              description="Configure AI providers for observations and distillation tasks"
              defaultOpen={false}
            >
              <FormField
                label="AI Provider"
                tooltip="Choose the provider that generates observations: Claude (via Agent SDK), Gemini (via REST API), OpenRouter (also used by the claude-mem observer), Codex (your ChatGPT subscription), OpenAI-compatible endpoint, Ollama, Antigravity CLI, or supported generic CLIs"
              >
                <select
                  value={formState.CLAUDE_MEM_PROVIDER || 'claude'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_PROVIDER', e.target.value)}
                >
                  <option value="claude">{claudeProviderOptionLabel(formState.CLAUDE_MEM_CLAUDE_AUTH_METHOD)}</option>
                  <option value="gemini">Gemini (uses API key)</option>
                  <option value="openrouter">OpenRouter / claude-mem observer</option>
                  <option value="codex">Codex (uses your ChatGPT subscription)</option>
                  <option value="openai-compatible">OpenAI-compatible endpoint (BYOK)</option>
                  <option value="ollama">Ollama (local, no API key needed)</option>
                  <option value="gemini-cli">Antigravity CLI (agy)</option>
                  <option value="claude-cli">Claude CLI</option>
                  <option value="codex-cli">Codex CLI</option>
                  <option value="copilot-cli">Copilot CLI</option>
                  <option value="opencode-cli">OpenCode CLI</option>
                  <option value="thermis-cli">Thermis CLI</option>
                </select>
              </FormField>

              {formState.CLAUDE_MEM_PROVIDER === 'ollama' && (
                <p style={{ fontSize: '0.85em', color: '#666', margin: '4px 0 8px' }}>
                  Using Ollama endpoint and model configured below in Local/Free Providers.
                </p>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'gemini-cli' && (
                <p style={{ fontSize: '0.85em', color: '#666', margin: '4px 0 8px' }}>
                  Using Antigravity CLI binary and model configured below in Local/Free Providers.
                </p>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'claude' && (
                <>
                  <FormField
                    label="Claude Model"
                    tooltip="Claude model used for generating observations"
                  >
                    <select
                      value={formState.CLAUDE_MEM_MODEL || 'haiku'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_MODEL', e.target.value)}
                    >
                      <option value="haiku">haiku (fastest)</option>
                      <option value="sonnet">sonnet (balanced)</option>
                      <option value="opus">opus (highest quality)</option>
                    </select>
                  </FormField>
                  <FormField
                    label="Claude Auth Method"
                    tooltip="Records which Claude credential this install uses: your Claude account login (subscription), an ANTHROPIC_API_KEY (api-key), a custom ANTHROPIC_BASE_URL endpoint (gateway), or Claude Code's own credentials (cli). The credential itself comes from ~/.claude-mem/.env: an ANTHROPIC_BASE_URL or ANTHROPIC_API_KEY there is used even when this says subscription. Shared with the Quota Fallback Claude option."
                  >
                    <select
                      value={formState.CLAUDE_MEM_CLAUDE_AUTH_METHOD || 'subscription'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_CLAUDE_AUTH_METHOD', e.target.value)}
                    >
                      <option value="subscription">subscription (Claude account login)</option>
                      <option value="api-key">api-key (ANTHROPIC_API_KEY)</option>
                      <option value="gateway">gateway (custom endpoint + token)</option>
                      <option value="cli">cli (Claude Code credentials)</option>
                    </select>
                  </FormField>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'codex' && (
                <FormField
                  label="Codex Model"
                  tooltip="Optional model available through your Codex subscription; leave empty for the Codex default. Run codex login before starting the worker."
                >
                  <input
                    type="text"
                    value={formState.CLAUDE_MEM_CODEX_MODEL || ''}
                    onChange={(e) => updateSetting('CLAUDE_MEM_CODEX_MODEL', e.target.value)}
                    placeholder="Codex default (e.g. gpt-6-luna)"
                  />
                </FormField>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'gemini' && (
                <>
                  <FormField
                    label="Gemini API Key"
                    tooltip="Your Google AI Studio API key (or set GEMINI_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_GEMINI_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_API_KEY', e.target.value)}
                      placeholder="Enter Gemini API key..."
                    />
                  </FormField>
                  <FormField
                    label="Gemini Model"
                    tooltip="Gemini model used for generating observations"
                  >
                    <select
                      value={formState.CLAUDE_MEM_GEMINI_MODEL || 'gemini-flash-latest'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_MODEL', e.target.value)}
                    >
                      <option value="gemini-flash-latest">gemini-flash-latest (default, latest GA Flash)</option>
                      <option value="gemini-flash-lite-latest">gemini-flash-lite-latest (latest GA Flash-Lite)</option>
                      <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                      <option value="gemini-3-flash-preview">gemini-3-flash-preview (preview)</option>
                    </select>
                  </FormField>
                  <div className="toggle-group" style={{ marginTop: '8px' }}>
                    <ToggleSwitch
                      id="gemini-rate-limiting"
                      label="Rate Limiting"
                      description="Enable for free tier (10-30 RPM). Disable if you have billing set up (1000+ RPM)."
                      checked={formState.CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED === 'true'}
                      onChange={(checked) => updateSetting('CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED', checked ? 'true' : 'false')}
                    />
                  </div>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'openrouter' && (
                <>
                  <FormField
                    label="OpenRouter API Key"
                    tooltip="Your OpenRouter API key from openrouter.ai (or set OPENROUTER_API_KEY env var)"
                  >
                    <input
                      type="password"
                      value={formState.CLAUDE_MEM_OPENROUTER_API_KEY || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_API_KEY', e.target.value)}
                      placeholder="Enter OpenRouter API key..."
                    />
                  </FormField>
                  <FormField
                    label="OpenRouter Model"
                    tooltip="Model identifier from openrouter.ai/models (e.g., anthropic/claude-haiku-4.5, google/gemini-2.5-flash)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_MODEL || DEFAULT_SETTINGS.CLAUDE_MEM_OPENROUTER_MODEL}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_MODEL', e.target.value)}
                      placeholder={`e.g., ${DEFAULT_SETTINGS.CLAUDE_MEM_OPENROUTER_MODEL}`}
                    />
                  </FormField>
                  <FormField
                    label="OpenRouter Base URL"
                    tooltip={observerManagesBaseUrl
                      ? 'Managed by the claude-mem observer. Run npx claude-mem install to use your own endpoint.'
                      : 'Optional OpenAI-compatible base URL. Leave blank to use openrouter.ai.'}
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_BASE_URL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_BASE_URL', e.target.value)}
                      placeholder="https://openrouter.ai/api/v1"
                      readOnly={observerManagesBaseUrl}
                    />
                  </FormField>
                  {!observerManagesBaseUrl && (
                    <FormField
                      label="Reasoning effort"
                      tooltip="openrouter.ai only. Empty (the default) sends reasoning off. Set an effort to opt back in. A custom gateway does not get this field until an empty length-truncated reply retries once."
                    >
                      <select
                        value={formState.CLAUDE_MEM_OPENROUTER_REASONING_EFFORT || ''}
                        onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_REASONING_EFFORT', e.target.value)}
                      >
                        <option value="">Off (default)</option>
                        <option value="none">None (reasoning off)</option>
                        <option value="minimal">Minimal</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </FormField>
                  )}
                  <FormField
                    label="Site URL (Optional)"
                    tooltip="Your site URL for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_SITE_URL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_SITE_URL', e.target.value)}
                      placeholder="https://yoursite.com"
                    />
                  </FormField>
                  <FormField
                    label="App Name (Optional)"
                    tooltip="Your app name for OpenRouter analytics (optional)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENROUTER_APP_NAME || 'claude-mem'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENROUTER_APP_NAME', e.target.value)}
                      placeholder="claude-mem"
                    />
                  </FormField>
                </>
              )}

              {formState.CLAUDE_MEM_PROVIDER === 'openai-compatible' && (
                <>
                  <FormField
                    label="Endpoint preset"
                    tooltip="Fills in the base URL and default model; the fields below override it"
                  >
                    <select
                      value={openAICompatPresetOption(formState.CLAUDE_MEM_OPENAI_COMPAT_PRESET).id}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPAT_PRESET', e.target.value)}
                    >
                      {OPENAI_COMPAT_PRESET_OPTIONS.map(preset => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </FormField>
                  {openAICompatPresetOption(formState.CLAUDE_MEM_OPENAI_COMPAT_PRESET).note && (
                    <span className="toggle-description">
                      {openAICompatPresetOption(formState.CLAUDE_MEM_OPENAI_COMPAT_PRESET).note}
                    </span>
                  )}
                  <FormField
                    label="Base URL"
                    tooltip="Leave blank to use the preset's endpoint"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENAI_COMPAT_BASE_URL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPAT_BASE_URL', e.target.value)}
                      placeholder={openAICompatPresetOption(formState.CLAUDE_MEM_OPENAI_COMPAT_PRESET).baseUrl || 'https://my-gateway.example.com/v1'}
                    />
                  </FormField>
                  <FormField
                    label="Model"
                    tooltip="Model id, passed verbatim. Leave blank to use the preset's default"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_OPENAI_COMPAT_MODEL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPAT_MODEL', e.target.value)}
                      placeholder={openAICompatPresetOption(formState.CLAUDE_MEM_OPENAI_COMPAT_PRESET).defaultModel || 'model id'}
                    />
                  </FormField>
                  <FormField
                    label="Reasoning"
                    tooltip="Off (default) sends reasoning disabled so a reasoning model cannot spend the output cap thinking. On leaves it to the endpoint. A server that rejects the field is retried once without it."
                  >
                    <select
                      value={formState.CLAUDE_MEM_OPENAI_COMPAT_REASONING || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_OPENAI_COMPAT_REASONING', e.target.value)}
                    >
                      <option value="">Off (default)</option>
                      <option value="on">On (endpoint decides)</option>
                    </select>
                  </FormField>
                  <span className="toggle-description">
                    The API key is set outside the viewer: <code>CLAUDE_MEM_OPENAI_COMPAT_API_KEY</code> in{' '}
                    <code>~/.claude-mem/settings.json</code>, or <code>OPENAI_COMPAT_API_KEY</code> in{' '}
                    <code>~/.claude-mem/.env</code>. Local servers need none.
                  </span>
                </>
              )}

              <FormField
                label="My Work summary provider"
                tooltip="Generated card wording uses this endpoint. Empty uses OpenRouter only when it is the primary observer provider; any other endpoint, or a fallback key, is not used unless you select its provider here. Explicit provider selection may incur that provider's usual charges."
              >
                <select
                  value={formState.CLAUDE_MEM_WORK_VIEW_COPY_PROVIDER || ''}
                  onChange={(e) => updateSetting('CLAUDE_MEM_WORK_VIEW_COPY_PROVIDER', e.target.value)}
                >
                  <option value="">OpenRouter when it is the primary provider</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="openai-compatible">OpenAI-compatible endpoint</option>
                  <option value="off">Off (recorded wording only)</option>
                </select>
              </FormField>
              <FormField
                label="My Work summary model override"
                tooltip="Optional model id for generated card wording. Empty uses the selected provider's configured model."
              >
                <input
                  type="text"
                  maxLength={200}
                  value={formState.CLAUDE_MEM_WORK_VIEW_COPY_MODEL || ''}
                  onChange={(e) => updateSetting('CLAUDE_MEM_WORK_VIEW_COPY_MODEL', e.target.value)}
                  placeholder="Use the provider's configured model"
                />
              </FormField>

              <FormField
                label="Quota Fallback"
                tooltip="While the selected provider cannot serve (allowance spent, rate limited or over capacity past its retries, unavailable, or repeatedly returning unusable replies), send observation work here until it recovers. Claude (your Anthropic plan) is the default and is used only when a Claude login or key exists. Off: work waits for the provider."
              >
                <select
                  value={formState.CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER || 'claude'}
                  onChange={(e) => updateSetting('CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER', e.target.value)}
                >
                  <option value="claude">{claudeProviderOptionLabel(formState.CLAUDE_MEM_CLAUDE_AUTH_METHOD)}</option>
                  <option value="off">Off (wait for the provider)</option>
                  <option value="gemini">Gemini (uses API key)</option>
                  <option value="openrouter">OpenRouter / claude-mem observer</option>
                  <option value="openai-compatible">OpenAI-compatible endpoint</option>
                </select>
              </FormField>

              {(formState.CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER || 'claude') === 'claude' && (
                <>
                  <FormField
                    label="Claude Auth Method"
                    tooltip="The same CLAUDE_MEM_CLAUDE_AUTH_METHOD setting as the AI Provider's Claude Auth Method. Fallback Claude runs use the same credential, which comes from ~/.claude-mem/.env when an ANTHROPIC_BASE_URL or ANTHROPIC_API_KEY is set there."
                  >
                    <select
                      value={formState.CLAUDE_MEM_CLAUDE_AUTH_METHOD || 'subscription'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_CLAUDE_AUTH_METHOD', e.target.value)}
                    >
                      <option value="subscription">subscription (Claude account login)</option>
                      <option value="api-key">api-key (ANTHROPIC_API_KEY)</option>
                      <option value="gateway">gateway (custom endpoint + token)</option>
                      <option value="cli">cli (Claude Code credentials)</option>
                    </select>
                  </FormField>
                  <FormField
                    label="Fallback Claude Model"
                    tooltip="Claude model for fallback runs only. Blank uses the Claude Model setting and tier routing."
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_QUOTA_FALLBACK_MODEL || ''}
                      onChange={(e) => updateSetting('CLAUDE_MEM_QUOTA_FALLBACK_MODEL', e.target.value)}
                      placeholder="e.g., claude-haiku-4-5-20251001"
                    />
                  </FormField>
                </>
              )}

              <FormField
                label="Claude Credential Fallback"
                tooltip="For a Claude observer: the other credential to run on while the primary one is held for quota, tried before the Quota Fallback provider. Subscription: a spent ANTHROPIC_API_KEY (e.g. credit balance too low) hands over to your Claude Code login, still protected by the quota guard. API key: a login that is spent or paused by the quota guard hands over to ANTHROPIC_FALLBACK_API_KEY in ~/.claude-mem/.env, billed per request. Either returns to the primary once it recovers; neither applies under ANTHROPIC_BASE_URL."
              >
                <select
                  value={formState.CLAUDE_MEM_QUOTA_FALLBACK_AUTH_METHOD || ''}
                  onChange={(e) => updateSetting('CLAUDE_MEM_QUOTA_FALLBACK_AUTH_METHOD', e.target.value)}
                >
                  <option value="">Off (wait for the primary credential)</option>
                  <option value="subscription">Subscription (Claude Code login)</option>
                  <option value="api-key">API key (ANTHROPIC_FALLBACK_API_KEY)</option>
                </select>
              </FormField>

              <FormField
                label="Claude Code CLI path"
                tooltip="Executable path for the Claude Code CLI. File/env only — edit ~/.claude-mem/settings.json or set CLAUDE_CODE_PATH in the environment, then restart the worker."
              >
                <input
                  type="text"
                  value={formState.CLAUDE_CODE_PATH || ''}
                  readOnly
                  disabled
                  placeholder="Auto-detect (set via settings.json or env)"
                />
                <span className="toggle-description">
                  Read-only here. Set <code>CLAUDE_CODE_PATH</code> in <code>~/.claude-mem/settings.json</code> or the environment.
                </span>
              </FormField>

              {/* Scenario-Based Routing & Fallback Policies */}
              <div className="display-subsection">
                <span className="subsection-label">Scenario Routing & Automatic Fallbacks</span>

                <p style={{ fontSize: '0.85em', color: 'var(--color-text-secondary, #57606a)', marginBottom: '12px', lineHeight: '1.4' }}>
                  Group memory distillation tasks into 4 logical scenarios. Each scenario specifies a <strong>Primary</strong> provider, an automatic <strong>Fallback</strong> provider if primary fails or times out, and a failover timeout.
                </p>

                {/* Quick Presets */}
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.8em', fontWeight: 600, color: 'var(--color-text-muted, #8c959f)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Quick Presets
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="save-btn"
                      onClick={() => applyPreset('hybrid')}
                      style={{
                        fontSize: '0.82em',
                        padding: '6px 10px',
                        background: 'var(--color-bg-secondary, #f6f8fa)',
                        color: 'var(--color-text-primary, #24292e)',
                        border: '1px solid var(--color-border, #e1e4e8)',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}
                    >
                      ⭐ Hybrid (Ollama + agy)
                    </button>
                    <button
                      type="button"
                      className="save-btn"
                      onClick={() => applyPreset('ollama-all')}
                      style={{
                        fontSize: '0.82em',
                        padding: '6px 10px',
                        background: 'var(--color-bg-secondary, #f6f8fa)',
                        color: 'var(--color-text-primary, #24292e)',
                        border: '1px solid var(--color-border, #e1e4e8)',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}
                    >
                      🦙 Full Local (Ollama)
                    </button>
                    <button
                      type="button"
                      className="save-btn"
                      onClick={() => applyPreset('agy-first')}
                      style={{
                        fontSize: '0.82em',
                        padding: '6px 10px',
                        background: 'var(--color-bg-secondary, #f6f8fa)',
                        color: 'var(--color-text-primary, #24292e)',
                        border: '1px solid var(--color-border, #e1e4e8)',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}
                    >
                      ✨ Antigravity First
                    </button>
                    <button
                      type="button"
                      className="save-btn"
                      onClick={() => applyPreset('claude-cli-first')}
                      style={{
                        fontSize: '0.82em',
                        padding: '6px 10px',
                        background: 'var(--color-bg-secondary, #f6f8fa)',
                        color: 'var(--color-text-primary, #24292e)',
                        border: '1px solid var(--color-border, #e1e4e8)',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}
                    >
                      🤖 Claude CLI First
                    </button>
                  </div>
                </div>

                {/* 4 Scenario Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                  {SCENARIO_DEFINITIONS.map(sc => {
                    const current = scenariosState[sc.id] || DEFAULT_SCENARIOS_STATE[sc.id];
                    return (
                      <div
                        key={sc.id}
                        style={{
                          border: '1px solid var(--color-border, #e1e4e8)',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          background: 'var(--color-bg-primary, #ffffff)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '0.92em', color: 'var(--color-text-primary, #24292e)' }}>
                              {sc.icon} {sc.title}
                            </span>
                            <p style={{ margin: '2px 0 0', fontSize: '0.8em', color: 'var(--color-text-secondary, #57606a)' }}>
                              {sc.description}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginTop: '10px' }}>
                          {/* Primary */}
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75em', fontWeight: 600, color: 'var(--color-text-muted, #8c959f)', marginBottom: '4px' }}>
                              PRIMARY PROVIDER
                            </label>
                            <select
                              value={current.primary}
                              onChange={(e) => updateScenario(sc.id, { primary: e.target.value as ProviderId })}
                              style={{ width: '100%', fontSize: '0.82em', padding: '6px 8px', borderRadius: '5px', border: '1px solid var(--color-border, #d0d7de)' }}
                            >
                              {PROVIDER_SELECT_OPTIONS.map(opt => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Fallback */}
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75em', fontWeight: 600, color: 'var(--color-text-muted, #8c959f)', marginBottom: '4px' }}>
                              FALLBACK PROVIDER
                            </label>
                            <select
                              value={current.fallback}
                              onChange={(e) => updateScenario(sc.id, { fallback: e.target.value as ProviderId })}
                              style={{ width: '100%', fontSize: '0.82em', padding: '6px 8px', borderRadius: '5px', border: '1px solid var(--color-border, #d0d7de)' }}
                            >
                              <option value="none">🚫 None (Fail immediately)</option>
                              {PROVIDER_SELECT_OPTIONS.map(opt => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Timeout */}
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75em', fontWeight: 600, color: 'var(--color-text-muted, #8c959f)', marginBottom: '4px' }}>
                              TIMEOUT (FAILOVER)
                            </label>
                            <select
                              value={current.timeoutMs}
                              onChange={(e) => updateScenario(sc.id, { timeoutMs: Number(e.target.value) })}
                              style={{ width: '100%', fontSize: '0.82em', padding: '6px 8px', borderRadius: '5px', border: '1px solid var(--color-border, #d0d7de)' }}
                            >
                              <option value={5000}>5s (Ultra fast)</option>
                              <option value={10000}>10s (Fast)</option>
                              <option value={12000}>12s (Default live)</option>
                              <option value={15000}>15s (Standard)</option>
                              <option value={25000}>25s (Extended summary)</option>
                              <option value={40000}>40s (Deep inference)</option>
                              <option value={60000}>60s (Maximum)</option>
                            </select>
                          </div>
                        </div>

                        <div style={{ marginTop: '8px', fontSize: '0.72em', color: 'var(--color-text-muted, #8c959f)' }}>
                          Tasks: {sc.tasks.join(', ')}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Ollama */}
                <div style={{ paddingLeft: '12px', borderLeft: '2px solid #e0e0e0', marginBottom: '12px' }}>
                  <span style={{ fontSize: '0.9em', fontWeight: '500', color: '#666' }}>Ollama</span>
                  <div className="toggle-group" style={{ marginTop: '8px', marginBottom: '8px' }}>
                    <ToggleSwitch
                      id="ollama-enable"
                      label="Enable Ollama"
                      description="Connect to a local Ollama instance for free on-device inference"
                      checked={(formState.OLLAMA_ENDPOINT ?? '') !== ''}
                      onChange={(checked) => {
                        if (!checked) {
                          updateSetting('OLLAMA_ENDPOINT', '');
                        } else {
                          updateSetting('OLLAMA_ENDPOINT', 'http://localhost:11434');
                        }
                      }}
                    />
                  </div>
                  {(formState.OLLAMA_ENDPOINT ?? '') !== '' && (
                    <>
                      <FormField
                        label="Endpoint URL"
                        tooltip="Base URL of your Ollama server (e.g., http://localhost:11434)"
                      >
                        <input
                          type="text"
                          value={formState.OLLAMA_ENDPOINT ?? ''}
                          onChange={(e) => updateSetting('OLLAMA_ENDPOINT', e.target.value)}
                          placeholder="http://localhost:11434"
                        />
                      </FormField>
                      <FormField
                        label="Model"
                        tooltip="Installed Ollama model for on-device distillation"
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {!isCustomOllamaModel && detectedOllamaModels.length > 0 ? (
                            <select
                              value={formState.OLLAMA_MODEL || (detectedOllamaModels[0]?.name ?? '')}
                              onChange={(e) => {
                                if (e.target.value === '__custom__') {
                                  setIsCustomOllamaModel(true);
                                } else {
                                  updateSetting('OLLAMA_MODEL', e.target.value);
                                }
                              }}
                              style={{ flex: 1 }}
                            >
                              {detectedOllamaModels.map((m) => (
                                <option key={m.name} value={m.name}>
                                  {m.name} {m.sizeFormatted ? `(${m.sizeFormatted})` : ''}
                                </option>
                              ))}
                              <option value="__custom__">Custom / Type model manually...</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={formState.OLLAMA_MODEL ?? ''}
                              onChange={(e) => updateSetting('OLLAMA_MODEL', e.target.value)}
                              placeholder="e.g. gemma4:latest, llama3.2, mistral"
                              style={{ flex: 1 }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => fetchOllamaModels(formState.OLLAMA_ENDPOINT)}
                            disabled={isDetectingOllama}
                            title="Auto-detect downloaded models on local Ollama"
                            style={{
                              padding: '6px 12px',
                              fontSize: '0.82em',
                              borderRadius: '6px',
                              border: '1px solid var(--color-border, #e1e4e8)',
                              background: 'var(--color-bg-secondary, #f6f8fa)',
                              color: 'var(--color-text-primary, #24292e)',
                              cursor: isDetectingOllama ? 'wait' : 'pointer',
                              whiteSpace: 'nowrap',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            {isDetectingOllama ? 'Scanning...' : 'Detect 🔄'}
                          </button>
                          {isCustomOllamaModel && detectedOllamaModels.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setIsCustomOllamaModel(false)}
                              title="Switch back to detected models dropdown"
                              style={{
                                padding: '6px 10px',
                                fontSize: '0.82em',
                                borderRadius: '6px',
                                border: '1px solid var(--color-border, #e1e4e8)',
                                background: 'var(--color-bg-secondary, #f6f8fa)',
                                color: 'var(--color-text-primary, #24292e)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              List
                            </button>
                          )}
                        </div>
                        {ollamaDetectError && (
                          <p style={{ fontSize: '0.8em', color: '#cf222e', margin: '4px 0 0' }}>
                            ⚠️ {ollamaDetectError}
                          </p>
                        )}
                        {!isCustomOllamaModel && detectedOllamaModels.length > 0 && (
                          <p style={{ fontSize: '0.8em', color: '#1a7f37', margin: '4px 0 0' }}>
                            ✓ Detected {detectedOllamaModels.length} installed Ollama model{detectedOllamaModels.length > 1 ? 's' : ''} on this machine
                          </p>
                        )}
                      </FormField>
                    </>
                  )}
                </div>

                {/* Antigravity CLI */}
                <div style={{ paddingLeft: '12px', borderLeft: '2px solid #e0e0e0' }}>
                  <span style={{ fontSize: '0.9em', fontWeight: '500', color: '#666' }}>Antigravity CLI (agy)</span>
                  <FormField
                    label="Binary Path"
                    tooltip="Path to the agy CLI binary (default: 'agy' on PATH)"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_GEMINI_CLI_BINARY ?? 'agy'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_CLI_BINARY', e.target.value)}
                      placeholder="agy"
                    />
                  </FormField>
                  <FormField
                    label="Model"
                    tooltip="Model to pass to the CLI"
                  >
                    <input
                      type="text"
                      value={formState.CLAUDE_MEM_GEMINI_CLI_MODEL ?? 'Gemini 3.5 Flash (Low)'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_GEMINI_CLI_MODEL', e.target.value)}
                      placeholder="Gemini 3.5 Flash (Low)"
                    />
                  </FormField>
                </div>

                {/* Generic CLIs */}
                {['claude-cli', 'codex-cli', 'copilot-cli', 'opencode-cli', 'thermis-cli'].includes(formState.CLAUDE_MEM_PROVIDER ?? '') && (() => {
                  const providerKey = (formState.CLAUDE_MEM_PROVIDER as string).replace('-', '_').toUpperCase(); // e.g. CLAUDE_CLI
                  const binKey = `CLAUDE_MEM_${providerKey}_BINARY` as keyof Settings;
                  const modKey = `CLAUDE_MEM_${providerKey}_MODEL` as keyof Settings;
                  
                  return (
                    <div style={{ paddingLeft: '12px', borderLeft: '2px solid #e0e0e0', marginTop: '12px' }}>
                      <span style={{ fontSize: '0.9em', fontWeight: '500', color: '#666' }}>{formState.CLAUDE_MEM_PROVIDER} Config</span>
                      <FormField
                        label="Binary Path"
                        tooltip="Command to execute this CLI"
                      >
                        <input
                          type="text"
                          value={formState[binKey] ?? ''}
                          onChange={(e) => updateSetting(binKey, e.target.value)}
                        />
                      </FormField>
                      <FormField
                        label="Model"
                        tooltip="Model to pass to the CLI"
                      >
                        <input
                          type="text"
                          value={formState[modKey] ?? ''}
                          onChange={(e) => updateSetting(modKey, e.target.value)}
                        />
                      </FormField>
                    </div>
                  );
                })()}
                {/* Work View & Background Tasks Agent */}
                <div style={{ marginTop: '16px', padding: '12px', background: 'var(--color-bg-secondary, #f6f8fa)', borderRadius: '6px', border: '1px solid var(--color-border, #e1e4e8)' }}>
                  <span style={{ fontSize: '0.95em', fontWeight: '600', color: 'var(--color-text-primary, #24292e)' }}>
                    Work View & Background Tasks Agent
                  </span>
                  <p style={{ fontSize: '0.8em', color: '#666', marginTop: '4px', marginBottom: '8px' }}>
                    Choose which CLI agent processes background tasks (My Work cards, task grouping, goal refresh).
                  </p>
                  <FormField
                    label="Preferred Agent"
                    tooltip="Select the CLI tool used for background Work View tasks"
                  >
                    <select
                      value={formState.CLAUDE_MEM_WORK_VIEW_AGENT ?? 'auto'}
                      onChange={(e) => updateSetting('CLAUDE_MEM_WORK_VIEW_AGENT', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border, #d0d7de)',
                        background: 'var(--color-canvas-default, #fff)',
                        color: 'var(--color-text-primary, #24292e)'
                      }}
                    >
                      <option value="auto">⚡ Auto (Antigravity CLI → Claude Code → Codex)</option>
                      <option value="antigravity-cli">✨ Antigravity CLI (agy) - Active Subscription</option>
                      <option value="claude-code">🤖 Claude Code CLI</option>
                      <option value="codex">💻 Codex CLI</option>
                      <option value="disabled">🚫 Disabled (Never run background tasks)</option>
                    </select>
                  </FormField>

                  <div className="toggle-group" style={{ marginTop: '10px' }}>
                    <ToggleSwitch
                      id="work-view-auto-refresh"
                      label="Enable Auto-Refresh"
                      description="Automatically refresh Work View tasks every 10 minutes using the preferred agent above"
                      checked={(formState.CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH ?? 'true') !== 'false'}
                      onChange={(checked) => updateSetting('CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH', checked ? 'true' : 'false')}
                    />
                  </div>
                </div>
              </div>

              <FormField
                label="Worker Port"
                tooltip="Port for the background worker service"
              >
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={formState.CLAUDE_MEM_WORKER_PORT || DEFAULT_SETTINGS.CLAUDE_MEM_WORKER_PORT}
                  onChange={(e) => updateSetting('CLAUDE_MEM_WORKER_PORT', e.target.value)}
                />
              </FormField>

              <div className="toggle-group" style={{ marginTop: '12px' }}>
                <ToggleSwitch
                  id="show-last-summary"
                  label="Include last summary"
                  description="Add previous session's summary to context"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY')}
                />
                <ToggleSwitch
                  id="show-last-message"
                  label="Include last message"
                  description="Add previous session's final message"
                  checked={formState.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE === 'true'}
                  onChange={() => toggleBoolean('CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE')}
                />
                <ToggleSwitch
                  id="file-read-gate"
                  label="Block full-file reads"
                  description="Send Claude to smart_outline/smart_unfold and past observations instead of reading whole code files of 32 KB and up that have history"
                  checked={formState.CLAUDE_MEM_FILE_READ_GATE_ENABLED !== 'false'}
                  onChange={(checked) => updateSetting('CLAUDE_MEM_FILE_READ_GATE_ENABLED', checked ? 'true' : 'false')}
                />
              </div>
            </CollapsibleSection>
          </fieldset>
        </div>

        {/* Footer with Save button */}
        <div className="modal-footer">
          <div className="save-status" role="status" aria-live="polite">
            {loadError ? (
              <span className="error" role="alert">
                {loadError}{' '}
                <button type="button" onClick={onRetryLoad}>Retry</button>
              </span>
            ) : !isLoaded ? (
              <span>Loading settings…</span>
            ) : (
              saveStatus && <span className={saveStatusClass(saveStatus)}>{saveStatus}</span>
            )}
          </div>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={isSaving || !isLoaded}
          >
            {isSaving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
