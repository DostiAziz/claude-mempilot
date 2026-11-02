import { dirname, join, normalize } from 'node:path/posix';
import { existsSync } from 'node:fs';

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs'];

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Resolves an import specifier (e.g. './SessionStore', '../utils/logger.js')
 * relative to the importing file and project root directory.
 */
export function resolveImportPath(
  sourceFilePath: string,
  rawSpecifier: string,
  projectRoot?: string
): string | null {
  let trimmed = rawSpecifier.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;

  // External package imports (e.g. 'express', 'node:fs', 'react')
  if (!trimmed.startsWith('.') && !trimmed.startsWith('/')) {
    return `pkg:${trimmed}`;
  }

  const sourceDir = toPosix(dirname(sourceFilePath));

  // Handle Python relative imports (e.g. .helper, ..utils, ...core.models)
  let resolvedRelative: string;
  if (sourceFilePath.endsWith('.py') && trimmed.startsWith('.')) {
    const match = trimmed.match(/^(\.+)(.*)$/);
    if (match) {
      const leadingDots = match[1].length;
      const rest = match[2].replace(/\./g, '/');
      const upLevels = leadingDots - 1;
      let targetDir = sourceDir;
      for (let i = 0; i < upLevels; i++) {
        targetDir = dirname(targetDir);
      }
      const full = rest ? (targetDir === '.' ? rest : `${targetDir}/${rest}`) : targetDir;
      resolvedRelative = toPosix(normalize(full));
    } else {
      resolvedRelative = toPosix(normalize(join(sourceDir, trimmed)));
    }
  } else {
    resolvedRelative = toPosix(normalize(trimmed.startsWith('/') ? trimmed.slice(1) : join(sourceDir, trimmed)));
  }

  // If projectRoot is provided, test physical existence
  if (projectRoot) {
    const fullBasePath = toPosix(join(projectRoot, resolvedRelative));

    // 1. Exact match
    if (existsSync(fullBasePath)) {
      return resolvedRelative;
    }

    // 2. TypeScript ESM: strip .js / .mjs / .cjs and probe for .ts / .tsx source files
    const strippedExt = resolvedRelative.replace(/\.(js|mjs|cjs)$/, '');
    if (strippedExt !== resolvedRelative) {
      const fullStripped = toPosix(join(projectRoot, strippedExt));
      for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
        if (existsSync(`${fullStripped}${ext}`)) {
          return `${strippedExt}${ext}`;
        }
      }
    }

    // 3. Probing extensions (.ts, .tsx, .js, etc.)
    for (const ext of PROBE_EXTENSIONS) {
      if (existsSync(`${fullBasePath}${ext}`)) {
        return `${resolvedRelative}${ext}`;
      }
    }

    // 4. Probing directory index (index.ts, __init__.py, etc.)
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

  // Fallback heuristic
  return resolvedRelative;
}

/**
 * Extracts imported and re-exported symbols from a raw import/export line.
 * e.g. "import { SessionStore, User } from './SessionStore.js'" -> ["SessionStore", "User"]
 * e.g. "import express from 'express'" -> ["express"]
 * e.g. "from os.path import join, dirname" -> ["join", "dirname"]
 * e.g. "export { A, B } from './foo.js'" -> ["A", "B"]
 */
export function extractImportedSymbols(importStatement: string): { specifier: string; symbols: string[] } {
  // Normalize multi-line statements into a single line
  const line = importStatement.replace(/\r?\n/g, ' ').trim();

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

  // TS/JS: (import|export) ... from 'specifier'
  const tsFromMatch = line.match(/(?:import|export)\s+(.+?)\s+from\s+['"]([^'"]+)['"]/);
  if (tsFromMatch) {
    let clause = tsFromMatch[1].trim();
    const specifier = tsFromMatch[2].trim();
    const symbols: string[] = [];

    // Strip top-level 'type ' prefix (e.g. import type { Foo })
    if (clause.startsWith('type ')) {
      clause = clause.slice(5).trim();
    }

    // Named imports/exports: { A, type B, C as D }
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const named = namedMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
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
