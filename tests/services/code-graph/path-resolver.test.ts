import { describe, it, expect } from 'bun:test';
import { extractImportedSymbols, resolveImportPath } from '../../../src/services/code-graph/PathResolver.js';

describe('PathResolver', () => {
  describe('extractImportedSymbols', () => {
    it('extracts named TypeScript imports', () => {
      const res = extractImportedSymbols("import { SessionStore, User as UserModel } from './SessionStore.js';");
      expect(res.specifier).toBe('./SessionStore.js');
      expect(res.symbols).toEqual(['SessionStore', 'User']);
    });

    it('extracts default TypeScript imports', () => {
      const res = extractImportedSymbols("import express from 'express';");
      expect(res.specifier).toBe('express');
      expect(res.symbols).toEqual(['express']);
    });

    it('extracts Python from-import statements', () => {
      const res = extractImportedSymbols("from app.models import User, Order as UserOrder");
      expect(res.specifier).toBe('app.models');
      expect(res.symbols).toEqual(['User', 'Order']);
    });

    it('extracts CommonJS destructuring requires', () => {
      const res = extractImportedSymbols("const { readFileSync, existsSync } = require('node:fs');");
      expect(res.specifier).toBe('node:fs');
      expect(res.symbols).toEqual(['readFileSync', 'existsSync']);
    });

    it('extracts multi-line and type-only TypeScript imports', () => {
      const multiLine = `
import {
  type SessionStore,
  User as UserModel
} from './SessionStore.js';
`;
      const res = extractImportedSymbols(multiLine);
      expect(res.specifier).toBe('./SessionStore.js');
      expect(res.symbols).toEqual(['SessionStore', 'User']);

      const typeOnly = "import type { AppError } from '../errors.js';";
      const resType = extractImportedSymbols(typeOnly);
      expect(resType.specifier).toBe('../errors.js');
      expect(resType.symbols).toEqual(['AppError']);
    });

    it('extracts re-exports', () => {
      const reExport = "export { DatabaseManager, SessionStore } from './db.js';";
      const res = extractImportedSymbols(reExport);
      expect(res.specifier).toBe('./db.js');
      expect(res.symbols).toEqual(['DatabaseManager', 'SessionStore']);
    });
  });

  describe('resolveImportPath', () => {
    it('marks non-relative imports as package references', () => {
      expect(resolveImportPath('src/foo.ts', 'express')).toBe('pkg:express');
      expect(resolveImportPath('src/foo.ts', 'node:path')).toBe('pkg:node:path');
    });

    it('normalizes relative file paths without projectRoot', () => {
      expect(resolveImportPath('src/services/code-graph/AstExtractor.ts', './PathResolver.js'))
        .toBe('src/services/code-graph/PathResolver.js');
      expect(resolveImportPath('src/services/code-graph/AstExtractor.ts', '../sqlite/SessionStore.js'))
        .toBe('src/services/sqlite/SessionStore.js');
    });

    it('handles Python multi-dot relative imports', () => {
      expect(resolveImportPath('app/services/auth.py', '...utils.helper'))
        .toBe('utils/helper');
      expect(resolveImportPath('app/services/auth.py', '.helper'))
        .toBe('app/services/helper');
      expect(resolveImportPath('app/services/auth.py', '..models.user'))
        .toBe('app/models/user');
    });
  });
});
