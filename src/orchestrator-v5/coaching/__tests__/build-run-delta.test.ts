/**
 * `buildRunDelta` — the consequence producer.
 *
 * ⭐ WHAT THIS SUITE IS FOR. Every assertion here is about a claim that reaches
 * a user's screen, so the standard is not "does the function return something"
 * but "can it ever return something it has not observed". The suite is written
 * against the CONTRACT's semantics (`@talchain/schemas` `run-delta.ts`), not
 * against the shape this implementation happens to produce — a suite derived
 * from the implementation is a guard agreeing with itself.
 *
 * ⚠ EVERY OPTION ASSERTION BINDS BY `option_id`, NEVER BY VALUE. A test that
 * finds a row by `win_probability === 0.62` can be satisfied by a DIFFERENT
 * option that happens to share the number (CLAUDE.md trap 19), which is exactly
 * the defect the producer's identity-binding exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { RunDeltaSchema } from '@talchain/schemas/boundary';

import { RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED } from '../../compose/claim-safety-cage.js';
import { buildRunDelta } from '../build-run-delta.js';

interface OptionSpec {
  readonly id?: string;
  readonly label?: string;
  readonly win: number;
}

interface FactSpec {
  readonly options: readonly OptionSpec[];
  readonly seed?: string | number | null;
  readonly nSamples?: number | null;
  readonly hash?: string;
  readonly computedAt?: string;
  readonly builds?: Record<string, string | null> | null;
  readonly entitled?: boolean;
  /** Producer-attested option separation. `null` means unavailable. */
  readonly nearTie?: boolean | null;
}

/**
 * A persisted `run_analysis` fact.
 *
 * The `constraint_verdict` stamp is REQUIRED on any fixture that expects leader
 * ids to travel: an unstamped completed analysis reads as "unknown", not
 * "verified feasible", and `readMayNameLeadingOptionVerdictForFact` has been
 * fail-closed on that since #710. Its presence here makes the fixture model
 * what it means — a real, constraint-checked run — and REMOVING it turns the
 * leader assertions red, so the fixture doubles as a mutation check on the
 * per-run gate.
 */
function fact(spec: FactSpec): HandlerFact {
  const meta: Record<string, unknown> = {};
  if (spec.seed !== null) meta.seed_used = spec.seed ?? '4242';
  if (spec.nSamples !== null) meta.n_samples = spec.nSamples ?? 10_000;

  const enrichment: Record<string, unknown> = {
    analysis_status: 'completed',
    ...(spec.nearTie === null
      ? {}
      : {
          robustness_status: 'computed',
          robustness: {
            level: 'high',
            near_tie: { is_tie: spec.nearTie ?? false },
          },
        }),
    results: spec.options.map((o) => ({
      ...(o.id !== undefined ? { option_id: o.id } : {}),
      ...(o.label !== undefined ? { option_label: o.label } : {}),
      win_probability: o.win,
    })),
    meta,
    ...(spec.builds !== undefined && spec.builds !== null
      ? { _meta: { builds: spec.builds } }
      : {}),
  };

  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment,
      computed_at: spec.computedAt ?? '2026-06-06T00:00:00.000Z',
      graph_hash_at_run: spec.hash ?? 'hash-a',
      constraint_verdict: {
        may_name_leading_option: spec.entitled ?? true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
    },
  } as unknown as HandlerFact;
}

const OPTIONS_PRIOR = [
  { id: 'opt-a', label: 'Offshore', win: 0.62 },
  { id: 'opt-b', label: 'Onshore', win: 0.38 },
] as const;
const OPTIONS_CURRENT = [
  { id: 'opt-a', label: 'Offshore', win: 0.45 },
  { id: 'opt-b', label: 'Onshore', win: 0.55 },
] as const;

/** Newest first, which is how the turn loader delivers `prior_facts`. */
function pair(prior: HandlerFact, current: HandlerFact): HandlerFact[] {
  return [current, prior];
}

function build(
  facts: readonly HandlerFact[],
  mayName = true,
  currentLeaderDesignationPermitted = true,
) {
  return buildRunDelta({
    priorFacts: facts,
    mayNameLeadingOption: mayName,
    currentLeaderDesignationPermitted,
  });
}

/**
 * The FACTOR-VALUE-EDIT pair: PLoT derives its seed from a graph projection
 * that INCLUDES `observed_state.value`, so an edit to a factor value moves the
 * seed AND the analysis hash together. This is the slice's target class.
 */
const FVE_PRIOR = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' });
const FVE_CURRENT = fact({ options: OPTIONS_CURRENT, seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z' });

describe('buildRunDelta — refusals are discriminated, never a bare null', () => {
  it('refuses with insufficient_runs when fewer than two successful runs exist', () => {
    expect(build([FVE_CURRENT])).toEqual({ kind: 'none', reason: 'insufficient_runs' });
    expect(build([])).toEqual({ kind: 'none', reason: 'insufficient_runs' });
  });

  it('refuses with echoes_incomplete when the seed echo is absent on either side', () => {
    const noSeed = fact({ options: OPTIONS_CURRENT, seed: null, hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z' });
    expect(build(pair(FVE_PRIOR, noSeed))).toEqual({ kind: 'none', reason: 'echoes_incomplete' });
    expect(build(pair(noSeed, FVE_CURRENT))).toEqual({ kind: 'none', reason: 'echoes_incomplete' });
  });

  it('refuses with echoes_incomplete when n_samples is absent', () => {
    const noN = fact({ options: OPTIONS_CURRENT, nSamples: null, seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z' });
    expect(build(pair(FVE_PRIOR, noN))).toEqual({ kind: 'none', reason: 'echoes_incomplete' });
  });

  /**
   * The POSITIVE CONTROL for the two refusals above. Without it, an
   * `echoes_incomplete` assertion is satisfied by a producer that refuses
   * EVERYTHING — an absence test with no presence test proves nothing
   * (CLAUDE.md trap 13).
   */
  it('CONTROL: the same fixture WITH every echo present produces a delta', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
  });
});

describe('buildRunDelta — attribution is named only from an OBSERVED divergence', () => {
  it('a factor-value-edit pair (seed moved, hash moved) classifies C2_unpaired', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.attribution_case).toBe('C2_unpaired');
    expect(built.delta.pair_provenance).toEqual({
      seed_equal: false,
      hash_equal: false,
      builds_equal: 'unknown',
      n_equal: true,
    });
  });

  it('an unequal n_samples on an otherwise-paired run classifies C4_budget_drift', () => {
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', nSamples: 10_000, hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_CURRENT, seed: '111', nSamples: 5_000, hash: 'hash-a', computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.attribution_case).toBe('C4_budget_drift');
  });

  it('an OBSERVED build difference classifies C3_engine_drift', () => {
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds: { ui: null, cee: null, plot: 'p1', isl: 'i1' }, computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_CURRENT, seed: '111', hash: 'hash-a', builds: { ui: null, cee: null, plot: 'p2', isl: 'i1' }, computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.attribution_case).toBe('C3_engine_drift');
    expect(built.delta.pair_provenance.builds_equal).toBe('unequal');
  });

  /**
   * ⭐ THE LOAD-BEARING RULE. An absent `_meta.builds` echo means we cannot
   * check whether the pipeline moved. Naming `C3_engine_drift` there would
   * assert a drift we never observed; naming `C0_identical` would assert a
   * verified identity we cannot verify. The honest answer is to emit nothing.
   */
  it('builds UNKNOWN with no other divergence REFUSES rather than inventing a case', () => {
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', computedAt: '2026-06-07T00:00:00.000Z' });
    expect(build(pair(prior, current))).toEqual({
      kind: 'none',
      reason: 'no_honest_attribution_case',
    });
  });

  /**
   * ⭐⭐ THE CORRECTED PREMISE, MADE EXECUTABLE. This codebase records that the
   * seed "is not pinned on the live path", implying C1_attributable is
   * structurally unreachable. It is not: PLoT derives the seed deterministically
   * from a projection that EXCLUDES `exists_probability` and `strength.std`,
   * while the canonical analysis hash INCLUDES them — so an edge-uncertainty
   * edit moves the hash and leaves the seed alone. With the builds echo riding,
   * that pair is genuinely C1. This test pins that, so a future lane cannot
   * "simplify" C1 away as dead code.
   */
  it('an uncertainty-only edit WITH the builds echo present classifies C1_attributable', () => {
    const builds = { ui: null, cee: null, plot: 'plot-1', isl: 'isl-1' };
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_CURRENT, seed: '111', hash: 'hash-b', builds, computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.attribution_case).toBe('C1_attributable');
    expect(built.delta.pair_provenance).toEqual({
      seed_equal: true,
      hash_equal: false,
      builds_equal: 'equal',
      n_equal: true,
    });
  });

  it('an identical re-run WITH the builds echo present classifies C0_identical', () => {
    const builds = { ui: null, cee: null, plot: 'plot-1', isl: 'isl-1' };
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.attribution_case).toBe('C0_identical');
  });

  /**
   * `null === null` is not evidence of equality. PLoT emits `ui`/`cee` as null
   * on a CEE-originated run, so a naive record comparison would read "equal"
   * having verified nothing about the two services that can actually change a
   * number.
   */
  it('builds present but with NULL compute members is UNKNOWN, never equal', () => {
    const builds = { ui: null, cee: null, plot: null, isl: null };
    const prior = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: OPTIONS_CURRENT, seed: '111', hash: 'hash-b', builds, computedAt: '2026-06-07T00:00:00.000Z' });
    // seed equal, n equal, builds unverifiable, hash differs — no honest case.
    expect(build(pair(prior, current))).toEqual({
      kind: 'none',
      reason: 'no_honest_attribution_case',
    });
  });
});

describe('buildRunDelta — win probabilities are IDENTITY-bound', () => {
  it('emits one row per option id present on BOTH sides, bound by id', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    const rows = built.delta.win_probabilities;
    expect(rows.map((r) => r.option_id)).toEqual(['opt-a', 'opt-b']);
    const a = rows.find((r) => r.option_id === 'opt-a');
    expect(a).toMatchObject({ option_id: 'opt-a', prior: 0.62, current: 0.45 });
    const b = rows.find((r) => r.option_id === 'opt-b');
    expect(b).toMatchObject({ option_id: 'opt-b', prior: 0.38, current: 0.55 });
  });

  /**
   * ⭐ THE LABEL TRAP, PINNED. `result.win_probabilities` — the obvious source —
   * is keyed by `option_label` first (`run-analysis.ts` `extractWinProbabilities`),
   * so a producer that used it would emit DISPLAY STRINGS in an identity-bound
   * field. Here the two runs share labels but have DIFFERENT ids: a label-keyed
   * producer would happily pair them; an id-bound one must emit nothing.
   */
  it('does NOT pair options that share a label but differ in id', () => {
    const prior = fact({
      options: [{ id: 'opt-old', label: 'Offshore', win: 0.62 }, { id: 'opt-b', label: 'Onshore', win: 0.38 }],
      seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z',
    });
    const current = fact({
      options: [{ id: 'opt-new', label: 'Offshore', win: 0.45 }, { id: 'opt-b', label: 'Onshore', win: 0.55 }],
      seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z',
    });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    // Only the genuinely-shared id survives. 'Offshore' appears on both sides
    // as a LABEL and must not produce a row.
    expect(built.delta.win_probabilities.map((r) => r.option_id)).toEqual(['opt-b']);
  });

  it('drops an option carrying NO option_id rather than falling back to its label', () => {
    const prior = fact({
      options: [{ label: 'Offshore', win: 0.62 }, { id: 'opt-b', label: 'Onshore', win: 0.38 }],
      seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z',
    });
    const current = fact({
      options: [{ label: 'Offshore', win: 0.45 }, { id: 'opt-b', label: 'Onshore', win: 0.55 }],
      seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z',
    });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.win_probabilities.map((r) => r.option_id)).toEqual(['opt-b']);
  });

  it('drops BOTH entries when one option id appears twice (ambiguous, fail-closed)', () => {
    const prior = fact({
      options: [{ id: 'dup', label: 'A', win: 0.6 }, { id: 'dup', label: 'B', win: 0.4 }, { id: 'opt-b', label: 'C', win: 0.5 }],
      seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z',
    });
    const current = fact({
      options: [{ id: 'dup', label: 'A', win: 0.55 }, { id: 'opt-b', label: 'C', win: 0.45 }],
      seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z',
    });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.win_probabilities.map((r) => r.option_id)).toEqual(['opt-b']);
  });

  it('rows are ordered deterministically so a captured wire body is byte-stable', () => {
    const first = build(pair(FVE_PRIOR, FVE_CURRENT));
    const second = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('buildRunDelta — noise entitlement', () => {
  it('calls a large movement at n=10000 a SIGNAL', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    const a = built.delta.win_probabilities.find((r) => r.option_id === 'opt-a');
    // 0.62 -> 0.45 at n=10,000 is ~24 SE. Nothing subtle about it.
    expect(a?.noise_verdict).toBe('signal');
  });

  it('calls a tiny movement at n=10000 WITHIN NOISE', () => {
    const prior = fact({ options: [{ id: 'opt-a', label: 'A', win: 0.5 }, { id: 'opt-b', label: 'B', win: 0.5 }], seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: [{ id: 'opt-a', label: 'A', win: 0.502 }, { id: 'opt-b', label: 'B', win: 0.498 }], seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    const a = built.delta.win_probabilities.find((r) => r.option_id === 'opt-a');
    // 0.002 against an SE of ~0.00707: about 0.28 SE.
    expect(a?.noise_verdict).toBe('within_noise');
  });

  /**
   * The normal approximation needs both successes and failures to be numerous.
   * At n=8 with p=0.5 there are 4 of each — below the floor — so no honest band
   * exists and the movement is reported as direction only. A producer that
   * skipped this guard would emit a confident `signal`/`within_noise` verdict
   * from a band that does not hold.
   */
  it('reports NOT NOISE QUALIFIED when the normal approximation does not hold', () => {
    const prior = fact({ options: [{ id: 'opt-a', label: 'A', win: 0.5 }, { id: 'opt-b', label: 'B', win: 0.5 }], nSamples: 8, seed: '111', hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' });
    const current = fact({ options: [{ id: 'opt-a', label: 'A', win: 0.875 }, { id: 'opt-b', label: 'B', win: 0.125 }], nSamples: 8, seed: '222', hash: 'hash-b', computedAt: '2026-06-07T00:00:00.000Z' });
    const built = build(pair(prior, current));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    for (const row of built.delta.win_probabilities) {
      expect(row.noise_verdict).toBe('not_noise_qualified');
    }
  });
});

describe('buildRunDelta — leader entitlement', () => {
  it('carries both leader ids when the turn and both runs entitle the claim', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBe('opt-a');
    expect(built.delta.leader.current_leading_option_id).toBe('opt-b');
    expect(built.delta.leader.changed).toBe(true);
  });

  it('omits BOTH ids and refuses the change claim when the TURN withholds', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT), false);
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBeUndefined();
    expect(built.delta.leader.current_leading_option_id).toBeUndefined();
    // Absence of an id means "no entitled claim on that side", never "no leader
    // existed" — and `changed` compares entitled claims only.
    expect(built.delta.leader.changed).toBe(false);
  });

  it('omits ONE id when only that RUN withholds, and then makes no change claim', () => {
    const priorWithheld = fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', entitled: false, computedAt: '2026-06-06T00:00:00.000Z' });
    const built = build(pair(priorWithheld, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBeUndefined();
    expect(built.delta.leader.current_leading_option_id).toBe('opt-b');
    expect(built.delta.leader.changed).toBe(false);
  });

  it('omits only the CURRENT categorical id when its producer attests a near tie, preserving numerical evidence', () => {
    const currentNearTie = fact({
      options: OPTIONS_CURRENT,
      seed: '222',
      hash: 'hash-b',
      nearTie: true,
      computedAt: '2026-06-07T00:00:00.000Z',
    });
    const built = build(pair(FVE_PRIOR, currentNearTie));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader).toMatchObject({
      prior_leading_option_id: 'opt-a',
      changed: false,
    });
    expect(built.delta.leader.current_leading_option_id).toBeUndefined();
    expect(built.delta.win_probabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ option_id: 'opt-a', prior: 0.62, current: 0.45 }),
        expect.objectContaining({ option_id: 'opt-b', prior: 0.38, current: 0.55 }),
      ]),
    );
  });

  it('omits only the PRIOR categorical id when its producer attests a near tie', () => {
    const priorNearTie = fact({
      options: OPTIONS_PRIOR,
      seed: '111',
      hash: 'hash-a',
      nearTie: true,
      computedAt: '2026-06-06T00:00:00.000Z',
    });
    const built = build(pair(priorNearTie, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBeUndefined();
    expect(built.delta.leader.current_leading_option_id).toBe('opt-b');
    expect(built.delta.leader.changed).toBe(false);
  });

  it('current final authority withholds only the current id and cannot erase separately licensed numerical evidence', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT), true, false);
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBe('opt-a');
    expect(built.delta.leader.current_leading_option_id).toBeUndefined();
    expect(built.delta.leader.changed).toBe(false);
    expect(built.delta.win_probabilities).toHaveLength(2);
  });

  it('fails weak on absent producer separation rather than borrowing the constraint verdict', () => {
    const currentWithoutSeparation = fact({
      options: OPTIONS_CURRENT,
      seed: '222',
      hash: 'hash-b',
      nearTie: null,
      computedAt: '2026-06-07T00:00:00.000Z',
    });
    const built = build(pair(FVE_PRIOR, currentWithoutSeparation));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.prior_leading_option_id).toBe('opt-a');
    expect(built.delta.leader.current_leading_option_id).toBeUndefined();
    expect(built.delta.leader.changed).toBe(false);
  });

  it('never dresses an unqualified leader movement as signal in this slice', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.leader.noise_verdict).toBe('not_noise_qualified');
  });
});

describe('buildRunDelta — the contract polices the producer', () => {
  it('every emitted block parses against RunDeltaSchema, superRefine included', () => {
    const cases = [
      build(pair(FVE_PRIOR, FVE_CURRENT)),
      build(pair(FVE_PRIOR, FVE_CURRENT), false),
    ];
    for (const built of cases) {
      expect(built.kind).toBe('ok');
      if (built.kind !== 'ok') continue;
      expect(RunDeltaSchema.safeParse(built.delta).success).toBe(true);
    }
  });

  /**
   * The guard's own precondition, pinned in-test (CLAUDE.md trap 13b): this
   * proves `RunDeltaSchema` would actually REJECT a fabricated C1, so the
   * producer's `safeParse` gate is a real gate and not a formality that passes
   * whatever it is handed.
   */
  it('CONTROL: RunDeltaSchema rejects a C1 claim whose preconditions do not hold', () => {
    const fabricated = {
      attribution_case: 'C1_attributable',
      pair_provenance: { seed_equal: false, hash_equal: false, builds_equal: 'equal', n_equal: true },
      leader: { changed: false, noise_verdict: 'within_noise' },
      win_probabilities: [],
      flip_thresholds: [],
    };
    expect(RunDeltaSchema.safeParse(fabricated).success).toBe(false);
  });

  it('never emits edit_list or flip_threshold rows in this slice', () => {
    const built = build(pair(FVE_PRIOR, FVE_CURRENT));
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') return;
    expect(built.delta.edit_list).toBeUndefined();
    expect(built.delta.flip_thresholds).toEqual(
      RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED.flip_thresholds,
    );
  });

  /**
   * ⭐ THE TRIPWIRE ON THE WITHHELD FLIP-THRESHOLD SLOT.
   *
   * ⚠⚠ AND AN EARLIER VERSION OF THIS COMMENT HAD THE CLAIM EXACTLY BACKWARDS,
   * which is worth leaving on the record. It argued that "emptiness is the
   * property that makes the claim posture true". **It is the property that
   * makes it false.** The contract annotates this field "may be empty (no flip
   * rows on either side)" and Brief 4 §5 rules, for this exact field,
   * **"Absence: not 'no tipping point.'"** So an empty array read naively
   * ASSERTS there are no flip thresholds. This producer emits it because the
   * per-factor stability-band join is DEFERRED and it NEVER LOOKED — a
   * different fact, and the only honest one.
   *
   * The sibling `edit_list` avoids the trap structurally: `.min(1).optional()`
   * makes an empty list unrepresentable, so absence is the ONLY way it can say
   * "underivable". That asymmetry was diagnosed one field to the left and then
   * walked into here.
   *
   * SO WHAT THIS TEST IS FOR, PRECISELY: not to bless the emptiness, but to
   * make the slot IMMOVABLE without review. The value must remain exactly what
   * the cage's `RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED` supplies, across every
   * delta the producer can build, so slice two cannot start populating it — a
   * claim-safety change, not a wiring change — without turning this red.
   * `tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts` pins
   * the other half: that the producer never carries the deny-key literal at all.
   */
  it('TRIPWIRE: the flip-threshold slot is the cage-supplied withheld value, on every delta', () => {
    const builds = { ui: null, cee: null, plot: 'plot-1', isl: 'isl-1' };
    const everyConstructibleDelta = [
      // C2_unpaired (the factor-value-edit class), entitled and withheld.
      build(pair(FVE_PRIOR, FVE_CURRENT)),
      build(pair(FVE_PRIOR, FVE_CURRENT), false),
      // C4_budget_drift.
      build(pair(
        fact({ options: OPTIONS_PRIOR, seed: '111', nSamples: 10_000, hash: 'hash-a', computedAt: '2026-06-06T00:00:00.000Z' }),
        fact({ options: OPTIONS_CURRENT, seed: '111', nSamples: 5_000, hash: 'hash-a', computedAt: '2026-06-07T00:00:00.000Z' }),
      )),
      // C3_engine_drift.
      build(pair(
        fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds: { ...builds, plot: 'plot-1' }, computedAt: '2026-06-06T00:00:00.000Z' }),
        fact({ options: OPTIONS_CURRENT, seed: '111', hash: 'hash-a', builds: { ...builds, plot: 'plot-2' }, computedAt: '2026-06-07T00:00:00.000Z' }),
      )),
      // C1_attributable (uncertainty-only edit, builds echo riding).
      build(pair(
        fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-06T00:00:00.000Z' }),
        fact({ options: OPTIONS_CURRENT, seed: '111', hash: 'hash-b', builds, computedAt: '2026-06-07T00:00:00.000Z' }),
      )),
      // C0_identical.
      build(pair(
        fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-06T00:00:00.000Z' }),
        fact({ options: OPTIONS_PRIOR, seed: '111', hash: 'hash-a', builds, computedAt: '2026-06-07T00:00:00.000Z' }),
      )),
    ];

    // The invariant is worthless if nothing was constructed — an "all of them
    // are empty" assertion over an empty list passes by testing nothing
    // (CLAUDE.md trap 13). Pin the count AND that every attribution case the
    // producer can reach is represented.
    const deltas = everyConstructibleDelta
      .filter((r): r is Extract<typeof r, { kind: 'ok' }> => r.kind === 'ok')
      .map((r) => r.delta);
    expect(deltas).toHaveLength(6);
    expect([...new Set(deltas.map((d) => d.attribution_case))].sort()).toEqual([
      'C0_identical',
      'C1_attributable',
      'C2_unpaired',
      'C3_engine_drift',
      'C4_budget_drift',
    ]);

    for (const delta of deltas) {
      // Value equality, not identity: `RunDeltaSchema.safeParse` clones arrays,
      // so the parsed field cannot be reference-equal to the frozen cage
      // constant. The identity half — that the producer takes its value from
      // the cage and carries no literal of its own — is pinned statically by
      // the single-site guard, which is the assertion that can actually see it.
      expect(delta.flip_thresholds).toEqual(
        RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED.flip_thresholds,
      );
    }
  });
});
