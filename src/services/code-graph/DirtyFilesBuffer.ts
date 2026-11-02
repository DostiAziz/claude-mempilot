import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { AstExtractorService } from './AstExtractorService.js';
import type { BlastRadiusNode, CodeImpactReport } from './types.js';

export interface DirtyFileEntry {
  filePath: string;
  projectId: string;
  projectRoot: string;
  lastEditedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class DirtyFilesBuffer {
  private dirtyFiles = new Map<string, DirtyFileEntry>();
  private readonly cooldownMs: number;
  private readonly extractor: AstExtractorService;

  constructor(
    private db: Database,
    cooldownMs = 7000,
    extractor?: AstExtractorService
  ) {
    this.cooldownMs = cooldownMs;
    this.extractor = extractor || new AstExtractorService();
  }

  /**
   * Called by file-edit/observation hooks when a file is modified.
   */
  public markDirty(filePath: string, projectId: string, projectRoot: string): void {
    const key = `${projectId}:${filePath}`;
    const existing = this.dirtyFiles.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      void this.commitFile(key);
    }, this.cooldownMs);
    timer.unref?.();

    this.dirtyFiles.set(key, {
      filePath,
      projectId,
      projectRoot,
      lastEditedAt: Date.now(),
      timer,
    });
  }

  /**
   * Flushes all pending dirty files immediately (e.g. at Turn-End / Stop hook).
   */
  public async flushAll(): Promise<void> {
    const keys = Array.from(this.dirtyFiles.keys());
    for (const key of keys) {
      const entry = this.dirtyFiles.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        await this.commitFile(key);
      }
    }
  }

  /**
   * Commits a single dirty file to the SQLite Code Graph.
   */
  public async commitFile(key: string): Promise<boolean> {
    const entry = this.dirtyFiles.get(key);
    if (!entry) return false;
    this.dirtyFiles.delete(key);

    const fullPath = entry.filePath.startsWith('/')
      ? entry.filePath
      : `${entry.projectRoot}/${entry.filePath}`;

    if (!existsSync(fullPath)) {
      // File was deleted: purge symbols and edges
      this.purgeFileSymbols(entry.projectId, entry.filePath);
      return true;
    }

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      return false;
    }

    // 1. Content Hashing & Revert Detection
    const currentSha256 = createHash('sha256').update(content).digest('hex');
    const lastHash = this.getLastIndexedHash(entry.projectId, entry.filePath);

    if (lastHash === currentSha256) {
      logger.debug('CODEGRAPH', `Reversion or zero-diff detected for ${entry.filePath}; aborting write`, {
        projectId: entry.projectId,
      });
      return false; // Zero SQLite operations performed!
    }

    // 2. Syntax Validation Gate
    const result = this.extractor.extract(entry.filePath, content, entry.projectId, entry.projectRoot);
    if (result.diagnostics.hasErrors) {
      logger.warn('CODEGRAPH', `Syntax error detected in ${entry.filePath}; postponing graph indexing`, {
        filePath: entry.filePath,
      });
      return false; // Preserve existing valid graph state
    }

    // 3. Atomic SQLite Transaction
    this.persistFileGraph(entry.projectId, entry.filePath, currentSha256, result.symbols, result.edges);
    return true;
  }

  public getLastIndexedHash(projectId: string, filePath: string): string | null {
    try {
      const row = this.db.prepare(
        'SELECT content_hash FROM code_symbols WHERE project_id = ? AND file_path = ? LIMIT 1'
      ).get(projectId, filePath) as { content_hash: string } | undefined;
      return row?.content_hash ?? null;
    } catch {
      return null;
    }
  }

  private purgeFileSymbols(projectId: string, filePath: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM code_symbols WHERE project_id = ? AND file_path = ?').run(projectId, filePath);
      this.db.prepare('DELETE FROM code_edges WHERE project_id = ? AND source_file = ?').run(projectId, filePath);
    })();
  }

  private persistFileGraph(
    projectId: string,
    filePath: string,
    contentHash: string,
    symbols: any[],
    edges: any[]
  ): void {
    const now = Date.now();
    this.db.transaction(() => {
      // Purge prior records for this file
      this.db.prepare('DELETE FROM code_symbols WHERE project_id = ? AND file_path = ?').run(projectId, filePath);
      this.db.prepare('DELETE FROM code_edges WHERE project_id = ? AND source_file = ?').run(projectId, filePath);

      const insertSymbol = this.db.prepare(`
        INSERT OR REPLACE INTO code_symbols (
          project_id, file_path, symbol_name, symbol_kind,
          start_line, end_line, signature, docstring, content_hash, updated_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const sym of symbols) {
        insertSymbol.run(
          projectId,
          filePath,
          sym.symbolName,
          sym.symbolKind,
          sym.startLine,
          sym.endLine,
          sym.signature || null,
          sym.docstring || null,
          contentHash,
          now
        );
      }

      const insertEdge = this.db.prepare(`
        INSERT OR IGNORE INTO code_edges (
          project_id, source_file, source_symbol, target_file, target_symbol, edge_kind, created_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const edge of edges) {
        insertEdge.run(
          projectId,
          filePath,
          edge.sourceSymbol,
          edge.targetFile || null,
          edge.targetSymbol,
          edge.edgeKind,
          now
        );
      }
    })();
  }

  /**
   * Computes reverse blast radius (callers that depend on targetSymbol).
   */
  public getBlastRadius(
    projectId: string,
    targetSymbol: string,
    targetFile?: string,
    maxDepth = 2
  ): BlastRadiusNode[] {
    const hasTargetFile = typeof targetFile === 'string' && targetFile.length > 0;
    const query = `
      WITH RECURSIVE blast_radius(depth, file, symbol, relation) AS (
        SELECT 1, source_file, source_symbol, edge_kind
        FROM code_edges
        WHERE project_id = ? 
          AND target_symbol = ?
          ${hasTargetFile ? 'AND (target_file = ? OR target_file IS NULL OR target_file = "*")' : ''}
        
        UNION
        
        SELECT br.depth + 1, e.source_file, e.source_symbol, e.edge_kind
        FROM code_edges e
        JOIN blast_radius br 
          ON (e.target_file = br.file OR e.target_file IS NULL OR e.target_file = '*') AND e.target_symbol = br.symbol
        WHERE e.project_id = ? AND br.depth < ?
      )
      SELECT depth, file, symbol, relation, count(*) as referenceCount
      FROM blast_radius
      GROUP BY depth, file, symbol, relation
      ORDER BY depth ASC, referenceCount DESC
    `;

    try {
      const stmt = this.db.prepare(query);
      const params = hasTargetFile
        ? [projectId, targetSymbol, targetFile, projectId, maxDepth]
        : [projectId, targetSymbol, projectId, maxDepth];
      return stmt.all(...params) as BlastRadiusNode[];
    } catch {
      return [];
    }
  }

  /**
   * Computes outward dependencies (symbols/files that sourceSymbol depends on).
   */
  public getOutwardDependencies(
    projectId: string,
    sourceSymbol: string,
    sourceFile?: string
  ): BlastRadiusNode[] {
    const hasSourceFile = typeof sourceFile === 'string' && sourceFile.length > 0;
    const query = `
      SELECT 1 as depth, COALESCE(target_file, '*') as file, target_symbol as symbol, edge_kind as relation, count(*) as referenceCount
      FROM code_edges
      WHERE project_id = ?
        AND source_symbol = ?
        ${hasSourceFile ? 'AND source_file = ?' : ''}
      GROUP BY target_file, target_symbol, edge_kind
      ORDER BY referenceCount DESC
    `;

    try {
      const stmt = this.db.prepare(query);
      const params = hasSourceFile ? [projectId, sourceSymbol, sourceFile] : [projectId, sourceSymbol];
      return stmt.all(...params) as BlastRadiusNode[];
    } catch {
      return [];
    }
  }

  /**
   * Generates a comprehensive Code Impact Report with both structural blast radius
   * and linked episodic decisions.
   */
  public getCodeImpactReport(
    projectId: string,
    symbolName: string,
    filePath?: string
  ): CodeImpactReport {
    const directCallers = this.getBlastRadius(projectId, symbolName, filePath, 2);
    const outwardDependencies = this.getOutwardDependencies(projectId, symbolName, filePath);

    // Query linked decisions
    let linkedDecisions: CodeImpactReport['linkedDecisions'] = [];
    try {
      const decQuery = `
        SELECT d.id as decisionId, d.topic, d.choice, d.reason, f.name as featureTitle
        FROM symbol_decision_links sdl
        JOIN code_symbols cs ON sdl.symbol_id = cs.id
        JOIN decisions d ON sdl.decision_id = d.id
        LEFT JOIN features f ON sdl.feature_id = f.id
        WHERE cs.project_id = ? AND cs.symbol_name = ?
        ORDER BY d.id DESC
      `;
      linkedDecisions = this.db.prepare(decQuery).all(projectId, symbolName) as any[];
    } catch {
      linkedDecisions = [];
    }

    return {
      symbolName,
      filePath,
      directCallers,
      outwardDependencies,
      linkedDecisions,
    };
  }
}

let defaultDirtyBuffer: DirtyFilesBuffer | null = null;

export function getDirtyFilesBuffer(db?: Database): DirtyFilesBuffer | null {
  if (!defaultDirtyBuffer && db) {
    defaultDirtyBuffer = new DirtyFilesBuffer(db);
  }
  return defaultDirtyBuffer;
}

