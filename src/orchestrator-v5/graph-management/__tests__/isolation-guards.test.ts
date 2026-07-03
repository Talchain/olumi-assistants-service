/**
 * Track 3 — isolation / import-boundary guards (AST-driven, TypeScript compiler API).
 *
 * Enforces the hard import boundary (Paul #1):
 *  - production module files may import ONLY local files, the four sanctioned seam
 *    targets, and the external `zod`;
 *  - NO production file imports a hash-derivation function (graph-hash.js is NOT
 *    allowlisted — the hash arrives via the frame);
 *  - NO production file imports `mergeMutatedGraphForPersistence` (it shares a
 *    module with the allowed `applyAndValidateMutation`, so a named-import ban is
 *    required — the persistence merge seam is exercised ONLY by merge-parity fixtures);
 *  - NO dynamic import()/require();
 *  - the referee never mutates its input graph (zero persistence, off-path).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { refereeMutation } from '../referee.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..'); // src/orchestrator-v5/graph-management

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
function collectModuleSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      out.push(...collectModuleSourceFiles(join(dir, ent.name)));
    } else if (SOURCE_EXT.test(ent.name)) {
      out.push(join(dir, ent.name));
    }
  }
  return out;
}
const moduleFiles = collectModuleSourceFiles(moduleDir);

/** The ONLY cross-boundary seam targets a production file may import from. NOTE:
 *  graph-hash.js is DELIBERATELY absent — Track 3 consumes the hash via the frame. */
const ALLOWED_RESOLVED = new Set(
  [
    '../tools/handlers/d1-shared/apply-graph-mutation.js',
    '../tools/handlers/d1-shared/errors.js',
    '../tools/handlers/analysis-ready-core.js',
    '../../schemas/cee-v3.js',
  ].map((s) => resolve(moduleDir, s)),
);

/** External bare specifiers permitted in production (pure libs, no live-path coupling). */
const EXTERNAL_ALLOWED = new Set(['zod']);

/** Named imports that must NEVER appear in a production module file. */
const BANNED_NAMED_IMPORTS = new Set(['mergeMutatedGraphForPersistence']);

interface ScanResult {
  specifiers: string[];
  hasDynamic: boolean;
  named: { module: string; name: string }[];
}

function scanImports(file: string): ScanResult {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const named: { module: string; name: string }[] = [];
  let hasDynamic = false;

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const mod = node.moduleSpecifier.text;
      specifiers.push(mod);
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const el of node.importClause.namedBindings.elements) {
          named.push({ module: mod, name: el.propertyName?.text ?? el.name.text });
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        hasDynamic = true;
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specifiers, hasDynamic, named };
}

function importAllowed(fileDir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return EXTERNAL_ALLOWED.has(spec); // bare/external — only the allowlist
  const resolved = resolve(fileDir, spec);
  if (resolved === moduleDir || resolved.startsWith(moduleDir + sep)) return true; // local
  return ALLOWED_RESOLVED.has(resolved); // cross-boundary seam
}

describe('isolation guards (AST import enforcement / off-path / no persistence-merge in production)', () => {
  it('scans more than one production module file', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('every production import resolves within the module or to an allowlisted seam target / zod', () => {
    for (const file of moduleFiles) {
      const fileDir = dirname(file);
      for (const spec of scanImports(file).specifiers) {
        expect(importAllowed(fileDir, spec), `${file} imports disallowed module '${spec}'`).toBe(true);
      }
    }
  });

  it('no production file imports a hash-derivation function (graph-hash.js is not allowlisted)', () => {
    for (const file of moduleFiles) {
      for (const spec of scanImports(file).specifiers) {
        expect(spec.includes('graph-hash'), `${file} must not import graph-hash (hash comes via frame)`).toBe(false);
      }
    }
  });

  it('no production file imports mergeMutatedGraphForPersistence (candidate-build vs persistence-merge never co-mingle)', () => {
    for (const file of moduleFiles) {
      for (const n of scanImports(file).named) {
        expect(BANNED_NAMED_IMPORTS.has(n.name), `${file} must not import ${n.name}`).toBe(false);
      }
    }
  });

  it('no production file imports commit / turn-executor / persistence / store / pending-action', () => {
    const forbidden = /(turn-executor|\/commit\b|supabase-store|session\/pending-action|persist)/;
    for (const file of moduleFiles) {
      for (const spec of scanImports(file).specifiers) {
        expect(forbidden.test(spec), `${file} imports forbidden live surface '${spec}'`).toBe(false);
      }
    }
  });

  it('no production file uses dynamic import()/require()', () => {
    for (const file of moduleFiles) {
      expect(scanImports(file).hasDynamic, `${file} must not use dynamic import()/require()`).toBe(false);
    }
  });

  it('meta-check: the enforcer rejects escapes, bare specifiers, graph-hash, and off-list seams', () => {
    expect(importAllowed(moduleDir, './types.js')).toBe(true);
    expect(importAllowed(moduleDir, '../tools/handlers/analysis-ready-core.js')).toBe(true);
    expect(importAllowed(moduleDir, 'zod')).toBe(true);
    expect(importAllowed(moduleDir, '../context/graph-hash.js')).toBe(false);
    expect(importAllowed(moduleDir, '../turn-executor.js')).toBe(false);
    expect(importAllowed(moduleDir, '../session/pending-action.js')).toBe(false);
    expect(importAllowed(moduleDir, '../bad.js')).toBe(false);
    expect(importAllowed(moduleDir, 'lodash')).toBe(false);
  });

  it('zero persistence: the input graph is never mutated by refereeMutation', () => {
    const graph = buildReadyGraph();
    const snapshot = structuredClone(graph);
    const env = makeEnvelope('rename_node', { node_id: 'g-profit', to_label: 'Renamed' }, { base_graph_hash: hashOf(graph) });
    const v = refereeMutation(env, graph, frameFor(graph));
    expect(graph).toEqual(snapshot); // input untouched
    expect(v.candidate).toBeDefined();
    expect(v.candidate).not.toBe(graph);
  });
});
