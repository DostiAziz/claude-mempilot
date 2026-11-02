import { createHash } from 'node:crypto';
import { parseFile, type CodeSymbol as ParsedSymbol, type FoldedFile } from '../smart-file-read/parser.js';
import { extractImportedSymbols, resolveImportPath } from './PathResolver.js';
import type { AstExtractionResult, CodeEdge, CodeSymbol, SymbolKind } from './types.js';

export class AstExtractorService {
  /**
   * Extracts structural symbols and dependency edges from a source file.
   */
  public extract(
    filePath: string,
    content: string,
    projectId: string,
    projectRoot?: string
  ): AstExtractionResult {
    const startTime = Date.now();
    const contentHash = createHash('sha256').update(content).digest('hex');

    // 1. Parse AST using existing resilient Tree-Sitter subsystem
    let parsed: FoldedFile;
    try {
      parsed = parseFile(content, filePath);
    } catch {
      return {
        filePath,
        language: 'unknown',
        contentHash,
        symbols: [],
        edges: [],
        diagnostics: {
          hasErrors: true,
          errorCount: 1,
          errorRatio: 1.0,
          parseDurationMs: Date.now() - startTime,
        },
      };
    }

    const isCodeFile = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cpp|c|h|swift)$/.test(filePath);
    const hasSyntaxErrors =
      isCodeFile &&
      parsed.symbols.length === 0 &&
      content.trim().length > 120 &&
      !content.trim().startsWith('//') &&
      !content.trim().startsWith('/*');

    if (hasSyntaxErrors) {
      return {
        filePath,
        language: parsed.language,
        contentHash,
        symbols: [],
        edges: [],
        diagnostics: {
          hasErrors: true,
          errorCount: 1,
          errorRatio: 1.0,
          parseDurationMs: Date.now() - startTime,
        },
      };
    }

    // 2. Flatten and map symbols
    const symbols: CodeSymbol[] = [];
    const now = Date.now();

    const flattenSymbol = (sym: ParsedSymbol, parentName?: string) => {
      const symbolName = parentName ? `${parentName}.${sym.name}` : sym.name;
      const mappedKind: SymbolKind = this.normalizeKind(sym.kind);

      symbols.push({
        projectId,
        filePath,
        symbolName,
        symbolKind: mappedKind,
        startLine: sym.lineStart,
        endLine: sym.lineEnd,
        signature: sym.signature || null,
        docstring: sym.jsdoc || null,
        contentHash,
        updatedAtEpoch: now,
      });

      if (sym.children && sym.children.length > 0) {
        for (const child of sym.children) {
          flattenSymbol(child, sym.name);
        }
      }
    };

    for (const topSymbol of parsed.symbols) {
      flattenSymbol(topSymbol);
    }

    // 3. Extract import edges
    const edges: CodeEdge[] = [];
    const importedSymbolMap = new Map<string, string>(); // symbol -> targetFile

    for (const impLine of parsed.imports) {
      const { specifier, symbols: importedSymbols } = extractImportedSymbols(impLine);
      const targetFile = resolveImportPath(filePath, specifier, projectRoot);

      for (const sym of importedSymbols) {
        if (targetFile) {
          importedSymbolMap.set(sym, targetFile);
        }

        edges.push({
          projectId,
          sourceFile: filePath,
          sourceSymbol: '*',
          targetFile,
          targetSymbol: sym,
          edgeKind: 'imports',
          createdAtEpoch: now,
        });
      }
    }

    // 4. Extract function/method call references
    const lines = content.split(/\r?\n/);
    for (const sym of symbols) {
      if (sym.symbolKind === 'function' || sym.symbolKind === 'method') {
        const bodyLines = lines.slice(sym.startLine - 1, sym.endLine).join('\n');
        
        // Scan for calls to imported symbols
        for (const [importedSym, targetFile] of importedSymbolMap.entries()) {
          if (importedSym === '*') continue;
          // Look for direct call pattern: importedSym(...)
          const callRegex = new RegExp(`\\b${importedSym}\\s*\\(`, 'g');
          if (callRegex.test(bodyLines)) {
            edges.push({
              projectId,
              sourceFile: filePath,
              sourceSymbol: sym.symbolName,
              targetFile,
              targetSymbol: importedSym,
              edgeKind: 'calls',
              createdAtEpoch: now,
            });
          }
        }

        // Scan for calls to other sibling symbols in the same file
        for (const sibling of symbols) {
          if (sibling.symbolName === sym.symbolName) continue;
          const leafName = sibling.symbolName.split('.').pop()!;
          const callRegex = new RegExp(`\\b${leafName}\\s*\\(`, 'g');
          if (callRegex.test(bodyLines)) {
            edges.push({
              projectId,
              sourceFile: filePath,
              sourceSymbol: sym.symbolName,
              targetFile: filePath,
              targetSymbol: sibling.symbolName,
              edgeKind: 'calls',
              createdAtEpoch: now,
            });
          }
        }
      }
    }

    return {
      filePath,
      language: parsed.language,
      contentHash,
      symbols,
      edges,
      diagnostics: {
        hasErrors: false,
        errorCount: 0,
        errorRatio: 0,
        parseDurationMs: Date.now() - startTime,
      },
    };
  }

  private normalizeKind(kind: string): SymbolKind {
    switch (kind) {
      case 'function':
      case 'class':
      case 'method':
      case 'interface':
      case 'type':
      case 'struct':
      case 'enum':
      case 'trait':
      case 'impl':
      case 'const':
      case 'variable':
      case 'export':
      case 'namespace':
        return kind as SymbolKind;
      default:
        return 'variable';
    }
  }
}
