/**
 * Persisted-first contract guard (component 1) — the CI gate.
 *
 * Proves, on every run, that every production call site of
 * `collectInterventionControlledFactorIds` derives the controlled-factor set
 * from the SAVED model (persisted-first / persisted-only / persisted-derived),
 * and that no call site or laundered reference can be added without
 * consciously extending the reviewed allowlist. Doctrine and text-handling
 * design: see `controlled-factor-authority.scan.ts`.
 *
 * RED evidence (three layers; transcripts archived durably in
 * `Docs/v5/persisted-first-guard-evidence.md`):
 *   1. COMMITTED, PERMANENT: the fixture cases below feed the pure scanner
 *      request-first / laundered / hidden / rogue forms and assert violations
 *      — the detector is re-proven able to fail on every CI run.
 *   2. HISTORICAL (one-off): the same scanner over
 *      `git show e364c7332:src/orchestrator-v5/turn-executor.ts` (the pre-#316
 *      staging tip) flags the real request-first run-comparison site at its
 *      true line — the guard catches the actual historical violation.
 *   3. SYNTHETIC MUTATION (one-off): flipping a live site request-first,
 *      adding an alias-imported rogue call, and adding an unaliased rogue call
 *      all fail the repository scan; reverted, nothing committed touches
 *      production files. The first drill found a real hole (alias laundering),
 *      which is why the reference-discipline rules exist.
 *
 * Rule 2 (narrow, boot-snapshot precedent): the current-model hash derivation
 * (`currentAnalysisGraphHashForTurn`) anchors to `context.persistedGraph`; the
 * request graph (`graphStateForTurn`) may appear ONLY inside the documented
 * cold-start branch (no saved model exists yet, so the request graph is the
 * only signal — hashing it there is correct, not a violation). Block capture
 * runs on the tokenised structural view, so braces inside strings cannot
 * mis-scope it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_ALLOWLIST,
  AUTHORITY_FUNCTION,
  MIN_TOTAL_SITES,
  captureBalanced,
  classifySites,
  extractAuthorityCallSites,
  findImportLaundering,
  isScannableFile,
  normaliseArg,
  scanRepository,
  tokenise,
} from './controlled-factor-authority.scan.js';

const SRC_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));

// ---------------------------------------------------------------------------
// 1. Committed RED cases — the detector is proven able to fail, permanently.
// ---------------------------------------------------------------------------

describe('detector RED cases (committed violations the scan must catch)', () => {
  it('flags the request-first form (the exact pre-#316 defect shape)', () => {
    const source = `
      const outcome = tryRunComparisonGate({
        interventionControlledFactorIds: ${AUTHORITY_FUNCTION}(
          options.graphState ?? context.persistedGraph,
        ),
      });
    `;
    const sites = extractAuthorityCallSites(source, 'orchestrator-v5/turn-executor.ts');
    expect(sites).toHaveLength(1);
    expect(sites[0]!.argText).toBe('options.graphState ?? context.persistedGraph');
    const violations = classifySites(sites);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('not an allowlisted persisted-first form');
  });

  it('flags a laundered argument alias — any rebinding fails because it is not listed', () => {
    const aliased = extractAuthorityCallSites(
      `const ids = ${AUTHORITY_FUNCTION}(graphStateForTurn ?? context.persistedGraph);`,
      'orchestrator-v5/turn-executor.ts',
    );
    expect(classifySites(aliased)).toHaveLength(1);

    const rebound = extractAuthorityCallSites(
      `const g = options.graphState ?? context.persistedGraph;\nconst ids = ${AUTHORITY_FUNCTION}(g);`,
      'orchestrator-v5/turn-executor.ts',
    );
    expect(rebound[0]!.argText).toBe('g');
    expect(classifySites(rebound)).toHaveLength(1);
  });

  it('flags a rogue NEW call site in a file not on the allowlist', () => {
    const sites = extractAuthorityCallSites(
      `const ids = ${AUTHORITY_FUNCTION}(context.persistedGraph);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    const violations = classifySites(sites);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('NEW call site');
  });

  it('still sees a call hidden behind a string containing // or /* (the fail-open the review drills found)', () => {
    // Before the tokeniser, a URL string deleted the rest of the line and an
    // unpaired /* in a string swallowed everything to the next */ — hiding
    // rogue calls entirely. Both must now be visible.
    const urlHidden = extractAuthorityCallSites(
      `const u = 'https://api.example.com'; const ids = ${AUTHORITY_FUNCTION}(options.graphState);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(urlHidden).toHaveLength(1);
    expect(urlHidden[0]!.argText).toBe('options.graphState');
    expect(classifySites(urlHidden)).toHaveLength(1);

    const blockHidden = extractAuthorityCallSites(
      `const banner = 'section /* header';\nconst ids = ${AUTHORITY_FUNCTION}(options.graphState);\nconst tail = '*/ end';`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(blockHidden).toHaveLength(1);
    expect(classifySites(blockHidden)).toHaveLength(1);

    const regexHidden = extractAuthorityCallSites(
      `const re = /https:\\/\\//; const ids = ${AUTHORITY_FUNCTION}(options.graphState);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(regexHidden).toHaveLength(1);
  });

  it('flags bare rebinding and point-free references (function laundering)', () => {
    const rebound = findImportLaundering(
      `import { ${AUTHORITY_FUNCTION} } from '../context/intervention-controlled-drivers.js';\n` +
        `const collect = ${AUTHORITY_FUNCTION};\nexport const ids = (g: unknown) => collect(g);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(rebound).toHaveLength(1);
    expect(rebound[0]).toContain('bare reference');

    const pointFree = findImportLaundering(
      `import { ${AUTHORITY_FUNCTION} } from '../context/intervention-controlled-drivers.js';\n` +
        `export const all = (gs: unknown[]) => gs.map(${AUTHORITY_FUNCTION});`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(pointFree).toHaveLength(1);
    expect(pointFree[0]).toContain('bare reference');
  });

  it('flags import laundering: alias, namespace, and dynamic import of the authority module', () => {
    const aliased = findImportLaundering(
      `import { ${AUTHORITY_FUNCTION} as rogue } from '../context/intervention-controlled-drivers.js';\n` +
        `export const ids = (g: unknown) => rogue(g);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(aliased.some((v) => v.includes('aliases'))).toBe(true);

    const namespaced = findImportLaundering(
      `import * as drivers from '../context/intervention-controlled-drivers.js';`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(namespaced).toHaveLength(1);
    expect(namespaced[0]).toContain('namespace-imports');

    const dynamic = findImportLaundering(
      `const mod = await import('../context/intervention-controlled-drivers.js');`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]).toContain('dynamically imports');

    // Review-blocker RED cases — fail-open forms the first design missed.
    // (a) A `$`-prefixed alias identifier (the old `as \w+` needed a leading
    //     word char, and `$` is not \w).
    const dollarAlias = findImportLaundering(
      `import { ${AUTHORITY_FUNCTION} as $ids } from '../context/intervention-controlled-drivers.js';\n` +
        `export const ids = (g: unknown) => $ids(g);`,
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(dollarAlias.some((v) => v.includes('aliases'))).toBe(true);

    // (b) A backtick (template-literal) dynamic import + computed access — the
    //     string-only quote class missed the backtick, and computed access via
    //     a string is invisible to the call/reference scans, so catching the
    //     dynamic import is the whole defence.
    const backtickDynamic = findImportLaundering(
      'const mod = await import(`../context/intervention-controlled-drivers.js`);\n' +
        'export const ids = (g: unknown) => mod[`collectInterventionControlledFactorIds`](g);',
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(backtickDynamic.some((v) => v.includes('dynamically imports'))).toBe(true);

    // (c) Backtick require, symmetrically.
    const backtickRequire = findImportLaundering(
      'const mod = require(`../context/intervention-controlled-drivers.js`);',
      'orchestrator-v5/routing/some-new-gate.ts',
    );
    expect(backtickRequire.some((v) => v.includes('dynamically imports'))).toBe(true);

    // The sanctioned direct named import + direct call is clean.
    expect(
      findImportLaundering(
        `import { ${AUTHORITY_FUNCTION} } from './context/intervention-controlled-drivers.js';\n` +
          `const ids = ${AUTHORITY_FUNCTION}(context.persistedGraph);`,
        'orchestrator-v5/turn-executor.ts',
      ),
    ).toHaveLength(0);
  });

  it('captures multi-line, comment-bearing arguments and normalises them', () => {
    const source = `
      const ids = ${AUTHORITY_FUNCTION}(
        // authority comment that must not perturb the capture
        context.persistedGraph ??
          options.graphState, /* trailing note */
      );
    `;
    const sites = extractAuthorityCallSites(source, 'orchestrator-v5/turn-executor.ts');
    expect(sites).toHaveLength(1);
    expect(sites[0]!.argText).toBe('context.persistedGraph ?? options.graphState');
    expect(classifySites(sites)).toHaveLength(0);
  });

  it('reports TRUE line numbers even after multi-line block comments', () => {
    // The first design counted newlines on comment-collapsed text and drifted
    // by hundreds of lines in doc-heavy files (1041 reported for true 1208).
    const source = `/**\n * four\n * line\n * header\n */\nconst ids = ${AUTHORITY_FUNCTION}(context.persistedGraph);`;
    const sites = extractAuthorityCallSites(source, 'orchestrator-v5/handlers/chip-click-dispatch.ts');
    expect(sites).toHaveLength(1);
    expect(sites[0]!.line).toBe(6);
  });

  it('does not match prose mentions or the function declaration', () => {
    const prose = extractAuthorityCallSites(
      `/** membership (the #308 union set, \`${AUTHORITY_FUNCTION}\`), */ const x = 1;`,
      'orchestrator-v5/compose/flip-proposal.ts',
    );
    expect(prose).toHaveLength(0);

    const decl = extractAuthorityCallSites(
      `export function ${AUTHORITY_FUNCTION}(graph: unknown): Set<string> { return new Set(); }`,
      'orchestrator-v5/context/intervention-controlled-drivers.ts',
    );
    expect(decl).toHaveLength(0);
  });

  it('walker filename filter: excludes tests, declarations, and editor/sync junk', () => {
    expect(isScannableFile('turn-executor.ts')).toBe(true);
    expect(isScannableFile('gate.tsx')).toBe(true);
    expect(isScannableFile('gate.mts')).toBe(true);
    expect(isScannableFile('turn-executor.test.ts')).toBe(false);
    expect(isScannableFile('types.d.ts')).toBe(false);
    // The repo actively defends against these (.gitignore `* 2.*`, tsconfig
    // exclude `**/* 2.ts`) — a stray duplicate must not RED the gate.
    expect(isScannableFile('turn-executor 2.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Repository scan — the live tree conforms, exactly.
// ---------------------------------------------------------------------------

describe('repository scan (the gate)', () => {
  const result = scanRepository(SRC_ROOT);

  it('every production authority call site matches the reviewed allowlist', () => {
    expect(result.violations, result.violations.join('\n')).toHaveLength(0);
  });

  it(`finds at least ${MIN_TOTAL_SITES} sites (anti-rot: a vacuous scan fails loudly)`, () => {
    expect(result.sites.length).toBeGreaterThanOrEqual(MIN_TOTAL_SITES);
  });

  it('site counts and files match the allowlist exactly (no site outside allowlisted files)', () => {
    const perFile = new Map<string, number>();
    for (const s of result.sites) perFile.set(s.file, (perFile.get(s.file) ?? 0) + 1);
    for (const [file, entry] of Object.entries(AUTHORITY_ALLOWLIST)) {
      expect(perFile.get(file), `site count for ${file}`).toBe(entry.count);
    }
    for (const file of perFile.keys()) {
      expect(AUTHORITY_ALLOWLIST[file], `unexpected authority call sites in ${file}`).toBeDefined();
    }
  });

  it('reports true source line numbers for the live sites (drift-robust)', () => {
    // Assert each reported line ACTUALLY points at an authority call in the
    // source, rather than pinning absolute line numbers. turn-executor.ts is
    // the rank-1 collision file; pinning [1208,3283,4515] would false-RED this
    // gate on every unrelated edit that shifts lines above a site — a guard
    // that false-reds on harmless drift gets ignored. An off-by-one still
    // fails (the adjacent lines are the argument / surrounding code, not the
    // callee name). Correctness proven; drift tolerated.
    const source = readFileSync(join(SRC_ROOT, 'orchestrator-v5/turn-executor.ts'), 'utf-8');
    const sourceLines = source.split('\n');
    const sites = result.sites.filter((s) => s.file === 'orchestrator-v5/turn-executor.ts');
    expect(sites).toHaveLength(3);
    for (const site of sites) {
      expect(
        sourceLines[site.line - 1],
        `reported line ${site.line} should contain the authority call`,
      ).toContain(AUTHORITY_FUNCTION);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Rule 2 — the current-model hash derivation anchors to the saved model.
// ---------------------------------------------------------------------------

describe('hash-anchor rule (currentAnalysisGraphHashForTurn)', () => {
  const source = readFileSync(join(SRC_ROOT, 'orchestrator-v5/turn-executor.ts'), 'utf-8');

  it('anchors to context.persistedGraph; the request graph appears only in the cold-start branch', () => {
    // Structural view: comments AND string contents blanked (newline- and
    // length-preserving), so neither prose mentions nor braces inside strings
    // can perturb the block capture.
    const { structural } = tokenise(source);

    const assignIdx = structural.indexOf('currentAnalysisGraphHashForTurn = ((');
    expect(assignIdx, 'hash derivation assignment not found — re-anchor this rule').toBeGreaterThan(-1);
    const derivation = captureBalanced(structural, assignIdx, '{', '}');
    expect(derivation, 'derivation block did not balance').not.toBeNull();
    const derivationText = structural.slice(derivation!.start, derivation!.end + 1);

    // The persisted anchor exists.
    expect(derivationText).toContain('context.persistedGraph');

    // The ONLY permitted request-graph use is the documented cold-start branch
    // (no saved model yet). Capture that branch and require every structural
    // occurrence of `graphStateForTurn` in the derivation to sit inside it.
    const guardIdx = derivationText.indexOf('persistedGraph === undefined || persistedGraph === null');
    expect(guardIdx, 'cold-start guard not found — re-anchor this rule').toBeGreaterThan(-1);
    const coldStart = captureBalanced(derivationText, guardIdx, '{', '}');
    expect(coldStart, 'cold-start block did not balance').not.toBeNull();

    const occurrences = [...derivationText.matchAll(/graphStateForTurn/g)].map((m) => m.index!);
    expect(occurrences.length, 'expected the cold-start fallback to reference the request graph').toBeGreaterThan(0);
    for (const idx of occurrences) {
      expect(
        idx >= coldStart!.start && idx <= coldStart!.end,
        `graphStateForTurn used OUTSIDE the cold-start branch of the hash derivation (offset ${idx}) — ` +
          `the current-model hash must never fall back to the request graph when a saved model exists ` +
          `(false-fresh risk under client lag)`,
      ).toBe(true);
    }
  });

  it('normaliseArg is stable for the allowlisted forms (self-check)', () => {
    expect(normaliseArg('\n  context.persistedGraph ??\n    options.graphState,\n')).toBe(
      'context.persistedGraph ?? options.graphState',
    );
  });
});
