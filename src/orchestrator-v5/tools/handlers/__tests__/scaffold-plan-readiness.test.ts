/**
 * F4 (readiness↔run gate drift) — anti-drift property for the pre-run
 * scaffold plan the `/graph-readiness` endpoint advertises.
 *
 * Paul's symptom (manual test 21 Jul): an option added WITHOUT configuration
 * makes run_analysis SCAFFOLD it and succeed, but the pre-run panel — which
 * derives "blocked" purely from `readiness.can_run_analysis === false` — shows
 * "V3 analysis not ready: 1 option(s) blocked". The two gates disagree.
 *
 * The fix is a SHARED predicate, not a copied one: `computeScaffoldPlan`
 * DELEGATES to `gateAnalysableOptions` (the exact function run_analysis
 * invokes). This suite pins the by-construction property — for any input the
 * plan the panel shows equals what the run path would actually scaffold —
 * because a copied predicate would re-create the very drift F4 closes.
 *
 * These tests are UNIT-level over GraphV3-provenance inputs (observed_state /
 * prior), the shape the run path feeds. The end-to-end route wiring (and the
 * verified input-contract nuance that the `/graph-readiness` request carries
 * factor value provenance under `prior`, never the constraint-shaped
 * `observed_state`) is exercised in tests/integration/cee.graph-readiness.test.ts.
 */

import { describe, it, expect } from 'vitest';

import {
  computeScaffoldPlan,
  gateAnalysableOptions,
  type ScaffoldUnconfiguredInput,
} from '../analysable-option-gate.js';

// A configured option carries ≥1 intervention; an unconfigured one carries none.
const configured = (id: string, interventions: Record<string, number>) => ({
  option_id: id,
  label: id,
  interventions,
});
const unconfigured = (id: string) => ({ option_id: id, label: id, interventions: {} });

/**
 * GraphV3-provenance graph: two factors with distinct neutral rungs so the
 * plan is observable, plus option→factor edges the scaffold reads.
 *   - fac_obs: observed_state.value 0.4 (rung 1)
 *   - fac_prior: prior range [10,30] → mid 20 (rung 3)
 *   - fac_dead: no provenance → skipped (never fabricated)
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
    ],
    edges,
  };
}

/** Assert the plan is the exact projection of the run predicate's outcome. */
function expectPlanMatchesOutcome(input: ScaffoldUnconfiguredInput) {
  const outcome = gateAnalysableOptions(input);
  const plan = computeScaffoldPlan(input);
  expect(plan.will_scaffold_options).toBe(outcome.scaffolded.length > 0);
  expect(plan.option_count).toBe(outcome.scaffolded.length);
  expect(plan.scaffolded_option_ids).toEqual(outcome.scaffolded.map((s) => s.option_id));
  return plan;
}

describe('F4 computeScaffoldPlan — anti-drift with the run-path scaffolder', () => {
  it('mixed state (≥1 configured + ≥1 unconfigured, neutral target) → will_scaffold, count 1', () => {
    // opt_b unconfigured; its own edge targets fac_prior (has a rung-3 neutral).
    const input: ScaffoldUnconfiguredInput = {
      options: [configured('opt_a', { fac_prior: 0.9 }), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_b', to: 'fac_prior' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_b', to: 'fac_prior' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.option_count).toBe(1);
    expect(plan.scaffolded_option_ids).toEqual(['opt_b']);
  });

  it('mixed state via comparison basis (unconfigured option has no edges) → will_scaffold', () => {
    // opt_b has no edges → falls back to the configured sibling's factor ids.
    const input: ScaffoldUnconfiguredInput = {
      options: [configured('opt_a', { fac_obs: 0.3 }), unconfigured('opt_b')],
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.option_count).toBe(1);
  });

  it('all options configured → nothing scaffolds', () => {
    const input: ScaffoldUnconfiguredInput = {
      options: [configured('opt_a', { fac_prior: 0.9 }), configured('opt_b', { fac_obs: 0.2 })],
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
    expect(plan.option_count).toBe(0);
  });

  it('all options unconfigured (not runnable) → nothing scaffolds (pre-PLoT guard owns it)', () => {
    const input: ScaffoldUnconfiguredInput = {
      options: [unconfigured('opt_a'), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_a', to: 'fac_prior' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_a', to: 'fac_prior' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
    expect(plan.option_count).toBe(0);
  });

  it('unconfigured option but no projectable neutral target → nothing scaffolds', () => {
    // opt_b edges only to fac_dead (no provenance) → no safe target → honest 422 path.
    const input: ScaffoldUnconfiguredInput = {
      options: [configured('opt_a', { fac_dead: 0.5 }), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_b', to: 'fac_dead' }]),
      rawPersistedGraph: makeGraph([{ from: 'opt_b', to: 'fac_dead' }]),
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
  });

  it('persisted intervention intent is never scaffolded over (matches run path)', () => {
    // opt_b has empty projected interventions BUT the persisted node carries
    // intent (data.interventions) → the scaffold leaves it for the configure path.
    const rawPersisted = {
      nodes: [
        ...makeGraph().nodes.filter((n) => n.id !== 'opt_b'),
        { id: 'opt_b', kind: 'option', label: 'Option B', data: { interventions: { fac_prior: 1 } } },
      ],
      edges: [{ from: 'opt_b', to: 'fac_prior' }],
    };
    const input: ScaffoldUnconfiguredInput = {
      options: [configured('opt_a', { fac_prior: 0.9 }), unconfigured('opt_b')],
      graph: makeGraph([{ from: 'opt_b', to: 'fac_prior' }]),
      rawPersistedGraph: rawPersisted,
      scaleNetEnabled: true,
    };
    const plan = expectPlanMatchesOutcome(input);
    expect(plan.will_scaffold_options).toBe(false);
  });
});
