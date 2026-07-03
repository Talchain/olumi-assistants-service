import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  selectTwoNewestRunAnalysisFacts,
  projectRunFact,
  compareRuns,
  deriveRerunReadiness,
} from '../compare-runs.js';
import { compactAnalysis } from '../../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// ── fixtures ───────────────────────────────────────────────────────────

interface OptionSpec {
  id: string;
  label: string;
  win: number;
  drivers?: Array<{ id: string; label: string; sensitivity: number }>;
}

function envelope(opts: {
  options: OptionSpec[];
  band?: string; // robustness_synthesis.overall_assessment
  status?: string;
}): V2RunResponseEnvelope {
  return {
    analysis_status: opts.status ?? 'completed',
    results: opts.options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: (o.drivers ?? []).map((d) => ({
        node_id: d.id,
        label: d.label,
        sensitivity: d.sensitivity,
        direction: 'increases',
      })),
    })),
    ...(opts.band ? { robustness_synthesis: { overall_assessment: opts.band } } : {}),
  } as unknown as V2RunResponseEnvelope;
}

function makeRunFact(
  env: V2RunResponseEnvelope,
  meta?: { noop?: boolean; computed_at?: string; graph_hash?: string; status?: string },
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: meta?.noop ?? false,
    result: {
      enrichment: env,
      computed_at: meta?.computed_at ?? '2026-06-06T00:00:00.000Z',
      graph_hash_at_run: meta?.graph_hash ?? 'hash-1',
    },
  } as unknown as HandlerFact;
}

function otherFact(factType: string): HandlerFact {
  return { fact_type: factType, noop: false, result: {} } as unknown as HandlerFact;
}

// prior: Offshore leads 0.62 vs 0.38 (margin 24pp), fragile band.
const PRIOR_ENV = envelope({
  options: [
    { id: 'a', label: 'Offshore', win: 0.62, drivers: [
      { id: 'q', label: 'Quality', sensitivity: 0.5 },
      { id: 'c', label: 'Communication overhead', sensitivity: 0.3 },
    ] },
    { id: 'b', label: 'Onshore', win: 0.38 },
  ],
  band: 'low', // → fragile
});

// current: Onshore leads 0.55 vs 0.45 (margin 10pp, narrowed), stable band,
// driver ranks swapped (Communication overhead now #1).
const CURRENT_ENV = envelope({
  options: [
    { id: 'b', label: 'Onshore', win: 0.55, drivers: [
      { id: 'c', label: 'Communication overhead', sensitivity: 0.6 },
      { id: 'q', label: 'Quality', sensitivity: 0.4 },
    ] },
    { id: 'a', label: 'Offshore', win: 0.45 },
  ],
  band: 'high', // → stable
});

// ── selectTwoNewestRunAnalysisFacts ────────────────────────────────────

describe('selectTwoNewestRunAnalysisFacts', () => {
  it('returns null with fewer than two successful runs', () => {
    expect(selectTwoNewestRunAnalysisFacts([])).toBeNull();
    expect(selectTwoNewestRunAnalysisFacts([makeRunFact(CURRENT_ENV)])).toBeNull();
  });

  it('returns [newest, prior] preserving newest-first order', () => {
    const newest = makeRunFact(CURRENT_ENV);
    const prior = makeRunFact(PRIOR_ENV);
    const pair = selectTwoNewestRunAnalysisFacts([newest, prior]);
    expect(pair).not.toBeNull();
    expect(pair!.current).toBe(newest);
    expect(pair!.prior).toBe(prior);
  });

  it('ignores noop facts, non-run facts, and failed runs', () => {
    const noop = makeRunFact(CURRENT_ENV, { noop: true });
    const edit = otherFact('set_factor_value');
    const failed = makeRunFact(envelope({ options: [{ id: 'a', label: 'A', win: 0.9 }], status: 'failed' }));
    const good1 = makeRunFact(CURRENT_ENV);
    const good2 = makeRunFact(PRIOR_ENV);
    const pair = selectTwoNewestRunAnalysisFacts([noop, edit, good1, failed, good2]);
    expect(pair).not.toBeNull();
    expect(pair!.current).toBe(good1);
    expect(pair!.prior).toBe(good2);
  });
});

// ── projectRunFact ─────────────────────────────────────────────────────

describe('projectRunFact', () => {
  it('projects enrichment to a summary', () => {
    const s = projectRunFact(makeRunFact(PRIOR_ENV));
    expect(s).not.toBeNull();
    expect(s!.winner.option_label).toBe('Offshore');
    expect(s!.margin_pp).toBe(24);
  });

  it('returns null when enrichment is missing', () => {
    const fact = { fact_type: 'run_analysis', noop: false, result: {} } as unknown as HandlerFact;
    expect(projectRunFact(fact)).toBeNull();
  });

  it('returns null when analysis is blocked/failed', () => {
    const fact = makeRunFact(envelope({ options: [{ id: 'a', label: 'A', win: 0.9 }], status: 'failed' }));
    expect(projectRunFact(fact)).toBeNull();
  });
});

// ── compareRuns ────────────────────────────────────────────────────────

describe('compareRuns', () => {
  it('detects a leading-option flip with narrowed margin, band change, and driver rank swap', () => {
    const prior = compactAnalysis(PRIOR_ENV)!;
    const current = compactAnalysis(CURRENT_ENV)!;
    const delta = compareRuns(prior, current);

    expect(delta.comparable).toBe(true);
    expect(delta.leading_option_changed).toBe(true);
    expect(delta.prior_leading_label).toBe('Offshore');
    expect(delta.current_leading_label).toBe('Onshore');
    expect(delta.margin_direction).toBe('narrowed');
    expect(delta.margin_shift_pp).toBe(-14);
    expect(delta.robustness_changed).toBe(true);
    expect(delta.prior_band).toBe('fragile');
    expect(delta.current_band).toBe('stable');
    // Communication overhead 2 → 1, Quality 1 → 2; largest-mover tiebreak by label.
    expect(delta.driver_rank_changes).toEqual([
      { factor_label: 'Communication overhead', from_rank: 2, to_rank: 1 },
      { factor_label: 'Quality', from_rank: 1, to_rank: 2 },
    ]);
  });

  it('reports a widened margin and no flip', () => {
    const prior = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'A', win: 0.55 }, { id: 'b', label: 'B', win: 0.45 }] }))!;
    const current = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'A', win: 0.70 }, { id: 'b', label: 'B', win: 0.30 }] }))!;
    const delta = compareRuns(prior, current);
    expect(delta.leading_option_changed).toBe(false);
    expect(delta.margin_direction).toBe('widened');
    expect(delta.margin_shift_pp).toBe(30);
  });

  it('reports unchanged margin within the epsilon', () => {
    const prior = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'A', win: 0.60 }, { id: 'b', label: 'B', win: 0.40 }] }))!;
    const current = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'A', win: 0.602 }, { id: 'b', label: 'B', win: 0.398 }] }))!;
    const delta = compareRuns(prior, current);
    expect(delta.margin_direction).toBe('unchanged');
  });

  it('reports margin unavailable when a run has fewer than two options', () => {
    const prior = compactAnalysis(envelope({ options: [{ id: 'a', label: 'A', win: 0.9 }] }))!;
    const current = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'A', win: 0.7 }, { id: 'b', label: 'B', win: 0.3 }] }))!;
    const delta = compareRuns(prior, current);
    expect(delta.margin_direction).toBe('unavailable');
    expect(delta.margin_shift_pp).toBe(0);
  });

  it('marks comparable:false when a winner label is empty', () => {
    const prior = compactAnalysis(envelope({ options: [] }))!;
    const current = compactAnalysis(CURRENT_ENV)!;
    const delta = compareRuns(prior, current);
    expect(delta.comparable).toBe(false);
  });
});

describe('compareRuns — Spine A option-controlled-driver suppression', () => {
  // `fac_lever` is option-controlled; the others are external/tunable.
  const onshore = (win: number) => ({ id: 'b', label: 'Onshore', win });

  it('excludes an option-controlled lever from driver_rank_changes', () => {
    const prior = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9 },
        { id: 'fac_ext', label: 'Market demand', sensitivity: 0.5 },
      ] },
      onshore(0.38),
    ] }))!;
    const current = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_ext', label: 'Market demand', sensitivity: 0.9 },
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.5 },
      ] },
      onshore(0.38),
    ] }))!;
    const guarded = compareRuns(prior, current, new Set(['fac_lever'])).driver_rank_changes.map(
      (d) => d.factor_label,
    );
    expect(guarded).not.toContain('Capacity');
    // Load-bearing: without the controlled set the comparator WOULD report it.
    const unguarded = compareRuns(prior, current).driver_rank_changes.map((d) => d.factor_label);
    expect(unguarded).toContain('Capacity');
  });

  it('still reports an external driver rank change (no over-suppression)', () => {
    const prior = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9 },
        { id: 'fac_b', label: 'Brand sentiment', sensitivity: 0.5 },
        { id: 'fac_c', label: 'Conversion rate', sensitivity: 0.3 },
      ] },
      onshore(0.38),
    ] }))!;
    const current = compactAnalysis(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9 },
        { id: 'fac_c', label: 'Conversion rate', sensitivity: 0.5 },
        { id: 'fac_b', label: 'Brand sentiment', sensitivity: 0.3 },
      ] },
      onshore(0.38),
    ] }))!;
    const labels = compareRuns(prior, current, new Set(['fac_lever'])).driver_rank_changes.map(
      (d) => d.factor_label,
    );
    expect(labels).not.toContain('Capacity');
    expect(labels).toEqual(expect.arrayContaining(['Brand sentiment', 'Conversion rate']));
  });
});

describe('deriveRerunReadiness — Track 2 rerun/what-changed readiness composition', () => {
  const run = () => makeRunFact(envelope({ options: [{ id: 'a', label: 'A', win: 0.6 }] }));
  const failedRun = () =>
    makeRunFact(envelope({ options: [{ id: 'a', label: 'A', win: 0.6 }], status: 'failed' }));

  it('no facts → 0 successful runs, comparison NOT ready', () => {
    expect(deriveRerunReadiness([], 'fresh')).toEqual({
      priorSuccessfulRunCount: 0,
      comparisonCandidatesReady: false,
    });
  });

  it('one successful run + fresh → count 1 but NOT ready (needs ≥2)', () => {
    expect(deriveRerunReadiness([run()], 'fresh')).toEqual({
      priorSuccessfulRunCount: 1,
      comparisonCandidatesReady: false,
    });
  });

  it('two successful runs + fresh → count 2 AND ready (the positive path)', () => {
    expect(deriveRerunReadiness([run(), run()], 'fresh')).toEqual({
      priorSuccessfulRunCount: 2,
      comparisonCandidatesReady: true,
    });
  });

  it('two successful runs but STALE → ready is false (the freshness conjunct)', () => {
    expect(deriveRerunReadiness([run(), run()], 'stale')).toEqual({
      priorSuccessfulRunCount: 2,
      comparisonCandidatesReady: false,
    });
  });

  it('two successful runs but UNKNOWN freshness → ready is false', () => {
    expect(deriveRerunReadiness([run(), run()], 'unknown').comparisonCandidatesReady).toBe(false);
  });

  it('two successful runs but NONE freshness → ready is false', () => {
    expect(deriveRerunReadiness([run(), run()], 'none').comparisonCandidatesReady).toBe(false);
  });

  it('only successful runs are counted (failed + non-run facts excluded from the count)', () => {
    const facts = [run(), failedRun(), otherFact('edit_graph'), run()];
    expect(deriveRerunReadiness(facts, 'fresh')).toEqual({
      priorSuccessfulRunCount: 2,
      comparisonCandidatesReady: true,
    });
  });

  it('one successful + one failed + fresh → NOT ready (only one countable run)', () => {
    expect(deriveRerunReadiness([run(), failedRun()], 'fresh')).toEqual({
      priorSuccessfulRunCount: 1,
      comparisonCandidatesReady: false,
    });
  });
});
