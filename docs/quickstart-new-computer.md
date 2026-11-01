# Mempilot Quickstart: New Computer & New System Setup

This guide walks you through setting up **Mempilot** on a fresh computer (macOS, Linux, or Windows WSL) and configuring it seamlessly with any AI coding agent — including **Google Antigravity (`agy`)**, **Claude Code**, **OpenAI Codex**, **Cursor**, **Windsurf**, and any other agentic coding system.

---

## ⚡ 1-Minute Automated Setup

On your new computer:

```bash
# 1. Clone the repository
git clone https://github.com/your-username/claude-mempilot.git mempilot
cd mempilot

# 2. Run the automated setup wizard
npm run setup
```

The setup wizard will:
1. Verify **Node.js** (>= 20) and offer to install **Bun** if missing.
2. Install all dependencies.
3. Build the core bundles, hooks, and CLI tools.
4. Globally link the `mempilot` CLI to your system `$PATH`.
5. Run the interactive agent discovery wizard so you can enable memory for all your installed coding agents.
6. Start the local background worker daemon on `http://127.0.0.1:37701`.

---

## 🛠️ Prerequisites

| Requirement | Supported Versions | Verification Command | Installation / Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>= 20.19.0` or `>= 22.12.0` | `node -v` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| **Bun** | `>= 1.1.31` | `bun -v` | `curl -fsSL https://bun.sh/install \| bash` |
| **Git** | Any modern version | `git --version` | Standard system tool |
| **Ollama** *(Optional)* | Any recent version | `ollama -v` | [ollama.com](https://ollama.com) (for 100% free offline memory models) |

---

## 🤖 Configuring Your Coding Agents

Mempilot supports multi-agent setups simultaneously. You can configure any agent using the commands below:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          MEMPILOT CORE ENGINE                          │
│         Local Background Worker Daemon (http://127.0.0.1:37701)        │
└──────┬───────────────┬────────────────┬───────────────┬────────────────┘
       │               │                │               │
       ▼               ▼                ▼               ▼
┌──────────────┐┌───────────────┐┌──────────────┐┌──────────────┐
│  Antigravity ││  Claude Code  ││  Codex CLI   ││ Cursor / IDE │
│  (AGY / IDE) ││   (Anthropic) ││   (OpenAI)   ││  & Windsurf  │
└──────────────┘└───────────────┘└──────────────┘└──────────────┘
```

---

### 1. Google Antigravity & Antigravity CLI (`agy`)

Antigravity uses Protobuf protojson for its lifecycle hooks and local MCP server configurations:

* **Automated Setup** (accepts `antigravity`, `agy`, or `antigravity-cli`):
  ```bash
  mempilot antigravity-cli install
  # or:
  mempilot install --ide agy
  ```

* **What it configures**:
  * **Lifecycle Hooks**: Registered in `~/.gemini/config/hooks.json` (`SessionStart`, `PreInvocation`, `PostToolUse`, `PostInvocation`, `Stop`).
  * **Protojson Safety**: Automatically responds with `{"decision":"allow"}` on `PreToolUse` so agent actions are never blocked, and `{}` for clean no-ops.
  * **MCP Servers**: Registered in `~/.gemini/antigravity/mcp_config.json` and `~/.gemini/config/mcp_config.json`.
  * **Context Guidelines**: Injected into `~/.gemini/GEMINI.md` and `~/.agents/rules/claude-mem-context.md`.

* **Verification**:
  ```bash
  mempilot antigravity-cli status
  ```

---

### 2. Claude Code

* **Automated Setup** (accepts `claude-code`, `claudecode-cli`, `claude`, or `claudecode`):
  ```bash
  mempilot install --ide claudecode-cli
  # or:
  mempilot install --ide claude-code
  ```

* **What it configures**:
  * Registers the Mempilot plugin in `~/.claude/settings.json`.
  * Sets up shell-free lifecycle hooks (`mempilot hook claude-code <event>`).
  * Preserves context in `CLAUDE.md`.

* **Alternative via Claude Code CLI**:
  ```bash
  /plugin marketplace add thedotmack/claude-mem
  /plugin install claude-mem
  ```

---

### 3. OpenAI Codex CLI

* **Automated Setup** (accepts `codex-cli` or `codex`):
  ```bash
  mempilot install --ide codex-cli
  # or:
  mempilot install --ide codex
  ```

* **What it configures**:
  * Registers native hooks in `~/.codex/` via `plugin/hooks/codex-hooks.json`.
  * Context injection maintained in `~/.codex/AGENTS.md` and repository `AGENTS.md`.

---

### 4. Cursor & Windsurf

* **Cursor** (accepts `cursor` or `cursor-cli`):
  ```bash
  mempilot install --ide cursor-cli
  # or:
  mempilot install --ide cursor
  ```
  Configures Cursor hooks and stdio MCP server in `~/.cursor/mcp.json`, linking context via `.cursorrules`.

* **Windsurf**:
  ```bash
  mempilot install --ide windsurf
  ```
  Configures hooks in `~/.codeium/windsurf/` and rule integration in `.windsurf/rules/`.

---

### 5. GitHub Copilot CLI

* **Automated Setup** (accepts `copilot-cli` or `copilot`):
  ```bash
  mempilot install --ide copilot-cli
  # or:
  mempilot install --ide copilot
  ```
  Configures Copilot CLI MCP server in `~/.github/copilot/mcp.json` and context in `.github/copilot-instructions.md`.

---

### 5. OpenCode, Hermes Agent, Pi, DeepSeek Harness (DSH), OMP

Mempilot has native adapters for open-source agent runtimes:

```bash
mempilot install --ide opencode   # OpenCode 1.3.4+ / OpenCode 2
mempilot install --ide hermes     # Hermes Agent
mempilot install --ide pi         # Pi Coding Agent
mempilot install --ide dsh        # DeepSeek Harness
mempilot install --ide omp        # Oh My Pi (OMP)
```

---

### 6. Any Generic MCP-Enabled Agent (Roo Code, Goose, GitHub Copilot CLI, Warp)

For any coding tool supporting Model Context Protocol (MCP), add Mempilot as a standard stdio server:

```json
{
  "mcpServers": {
    "mempilot": {
      "command": "mempilot",
      "args": ["mcp"]
    }
  }
}
```

---

## 🧠 Configuring LLM Providers & Scenario Routing

Mempilot runs background memory distillation (summarizing steps, extracting decisions, tracking features, and pruning noise). You can configure your model providers in the **Web Dashboard**:

👉 Open your browser to: **`http://localhost:37701/viewer`**

Click the ⚙️ **Settings** icon to configure:

### Option A: Local & Offline via Ollama (100% Free & Private)
1. Install Ollama from [ollama.com](https://ollama.com).
2. Pull your preferred coding model, e.g.:
   ```bash
   ollama pull qwen2.5-coder:7b
   # or:
   ollama pull llama3.1:8b
   ```
3. Mempilot features **Automatic Ollama Discovery** — it detects running models on `http://127.0.0.1:11434` with zero manual configuration. Select your model from the dropdown.

### Option B: Antigravity CLI (`agy`) / Gemini CLI
* Uses your local Antigravity CLI binary (`agy`) to run distillation with zero cloud API keys.

### Option C: Cloud Providers (Anthropic Claude or OpenRouter)
* Enter your Anthropic or OpenRouter API key directly in the Settings modal for high-capacity cloud models (Claude 3.5 Sonnet, Haiku, GPT-4o, etc.).

---

### Scenario-Based Routing & Automatic Fallback

Mempilot groups memory tasks into 4 logical scenarios:

1. **⚡ Live Tool Observations (`live-observation`)**: Distills raw tool outputs and extracts decisions.
2. **📝 Session Summaries & Reports (`session-summary`)**: Compresses entire coding sessions into structured changelogs and feature updates.
3. **🔍 Semantic Search & Embeddings (`semantic-search`)**: Vector indexing for relevant cross-session memory recall.
4. **🏷️ Formatting & Concept Enrichment (`enrichment-format`)**: Metadata enrichment and todo formatting.

Each scenario allows you to set:
* **Primary Provider**: e.g., Local `ollama`
* **Fallback Provider**: e.g., `gemini-cli` or `claude-cli`
* **Timeout Threshold**: e.g., 10s–25s

If your primary model times out or is offline, Mempilot automatically delegates the task to the fallback without interrupting your coding flow!

---

## 🩺 System Diagnostics & Health Checks

Verify your setup at any time using the built-in diagnostic commands:

```bash
# 1. Full system health audit (bun, uv, tree-sitter, hooks, worker daemon)
mempilot doctor

# 2. Worker daemon status (port, uptime, PID)
mempilot status

# 3. Antigravity CLI integration audit
mempilot antigravity-cli status

# 4. Test memory search across past sessions
mempilot search "project configuration"

# 5. Restart daemon if configuration changes
mempilot restart
```

---

## ❓ Frequently Asked Questions (FAQ)

### Q: Does Mempilot compete with my coding agent's native memory?
**No.** Mempilot operates at the lifecycle hook level, compressing observations in the background and injecting only high-relevance distilled context (decisions, active todos, architecture changes) into your session.

### Q: Can I run Mempilot completely offline without an internet connection?
**Yes.** Set your primary provider to `ollama` with a local model (e.g. `qwen2.5-coder:7b`). All embeddings and memory distillations remain 100% on your machine.

### Q: What if I switch between Antigravity, Claude Code, and Cursor on the same project?
Mempilot provides **unified cross-agent memory**. A feature planned in Antigravity or a bug investigated in Claude Code is immediately remembered when you open the same project in Cursor or Codex!
