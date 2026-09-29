/**
 * ⭐⭐ THE BASELINE CONFOUND — `private_factor_count` measures Status Quo wiring,
 * not option-specific causality, and reading it the other way produced a false
 * programme finding on 2026-09-14.
 *
 * ## What was measured, on the wire, before this file was written
 *
 * Ten draws of ONE brief on staging (`walk-b1-131836`, 13:18–13:28Z, served
 * prompt `draft_graph_default` v201, sha256 `fab9aa27…`), nine carrying a graph.
 * In all nine the three brief-named options point at three DISJOINT factors —
 * maximally differentiated. Eight scored `private_factor_count` 2–4. One scored
 * **0**. The only structural difference was the out-degree of the AI-invented
 * `is_baseline` Status Quo option: 1 in the eight, 3 in the ninth.
 *
 * Proof by deletion — remove only the baseline node and its edges:
 *
 *     res9   0 → 4        (the "flat" one: every lever is in fact private)
 *     other eight  +1 each (3→4, 2→3, 4→5, 2→3, 3→4, 4→5, 4→5, 3→4)
 *
 * The served prompt's OWN canonical annotated example — one lever per option,
 * maximally option-specific — also scores 0, and goes to 3 when only its three
 * mandatory Status Quo edges are deleted.
 *
 * ## Why, and why it is not a drafting defect
 *
 * `privateFactorCount` counts waist factors reached by EXACTLY ONE option, and
 * the option set includes the Status Quo. The served prompt MANDATES that
 * option (v201:804) and REQUIRES it to keep its factor edges even though it
 * changes nothing (v201:163, v201:285). So the estate's most common HEALTHY
 * shape — N options each with its own lever plus a baseline holding those
 * levers — gives every lever an option-count of 2 and scores 0. The drafter is
 * doing what it was told; the metric is reading it wrong.
 *
 * ## Named apart, not redefined (trap 21)
 *
 * `private_factor_count` keeps its exact meaning so the telemetry series stays
 * comparable. `deviating_private_factor_count` is the honest measure and is what
 * `isMaterallyRicher` consumes. This module already applies the same treatment
 * one field over, for `causal_waist`'s two zeros.
 *
 * ⛔ THE NEGATIVE CONTROL IS THE POINT OF THIS FILE. A field that were simply
 * "private_factor_count + 1 when a baseline exists" would be useless. The third
 * case below is a GENUINE bowtie carrying a baseline, where the honest field
 * must still read 0 — otherwise this change would hide the defect the lane
 * exists to find.
 */

import { describe, it, expect } from 'vitest';
import { computeDraftCoverage, isMaterallyRicher } from '../coverage.js';

const goal = { id: 'goal', kind: 'goal', label: 'Cut churn' };
const outcome = { id: 'out', kind: 'outcome', label: 'Churn rate' };

/** Three options, three DISJOINT levers, plus a Status Quo wired to all three.
 *  This is res9's shape. */
const BASELINE_WIRED_TO_EVERYTHING = {
  nodes: [
    goal, outcome,
    { id: 'o_onboard', kind: 'option', label: 'Rebuild onboarding' },
    { id: 'o_cs', kind: 'option', label: 'Build a CS team' },
    { id: 'o_price', kind: 'option', label: 'Raise the Pro price' },
    { id: 'o_sq', kind: 'option', label: 'Status Quo — hold spend', is_baseline: true },
    { id: 'f_onboard', kind: 'factor', label: 'Onboarding quality' },
    { id: 'f_cs', kind: 'factor', label: 'CS capacity' },
    { id: 'f_price', kind: 'factor', label: 'Pro plan price' },
  ],
  edges: [
    { from: 'o_onboard', to: 'f_onboard' },
    { from: 'o_cs', to: 'f_cs' },
    { from: 'o_price', to: 'f_price' },
    // the mandatory Status Quo wiring — v201:163 / v201:285
    { from: 'o_sq', to: 'f_onboard' },
    { from: 'o_sq', to: 'f_cs' },
    { from: 'o_sq', to: 'f_price' },
    { from: 'f_onboard', to: 'out' },
    { from: 'f_cs', to: 'out' },
    { from: 'f_price', to: 'out' },
    { from: 'out', to: 'goal' },
  ],
};

/** Identical graph with the baseline option removed entirely. */
const NO_BASELINE = {
  nodes: BASELINE_WIRED_TO_EVERYTHING.nodes.filter((n) => n.id !== 'o_sq'),
  edges: BASELINE_WIRED_TO_EVERYTHING.edges.filter((e) => e.from !== 'o_sq'),
};

/** ⛔ THE NEGATIVE CONTROL: a GENUINE bowtie — every option acts through the
 *  same single lever — that also carries a baseline. The honest field must
 *  still read 0 here, or this change would hide the defect it must detect. */
const GENUINE_BOWTIE_WITH_BASELINE = {
  nodes: [
    goal, outcome,
    { id: 'o_a', kind: 'option', label: 'Raise to £59' },
    { id: 'o_b', kind: 'option', label: 'Raise to £79' },
    { id: 'o_sq', kind: 'option', label: 'Hold at £49', is_baseline: true },
    { id: 'f_price', kind: 'factor', label: 'Pro plan price' },
  ],
  edges: [
    { from: 'o_a', to: 'f_price' },
    { from: 'o_b', to: 'f_price' },
    { from: 'o_sq', to: 'f_price' },
    { from: 'f_price', to: 'out' },
    { from: 'out', to: 'goal' },
  ],
};

describe('the baseline confound in private_factor_count', () => {
  it('PRECONDITION: the fixture really does carry a flagged baseline option', () => {
    // Pins the fixture's own discriminating property in-test (trap 13b). Without
    // this the cases below could pass because the flag silently stopped being
    // read, which is exactly how a guard becomes a tautology.
    const sq = BASELINE_WIRED_TO_EVERYTHING.nodes.find((n) => n.id === 'o_sq');
    expect(sq && (sq as Record<string, unknown>).is_baseline).toBe(true);
    expect(
      BASELINE_WIRED_TO_EVERYTHING.edges.filter((e) => e.from === 'o_sq'),
    ).toHaveLength(3);
  });

  it('the old field reads 0 on a maximally option-specific graph — the false zero', () => {
    const facts = computeDraftCoverage(BASELINE_WIRED_TO_EVERYTHING);
    expect(facts).not.toBeNull();
    expect(facts!.causal_waist).toBe(3);
    // Every lever is reached by its own option AND the Status Quo ⇒ count 2 ⇒
    // not private. This is the measured res9 result and it is WRONG as English.
    expect(facts!.private_factor_count).toBe(0);
  });

  it('⭐ the honest field reads 3 on that same graph', () => {
    const facts = computeDraftCoverage(BASELINE_WIRED_TO_EVERYTHING);
    expect(facts!.deviating_private_factor_count).toBe(3);
  });

  it('⛔ NEGATIVE CONTROL: a genuine bowtie with a baseline still reads 0', () => {
    // If this ever goes non-zero the change has hidden the defect the lane
    // exists to find, and the whole file is worthless.
    const facts = computeDraftCoverage(GENUINE_BOWTIE_WITH_BASELINE);
    expect(facts!.causal_waist).toBe(1);
    expect(facts!.private_factor_count).toBe(0);
    expect(facts!.deviating_private_factor_count).toBe(0);
  });

  it('with no baseline present the two fields are identical — no silent shift', () => {
    const facts = computeDraftCoverage(NO_BASELINE);
    expect(facts!.private_factor_count).toBe(3);
    expect(facts!.deviating_private_factor_count).toBe(3);
  });

  it('the redraw tie-break now orders on the honest field', () => {
    // a: the false zero (maximally option-specific, baseline wired to all).
    // b: a genuine bowtie. Ordered by `private_factor_count` these tie at 0 and
    // `isMaterallyRicher` would fall through to depth; ordered honestly, a wins.
    const a = computeDraftCoverage(GENUINE_BOWTIE_WITH_BASELINE)!;
    const b = computeDraftCoverage(BASELINE_WIRED_TO_EVERYTHING)!;
    expect(a.private_factor_count).toBe(b.private_factor_count); // the tie that used to happen
    expect(isMaterallyRicher(a, b)).toBe(true);                  // waist 1 → 3 decides first
    // and the reverse must NOT be richer — a discriminating pair, not one arm.
    expect(isMaterallyRicher(b, a)).toBe(false);
  });
});
