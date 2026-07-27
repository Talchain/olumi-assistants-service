import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  selectTwoNewestRunAnalysisFacts,
  projectRunFact,
  compareRuns,
  deriveRerunReadiness,
  type RunProjection,
} from '../compare-runs.js';
import { selectRunAnalysisFact } from '../../context/freshness.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// ── fixtures ───────────────────────────────────────────────────────────

interface OptionSpec {
  id: string;
  label: string;
  win: number;
  // DGAI #341: fixtures now carry `influence_score` alongside `sensitivity`
  // because driver ranking reads influence_score (see `envelope` below).
  drivers?: Array<{ id: string; label: string; sensitivity: number; influence_score: number }>;
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
        // DGAI #341: driver ranking reads influence_score; fixtures supply it
        // explicitly (direction carried separately by `sensitivity`'s sign).
        influence_score: d.influence_score,
        direction: 'increases',
      })),
    })),
    ...(opts.band ? { robustness_synthesis: { overall_assessment: opts.band } } : {}),
  } as unknown as V2RunResponseEnvelope;
}

function makeRunFact(
  env: V2RunResponseEnvelope,
  meta?: {
    noop?: boolean;
    /** `null` OMITS the key entirely — the legacy pre-0.10.0 shape. */
    computed_at?: string | null;
    graph_hash?: string;
    status?: string;
  },
): HandlerFact {
  const computedAt =
    meta?.computed_at === undefined ? '2026-06-06T00:00:00.000Z' : meta.computed_at;
  const result: Record<string, unknown> = {
    enrichment: env,
    graph_hash_at_run: meta?.graph_hash ?? 'hash-1',
  };
  if (computedAt !== null) result.computed_at = computedAt;
  return {
    fact_type: 'run_analysis',
    noop: meta?.noop ?? false,
    result,
  } as unknown as HandlerFact;
}

function otherFact(factType: string): HandlerFact {
  return { fact_type: factType, noop: false, result: {} } as unknown as HandlerFact;
}

/**
 * Project an envelope the way production does — through `projectRunFact`, so
 * the leader IDENTITY the comparator reads is derived from the raw enrichment
 * rather than hand-supplied by the test.
 */
function projectEnv(env: V2RunResponseEnvelope): RunProjection {
  return projectRunFact(makeRunFact(env))!;
}

// prior: Offshore leads 0.62 vs 0.38 (margin 24pp), fragile band.
const PRIOR_ENV = envelope({
  options: [
    { id: 'a', label: 'Offshore', win: 0.62, drivers: [
      { id: 'q', label: 'Quality', sensitivity: 0.5, influence_score: 0.5 },
      { id: 'c', label: 'Communication overhead', sensitivity: 0.3, influence_score: 0.3 },
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
      { id: 'c', label: 'Communication overhead', sensitivity: 0.6, influence_score: 0.6 },
      { id: 'q', label: 'Quality', sensitivity: 0.4, influence_score: 0.4 },
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

  // ── F2: ONE ORDERING. The pair selector and the canonical freshness
  // selector must agree on WHICH fact is "current". Before the fix the pair
  // was taken by ARRAY POSITION while `selectRunAnalysisFact` sorted by
  // `computed_at` desc (nulls last), so the two disagreed whenever insertion
  // order ≠ computed_at order — and the run that grounded
  // `freshness === 'fresh'` was not the run the comparison called `current`.
  it('F2 RED: a legacy fact with no computed_at at position 0 is NOT the current run', () => {
    const legacy = makeRunFact(PRIOR_ENV, { computed_at: null });
    const timestamped = makeRunFact(CURRENT_ENV, { computed_at: '2026-07-01T00:00:00.000Z' });
    const pair = selectTwoNewestRunAnalysisFacts([legacy, timestamped]);
    expect(pair).not.toBeNull();
    // The canonical selector puts untimestamped facts LAST.
    expect(pair!.current).toBe(timestamped);
    expect(pair!.prior).toBe(legacy);
  });

  it('F2 RED: computed_at skew inverts the roles the array order would have given', () => {
    const older = makeRunFact(PRIOR_ENV, { computed_at: '2026-06-01T00:00:00.000Z' });
    const newer = makeRunFact(CURRENT_ENV, { computed_at: '2026-06-09T00:00:00.000Z' });
    // Insertion order says `older` is current; computed_at says `newer` is.
    const pair = selectTwoNewestRunAnalysisFacts([older, newer]);
    expect(pair!.current).toBe(newer);
    expect(pair!.prior).toBe(older);
  });

  it('F2 RED: the pair’s current IS the fact the freshness verdict was derived from', () => {
    // The property the freshness docstring claims ("one ordering") — pinned
    // against the canonical selector itself, not against a copy of its rule.
    const legacy = makeRunFact(PRIOR_ENV, { computed_at: null });
    const mid = makeRunFact(PRIOR_ENV, { computed_at: '2026-06-02T00:00:00.000Z' });
    const newest = makeRunFact(CURRENT_ENV, { computed_at: '2026-06-30T00:00:00.000Z' });
    for (const window of [
      [legacy, mid, newest],
      [mid, newest, legacy],
      [newest, legacy, mid],
    ]) {
      const pair = selectTwoNewestRunAnalysisFacts(window);
      expect(pair).not.toBeNull();
      expect(pair!.current).toBe(selectRunAnalysisFact(window)!.fact);
      expect(pair!.current).toBe(newest);
      expect(pair!.prior).toBe(mid);
    }
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
    expect(s!.summary.winner.option_label).toBe('Offshore');
    expect(s!.summary.margin_pp).toBe(24);
    // The leading option's identity comes off the RAW record, not the label.
    expect(s!.leader_option_id).toBe('a');
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
    const prior = projectEnv(PRIOR_ENV);
    const current = projectEnv(CURRENT_ENV);
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
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'A', win: 0.55 }, { id: 'b', label: 'B', win: 0.45 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'A', win: 0.70 }, { id: 'b', label: 'B', win: 0.30 }] }));
    const delta = compareRuns(prior, current);
    expect(delta.leading_option_changed).toBe(false);
    expect(delta.margin_direction).toBe('widened');
    expect(delta.margin_shift_pp).toBe(30);
  });

  it('reports unchanged margin within the epsilon', () => {
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'A', win: 0.60 }, { id: 'b', label: 'B', win: 0.40 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'A', win: 0.602 }, { id: 'b', label: 'B', win: 0.398 }] }));
    const delta = compareRuns(prior, current);
    expect(delta.margin_direction).toBe('unchanged');
  });

  it('reports margin unavailable when a run has fewer than two options', () => {
    const prior = projectEnv(envelope({ options: [{ id: 'a', label: 'A', win: 0.9 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'A', win: 0.7 }, { id: 'b', label: 'B', win: 0.3 }] }));
    const delta = compareRuns(prior, current);
    expect(delta.margin_direction).toBe('unavailable');
    expect(delta.margin_shift_pp).toBe(0);
  });

  it('marks comparable:false when a winner label is empty', () => {
    const prior = projectEnv(envelope({ options: [] }));
    const current = projectEnv(CURRENT_ENV);
    const delta = compareRuns(prior, current);
    expect(delta.comparable).toBe(false);
  });
});

// ── F3: leader identity is the OPTION ID ───────────────────────────────
//
// `graph-hash.ts` excludes labels from the analysis-affecting hash, so a
// rename → re-run stays `fresh` and both runs stay permitted. Comparing
// LABELS therefore let a pure rename reach the both-permitted prose arm and
// assert "X came out ahead before, and Y now leads" about one option.
describe('compareRuns — leader identity is the option id, not the label (F3)', () => {
  /** Legacy enrichment: labels + probabilities, NO `option_id` anywhere. */
  function labelOnlyEnvelope(
    options: Array<{ label: string; win: number }>,
  ): V2RunResponseEnvelope {
    return {
      analysis_status: 'completed',
      results: options.map((o) => ({ option_label: o.label, win_probability: o.win })),
    } as unknown as V2RunResponseEnvelope;
  }

  it('a RENAME of the same leading option is NOT a leader change', () => {
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore (EU)', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }] }));
    const delta = compareRuns(prior, current);
    expect(delta.comparable).toBe(true);
    expect(delta.leader_identity_basis).toBe('option_id');
    expect(delta.leading_option_changed).toBe(false);
    // The labels are still reported verbatim — display is not identity.
    expect(delta.prior_leading_label).toBe('Offshore');
    expect(delta.current_leading_label).toBe('Offshore (EU)');
  });

  it('TRUE-POSITIVE CONTROL: a real id change still reports the change, with the new label', () => {
    // Without this the assertion above would pass identically against a
    // comparator that reports `false` unconditionally.
    const delta = compareRuns(projectEnv(PRIOR_ENV), projectEnv(CURRENT_ENV));
    expect(delta.leader_identity_basis).toBe('option_id');
    expect(delta.leading_option_changed).toBe(true);
    expect(delta.current_leading_label).toBe('Onshore');
  });

  it('an id change whose LABEL is unchanged is still a leader change', () => {
    // The mirror of the rename case: two distinct options sharing a display
    // label. Labels cannot see this; ids can.
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'Partner', win: 0.62 }, { id: 'b', label: 'Build', win: 0.38 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'b', label: 'Partner', win: 0.62 }, { id: 'a', label: 'Build', win: 0.38 }] }));
    expect(compareRuns(prior, current).leading_option_changed).toBe(true);
  });

  it('LEGACY: no option_id on either run ⇒ indeterminate, and never a change claim', () => {
    const prior = projectEnv(labelOnlyEnvelope([
      { label: 'Offshore', win: 0.62 }, { label: 'Onshore', win: 0.38 }]));
    const current = projectEnv(labelOnlyEnvelope([
      { label: 'Offshore (EU)', win: 0.62 }, { label: 'Onshore', win: 0.38 }]));
    // compactAnalysis falls back `option_id <- option_label`, so a naive id
    // compare would have degraded silently back into a label compare here.
    expect(prior.summary.winner.option_id).toBe('Offshore');
    expect(prior.leader_option_id).toBeNull();
    const delta = compareRuns(prior, current);
    expect(delta.comparable).toBe(true);
    expect(delta.leader_identity_basis).toBe('indeterminate');
    expect(delta.leading_option_changed).toBe(false);
  });

  it('LEGACY: one identified run + one legacy run is still indeterminate', () => {
    const prior = projectEnv(labelOnlyEnvelope([
      { label: 'Offshore', win: 0.62 }, { label: 'Onshore', win: 0.38 }]));
    const current = projectEnv(envelope({ options: [
      { id: 'b', label: 'Onshore', win: 0.62 }, { id: 'a', label: 'Offshore', win: 0.38 }] }));
    expect(current.leader_option_id).toBe('b');
    const delta = compareRuns(prior, current);
    expect(delta.leader_identity_basis).toBe('indeterminate');
    // The leaders genuinely differ here — and we still decline to say so,
    // because we cannot prove it. A false "nothing changed" is the cheaper
    // error than a false "your leader changed".
    expect(delta.leading_option_changed).toBe(false);
  });

  // ⚠ The confirmation must be anchored to the CROWNED entry. An EXISTENTIAL
  // check ("some entry in this source carries that id") is defeated by a
  // SIBLING option whose own id collides with the id-less leader's
  // label-fallback — which re-manufactures exactly the false "your leader
  // changed" F3 exists to remove, now wearing basis `option_id`.
  it('A3: an id-less leader is NOT confirmed by a SIBLING option carrying that id', () => {
    const priorEnv = {
      analysis_status: 'completed',
      results: [
        { option_label: 'Offshore', win_probability: 0.62 }, // leader, NO id
        { option_id: 'Offshore', option_label: 'Onshore', win_probability: 0.38 },
      ],
    } as unknown as V2RunResponseEnvelope;
    const prior = projectEnv(priorEnv);
    expect(prior.summary.winner.option_label).toBe('Offshore');
    // compactAnalysis' label fallback makes the projected winner id collide
    // with the SIBLING's genuine id.
    expect(prior.summary.winner.option_id).toBe('Offshore');
    expect(prior.leader_option_id).toBeNull();

    const current = projectEnv(envelope({ options: [
      { id: 'b', label: 'Onshore', win: 0.62 }, { id: 'a', label: 'Offshore', win: 0.38 }] }));
    const delta = compareRuns(prior, current);
    expect(delta.leader_identity_basis).toBe('indeterminate');
    expect(delta.leading_option_changed).toBe(false);
  });

  it('A3: nor by a sibling that ALSO shares the leader’s label (win_probability separates them)', () => {
    // Hardest form: the sibling matches the crowned entry on both id and
    // label, so only the third field of the anchor can reject it.
    const priorEnv = {
      analysis_status: 'completed',
      results: [
        { option_label: 'Offshore', win_probability: 0.62 }, // leader, NO id
        { option_id: 'Offshore', option_label: 'Offshore', win_probability: 0.38 },
      ],
    } as unknown as V2RunResponseEnvelope;
    const prior = projectEnv(priorEnv);
    expect(prior.leader_option_id).toBeNull();
  });

  it('an id that HAPPENS to equal the label is still a real identity', () => {
    // The structural-coincidence trap: `option_id === option_label` is not
    // evidence of a missing id. Reading the RAW record rather than inferring
    // from compactAnalysis's fallback is what makes this case work.
    const prior = projectEnv(envelope({ options: [
      { id: 'Offshore', label: 'Offshore', win: 0.62 },
      { id: 'b', label: 'Onshore', win: 0.38 }] }));
    const current = projectEnv(envelope({ options: [
      { id: 'Offshore', label: 'Offshore (EU)', win: 0.62 },
      { id: 'b', label: 'Onshore', win: 0.38 }] }));
    expect(prior.leader_option_id).toBe('Offshore');
    const delta = compareRuns(prior, current);
    expect(delta.leader_identity_basis).toBe('option_id');
    expect(delta.leading_option_changed).toBe(false);
  });
});

describe('compareRuns — Spine A option-controlled-driver suppression', () => {
  // `fac_lever` is option-controlled; the others are external/tunable.
  const onshore = (win: number) => ({ id: 'b', label: 'Onshore', win });

  it('excludes an option-controlled lever from driver_rank_changes', () => {
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9, influence_score: 0.9 },
        { id: 'fac_ext', label: 'Market demand', sensitivity: 0.5, influence_score: 0.5 },
      ] },
      onshore(0.38),
    ] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_ext', label: 'Market demand', sensitivity: 0.9, influence_score: 0.9 },
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.5, influence_score: 0.5 },
      ] },
      onshore(0.38),
    ] }));
    const guarded = compareRuns(prior, current, new Set(['fac_lever'])).driver_rank_changes.map(
      (d) => d.factor_label,
    );
    expect(guarded).not.toContain('Capacity');
    // Load-bearing: without the controlled set the comparator WOULD report it.
    const unguarded = compareRuns(prior, current).driver_rank_changes.map((d) => d.factor_label);
    expect(unguarded).toContain('Capacity');
  });

  it('still reports an external driver rank change (no over-suppression)', () => {
    const prior = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9, influence_score: 0.9 },
        { id: 'fac_b', label: 'Brand sentiment', sensitivity: 0.5, influence_score: 0.5 },
        { id: 'fac_c', label: 'Conversion rate', sensitivity: 0.3, influence_score: 0.3 },
      ] },
      onshore(0.38),
    ] }));
    const current = projectEnv(envelope({ options: [
      { id: 'a', label: 'Offshore', win: 0.62, drivers: [
        { id: 'fac_lever', label: 'Capacity', sensitivity: 0.9, influence_score: 0.9 },
        { id: 'fac_c', label: 'Conversion rate', sensitivity: 0.5, influence_score: 0.5 },
        { id: 'fac_b', label: 'Brand sentiment', sensitivity: 0.3, influence_score: 0.3 },
      ] },
      onshore(0.38),
    ] }));
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
