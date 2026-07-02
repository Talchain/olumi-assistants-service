/**
 * V6 Increment 2 — `buildFrame` parity/purity tests.
 *
 * Proves the builder WRAPS the authority outputs (never re-derives): every
 * projected field equals its input value verbatim, counts derive from the held
 * array, claim permissions default HELD, and the function is pure. Fixtures are
 * REAL authority outputs (`deriveAnalysisFreshness` → `canonicalStateFromFreshness`),
 * mirroring the single-source-freshness precedent in
 * `context/__tests__/coaching-context-pack.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { buildFrame } from '../build-frame.js';
import { DEFAULT_CLAIM_PERMISSIONS } from '../claim-permissions.js';
import { deriveAnalysisFreshness } from '../../freshness.js';
import {
  canonicalStateFromFreshness,
  summariseCanonicalAnalysisState,
} from '../../canonical-analysis-state.js';
import type { BuildFrameInput, FrameChanges } from '../types.js';

// Real authority outputs — the frame must WRAP these, never re-derive them.
const freshness = deriveAnalysisFreshness([], 'graph-hash-current');
const canonicalState = canonicalStateFromFreshness(freshness);

const CHANGES: FrameChanges = [
  { action: 'graph_edited', summary: 'Edited the graph.', targetLabel: 'Decision' },
  { action: 'constraint_added', summary: 'Added a constraint.', targetLabel: 'Goal' },
];

function baseInput(overrides: Partial<BuildFrameInput> = {}): BuildFrameInput {
  return {
    freshness,
    canonicalState,
    canonicalStateSource: 'turn_executor',
    recentChanges: CHANGES,
    priorTurnCount: 3,
    ...overrides,
  };
}

describe('buildFrame — pure projection over authority outputs (Increment 2)', () => {
  it('version is the frame contract version', () => {
    expect(buildFrame(baseInput()).version).toBe('0.1.0');
  });

  it('freshness projection equals the freshness authority output, verbatim', () => {
    const f = buildFrame(baseInput()).freshness;
    expect(f.verdict).toBe(freshness.freshness);
    expect(f.reason).toBe(freshness.reason);
    expect(f.computedAt).toBe(freshness.computed_at);
  });

  it('model hashes are single-sourced from the freshness authority (no second graph-hash input)', () => {
    const m = buildFrame(baseInput()).model;
    expect(m.graphHash).toBe(freshness.current_graph_hash);
    expect(m.graphHashAtRun).toBe(freshness.graph_hash_at_run);
    expect(m.counts).toBeNull();
  });

  it('analysis projection equals the canonical-state predicates + source, verbatim', () => {
    const a = buildFrame(baseInput()).analysis;
    expect(a.status).toBe(canonicalState.status);
    expect(a.usableForProse).toBe(canonicalState.usableForProse);
    expect(a.usableForChips).toBe(canonicalState.usableForChips);
    expect(a.usableForFollowupContext).toBe(canonicalState.usableForFollowupContext);
    expect(a.requiresRerun).toBe(canonicalState.requiresRerun);
    expect(a.blockedUnusable).toBe(canonicalState.blockedUnusable);
    expect(a.source).toBe('turn_executor');
  });

  it('changes are passed through by reference — projected once upstream, never re-projected/re-capped', () => {
    expect(buildFrame(baseInput()).changes).toBe(CHANGES);
  });

  it('conversation.recentChangeCount derives from changes.length (single source)', () => {
    expect(buildFrame(baseInput()).conversation.recentChangeCount).toBe(CHANGES.length);
    expect(buildFrame(baseInput({ recentChanges: [] })).conversation.recentChangeCount).toBe(0);
  });

  it('conversation.priorTurnCount passes through verbatim (REQUIRED input — no default; a fabricated 0 for "not supplied" is unconstructible)', () => {
    expect(buildFrame(baseInput({ priorTurnCount: 7 })).conversation.priorTurnCount).toBe(7);
    expect(buildFrame(baseInput({ priorTurnCount: 0 })).conversation.priorTurnCount).toBe(0);
  });

  it('pendingConfirmation defaults to false; the builder never invents it', () => {
    expect(buildFrame(baseInput()).conversation.pendingConfirmation).toBe(false);
    expect(
      buildFrame(baseInput({ pendingConfirmation: true })).conversation.pendingConfirmation,
    ).toBe(true);
  });

  it('intent defaults to no-match when absent; passes through when supplied (deterministic pre-route only)', () => {
    expect(buildFrame(baseInput()).intent).toEqual({
      deterministicMatch: false,
      preRouteClass: null,
    });
    const withIntent = buildFrame(
      baseInput({ intent: { deterministicMatch: true, preRouteClass: 'state_query' } }),
    ).intent;
    expect(withIntent.deterministicMatch).toBe(true);
    expect(withIntent.preRouteClass).toBe('state_query');
  });

  it('claim permissions default to the HELD table when omitted; no relaxation', () => {
    const cp = buildFrame(baseInput()).claimPermissions;
    expect(cp).toEqual(DEFAULT_CLAIM_PERMISSIONS);
    expect(Object.values(cp).every((v) => v === 'held')).toBe(true);
  });

  it('evidence / actions / uiTargets are inert scaffolds — no fabricated data', () => {
    const frame = buildFrame(baseInput());
    expect(frame.evidence).toEqual({});
    expect(frame.actions).toEqual({});
    expect(frame.uiTargets).toEqual({});
  });

  it('diagnostics.analysisStateSummary is the pure redacted projection of the held canonical state', () => {
    const d = buildFrame(baseInput()).diagnostics;
    expect(d.analysisStateSummary).toEqual(summariseCanonicalAnalysisState(canonicalState));
    expect(d.canonicalStateSource).toBe('turn_executor');
  });

  it('internal graph-hash consistency: model and the diagnostic summary agree for a single-derivation input', () => {
    // freshness and canonicalState here come from ONE derivation
    // (canonicalState = canonicalStateFromFreshness(freshness)), so the frame's
    // two graph-hash surfaces agree. Cross-input provenance (freshness and
    // canonicalState derived from DIFFERENT graphs) is NOT the builder's job —
    // it is the Increment-2b live-seam gate (brief §9).
    const frame = buildFrame(baseInput());
    const summary = frame.diagnostics.analysisStateSummary;
    expect(summary).toBeDefined();
    expect(frame.model.graphHash).toBe(summary?.current_graph_hash ?? null);
    expect(frame.model.graphHashAtRun).toBe(summary?.graph_hash_at_run ?? null);
  });

  it('is deterministic: same input → deeply-equal output', () => {
    const input = baseInput();
    expect(buildFrame(input)).toEqual(buildFrame(input));
  });

  it('does not mutate its input (pure / total)', () => {
    const input = baseInput();
    const before = JSON.stringify(input);
    buildFrame(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('surfaces no held science — scan stems stay in sync with the claim-permission table', () => {
    // Broad prose/value stems, one+ per held-science class. The meta-check keeps
    // the list in sync with the AUTHORITATIVE set (DEFAULT_CLAIM_PERMISSIONS keys =
    // HeldScienceClaimClass): add a class and the test fails until a stem covers
    // it, so the guard can't silently drift (it now covers influence_driver via
    // 'driver' and m1_coaching via 'coaching', which the old fixed list missed).
    const scanStems = ['flip', 'robust', 'sensitiv', 'elasticity', 'evpi', 'fragil', 'causal', 'driver', 'coaching'];
    for (const cls of Object.keys(DEFAULT_CLAIM_PERMISSIONS)) {
      expect(
        scanStems.some((s) => cls.toLowerCase().includes(s)),
        `held-science class '${cls}' is not covered by any scan stem — add one`,
      ).toBe(true);
    }
    // The frame MINUS the (held-by-default) permission table must name no held class.
    const { claimPermissions, ...rest } = buildFrame(baseInput());
    void claimPermissions; // destructured out only to EXCLUDE it from the scan below
    const json = JSON.stringify(rest).toLowerCase();
    for (const stem of scanStems) {
      expect(
        json,
        `held-science term "${stem}" must not appear outside the permission table`,
      ).not.toContain(stem);
    }
  });

  it('source-scan guard: build-frame.ts imports ONLY the permitted-pure modules (allowlist)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../build-frame.ts', import.meta.url)),
      'utf8',
    );
    // Allowlist beats a denylist: any module not listed here — a new derivation
    // authority imported by name, a bare side-effect `import '../freshness.js';`,
    // or a namespace import — fails BY CONSTRUCTION, instead of hoping every
    // forbidden symbol/path was enumerated.
    const ALLOWED = new Set([
      '../canonical-analysis-state.js',
      './claim-permissions.js',
      './types.js',
    ]);
    // Every import specifier, including a bare side-effect `import '...';`.
    const specifiers = [...src.matchAll(/import[\s\S]*?'([^']+)'\s*;/g)].map((m) => m[1]);
    expect(specifiers.length, 'build-frame.ts should import at least one module').toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(ALLOWED.has(spec), `build-frame.ts imports a non-allowlisted module: ${spec}`).toBe(true);
    }
    // From the (allowlisted) analysis-state authority, ONLY the pure redacted
    // projection may be imported — never a derivation / selection function. Scan
    // ALL import statements (not just the first canonical-analysis-state one) so a
    // second, malicious import of the same module can't slip past.
    const allNamedImports = (src.match(/import[\s\S]*?from\s*'[^']+';/g) ?? []).join('\n');
    for (const derivation of [
      'deriveAnalysisFreshness',
      'selectCanonicalAnalysisState',
      'canonicalStateFromFreshness',
    ]) {
      expect(allNamedImports, `must not import ${derivation} from the analysis-state authority`).not.toContain(
        derivation,
      );
    }
    // Namespace / dynamic import() / require() would side-load a whole (even
    // allowlisted) module's derivation surface without a named specifier — forbid.
    expect(src, 'no namespace import').not.toMatch(/import\s+\*\s+as\s/);
    expect(src, 'no dynamic import()').not.toMatch(/\bimport\s*\(/);
    expect(src, 'no require()').not.toMatch(/\brequire\s*\(/);
  });
});
