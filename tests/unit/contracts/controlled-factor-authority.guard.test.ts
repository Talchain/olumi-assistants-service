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
 * Rule 2 (single-snapshot binding): graph-derived ContextPack slices consume
 * the pure four-state selector's coherent snapshot. Exactly one controlled-
 * factor projection may use that selector, and it must be inside the
 * `assembleContextPackWithSummary` call. Every other executor projection stays
 * persisted-first. Block capture runs on the tokenised structural view, so
 * braces inside strings cannot mis-scope it.
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
    // Derived from the allowlist (was a hand-pinned `3` — a mirror of the
    // allowlist count that would false-RED on every reviewed extension).
    expect(sites).toHaveLength(
      AUTHORITY_ALLOWLIST['orchestrator-v5/turn-executor.ts']!.count,
    );
    for (const site of sites) {
      expect(
        sourceLines[site.line - 1],
        `reported line ${site.line} should contain the authority call`,
      ).toContain(AUTHORITY_FUNCTION);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Rule 2 — graph-derived reasoning consumes one selector snapshot.
// ---------------------------------------------------------------------------

describe('single-snapshot authority rule', () => {
  const source = readFileSync(join(SRC_ROOT, 'orchestrator-v5/turn-executor.ts'), 'utf-8');

  function selectorBackedSites(candidate: string) {
    return extractAuthorityCallSites(
      candidate,
      'orchestrator-v5/turn-executor.ts',
    ).filter((site) => site.argText === 'contextGraphForReasoning');
  }

  it('binds the selector once and derives freshness/readiness from its graph', () => {
    const { structural } = tokenise(source);
    const selectorIdx = structural.indexOf('const contextGraphSelection = selectContextGraphSnapshot(');
    expect(selectorIdx, 'selector binding not found').toBeGreaterThan(-1);
    const selectorCall = captureBalanced(structural, selectorIdx, '(', ')');
    expect(selectorCall, 'selector call did not balance').not.toBeNull();
    const selectorText = structural.slice(selectorCall!.start, selectorCall!.end + 1);
    expect(selectorText).toContain('canonicalRead: context.persistedGraphRead');
    expect(selectorText).toContain('requestGraph: options.graphState');

    const binding = 'const contextGraphForReasoning = contextGraphSelection.graph';
    expect(structural).toContain(binding);

    const hashIdx = structural.indexOf('currentAnalysisGraphHashForTurn =', selectorCall!.end);
    expect(hashIdx, 'hash derivation after selector not found').toBeGreaterThan(selectorCall!.end);
    const hashEnd = structural.indexOf(';', hashIdx);
    const hashText = structural.slice(hashIdx, hashEnd + 1);
    expect(hashText).toContain('canonicalReadinessGraphForRun');
    expect(hashText).not.toContain('graphStateForTurn');
    expect(hashText).not.toContain('options.graphState');

    const executorSites = extractAuthorityCallSites(
      source,
      'orchestrator-v5/turn-executor.ts',
    );
    const selectorSites = selectorBackedSites(source);
    expect(
      selectorSites,
      'exactly one controlled-factor projection may use the selected snapshot',
    ).toHaveLength(1);
    expect(
      executorSites
        .filter((site) => site.argText !== 'contextGraphForReasoning')
        .every((site) => site.argText === 'context.persistedGraph ?? options.graphState'),
      'all non-ContextPack projections must remain persisted-first',
    ).toBe(true);

    const assemblyIdx = structural.indexOf(
      'assembleContextPackWithSummary(',
      selectorCall!.end,
    );
    expect(assemblyIdx, 'ContextPack assembly after selector not found').toBeGreaterThan(
      selectorCall!.end,
    );
    const assemblyCall = captureBalanced(structural, assemblyIdx, '(', ')');
    expect(assemblyCall, 'ContextPack assembly call did not balance').not.toBeNull();
    const assemblySource = source.slice(assemblyIdx, assemblyCall!.end + 1);
    const assemblySites = extractAuthorityCallSites(
      assemblySource,
      'orchestrator-v5/turn-executor.ts#context-pack',
    );
    expect(
      assemblySites.map((site) => site.argText),
      'ContextPack suppression must be the sole selector-backed authority call',
    ).toEqual(['contextGraphForReasoning']);
  });

  it('turns red when an unrelated executor projection is switched to selector authority', () => {
    const persistedFirstCall = `collectInterventionControlledFactorIds(
            context.persistedGraph ?? options.graphState,
          )`;
    const selectorCall = `collectInterventionControlledFactorIds(
            contextGraphForReasoning,
          )`;
    expect(source, 'discriminating-control anchor must exist exactly as reviewed').toContain(
      persistedFirstCall,
    );
    const mutant = source.replace(persistedFirstCall, selectorCall);

    expect(selectorBackedSites(source)).toHaveLength(1);
    expect(
      selectorBackedSites(mutant),
      'the file-wide two-form allowlist alone would miss this authority expansion',
    ).toHaveLength(2);
  });

  it('normaliseArg is stable for the allowlisted forms (self-check)', () => {
    expect(normaliseArg('\n  context.persistedGraph ??\n    options.graphState,\n')).toBe(
      'context.persistedGraph ?? options.graphState',
    );
  });
});
