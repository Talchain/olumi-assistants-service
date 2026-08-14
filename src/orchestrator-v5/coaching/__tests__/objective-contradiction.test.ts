/**
 * Behaviour pins for the objective-contradiction honesty surface.
 *
 * The graph shape under test is the REAL persisted `scenarios.graph` row for
 * the pricing scenario (staging guest session 2026-08-03, scenario
 * `04f53491-2fc1-4681-8ff5-faf58e255649`, goal `Grow MRR to £250,000`), read
 * from the fixture `goal-target-registration-claim-l60.test.ts` already pins as
 * the L60 Supabase pull. Using the real row rather than a hand-written graph is
 * the whole point: a fixture the author wrote is not evidence about the wire
 * (trap 16 — *a self-authored input silently encodes the author's model of the
 * producer rather than the producer*).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  buildObjectiveContradictionDisclosure,
  detectDirectionalContradiction,
  detectGoalAttainmentContradiction,
  OBJECTIVE_CONTRADICTION_MAX_CHARS,
  OBJECTIVE_LABEL_MAX_CHARS,
  type InterventionView,
  type ObjectiveOptionView,
} from '../objective-contradiction.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

const PRICING_GRAPH = JSON.parse(
  readFileSync(
    new URL(
      '../../compose/__tests__/fixtures/l60/pricing-persisted-graph.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { nodes: Array<Record<string, unknown>>; goal_node_id: string };

function goalLabel(): string {
  const goal = PRICING_GRAPH.nodes.find((n) => n.id === PRICING_GRAPH.goal_node_id);
  return goal!.label as string;
}

/** Derive the price-level intervention view straight from the real row. */
function pricingInterventions(): InterventionView[] {
  const byOption = new Map<string, number>();
  for (const node of PRICING_GRAPH.nodes) {
    if (node.kind !== 'option') continue;
    const interventions = node.interventions as Record<string, { value?: number }> | undefined;
    const entry = interventions?.fac_price_level;
    if (entry && typeof entry.value === 'number') byOption.set(node.id as string, entry.value);
  }
  const factor = PRICING_GRAPH.nodes.find((n) => n.id === 'fac_price_level');
  return [
    {
      factor_id: 'fac_price_level',
      factor_label: factor!.label as string,
      by_option: byOption,
    },
  ];
}

/**
 * The banked win shares, from FINDINGS.md's measured run on this shape: the
 * status-quo option takes ~70% and the big raise ~28%. Kept as the investigation
 * measured them rather than rounded, so the rendered percentages are the
 * product's own arithmetic and not a tidied-up illustration.
 */
const PRICING_OPTIONS: readonly ObjectiveOptionView[] = Object.freeze([
  {
    option_id: 'opt_hold',
    option_label: 'Hold at £49 Per Seat (Status Quo)',
    win_probability: 0.7067,
  },
  { option_id: 'opt_raise', option_label: 'Raise to £59 Per Seat', win_probability: 0.2782 },
  {
    option_id: 'opt_tiers',
    option_label: 'Introduce £39 / £69 Two-Tier Pricing',
    win_probability: 0.0152,
  },
]);

/** The same field, once F1's target recovery makes `probability_of_goal` arrive. */
const PRICING_OPTIONS_WITH_GOAL_PROBABILITY: readonly ObjectiveOptionView[] = Object.freeze(
  PRICING_OPTIONS.map((o) =>
    o.option_id === 'opt_hold'
      ? { ...o, probability_of_goal: 0.0 }
      : o.option_id === 'opt_raise'
        ? { ...o, probability_of_goal: 0.48 }
        : { ...o, probability_of_goal: 0.11 },
  ),
);

// ============================================================================
// ARM B — goal attainment
// ============================================================================

describe('ARM B — goal-attainment contradiction (pure arithmetic)', () => {
  it('⭐ THE BANKED PRICING SHAPE: the leader wins 71% of runs with a ZERO percent chance of the target', () => {
    const verdict = detectGoalAttainmentContradiction(PRICING_OPTIONS_WITH_GOAL_PROBABILITY);
    expect(verdict).not.toBeNull();
    expect(verdict!.leader_label).toBe('Hold at £49 Per Seat (Status Quo)');
    expect(verdict!.leader_probability_of_goal).toBe(0);
    expect(verdict!.better_label).toBe('Raise to £59 Per Seat');
    expect(verdict!.better_probability_of_goal).toBe(0.48);
  });

  it('⭐ THE HONEST SENTENCE, VERBATIM, on the banked pricing shape', () => {
    const suffix = buildObjectiveContradictionDisclosure(
      detectGoalAttainmentContradiction(PRICING_OPTIONS_WITH_GOAL_PROBABILITY),
      true,
    );
    expect(suffix).toBe(
      ' Two different questions have two different answers here: “Hold at £49 Per Seat (Status Quo)”' +
        ' came out ahead most often, but “Raise to £59 Per Seat” is more likely to reach your stated' +
        ' target (48% against 0%). Coming out ahead counts how often an option scored highest on the' +
        ' goal, not whether your target was met.',
    );
  });

  it('SILENT when no probability_of_goal is present — the COMMON state today', () => {
    // ISL fail-closes without a threshold + frame + baseline. A missing number
    // is honest; inventing a contradiction from its absence would not be.
    expect(detectGoalAttainmentContradiction(PRICING_OPTIONS)).toBeNull();
  });

  it('SILENT when the leader already has the greatest probability_of_goal — it pursues the aim', () => {
    const options = PRICING_OPTIONS.map((o) => ({
      ...o,
      probability_of_goal: o.option_id === 'opt_hold' ? 0.9 : 0.2,
    }));
    expect(detectGoalAttainmentContradiction(options)).toBeNull();
  });

  it('SILENT on a TIE — a tie is not a contradiction', () => {
    const options = PRICING_OPTIONS.map((o) => ({ ...o, probability_of_goal: 0.5 }));
    expect(detectGoalAttainmentContradiction(options)).toBeNull();
  });

  it('SILENT with fewer than two comparable options, and on an empty array', () => {
    expect(detectGoalAttainmentContradiction([])).toBeNull();
    expect(
      detectGoalAttainmentContradiction([PRICING_OPTIONS_WITH_GOAL_PROBABILITY[0]!]),
    ).toBeNull();
  });

  it('an ERRORED option is neither crowned nor used as the comparison partner', () => {
    // The errored option carries BOTH the top win share and the top goal
    // probability; it must influence neither.
    const options: ObjectiveOptionView[] = [
      {
        option_id: 'opt_bad',
        option_label: 'Failed Option',
        win_probability: 0.99,
        probability_of_goal: 0.99,
        status: 'error',
      },
      { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.6, probability_of_goal: 0.1 },
      { option_id: 'opt_raise', option_label: 'Raise', win_probability: 0.3, probability_of_goal: 0.4 },
    ];
    const verdict = detectGoalAttainmentContradiction(options);
    expect(verdict!.leader_label).toBe('Hold');
    expect(verdict!.better_label).toBe('Raise');
  });

  it('ABSENT status stays comparable — tightening to === "computed" would withhold a real comparison', () => {
    const options: ObjectiveOptionView[] = [
      { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.6, probability_of_goal: 0.1 },
      {
        option_id: 'opt_raise',
        option_label: 'Raise',
        win_probability: 0.3,
        probability_of_goal: 0.4,
        status: 'computed',
      },
    ];
    expect(detectGoalAttainmentContradiction(options)).not.toBeNull();
  });

  it('the leader is RE-DERIVED, not taken from array order', () => {
    // Deliberately unsorted: a detector binding to position would crown "Raise".
    const options: ObjectiveOptionView[] = [
      { option_id: 'opt_raise', option_label: 'Raise', win_probability: 0.3, probability_of_goal: 0.4 },
      { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.6, probability_of_goal: 0.1 },
    ];
    expect(detectGoalAttainmentContradiction(options)!.leader_label).toBe('Hold');
  });
});

// ============================================================================
// ARM A — directional
// ============================================================================

describe('ARM A — directional contradiction (arithmetic-gated)', () => {
  it('⭐ SILENT on the banked pricing shape — the aim governs MRR, not the price lever', () => {
    // `Grow MRR to £250,000` is a direction over the GOAL METRIC. No option
    // intervenes on the goal, so there is no directional contradiction to
    // report and argmax genuinely does maximise the metric the aim names.
    // Firing here would assert a contradiction the model does not contain.
    expect(goalLabel()).toBe('Grow MRR to £250,000');
    expect(
      detectDirectionalContradiction(goalLabel(), PRICING_OPTIONS, pricingInterventions()),
    ).toBeNull();
  });

  it('⭐ FIRES on the lever-directional aim, using the REAL price interventions', () => {
    // The same real graph, with the aim a user states about the LEVER rather
    // than the metric — the shape the investigation was opened on.
    const verdict = detectDirectionalContradiction(
      'Increase our subscription price',
      PRICING_OPTIONS,
      pricingInterventions(),
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.leader_label).toBe('Hold at £49 Per Seat (Status Quo)');
    expect(verdict!.factor_label).toBe('Seat Price Level');
    expect(verdict!.direction).toBe('increase');
    // The containment clause: among the options that DO raise price, this one
    // leads — from the SAME run's win shares, never a second analysis.
    expect(verdict!.pursuing_leader_label).toBe('Raise to £59 Per Seat');
    expect(verdict!.pursuing_leader_win_probability).toBe(0.2782);
  });

  it('⭐ THE HONEST SENTENCE, VERBATIM, with the containment clause', () => {
    const suffix = buildObjectiveContradictionDisclosure(
      detectDirectionalContradiction(
        'Increase our subscription price',
        PRICING_OPTIONS,
        pricingInterventions(),
      ),
      true,
    );
    expect(suffix).toBe(
      ' “Hold at £49 Per Seat (Status Quo)” came out ahead most often without moving' +
        ' “Seat Price Level” the way your goal asks. Among the options that do,' +
        ' “Raise to £59 Per Seat” came out ahead in 28% of runs of this model.',
    );
  });

  it('SILENT when the leader ALREADY pursues the aim (leader at the top of the lever)', () => {
    const options: ObjectiveOptionView[] = [
      { option_id: 'opt_raise', option_label: 'Raise to £59 Per Seat', win_probability: 0.8 },
      {
        option_id: 'opt_hold',
        option_label: 'Hold at £49 Per Seat (Status Quo)',
        win_probability: 0.2,
      },
    ];
    expect(
      detectDirectionalContradiction(
        'Increase our subscription price',
        options,
        pricingInterventions(),
      ),
    ).toBeNull();
  });

  it('SILENT for a DECREASE aim whose leader is already lowest — the opposite-direction twin', () => {
    // "Reduce price": the leader holds at the LOWEST price, so it already
    // pursues the aim. The increase logic must not fire here.
    expect(
      detectDirectionalContradiction(
        'Reduce our subscription price',
        PRICING_OPTIONS,
        pricingInterventions(),
      ),
    ).toBeNull();
  });

  it('FIRES for a DECREASE aim whose leader is at the WRONG (high) end', () => {
    const options: ObjectiveOptionView[] = [
      { option_id: 'opt_raise', option_label: 'Raise to £59 Per Seat', win_probability: 0.7 },
      {
        option_id: 'opt_hold',
        option_label: 'Hold at £49 Per Seat (Status Quo)',
        win_probability: 0.3,
      },
    ];
    const verdict = detectDirectionalContradiction(
      'Reduce our subscription price',
      options,
      pricingInterventions(),
    );
    expect(verdict!.direction).toBe('decrease');
    expect(verdict!.pursuing_leader_label).toBe('Hold at £49 Per Seat (Status Quo)');
  });

  it('SILENT when the aim is UNDETERMINED, even with a perfectly resolvable lever', () => {
    for (const aim of [
      'Maintain our subscription price',
      'Optimise our subscription price',
      'Choose vendor',
      'Reach £250k Monthly Recurring Revenue',
    ]) {
      expect(
        detectDirectionalContradiction(aim, PRICING_OPTIONS, pricingInterventions()),
      ).toBeNull();
    }
  });

  it('SILENT when the subject resolves to no INTERVENED factor', () => {
    expect(
      detectDirectionalContradiction('Increase headcount', PRICING_OPTIONS, pricingInterventions()),
    ).toBeNull();
  });

  /**
   * ⚠ ADDED BY A SURVIVING MUTANT, NOT BY INSPECTION. Relaxing the "strictly
   * beyond the leader" test to `>=` left every existing case GREEN, because no
   * fixture had a second option sitting at the SAME lever value as the leader.
   * With `>=`, an option that changes the lever not at all would be counted
   * among "the options that do" — so the containment clause would name an
   * option that does exactly what the leader does, which is the clause's one
   * job to avoid.
   */
  it('an option TIED with the leader on the lever is not "pursuing" (kills the >= mutant)', () => {
    const tiedInterventions: InterventionView[] = [
      {
        factor_id: 'fac_price_level',
        factor_label: 'Seat Price Level',
        by_option: new Map([
          ['opt_hold', 0.49],
          ['opt_hold_two', 0.49], // same price as the leader — changes nothing
        ]),
      },
    ];
    const options: ObjectiveOptionView[] = [
      {
        option_id: 'opt_hold',
        option_label: 'Hold at £49 Per Seat (Status Quo)',
        win_probability: 0.6,
      },
      {
        option_id: 'opt_hold_two',
        option_label: 'Hold at £49 With New Packaging',
        win_probability: 0.4,
      },
    ];
    expect(
      detectDirectionalContradiction('Increase our subscription price', options, tiedInterventions),
    ).toBeNull();
  });

  /**
   * ⚠ ALSO ADDED BY A SURVIVING MUTANT. Dropping the minimum-token-length
   * filter left every case green, yet it opens a real false positive: a
   * one-character subject token is a substring of almost any factor label
   * ("Seat Price Level" contains "e"), so the subject would resolve to a factor
   * it does not name and the surface would fire on a resolution that means
   * nothing. That is the LIE direction.
   */
  it('a subject too short to be a real noun resolves to NO factor (kills the token-filter mutant)', () => {
    for (const aim of ['Increase e', 'Grow a', 'Raise to']) {
      expect(
        detectDirectionalContradiction(aim, PRICING_OPTIONS, pricingInterventions()),
      ).toBeNull();
    }
  });

  it('SILENT when there is no analysis at all', () => {
    expect(
      detectDirectionalContradiction('Increase our subscription price', [], pricingInterventions()),
    ).toBeNull();
    expect(
      detectDirectionalContradiction('Increase our subscription price', PRICING_OPTIONS, []),
    ).toBeNull();
  });
});

// ============================================================================
// The disclosure's own safety
// ============================================================================

describe('the disclosure ships nothing it cannot stand behind', () => {
  it('⚠ SILENT when the headline did NOT name a leader — the G-CEE-1 defect class', () => {
    // Five independent producers of "who is leading" have been found, each one
    // asserting the leader the disclosure above it had just withheld. This tail
    // NAMES options, so on a withheld turn it must ship nothing at all.
    for (const detector of [
      detectGoalAttainmentContradiction(PRICING_OPTIONS_WITH_GOAL_PROBABILITY),
      detectDirectionalContradiction(
        'Increase our subscription price',
        PRICING_OPTIONS,
        pricingInterventions(),
      ),
    ]) {
      expect(detector).not.toBeNull(); // positive control: there IS something to suppress
      expect(buildObjectiveContradictionDisclosure(detector, false)).toBe('');
    }
  });

  it('ships nothing when there is no contradiction', () => {
    expect(buildObjectiveContradictionDisclosure(null, true)).toBe('');
  });

  it('suppresses the WHOLE disclosure rather than shipping a half-sentence on a bad label', () => {
    const overlong = 'x'.repeat(OBJECTIVE_LABEL_MAX_CHARS + 1);
    const verdict = detectGoalAttainmentContradiction([
      { option_id: 'opt_a', option_label: overlong, win_probability: 0.6, probability_of_goal: 0.1 },
      { option_id: 'opt_b', option_label: 'Fine', win_probability: 0.3, probability_of_goal: 0.4 },
    ]);
    expect(verdict).not.toBeNull();
    expect(buildObjectiveContradictionDisclosure(verdict, true)).toBe('');
  });

  it('never emits a raw decimal — the shared content defences reject one outright', () => {
    const suffix = buildObjectiveContradictionDisclosure(
      detectGoalAttainmentContradiction([
        { option_id: 'opt_a', option_label: 'A', win_probability: 0.6, probability_of_goal: 0.12345 },
        { option_id: 'opt_b', option_label: 'B', win_probability: 0.3, probability_of_goal: 0.6789 },
      ]),
      true,
    );
    expect(suffix).not.toBe('');
    expect(suffix).not.toMatch(/\d+\.\d+/);
  });

  it('every composed shape fits its own derived budget', () => {
    const suffix = buildObjectiveContradictionDisclosure(
      detectGoalAttainmentContradiction(PRICING_OPTIONS_WITH_GOAL_PROBABILITY),
      true,
    );
    expect(suffix.length).toBeLessThanOrEqual(OBJECTIVE_CONTRADICTION_MAX_CHARS);
  });

  /**
   * ⚠ THE LEADER-VOCABULARY HALF, checked here rather than at module load to
   * avoid an import cycle — the same construction and the same stated reason as
   * `intake-option-disclosure.ts`.
   *
   * This tail DOES name a leading option, deliberately and only on turns
   * entitled to. So unlike the intake disclosure it is EXPECTED to trip the
   * shared vocabulary; what matters is that the expectation is stated and
   * pinned, so a future reader does not read a hit here as a defect.
   */
  it('the tail is KNOWN to carry leader vocabulary, and only ships where a leader was named', () => {
    const suffix = buildObjectiveContradictionDisclosure(
      detectGoalAttainmentContradiction(PRICING_OPTIONS_WITH_GOAL_PROBABILITY),
      true,
    );
    expect(textNamesLeadingOption(suffix)).toBe(true);
    // ...which is exactly why the `leaderWasNamed` precondition above is a hard
    // gate rather than a convenience, and why that test carries a positive
    // control proving there was something to suppress.
  });
});
