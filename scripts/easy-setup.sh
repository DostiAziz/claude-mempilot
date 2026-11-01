#!/usr/bin/env bash
set -e

# ==============================================================================
# Mempilot: Universal Agentic Memory - Easy Setup Script
# ==============================================================================
# This script sets up Mempilot on a fresh system (macOS / Linux / WSL),
# checks prerequisites, compiles bundles, links the CLI, and runs the installer.
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "\n${BOLD}${CYAN}====================================================${NC}"
echo -e "${BOLD}${CYAN}       🧠 Welcome to Mempilot Setup Wizard          ${NC}"
echo -e "${BOLD}${CYAN}   Universal Cross-Session Memory for Coding Agents ${NC}"
echo -e "${BOLD}${CYAN}====================================================${NC}\n"

# 1. Check Node.js
echo -e "${BOLD}[1/5] Checking Node.js environment...${NC}"
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}✗ Node.js is not installed.${NC}"
    echo -e "Please install Node.js >= 20 from https://nodejs.org or via your package manager."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo -e "${YELLOW}! Detected Node.js v$NODE_VERSION. Mempilot works best with Node.js >= 20.${NC}"
else
    echo -e "${GREEN}✓ Node.js v$NODE_VERSION detected.${NC}"
fi

# 2. Check Bun runtime
echo -e "\n${BOLD}[2/5] Checking Bun runtime...${NC}"
if ! command -v bun >/dev/null 2>&1; then
    echo -e "${YELLOW}! Bun is not installed in PATH.${NC}"
    echo -e "Mempilot background daemon uses Bun for ultra-fast, lightweight performance."
    read -p "Would you like to install Bun automatically now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${CYAN}Installing Bun...${NC}"
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
        if command -v bun >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Bun installed successfully: $(bun --version)${NC}"
        else
            echo -e "${YELLOW}! Bun installed to $HOME/.bun/bin. Please reload your shell after setup.${NC}"
        fi
    else
        echo -e "${YELLOW}Proceeding without Bun. Note that runtime background service requires Bun.${NC}"
    fi
else
    echo -e "${GREEN}✓ Bun $(bun --version) detected.${NC}"
fi

# 3. Install project dependencies
echo -e "\n${BOLD}[3/5] Installing package dependencies...${NC}"
if command -v bun >/dev/null 2>&1; then
    bun install
else
    npm install
fi
echo -e "${GREEN}✓ Dependencies installed.${NC}"

# 4. Build plugin bundles & CLI
echo -e "\n${BOLD}[4/5] Building Mempilot bundles and CLI...${NC}"
npm run build
echo -e "${GREEN}✓ Build completed successfully.${NC}"

# Link CLI globally so 'mempilot' command is available anywhere
echo -e "Linking 'mempilot' CLI globally..."
npm link || sudo npm link || echo -e "${YELLOW}! npm link failed; you can still run via 'node ./dist/npx-cli/index.js' or 'npx mempilot'${NC}"

# 5. Launch Agent Configuration
echo -e "\n${BOLD}[5/5] Launching Agent Configuration...${NC}"
echo -e "${CYAN}Mempilot will now detect your installed coding agents (Claude Code, Antigravity, Codex, Cursor, etc.).${NC}"
echo -e "${CYAN}Select which ones to configure:${NC}\n"

if command -v mempilot >/dev/null 2>&1; then
    mempilot install "$@"
else
    node ./dist/npx-cli/index.js install "$@"
fi

echo -e "\n${BOLD}${GREEN}====================================================${NC}"
echo -e "${BOLD}${GREEN}          🎉 Mempilot Setup Complete!               ${NC}"
echo -e "${BOLD}${GREEN}====================================================${NC}"
echo -e "Next steps:"
echo -e "  • Web Dashboard & Settings: ${CYAN}http://localhost:37701/viewer${NC}"
echo -e "  • Check system health:      ${CYAN}mempilot doctor${NC}"
echo -e "  • Antigravity CLI status:   ${CYAN}mempilot antigravity-cli status${NC}"
echo -e "  • Search memories:          ${CYAN}mempilot search \"your search query\"${NC}"
echo -e "  • Restart daemon:           ${CYAN}mempilot restart${NC}\n"
