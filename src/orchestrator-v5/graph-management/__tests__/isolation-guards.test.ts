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
 *  graph-hash.js is DELIBERATELY absent — Track 3 consumes the hash via the frame.
 *  context/frame/types.js is the SANCTIONED type-only seam for the
 *  CanonicalContextFrame → MutationFrame adapter (lane 8 live wiring): import
 *  direction is graph-management → context/frame types, never the reverse,
 *  and the frame types module carries no hash-derivation runtime.
 *
 *  ROADMAP 2.380 — `../../schemas/required-nested-merge.js` is admitted as a
 *  SIXTH seam target, in the same class as `cee-v3.js`: pure schema derivation
 *  over the canonical Zod shapes, zod-only, no live-path coupling, no hash
 *  derivation, no persistence, no I/O. It exists because the candidate builder
 *  and the LIVE applier (`src/orchestrator/patch-applier.ts`) MUST agree on how
 *  a partial write onto a REQUIRED nested object merges — they did not, and
 *  every live edge-strength edit was discarded as a result. The boundary
 *  forbids importing the applier itself (correctly — that IS V4 patch/apply
 *  machinery), so the shared semantics were extracted to a neutral module both
 *  sides import. A second hand-written copy would have been the mirror defect
 *  this whole guard exists to prevent.
 *
 *  This is an EXACT-PATH allowlist, not a directory allowlist: admitting this
 *  module does not admit `src/schemas/*` generally (pinned by the meta-check
 *  below). */
const ALLOWED_RESOLVED = new Set(
  [
    '../tools/handlers/d1-shared/apply-graph-mutation.js',
    '../tools/handlers/d1-shared/errors.js',
    '../tools/handlers/analysis-ready-core.js',
    '../../schemas/cee-v3.js',
    '../../schemas/required-nested-merge.js',
    '../context/frame/types.js',
  ].map((s) => resolve(moduleDir, s)),
);

/** External bare specifiers permitted in production (pure libs, no live-path coupling).
 *
 *  ROADMAP 2.474 / design-review amendment A6 — `@talchain/schemas/orchestrator`
 *  is admitted as a SECOND external, in the same class as the
 *  `required-nested-merge` seam above: the CLASSED FIELD-PARITY TABLE and its
 *  derivation accessors are pure data + zod over the shared contract — no I/O,
 *  no hash derivation, no persistence, no live-path coupling. It exists because
 *  `field-safety.ts`'s allowlists MUST be derived from the one canonical table
 *  rather than hand-reconciled against the UI's inspector setters; a second
 *  hand-written copy is the mirror defect this guard exists to prevent
 *  (trap 12), and the drift it produces reads as green.
 *
 *  EXACT SUBPATH, not the package: admitting the orchestrator entry point does
 *  NOT admit `@talchain/schemas` root, `/boundary`, or `/fixtures` — those carry
 *  wire/transport surfaces this module is deliberately isolated from. Pinned by
 *  the meta-check below. */
const EXTERNAL_ALLOWED = new Set(['zod', '@talchain/schemas/orchestrator']);

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
      // Also cover `export { X } from '...'` RE-EXPORTS — a re-export of a banned
      // name would otherwise bypass the named-import ban (found by the boundary review).
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
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

  it('no production file imports OR re-exports mergeMutatedGraphForPersistence (candidate-build vs persistence-merge never co-mingle)', () => {
    for (const file of moduleFiles) {
      for (const n of scanImports(file).named) {
        expect(BANNED_NAMED_IMPORTS.has(n.name), `${file} must not import/re-export ${n.name}`).toBe(false);
      }
    }
  });

  it('meta-check: the scanner catches a banned name in an `export { X } from` RE-EXPORT (not just imports)', () => {
    // Mirrors the boundary-review finding: a re-export must not bypass the named ban.
    const sf = ts.createSourceFile(
      'tmp.ts',
      "export { mergeMutatedGraphForPersistence } from '../tools/handlers/d1-shared/apply-graph-mutation.js';",
      ts.ScriptTarget.Latest,
      true,
    );
    const found: string[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) found.push(el.propertyName?.text ?? el.name.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
    expect(found).toContain('mergeMutatedGraphForPersistence');
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

  /** ROADMAP 2.474 / A6 — admitting `@talchain/schemas/orchestrator` must not
   *  have widened the boundary to the PACKAGE. Same discipline as the
   *  required-nested-merge meta-check: exact specifier, not a prefix. */
  it('meta-check: admitting @talchain/schemas/orchestrator did NOT admit the package', () => {
    expect(importAllowed(moduleDir, '@talchain/schemas/orchestrator')).toBe(true);
    expect(importAllowed(moduleDir, '@talchain/schemas')).toBe(false);
    expect(importAllowed(moduleDir, '@talchain/schemas/boundary')).toBe(false);
    expect(importAllowed(moduleDir, '@talchain/schemas/fixtures')).toBe(false);
  });

  /** ROADMAP 2.380 — admitting `schemas/required-nested-merge.js` must not have
   *  widened the boundary to the schemas DIRECTORY. The allowlist is
   *  exact-path; these pin that it stayed exact-path. Without this, a later
   *  "it's just another schemas import" would sail through. */
  it('meta-check: admitting required-nested-merge did NOT admit src/schemas/* generally', () => {
    expect(importAllowed(moduleDir, '../../schemas/required-nested-merge.js')).toBe(true);
    expect(importAllowed(moduleDir, '../../schemas/cee-v3.js')).toBe(true);
    // Everything else under src/schemas/ is still refused.
    expect(importAllowed(moduleDir, '../../schemas/index.js')).toBe(false);
    expect(importAllowed(moduleDir, '../../schemas/anything-else.js')).toBe(false);
    // And the applier itself — the module whose semantics were extracted —
    // remains forbidden. Sharing happened via the neutral module, NOT by
    // opening the boundary to V4 patch/apply machinery.
    expect(importAllowed(moduleDir, '../../orchestrator/patch-applier.js')).toBe(false);
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
