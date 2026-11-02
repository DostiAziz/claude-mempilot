import { dirname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs'];

/**
 * Resolves an import specifier (e.g. './SessionStore', '../utils/logger.js')
 * relative to the importing file and project root directory.
 */
export function resolveImportPath(
  sourceFilePath: string,
  rawSpecifier: string,
  projectRoot?: string
): string | null {
  const trimmed = rawSpecifier.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;

  // External package imports (e.g. 'express', 'node:fs', 'react')
  if (!trimmed.startsWith('.') && !trimmed.startsWith('/')) {
    return `pkg:${trimmed}`;
  }

  const sourceDir = dirname(sourceFilePath);
  const resolvedRelative = normalize(join(sourceDir, trimmed));

  // If projectRoot is provided, test physical existence
  if (projectRoot) {
    const fullBasePath = join(projectRoot, resolvedRelative);

    // 1. Exact match
    if (existsSync(fullBasePath)) {
      return resolvedRelative;
    }

    // 2. Probing extensions (.ts, .tsx, .js, etc.)
    for (const ext of PROBE_EXTENSIONS) {
      if (existsSync(`${fullBasePath}${ext}`)) {
        return `${resolvedRelative}${ext}`;
      }
    }

    // 3. Probing directory index (index.ts, __init__.py, etc.)
    for (const ext of PROBE_EXTENSIONS) {
      const indexCandidate = join(fullBasePath, `index${ext}`);
      if (existsSync(indexCandidate)) {
        return join(resolvedRelative, `index${ext}`);
      }
    }

    const pyInit = join(fullBasePath, '__init__.py');
    if (existsSync(pyInit)) {
      return join(resolvedRelative, '__init__.py');
    }
  }

  // Fallback heuristic: strip existing extension or append .ts
  return resolvedRelative;
}

/**
 * Extracts imported symbols from a raw import line.
 * e.g. "import { SessionStore, User } from './SessionStore.js'" -> ["SessionStore", "User"]
 * e.g. "import express from 'express'" -> ["express"]
 * e.g. "from os.path import join, dirname" -> ["join", "dirname"]
 */
export function extractImportedSymbols(importStatement: string): { specifier: string; symbols: string[] } {
  const line = importStatement.trim();

  // Python: from X import A, B
  const pyFromMatch = line.match(/^from\s+([^\s]+)\s+import\s+(.+)$/);
  if (pyFromMatch) {
    const specifier = pyFromMatch[1];
    const symbols = pyFromMatch[2]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    return { specifier, symbols: symbols.length > 0 ? symbols : ['*'] };
  }

  // Python: import X
  const pyImportMatch = line.match(/^import\s+([^\s]+)$/);
  if (pyImportMatch) {
    return { specifier: pyImportMatch[1], symbols: ['*'] };
  }

  // TS/JS: import ... from 'specifier'
  const tsFromMatch = line.match(/import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/);
  if (tsFromMatch) {
    const clause = tsFromMatch[1].trim();
    const specifier = tsFromMatch[2].trim();
    const symbols: string[] = [];

    // Named imports: { A, B as C }
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const named = namedMatch[1]
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      symbols.push(...named);
    }

    // Default import: import Foo from '...' or import Foo, { Bar } from '...'
    const defaultPart = clause.replace(/\{[^}]+\}/, '').replace(/,/g, '').trim();
    if (defaultPart && !defaultPart.startsWith('*')) {
      symbols.push(defaultPart);
    } else if (defaultPart.startsWith('*')) {
      symbols.push('*');
    }

    return { specifier, symbols: symbols.length > 0 ? symbols : ['*'] };
  }

  // CommonJS: const { A, B } = require('specifier') or const A = require('specifier')
  const cjsMatch = line.match(/(?:const|let|var)\s+(.+?)\s*=\s*require\(['"]([^'"]+)['"]\)/);
  if (cjsMatch) {
    const clause = cjsMatch[1].trim();
    const specifier = cjsMatch[2].trim();
    const symbols: string[] = [];

    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const named = namedMatch[1]
        .split(',')
        .map(s => s.trim().split(/:/)[0].trim())
        .filter(Boolean);
      symbols.push(...named);
    } else {
      symbols.push(clause);
    }

    return { specifier, symbols: symbols.length > 0 ? symbols : ['*'] };
  }

  // Fallback: extract any string between quotes as specifier
  const quoteMatch = line.match(/['"]([^'"]+)['"]/);
  return {
    specifier: quoteMatch ? quoteMatch[1] : line,
    symbols: ['*'],
  };
}
