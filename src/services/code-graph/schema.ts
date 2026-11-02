import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export const CODE_GRAPH_SCHEMA_VERSION = 72;

/**
 * Migration v72: Native In-Process Code Knowledge Graph
 * Establishes structural code symbols, dependency/call edges, and
 * links bridging symbols to episodic decisions and features.
 */
export function ensureCodeGraphSchema(db: Database): void {
  db.transaction(() => {
    const applied = db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(CODE_GRAPH_SCHEMA_VERSION);
    if (applied) return;

    db.exec(`
      -- 1. Structural Code Symbols Table
      CREATE TABLE IF NOT EXISTS code_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        symbol_kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT,
        docstring TEXT,
        content_hash TEXT NOT NULL,
        updated_at_epoch INTEGER NOT NULL,
        UNIQUE(project_id, file_path, symbol_name, symbol_kind)
      );

      -- 2. Structural Code Dependency & Invocation Edges Table
      CREATE TABLE IF NOT EXISTS code_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        source_file TEXT NOT NULL,
        source_symbol TEXT NOT NULL,
        target_file TEXT,
        target_symbol TEXT NOT NULL,
        edge_kind TEXT NOT NULL CHECK(edge_kind IN ('imports', 'calls', 'extends', 'implements', 'references')),
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(project_id, source_file, source_symbol, target_file, target_symbol, edge_kind)
      );

      -- 3. Episodic-to-Structural Semantic Bridge (Linking Symbols to Decisions & Features)
      CREATE TABLE IF NOT EXISTS symbol_decision_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_id INTEGER NOT NULL REFERENCES code_symbols(id) ON DELETE CASCADE,
        decision_id INTEGER REFERENCES decisions(id) ON DELETE CASCADE,
        feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'modified' CHECK(relation_type IN ('introduced', 'modified', 'deprecated', 'referenced')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(symbol_id, decision_id, feature_id)
      );

      -- Indexes for sub-2ms seeks
      CREATE INDEX IF NOT EXISTS idx_code_symbols_file 
        ON code_symbols(project_id, file_path);

      CREATE INDEX IF NOT EXISTS idx_code_symbols_name 
        ON code_symbols(project_id, symbol_name);

      CREATE INDEX IF NOT EXISTS idx_code_edges_forward_seek 
        ON code_edges(project_id, source_file, source_symbol);

      CREATE INDEX IF NOT EXISTS idx_code_edges_reverse_seek 
        ON code_edges(project_id, target_file, target_symbol);

      CREATE INDEX IF NOT EXISTS idx_code_edges_source_file 
        ON code_edges(project_id, source_file);

      CREATE INDEX IF NOT EXISTS idx_sym_dec_symbol 
        ON symbol_decision_links(symbol_id);

      CREATE INDEX IF NOT EXISTS idx_sym_dec_decision 
        ON symbol_decision_links(decision_id);

      CREATE INDEX IF NOT EXISTS idx_sym_dec_feature 
        ON symbol_decision_links(feature_id);
    `);

    db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(
      CODE_GRAPH_SCHEMA_VERSION,
      new Date().toISOString()
    );

    logger.info('MIGRATION', `Applied migration v${CODE_GRAPH_SCHEMA_VERSION}: Code Knowledge Graph schema initialized`);
  })();
}
