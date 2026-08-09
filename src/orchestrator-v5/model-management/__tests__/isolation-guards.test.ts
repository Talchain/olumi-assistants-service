/**
 * Model Management v1 — isolation / import-boundary guards (AST-driven, TS compiler API).
 *
 * The dark invariant this module lives by (Layer 2, Track-3 discipline) is:
 *   1. ZERO PRODUCTION CALL SITES — nothing outside `model-management/` imports it, so
 *      the module is dead code until a separately-reviewed wiring slice lands (INBOUND).
 *   2. The module's own production files import ONLY local files, a small allowlist of
 *      sanctioned cross-boundary seams, and allowlisted externals (OUTBOUND).
 *   3. No dynamic import()/require() anywhere (a dynamic specifier would slip the AST net).
 *
 * These are mechanical proofs of what the module headers only assert in prose. The
 * flag-off no-op is proven separately (service-flag-gate.test.ts); this file proves the
 * module cannot leak into a live path in the first place.
 *
 * MAINTENANCE (stacked-PR contract): as the dark module grows, a later stacked PR may add
 * a new sanctioned outbound seam — extend ALLOWED_CROSS_BOUNDARY / EXTERNAL_ALLOWED here
 * and re-run. The allowlist is deliberately minimal (only what is actually imported today)
 * so an accidental new coupling fails loudly rather than passing silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, '..'); // src/orchestrator-v5/model-management
const srcRoot = resolve(moduleDir, '../..'); // src

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\./;

// ---------------------------------------------------------------------------
// OUTBOUND allowlist — the ONLY cross-boundary targets a production module file
// may import. Group A hash/CAS + boundary types are import-only seams; config is
// the flag read; telemetry is the sink logger; stable-stringify is the Group A
// canonicaliser. Everything else must resolve inside the module.
// ---------------------------------------------------------------------------
const ALLOWED_CROSS_BOUNDARY = new Set(
  [
    '../../config/index.js', // config.cee.modelVersionsEnabled (flag read)
    '../context/graph-identity.js', // Group A: computeGraphIdentityHash + analysis-affecting hash
    '../boundary/request-extensions.js', // GraphStateIngress (type-only)
    '../../orchestrator/context/stable-stringify.js', // Group A canonicaliser
    '../../utils/telemetry.js', // log (event-sink dispatch)
    // Lane 8 (3b cleanup): the A3 CAS vocabulary — CAS_CONFLICT_KIND is now
    // `satisfies GraphCasConflictCategory` against the landed #346 closed
    // enum instead of a free-floating local literal. Type-only import.
    '../context/graph-cas-conflict.js',
  ].map((s) => resolve(moduleDir, s)),
);

/** External bare specifiers permitted in production (pure libs / the sanctioned
 *  service-role client — no live-path coupling). `zod` was added with the strict
 *  boundary-contract module (contracts.ts) — a pure schema lib, no coupling. */
const EXTERNAL_ALLOWED = new Set(['@supabase/supabase-js', 'zod']);

/** Belt-and-braces: specific live surfaces that must NEVER appear in a production
 *  import (the allowlist already excludes them; this states the intent readably and
 *  catches an allowlist edit that accidentally opens one). */
const FORBIDDEN_LIVE_SURFACE =
  /(turn-executor|\/commit\b|supabase-store|session\/|\/handlers\/|\/routing\/|\/route-|persist|graph-hash)/;

// ---------------------------------------------------------------------------
// AST scan — collects static import + export-from specifiers, named import/export
// bindings, and flags any dynamic import()/require(). Covers `export * from` and
// `export { x } from` re-exports so a re-export cannot bypass a ban.
// ---------------------------------------------------------------------------
interface ScanResult {
  specifiers: string[];
  hasDynamic: boolean;
}

function scanImports(file: string): ScanResult {
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
    // `import x = require('...')` (TS import-equals) + dynamic import()/require().
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

/** True when `spec` (imported from a file in `fileDir`) is a permitted OUTBOUND target. */
function importAllowed(fileDir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return EXTERNAL_ALLOWED.has(spec); // bare/external — allowlist only
  const resolved = resolve(fileDir, spec);
  if (resolved === moduleDir || resolved.startsWith(moduleDir + sep)) return true; // local
  return ALLOWED_CROSS_BOUNDARY.has(resolved); // sanctioned seam
}

/** True when `spec` (imported from a file in `fileDir`) resolves INTO the module —
 *  i.e. this file is a production consumer of Model Management (a call site). */
function resolvesIntoModule(fileDir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const resolved = resolve(fileDir, spec);
  return resolved === moduleDir || resolved.startsWith(moduleDir + sep);
}

function collectSourceFiles(dir: string, opts: { excludeTests: boolean }): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (opts.excludeTests && ent.name === '__tests__') continue;
      if (ent.name === 'node_modules') continue;
      out.push(...collectSourceFiles(full, opts));
    } else if (SOURCE_EXT.test(ent.name) && !(opts.excludeTests && TEST_FILE.test(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

const moduleFiles = collectSourceFiles(moduleDir, { excludeTests: true });

// Every production .ts under src/ that is NOT part of the module and NOT a test —
// the universe that must contain zero call sites. Prefiltered to files that even
// mention the module name (any relative path reaching it contains 'model-management').
const productionFilesMentioningModule = collectSourceFiles(srcRoot, { excludeTests: true })
  .filter((f) => !f.startsWith(moduleDir + sep) && f !== moduleDir)
  .filter((f) => readFileSync(f, 'utf8').includes('model-management'));

describe('model-management isolation guards — OUTBOUND (module imports only sanctioned seams)', () => {
  it('scans every production module file (more than one)', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('every production import resolves within the module, a sanctioned seam, or an allowlisted external', () => {
    for (const file of moduleFiles) {
      const fileDir = dirname(file);
      for (const spec of scanImports(file).specifiers) {
        expect(
          importAllowed(fileDir, spec),
          `${file} imports disallowed module '${spec}' (add to the allowlist only if it is a sanctioned dark seam)`,
        ).toBe(true);
      }
    }
  });

  it('no production module file imports a forbidden live surface (turn-executor / commit / store / session / handlers / routing / routes / persist / graph-hash)', () => {
    for (const file of moduleFiles) {
      for (const spec of scanImports(file).specifiers) {
        expect(
          FORBIDDEN_LIVE_SURFACE.test(spec),
          `${file} imports forbidden live surface '${spec}'`,
        ).toBe(false);
      }
    }
  });

  it('no production module file uses dynamic import()/require() (a dynamic specifier would evade the static net)', () => {
    for (const file of moduleFiles) {
      expect(
        scanImports(file).hasDynamic,
        `${file} must not use dynamic import()/require()`,
      ).toBe(false);
    }
  });
});

// Lane 8 (2026-07-07): the separately-reviewed wiring slice LANDED — the
// commit-seam version hook in commit.ts is the module's first (and only)
// sanctioned production call site (flag-gated on CEE_MODEL_VERSIONS_ENABLED;
// fire-and-forget; commit-model-version-hook.test.ts pins flag-off
// byte-identity + the non-blocking contract). The dark invariant narrows:
// ZERO call sites → EXACTLY the allowlisted set below. A new consumer must
// extend this list deliberately, in its own reviewed slice.
// COLLAB U-S0 (2026-08-09, ROADMAP 2.910): the SECOND sanctioned call site,
// added deliberately in its own reviewed slice exactly as the note above
// requires. `src/collab/store.ts` calls `getModelManagementService().saveVersion`
// when an elicitation round is minted, so the round pins the model version the
// panel was actually asked about.
//
// Why this consumer must exist rather than call the RPC directly: content
// identity (`computeGraphIdentityHash`) is computed inside the service, and a
// second caller reaching past it would be a duplicate of the identity envelope
// — the mirror defect this estate keeps paying for. One implementation, two
// call sites, is the correct shape.
//
// ⚠ It inherits the flag: `saveVersion` returns `disabled` when
// CEE_MODEL_VERSIONS_ENABLED is off, and the collab store REFUSES the round
// rather than pinning nothing (an unpinned round is 2.910's exact failure).
const SANCTIONED_INBOUND_CALL_SITES = new Set(
  ['../commit.ts', '../../collab/store.ts'].map((s) => resolve(moduleDir, s)),
);

describe('model-management isolation guards — INBOUND (only the sanctioned commit-seam call site)', () => {
  it('no production file OUTSIDE the sanctioned set imports, re-exports, or dynamically imports the module', () => {
    for (const file of productionFilesMentioningModule) {
      if (SANCTIONED_INBOUND_CALL_SITES.has(resolve(file))) continue;
      const fileDir = dirname(file);
      for (const spec of scanImports(file).specifiers) {
        expect(
          resolvesIntoModule(fileDir, spec),
          `${file} imports Model Management ('${spec}') — the ONLY sanctioned production call site is the ` +
            'flag-gated commit-seam hook (commit.ts); add a new consumer only in its own reviewed slice',
        ).toBe(false);
      }
    }
  });

  it('the sanctioned commit-seam call site EXISTS and actually imports the module (the allowlist is not vacuous)', () => {
    const commitFile = resolve(moduleDir, '../commit.ts');
    const importsModule = scanImports(commitFile).specifiers.some((s) =>
      resolvesIntoModule(dirname(commitFile), s),
    );
    expect(
      importsModule,
      'commit.ts no longer imports model-management — the lane-8 version hook regressed; shrink the allowlist deliberately',
    ).toBe(true);
  });

  it('a bare mention of the module name in a non-import context (e.g. a config comment) does not count as a call site', () => {
    expect(productionFilesMentioningModule.length).toBeGreaterThan(0);
    for (const file of productionFilesMentioningModule) {
      if (SANCTIONED_INBOUND_CALL_SITES.has(resolve(file))) continue;
      const fileDir = dirname(file);
      const importsModule = scanImports(file).specifiers.some((s) => resolvesIntoModule(fileDir, s));
      expect(importsModule, `${file} unexpectedly imports the module`).toBe(false);
    }
  });
});

describe('model-management isolation guards — meta-checks (the enforcer cannot be silently bypassed)', () => {
  it('accepts local files + every sanctioned seam, rejects off-list seams / non-allowlisted externals', () => {
    expect(importAllowed(moduleDir, './types.js')).toBe(true);
    expect(importAllowed(moduleDir, './service.js')).toBe(true);
    expect(importAllowed(moduleDir, '../../config/index.js')).toBe(true);
    expect(importAllowed(moduleDir, '../context/graph-identity.js')).toBe(true);
    expect(importAllowed(moduleDir, '../boundary/request-extensions.js')).toBe(true);
    expect(importAllowed(moduleDir, '../../orchestrator/context/stable-stringify.js')).toBe(true);
    expect(importAllowed(moduleDir, '../../utils/telemetry.js')).toBe(true);
    expect(importAllowed(moduleDir, '../context/graph-cas-conflict.js')).toBe(true);
    expect(importAllowed(moduleDir, '@supabase/supabase-js')).toBe(true);
    // zod is now allowlisted (added with the strict boundary-contract module):
    expect(importAllowed(moduleDir, 'zod')).toBe(true);
    // Off-list / forbidden:
    expect(importAllowed(moduleDir, '../context/graph-hash.js')).toBe(false);
    expect(importAllowed(moduleDir, '../turn-executor.js')).toBe(false);
    expect(importAllowed(moduleDir, '../session/store.js')).toBe(false);
    expect(importAllowed(moduleDir, 'lodash')).toBe(false);
  });

  it('the scanner catches a banned specifier in an `export * from` / `export { x } from` RE-EXPORT (not just imports)', () => {
    const sf = ts.createSourceFile(
      'tmp.ts',
      "export * from '../turn-executor.js';\nexport { x } from '../session/store.js';",
      ts.ScriptTarget.Latest,
      true,
    );
    const specs: string[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
    expect(specs).toContain('../turn-executor.js');
    expect(specs).toContain('../session/store.js');
  });

  it('the scanner flags dynamic import() and require() specifiers', () => {
    const r = scanImportsFromText(
      "const a = await import('../turn-executor.js'); const b = require('../session/store.js');",
    );
    expect(r.hasDynamic).toBe(true);
    expect(r.specifiers).toContain('../turn-executor.js');
    expect(r.specifiers).toContain('../session/store.js');
  });

  it('resolvesIntoModule identifies a call site and clears a sibling non-module import', () => {
    // A hypothetical importer living at src/orchestrator-v5/foo.ts:
    const importerDir = resolve(moduleDir, '..');
    expect(resolvesIntoModule(importerDir, './model-management/index.js')).toBe(true);
    expect(resolvesIntoModule(importerDir, './context/graph-identity.js')).toBe(false);
    expect(resolvesIntoModule(importerDir, '@supabase/supabase-js')).toBe(false);
  });
});

/** Test-only helper mirroring scanImports for inline source strings. */
function scanImportsFromText(text: string): ScanResult {
  const sf = ts.createSourceFile('inline.ts', text, ts.ScriptTarget.Latest, true);
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
