/**
 * F4 (readiness↔run gate drift) — anti-drift property for the pre-run plan the
 * `/graph-readiness` endpoint advertises.
 *
 * Paul's symptom (manual test 21 Jul): an option added WITHOUT configuration
 * makes run_analysis proceed and succeed, but the pre-run panel — which derives
 * "blocked" purely from `readiness.can_run_analysis === false` — shows "V3
 * analysis not ready: 1 option(s) blocked". The two gates disagree.
 *
 * The fix is a SHARED predicate, not a copied one: `computeScaffoldPlan`
 * DELEGATES to `gateAnalysableOptions` (the exact function run_analysis
 * invokes). This suite pins the by-construction property — for any input, the
 * plan the panel shows is a pure PROJECTION of what the run path would do.
 *
 * ⚠ RE-POINTED BY THE NO-RANK RULING (2026-08-14). Two things changed:
 *
 *  1. **The published field names no longer describe the mechanism.**
 *     `will_scaffold_options` now answers *"will the run PROCEED even though
 *     not every option is configured?"* — the same QUESTION it always answered,
 *     under a new mechanism (exclude, don't scaffold). It is a published field
 *     with live UI readers, so the name is retained until a rename ships with
 *     the UI half.
 *  2. **It gained a second conjunct, and that conjunct is load-bearing.**
 *     Exclusion can leave fewer than two options, and the run then REFUSES
 *     (`run-analysis.ts` §2.56). Advertising "will proceed" there would be
 *     precisely the readiness↔run drift F4 exists to close, in the other
 *     direction — so the plan must say the run will NOT proceed. That twin is
 *     pinned below by name.
 *
 * `option_count` counts HELD + EXCLUDED: it means "options the run will not
 * send exactly as the user left them". Counting only the excluded ones would
 * report "nothing special will happen" about a run holding the status quo.
 *
 * These tests are UNIT-level over GraphV3-provenance inputs, the shape the run
 * path feeds. End-to-end route wiring is exercised in
 * tests/integration/cee.graph-readiness.test.ts.
 */

import { describe, it, expect } from 'vitest';

import {
  computeScaffoldPlan,
  gateAnalysableOptions,
  PLOT_MIN_COMPARISON_OPTIONS,
  type AnalysableOptionGateInput,
} from '../analysable-option-gate.js';

const configured = (id: string, interventions: Record<string, number>) => ({
  option_id: id,
  label: id,
  interventions,
});
const unconfigured = (id: string) => ({ option_id: id, label: id, interventions: {} });
/** Unconfigured AND flagged as the status quo — the only held path. */
const baseline = (id: string) => ({ option_id: id, label: id, interventions: {}, is_baseline: true });

/**
 * GraphV3-provenance graph.
 *   - fac_obs:  observed_state.value 0.4          → HOLDABLE
 *   - fac_prior: prior range [10,30]              → NOT holdable (the midpoint
 *                rung was DELETED with the ruling: a centre-of-range guess is
 *                not a claim about where a factor DOES sit)
 *   - fac_dead: no provenance at all              → NOT holdable
 */
function makeGraph(edges: Array<{ from: string; to: string }> = []) {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' },
      { id: 'd', kind: 'decision', label: 'Decision' },
      { id: 'fac_obs', kind: 'factor', label: 'Obs', observed_state: { value: 0.4 } },
      {
        id: 'fac_prior',
        kind: 'factor',
        label: 'Prior',
        prior: { distribution: 'uniform', range_min: 10, range_max: 30 },
      },
      { id: 'fac_dead', kind: 'factor', label: 'Dead' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      { id: 'opt_c', kind: 'option', label: 'Option C' },
    ],
    edges,
  };
}

/**
 * Assert the plan is the exact projection of the run predicate's outcome —
 * the F4 property itself. Nothing here re-derives the DECISION; it asserts the
 * two are one computation, which is what makes a copied predicate impossible.
 */
function expectPlanMatchesOutcome(input: AnalysableOptionGateInput) {
  const outcome = gateAnalysableOptions(input);
  const plan = computeScaffoldPlan(input);
  const touchedIds = [
    ...outcome.held.map((s) => s.option_id),
    ...outcome.excluded.map((s) => s.option_id),
  ];
  expect(plan.will_scaffold_options).toBe(
    touchedIds.length > 0 && outcome.options.length >= PLOT_MIN_COMPARISON_OPTIONS,
  );
  expect(plan.option_count).toBe(touchedIds.length);
  expect(plan.scaffolded_option_ids).toEqual(touchedIds);
  return plan;
}

describe('F4 computeScaffoldPlan — anti-drift with the run-path gate', () => {
  it('mixed state (2 configured + 1 unconfigured) → the run WILL proceed, count 1', () => {
    // opt_c is excluded; two configured options remain, which is a comparison.
    const input: AnalysableOptionGateInput = {
      options: [
        configured('opt_a', { fac_obs: 0.9 }),
        configured('opt_b', { fac_obs: 0.3 }),
        unconfigured('opt_c'),
      ],
      graph: makeGraph([{ from: 'opt_c', to: 'fac_obs' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_c', to: 'fac_obs' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.option_count).toBe(1);
    expect(plan.scaffolded_option_ids).toEqual(['opt_c']);
  });

  it('a HELD status quo also counts as "not sent as the user left it" → will proceed, count 1', () => {
    // opt_c has no edges → the comparison basis (the siblings' factor ids,
    // filtered to holdable). Re-pointed from `fac_prior` to `fac_obs`: the old
    // fixture relied on the DELETED midpoint rung and would now hold nothing.
    const input: AnalysableOptionGateInput = {
      options: [
        configured('opt_a', { fac_obs: 0.3 }),
        configured('opt_b', { fac_obs: 0.7 }),
        baseline('opt_c'),
      ],
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.option_count).toBe(1);
    // Counting only the EXCLUDED would report "nothing special will happen"
    // about a run that is holding the status quo at values CEE chose.
    expect(plan.scaffolded_option_ids).toEqual(['opt_c']);
  });

  it('all options configured → nothing is touched', () => {
    const input: AnalysableOptionGateInput = {
      options: [configured('opt_a', { fac_obs: 0.9 }), configured('opt_b', { fac_obs: 0.2 })],
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
    expect(plan.option_count).toBe(0);
  });

  it('all options unconfigured (not runnable) → nothing is touched (the pre-PLoT guard owns it)', () => {
    const input: AnalysableOptionGateInput = {
      options: [unconfigured('opt_a'), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_a', to: 'fac_obs' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_a', to: 'fac_obs' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
    expect(plan.option_count).toBe(0);
  });

  it('⭐ TWIN — exclusion that leaves fewer than two options says the run will NOT proceed', () => {
    // The load-bearing conjunct. The gate DID touch an option (count 1), but
    // only one option would be submitted, and `run-analysis.ts` §2.56 refuses
    // that. Advertising "will proceed" here would be F4 in reverse: the panel
    // promising a run the handler declines.
    const input: AnalysableOptionGateInput = {
      options: [configured('opt_a', { fac_obs: 0.9 }), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_b', to: 'fac_obs' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_b', to: 'fac_obs' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
    // …and NOT because nothing happened — the option really was excluded.
    // Without this, the assertion above is satisfied by a gate that does
    // nothing at all, which is a different (and wrong) reason for the same
    // answer.
    expect(plan.option_count).toBe(1);
    expect(plan.scaffolded_option_ids).toEqual(['opt_b']);
  });

  it('a baseline with no holdable target is EXCLUDED, not held (we never invent "no change" either)', () => {
    // opt_c edges only to fac_dead (no provenance). Even the status quo cannot
    // be held from a factor whose current position is unknown.
    const input: AnalysableOptionGateInput = {
      options: [
        configured('opt_a', { fac_dead: 0.5 }),
        configured('opt_b', { fac_dead: 0.6 }),
        baseline('opt_c'),
      ],
      graph: makeGraph([{ from: 'opt_c', to: 'fac_dead' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_c', to: 'fac_dead' }]),
      scaleNetEnabled: true,
    };
    const outcome = gateAnalysableOptions(input);
    expect(outcome.held).toEqual([]);
    expect(outcome.excluded.map((s) => s.option_id)).toEqual(['opt_c']);
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(true); // two configured remain
  });

  it('persisted intervention intent is never written over — the option is excluded instead', () => {
    // opt_c has empty PROJECTED interventions but the persisted node carries
    // intent (`data.interventions`). Intent is user authorship: we may not
    // substitute our own numbers for it, and we cannot submit an empty object.
    // Excluded and disclosed is the only honest outcome.
    const rawPersisted = {
      nodes: [
        ...makeGraph().nodes.filter((n) => n.id !== 'opt_c'),
        { id: 'opt_c', kind: 'option', label: 'Option C', data: { interventions: { fac_obs: 1 } } },
      ],
      edges: [{ from: 'opt_c', to: 'fac_obs' }],
    };
    const input: AnalysableOptionGateInput = {
      options: [
        configured('opt_a', { fac_obs: 0.9 }),
        configured('opt_b', { fac_obs: 0.4 }),
        // Flagged baseline, to prove intent beats even the hold exception.
        baseline('opt_c'),
      ],
      graph: makeGraph([{ from: 'opt_c', to: 'fac_obs' }]),
      rawPersistedGraph: rawPersisted,
      scaleNetEnabled: true,
    };
    const outcome = gateAnalysableOptions(input);
    expect(outcome.held).toEqual([]);
    expect(outcome.excluded.map((s) => s.option_id)).toEqual(['opt_c']);
    expectPlanMatchesOutcome(input);
  });
});
