import { describe, it, expect } from 'bun:test';
import { AstExtractorService } from '../../../src/services/code-graph/AstExtractorService.js';

describe('AstExtractorService', () => {
  const service = new AstExtractorService();

  it('extracts TypeScript classes, methods, imports, and call edges', () => {
    const code = `
import { SessionStore } from './SessionStore.js';
import { logger } from '../../utils/logger.js';

export class CodeGraphManager {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  public async syncFile(filePath: string): Promise<void> {
    logger.info('Syncing file: ' + filePath);
    this.recordMetric();
  }

  private recordMetric(): void {
    // metric logic
  }
}
`;

    const res = service.extract('src/services/code-graph/CodeGraphManager.ts', code, 'test-project');
    expect(res.diagnostics.hasErrors).toBe(false);
    expect(res.contentHash).toBeDefined();

    // Check symbols
    const symbolNames = res.symbols.map(s => s.symbolName);
    expect(symbolNames).toContain('CodeGraphManager');
    expect(symbolNames).toContain('CodeGraphManager.syncFile');
    expect(symbolNames).toContain('CodeGraphManager.recordMetric');

    // Check import edges
    const importEdges = res.edges.filter(e => e.edgeKind === 'imports');
    expect(importEdges.some(e => e.targetSymbol === 'SessionStore')).toBe(true);
    expect(importEdges.some(e => e.targetSymbol === 'logger')).toBe(true);

    // Check call edges (e.g. recordMetric called inside syncFile)
    const callEdges = res.edges.filter(e => e.edgeKind === 'calls');
    expect(callEdges.some(e => e.sourceSymbol === 'CodeGraphManager.syncFile' && e.targetSymbol === 'CodeGraphManager.recordMetric')).toBe(true);
  });

  it('extracts Python functions, classes, and from-imports', () => {
    const pyCode = `
from os.path import join, dirname
import sys

def compute_hash(data: str) -> str:
    """Computes a SHA-256 hash."""
    return data

class ServiceRunner:
    def run(self):
        compute_hash("hello")
`;

    const res = service.extract('app/runner.py', pyCode, 'test-project');
    expect(res.diagnostics.hasErrors).toBe(false);

    const symbolNames = res.symbols.map(s => s.symbolName);
    expect(symbolNames).toContain('compute_hash');
    expect(symbolNames).toContain('ServiceRunner');
    expect(symbolNames).toContain('ServiceRunner.run');

    const importEdges = res.edges.filter(e => e.edgeKind === 'imports');
    expect(importEdges.some(e => e.targetSymbol === 'join')).toBe(true);
    expect(importEdges.some(e => e.targetSymbol === 'dirname')).toBe(true);
  });
});
