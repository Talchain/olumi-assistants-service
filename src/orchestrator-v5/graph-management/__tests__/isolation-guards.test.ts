import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..'); // src/orchestrator-v5/graph-management

/** Recursively collect every non-test SOURCE file in the module (any code extension, subdirectories included). */
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
const moduleFiles = collectModuleSourceFiles(moduleDir); // absolute paths

/**
 * Import enforcement, resolved-path based and AST-driven (TypeScript compiler API)
 * rather than regex — so it is not fooled by comments, template-literal TEXT, or
 * fooled-into-missing real code inside `${ … }` interpolations. Every import must
 * resolve WITHIN the module dir, or to one of these exact cross-boundary seam
 * targets. Any V4 patch/apply, persistence, route, or write module fails.
 */
const ALLOWED_RESOLVED = new Set(
  [
    '../tools/handlers/d1-shared/apply-graph-mutation.js',
    '../tools/handlers/d1-shared/errors.js',
    '../tools/handlers/analysis-ready-core.js',
    '../context/graph-hash.js',
    '../../schemas/cee-v3.js',
  ].map((s) => resolve(moduleDir, s)),
);

/** Enumerate static import/export specifiers and detect any dynamic import()/require() via the AST. */
function scanImports(file: string): { specifiers: string[]; hasDynamic: boolean } {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  let hasDynamic = false;

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
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
  return { specifiers, hasDynamic };
}

function importAllowed(fileDir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false; // bare/external specifier — never allowed
  const resolved = resolve(fileDir, spec);
  if (resolved === moduleDir || resolved.startsWith(moduleDir + sep)) return true; // local
  return ALLOWED_RESOLVED.has(resolved); // cross-boundary seam
}

describe('isolation guards (AST import enforcement / no-persistence / off-path)', () => {
  it('scans every non-test module file, including any subdirectories', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('every import resolves within the module dir or to an allowlisted seam target', () => {
    for (const file of moduleFiles) {
      const fileDir = dirname(file);
      for (const spec of scanImports(file).specifiers) {
        expect(importAllowed(fileDir, spec), `${file} imports disallowed module '${spec}'`).toBe(true);
      }
    }
  });

  it('no module file uses a dynamic import() or require() — including inside template interpolations', () => {
    for (const file of moduleFiles) {
      expect(scanImports(file).hasDynamic, `${file} must not use dynamic import()/require()`).toBe(false);
    }
  });

  it('the AST scanner sees a dynamic import inside a template interpolation (self-check vs the old regex gap)', () => {
    const tmp = ts.createSourceFile(
      'tmp.ts',
      'const x = `${import("../bad.js")}`;',
      ts.ScriptTarget.Latest,
      true,
    );
    let found = false;
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) found = true;
      ts.forEachChild(n, walk);
    };
    walk(tmp);
    expect(found).toBe(true);
  });

  it('the import enforcer rejects escapes, bare specifiers, and off-list seams (meta-check)', () => {
    expect(importAllowed(moduleDir, './proposal-types.js')).toBe(true);
    expect(importAllowed(moduleDir, '../tools/handlers/analysis-ready-core.js')).toBe(true);
    expect(importAllowed(moduleDir, '../bad.js')).toBe(false);
    expect(importAllowed(moduleDir, './../../escape.js')).toBe(false);
    expect(importAllowed(moduleDir, '../tools/edit-graph.js')).toBe(false);
    expect(importAllowed(moduleDir, 'zod')).toBe(false);
    expect(importAllowed(join(moduleDir, 'lib'), '../../tools/edit-graph.js')).toBe(false);
  });

  it('zero persistence: the input graph is never mutated and the candidate is a distinct object', () => {
    const graph = buildReadyGraph();
    const snapshot = structuredClone(graph);
    const r = classifyProposal(
      {
        kind: 'rename_node',
        base_graph_hash: currentAnalysisHash(graph),
        node_id: 'g-profit',
        new_label: 'Renamed',
      },
      graph,
    );
    expect(graph).toEqual(snapshot);
    expect(r.candidate).toBeDefined();
    expect(r.candidate).not.toBe(graph);
  });
});
