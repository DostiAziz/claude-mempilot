#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const codexPluginPath = path.join(rootDir, '.codex-plugin', 'plugin.json');
const bundledCodexPluginPath = path.join(rootDir, 'plugin', '.codex-plugin', 'plugin.json');
const claudePluginPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
const bundledClaudePluginPath = path.join(rootDir, 'plugin', '.claude-plugin', 'plugin.json');
const marketplacePath = path.join(rootDir, '.claude-plugin', 'marketplace.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function syncCodexPlugin(plugin, pkg) {
  const author =
    typeof plugin.author === 'object' && plugin.author ? plugin.author : {};

  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...author,
      name: normalizeAuthorName(pkg.author),
    },
    interface: {
      ...plugin.interface,
      developerName: normalizeAuthorName(pkg.author),
      websiteURL: normalizeRepositoryUrl(pkg.repository),
    },
  };
}

function syncClaudePlugin(plugin, pkg) {
  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...(typeof plugin.author === 'object' && plugin.author ? plugin.author : {}),
      name: normalizeAuthorName(pkg.author),
    },
  };
}

function normalizeAuthorName(author) {
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object' && typeof author.name === 'string') return author.name;
  return '';
}

/**
 * The marketplace manifest advertises the plugin under an id that MUST match
 * plugin/.claude-plugin/plugin.json — Claude Code keys the install, the
 * enabledPlugins entry, skill prefixes, and MCP server names off it. Those two
 * files had already drifted apart (`claude-mem` vs `mempilot`) precisely
 * because only plugin.json was generated, so generate both from package.json
 * and let the mismatch become unrepresentable.
 *
 * Only the entry whose `source` points at this repo's ./plugin is rewritten;
 * any other plugin the marketplace happens to list is left alone.
 */
function syncMarketplace(marketplace, pkg) {
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  return {
    ...marketplace,
    plugins: plugins.map((plugin) =>
      plugin && plugin.source === './plugin'
        ? { ...plugin, name: pkg.name, version: pkg.version, description: pkg.description }
        : plugin
    ),
  };
}

function normalizeRepositoryUrl(repository) {
  if (typeof repository === 'string') return repository.replace(/\.git$/, '');
  if (repository && typeof repository === 'object' && typeof repository.url === 'string')
    return repository.url.replace(/\.git$/, '');
  return '';
}

function main() {
  for (const filePath of [packageJsonPath, codexPluginPath, bundledCodexPluginPath, claudePluginPath, bundledClaudePluginPath, marketplacePath]) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing required file: ${filePath}`);
      process.exit(1);
    }
  }

  const pkg = readJson(packageJsonPath);
  const codexPlugin = readJson(codexPluginPath);
  const bundledCodexPlugin = readJson(bundledCodexPluginPath);
  const claudePlugin = readJson(claudePluginPath);
  const bundledClaudePlugin = readJson(bundledClaudePluginPath);
  const marketplace = readJson(marketplacePath);

  writeJson(codexPluginPath, syncCodexPlugin(codexPlugin, pkg));
  writeJson(bundledCodexPluginPath, syncCodexPlugin(bundledCodexPlugin, pkg));
  writeJson(claudePluginPath, syncClaudePlugin(claudePlugin, pkg));
  writeJson(bundledClaudePluginPath, syncClaudePlugin(bundledClaudePlugin, pkg));
  writeJson(marketplacePath, syncMarketplace(marketplace, pkg));

  console.log(`✓ Synced plugin manifests + marketplace from package.json (${pkg.name}@${pkg.version})`);
}

main();
