export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'impl'
  | 'const'
  | 'variable'
  | 'export'
  | 'namespace';

export type EdgeRelation =
  | 'imports'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'defines'
  | 'references';

export type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface CodeLocation {
  line: number;    // 1-indexed
  column: number;  // 0-indexed
}

export interface CodeRange {
  start: CodeLocation;
  end: CodeLocation;
}

export interface CodeSymbol {
  id?: number;              // Database primary key ID (optional when in-flight)
  projectId: string;
  filePath: string;         // Relative path from project root
  symbolName: string;       // Leaf identifier name (e.g. "saveMemory")
  symbolKind: SymbolKind;
  startLine: number;
  endLine: number;
  signature?: string | null;
  docstring?: string | null;
  contentHash: string;
  updatedAtEpoch: number;
}

export interface CodeEdge {
  id?: number;              // Database primary key ID
  projectId: string;
  sourceFile: string;
  sourceSymbol: string;
  targetFile?: string | null;
  targetSymbol: string;
  edgeKind: EdgeRelation;
  createdAtEpoch: number;
}

export interface SymbolDecisionLink {
  id?: number;
  symbolId: number;
  decisionId?: number | null;
  featureId: number;
  relationType: 'introduced' | 'modified' | 'deprecated' | 'referenced';
  createdAt?: string;
}

export interface AstExtractionResult {
  filePath: string;
  language: string;
  contentHash: string;
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  diagnostics: {
    hasErrors: boolean;
    errorCount: number;
    errorRatio: number;
    parseDurationMs: number;
  };
}

export interface BlastRadiusNode {
  depth: number;
  file: string;
  symbol: string;
  relation: EdgeRelation;
  referenceCount: number;
}

export interface CodeImpactReport {
  symbolName: string;
  filePath?: string;
  directCallers: BlastRadiusNode[];
  outwardDependencies: BlastRadiusNode[];
  linkedDecisions: Array<{
    decisionId: number;
    topic: string;
    choice: string;
    reason: string;
    featureTitle?: string;
  }>;
}
