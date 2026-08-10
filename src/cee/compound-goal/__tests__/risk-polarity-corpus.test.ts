/**
 * ROADMAP 2.653 (I-A) — a threshold stated as a RISK never mints a constraint
 * demanding it.
 *
 * NOTHING IS MOCKED. Everything below runs the REAL producers end to end —
 * `extractCompoundGoals`, `remapConstraintTargets`, `normaliseConstraintUnits`,
 * `toGoalConstraints` and the merge-point screen — because the thing under test
 * is what a user's brief actually becomes, and a mocked extractor would measure
 * the fixture instead of the product. (Same reasoning, same shape, as the 2.349
 * sibling in `compound-goals-temporal-non-binding.test.ts`.)
 *
 * ⭐ THE FIXTURE IS THE WALK'S OWN BRIEF, near-verbatim from
 * `PHASE0-EVIDENCE-2026-07-28/consent-witness-findings-2026-08-07.md` §Log,
 * where it was re-sent deliberately "to recreate the defect's conditions" and
 * did so byte-identically on CEE `bb33751`. At `658cdff3` it yields:
 *
 *   { targetName: "churn could rise", operator: ">=", value: 0.03, unit: "%",
 *     label: "churn could rise floor",
 *     sourceQuote: "churn could rise above 3%" }
 *
 * — a hard FLOOR demanding churn stay AT OR ABOVE 3%, minted from a sentence
 * whose whole point was that churn going above 3% would be bad, and named with
 * an internal direction word the user had never seen. Everything downstream
 * followed from that one operator: chat called it a ceiling, the analysis said
 * "no option can be put forward yet" beside a panel ranking a 64% leader, a
 * units repair was prescribed for a sign defect, and the resulting
 * withheld-claim state dropped `decision_review` whole — darkening the entire
 * science-grounding surface (row 2.654).
 *
 * ⭐⭐ THE CORPUS IS THE POINT, AND IT IS HAND-WRITTEN ON PURPOSE (CLAUDE.md
 * trap 12d, second face). The screen is derived from two pattern alphabets in
 * `risk-polarity.ts`; nothing derived from those alphabets can notice a verb
 * that is MISSING from them, and nothing derived from them can notice that the
 * rule itself is too broad. Only a hand-written set of real phrasings can. So
 * the corpus below is spelled out in both directions AND — the half that
 * carries the real risk — as a NEGATIVE set of genuine requirements that must
 * survive untouched. A screen that deletes constraints is only safe if the
 * things it must not delete are enumerated and asserted.
 */
import { describe, it, expect } from 'vitest';

import { runCompoundGoals } from '../../unified-pipeline/stages/repair/compound-goals.js';
import {
  deriveRiskPolarity,
  polaritySafeOperator,
  contradictedRiskPolarity,
  partitionRiskFramedInversions,
} from '../risk-polarity.js';

/** The graph the drafter produced on the witnessed session, in the shape this stage reads. */
const GRAPH_NODES = [
  { id: 'goal_mrr', kind: 'goal', label: 'Grow Monthly Recurring Revenue to £250k' },
  { id: 'opt_premium', kind: 'option', label: 'Launch Premium Tier' },
  { id: 'fac_churn', kind: 'factor', label: 'Customer Churn Rate' },
  { id: 'fac_retention', kind: 'factor', label: 'Retention' },
  { id: 'fac_margin', kind: 'factor', label: 'Margin' },
  { id: 'fac_conversion', kind: 'factor', label: 'Conversion' },
  { id: 'out_costs', kind: 'outcome', label: 'Costs' },
  { id: 'out_support', kind: 'outcome', label: 'Support costs' },
];

function emitFor(brief: string, llmGoalConstraints?: unknown[]): any[] {
  const ctx: any = {
    requestId: 'test-2653',
    effectiveBrief: brief,
    graph: { nodes: GRAPH_NODES, edges: [] },
    goalConstraints: undefined,
    ...(llmGoalConstraints === undefined ? {} : { llmGoalConstraints }),
  };
  runCompoundGoals(ctx);
  return ctx.goalConstraints ?? [];
}

/** The walk's brief, near-verbatim from the consent-witness capture. */
const WALK_BRIEF =
  "We need to grow MRR from 180000 to 250000 GBP by December. Options we're considering: launch a premium tier, expand outbound sales, or partner with resellers. Key risks: customer churn could rise above 3%, and the sales team is stretched thin.";

/** The original walk's shorter risk-list phrasing (walk-2634 J1), same defect. */
const WALK_BRIEF_RISK_LIST =
  'We need to grow MRR from 180000 to 250000 GBP by December. Options: premium tier, outbound sales, resellers. Key risks: churn above 3%, sales team stretched thin.';

describe('2.653 — the walk brief no longer mints an inverted churn floor', () => {
  it('emits NO `>=` constraint on the churn node — the exact row the walk captured', () => {
    const emitted = emitFor(WALK_BRIEF);
    const churnFloors = emitted.filter(
      (c) => c.node_id === 'fac_churn' && c.operator === '>=',
    );
    expect(churnFloors).toEqual([]);
  });

  it('and emits no `>=` constraint AT ALL from that brief — the screen is not node-specific', () => {
    // The remap step binds the extracted target by fuzzy match, so pinning only
    // `fac_churn` would pass if the same inverted row simply landed on a
    // different node. The claim is about the ROW, not about where it stuck.
    expect(emitFor(WALK_BRIEF).filter((c) => c.operator === '>=')).toEqual([]);
  });

  it('the garbled name "churn could rise floor" cannot be produced by any emitted row', () => {
    // I-B, asserted at the same seam I-A is: the two defects were witnessed in
    // the same four words, and a fix for one that left the other would still put
    // an unrecognisable name in front of a user.
    for (const c of emitFor(WALK_BRIEF)) {
      expect(c.label).not.toMatch(/\b(floor|ceiling)\b/i);
      expect(c.label).not.toContain('could rise');
    }
  });

  it('a SURVIVING constraint is named in plain words on the wire, not with a machine suffix', () => {
    // I-B bound END TO END, not just at the naming module. The unit tests for
    // `buildBoundDisplayName` specify a new module and would pass against a
    // codebase that never called it; this is the assertion that fails if the
    // extractor keeps minting `${targetName} ceiling`.
    const emitted = emitFor('Grow MRR to 250000 while keeping churn under 3%.');
    const churn = emitted.find((c) => c.node_id === 'fac_churn' && c.operator === '<=');
    expect(churn).toBeDefined();
    expect(churn.label).toBe('Keep churn at or below 3%');
  });

  it('the risk-LIST phrasing with no modal verb is caught too ("Key risks: churn above 3%")', () => {
    // The header does the work the modal does in the longer form. Without this
    // route the commonest way a brief states a risk walks straight past the
    // screen — and it is the phrasing the ORIGINAL walk recorded (J1).
    expect(emitFor(WALK_BRIEF_RISK_LIST).filter((c) => c.operator === '>=')).toEqual([]);
  });
});

/* ===========================================================================
 * THE CORPUS. Hand-written, both directions, plus the negative set.
 * ========================================================================= */

/** Risk framing that FEARS HIGH values — every one must suppress the `>=`. */
const FEARS_HIGH_BRIEFS: ReadonlyArray<readonly [string, string]> = [
  ['modal + rise', 'Grow MRR to 250000. Customer churn could rise above 3%.'],
  ['modal + increase', 'Grow MRR to 250000. Churn might increase above 3%.'],
  ['modal + climb', 'Grow MRR to 250000. Churn may climb above 3%.'],
  ['modal + exceed', 'Grow MRR to 250000. Costs could exceed 50000.'],
  ['modal + go over', 'Grow MRR to 250000. Costs might go over 50000.'],
  ['risk that … rise', 'Grow MRR to 250000. There is a risk that costs rise above 50000.'],
  ['risk of … going over', 'Grow MRR to 250000. The risk of costs going over 50000 is real.'],
  ['worried … grow', 'Grow MRR to 250000. We are worried support costs grow above 50000.'],
  ['likely to spike', 'Grow MRR to 250000. Churn is likely to spike above 3%.'],
  ['danger that … escalate', 'Grow MRR to 250000. The danger that costs escalate above 50000 is real.'],
  ['risk list, bare comparator', 'Grow MRR to 250000. Key risks: churn above 3%.'],
  ['concerns list, bare comparator', 'Grow MRR to 250000. Concerns: costs over 50000.'],
];

/** Risk framing that FEARS LOW values — every one must suppress the `<=`. */
const FEARS_LOW_BRIEFS: ReadonlyArray<readonly [string, string]> = [
  ['modal + drop', 'Grow MRR to 250000. Retention could drop below 90%.'],
  ['modal + fall', 'Grow MRR to 250000. Margin might fall under 20%.'],
  ['modal + decline', 'Grow MRR to 250000. Conversion may decline below 2%.'],
  ['modal + go below', 'Grow MRR to 250000. Margin could go below 20%.'],
  ['risk that … slip', 'Grow MRR to 250000. There is a risk that retention slips below 90%.'],
  ['risk of … falling', 'Grow MRR to 250000. The risk of margin falling under 20% is real.'],
  ['risk list, bare comparator', 'Grow MRR to 250000. Key risks: retention below 90%.'],
];

/**
 * THE NEGATIVE SET — genuine requirements. Every one MUST survive, with the
 * operator the sentence asks for.
 *
 * This is the load-bearing half of the corpus. A screen that deletes
 * constraints passes every suppression assertion above by deleting everything;
 * only these rows can tell a precise screen from a destructive one.
 */
const REQUIREMENT_BRIEFS: ReadonlyArray<readonly [string, string, '<=' | '>=']> = [
  ['keep X under N', 'Grow MRR to 250000 while keeping churn under 3%.', '<='],
  ['keep X below N', 'Grow MRR to 250000. Keep churn below 3%.', '<='],
  ['X must not exceed N', 'Grow MRR to 250000. Costs must not exceed 50000.', '<='],
  ['ensure X stays above N', 'Grow MRR to 250000 while ensuring retention stays above 90%.', '>='],
  ['X must be at least N', 'Grow MRR to 250000. Retention must be at least 90%.', '>='],
  [
    'requirement stated INSIDE a risk list keeps its operator',
    'Grow MRR to 250000. Key risks: churn above 3%, and costs must not exceed 50000.',
    '<=',
  ],
  [
    'risk and its own remedy in one clause — the remedy survives',
    'Grow MRR to 250000. Churn could rise above 3%, so keep churn under 3%.',
    '<=',
  ],
  [
    'two thresholds in one clause — only the risk-framed one goes',
    'Grow MRR to 250000. Costs might rise above 50000 and retention must be at least 90%.',
    '>=',
  ],
];

describe('2.653 corpus — risk framing that fears HIGH values never mints a floor', () => {
  it.each(FEARS_HIGH_BRIEFS)('%s', (_name, brief) => {
    expect(emitFor(brief).filter((c) => c.operator === '>=')).toEqual([]);
  });
});

describe('2.653 corpus — risk framing that fears LOW values never mints a ceiling', () => {
  it.each(FEARS_LOW_BRIEFS)('%s', (_name, brief) => {
    // Deadline rows are `<=` and are already withheld by the 2.349 gate, so any
    // survivor here would be a real level constraint, not a deadline.
    expect(emitFor(brief).filter((c) => c.operator === '<=')).toEqual([]);
  });
});

describe('2.653 corpus — NEGATIVE SET: a stated requirement survives, with its own operator', () => {
  it.each(REQUIREMENT_BRIEFS)('%s', (_name, brief, operator) => {
    const emitted = emitFor(brief);
    expect(emitted.filter((c) => c.operator === operator).length).toBeGreaterThan(0);
  });
});

/* ===========================================================================
 * THE SCREEN IS SOURCE-AGNOSTIC — the model's own constraints go through it.
 * ========================================================================= */

describe('2.653 — the LLM producer is screened by the same rule, at the same point', () => {
  /**
   * The draft prompt tells the model the IDENTICAL defective rule the regex
   * extractor implements — `Patterns: "under/below/at most" -> <=, "at
   * least/above/minimum" -> >=` (`src/prompts/defaults-v187.ts`), keyed on the
   * comparator word with no reading of the framing. So a fix confined to the
   * extractor leaves the same inverted row reachable through the model, and the
   * defect returns the first time it emits one. That is why the screen sits at
   * the merge point.
   */
  it('an LLM-emitted row whose operator contradicts its own source_quote is withheld', () => {
    const emitted = emitFor('Grow MRR to 250000. Nothing else stated.', [
      {
        constraint_id: 'gc_churn',
        node_id: 'fac_churn',
        operator: '>=',
        value: 0.03,
        label: 'Churn floor',
        source_quote: 'customer churn could rise above 3%',
      },
    ]);
    expect(emitted.map((c) => c.constraint_id)).not.toContain('gc_churn');
  });

  it('…and its ordinary sibling on the SAME payload survives — the screen is per-row', () => {
    const emitted = emitFor('Grow MRR to 250000. Nothing else stated.', [
      {
        constraint_id: 'gc_churn',
        node_id: 'fac_churn',
        operator: '>=',
        value: 0.03,
        label: 'Churn floor',
        source_quote: 'customer churn could rise above 3%',
      },
      {
        constraint_id: 'gc_costs',
        node_id: 'out_costs',
        operator: '<=',
        value: 50000,
        label: 'Keep costs at or below 50000',
        source_quote: 'costs must not exceed 50000',
      },
    ]);
    expect(emitted.map((c) => c.constraint_id)).toEqual(['gc_costs']);
  });

  it('an LLM row with NO source_quote is inconclusive to THIS screen — it is not what withholds it', () => {
    // ⚠⚠ THIS TEST'S WIRE-LEVEL EXPECTATION CHANGED WITH ROADMAP 2.1051, AND
    // THE REASON IS TRAP 21: TWO AUTHORITIES ANSWERING DIFFERENT QUESTIONS
    // UNDER SIMILAR NAMES. Both answers below are correct for their own
    // question, and reconciling them by aligning the defaults would be the
    // mistake.
    //
    //   2.653 (this module) asks: "does this row's operator CONTRADICT the risk
    //     framing of its own source phrase?" With no phrase there is no
    //     contradiction, so this screen declines — it never guesses. UNCHANGED,
    //     and asserted directly below.
    //
    //   2.1051 (the direction gate) asks: "is this row's direction PROVEN?"
    //     With no evidence it is not, so the gate withholds it and ASKS the
    //     user. That is the stronger question, and it is the one that decides
    //     the wire.
    //
    // The gate is deliberately fail-closed here: the audit's e3 probe showed an
    // LLM row surviving ALONE on the wire and inverting a user's floor, and a
    // row that omits its quote is exactly that row with its evidence removed.
    // Letting it stand would reopen the hole for any model turn that skips the
    // (prompt-mandated) `source_quote`.
    const brief = 'Grow MRR to 250000. Nothing else stated.';
    const row = {
      constraint_id: 'gc_bare',
      node_id: 'fac_churn',
      operator: '>=' as const,
      value: 0.03,
      label: 'Some limit',
    };

    // THIS module still declines to judge it — the 2.653 rule is untouched.
    expect(contradictedRiskPolarity(null, '>=', brief)).toBeNull();
    expect(deriveRiskPolarity('Some limit', brief)).toBeNull();

    // …and the row nonetheless does not reach the wire, because a DIFFERENT
    // gate proved nothing about its direction.
    expect(emitFor(brief, [row]).map((c) => c.constraint_id)).toEqual([]);
  });

  it('POSITIVE CONTROL: the same row WITH a locatable quote does reach the wire', () => {
    // Without this pair the assertion above is satisfied by a merge that emits
    // nothing at all, which would make it vacuous (trap 13). The only
    // difference between the two rows is the evidence.
    const brief = 'Grow MRR to 250000. Keep churn under 3%.';
    const emitted = emitFor(brief, [
      {
        constraint_id: 'gc_quoted',
        node_id: 'fac_churn',
        operator: '<=',
        value: 0.03,
        label: 'Some limit',
        source_quote: 'Keep churn under 3%.',
      },
    ]);
    expect(emitted.map((c) => c.constraint_id)).toEqual(['gc_quoted']);
  });
});

/* ===========================================================================
 * THE RULE ITSELF, directly.
 * ========================================================================= */

describe('2.653 — deriveRiskPolarity', () => {
  it('reads the movement verb from the QUOTE, so polarity binds to THIS threshold', () => {
    // Trap 19 at the level of a phrase. The brief carries a risk clause AND a
    // requirement; the requirement's own quote has no movement verb, so it must
    // come back inconclusive even though "might rise" is a few words away.
    const brief = 'Costs might rise above 50000 and NPS must be at least 40.';
    expect(deriveRiskPolarity('Costs might rise above 50000', brief)).toBe('fears_high');
    expect(deriveRiskPolarity('NPS must be at least 40', brief)).toBeNull();
  });

  it('accepts a possibility marker from a SHORT preceding window, not from anywhere', () => {
    const near = 'There is a risk that costs rise above 50000.';
    expect(deriveRiskPolarity('that costs rise above 50000', near)).toBe('fears_high');
    // Same words, but the marker is in the PREVIOUS sentence: out of reach.
    const far = 'We considered every risk. Costs rise above 50000 in the base case.';
    expect(deriveRiskPolarity('Costs rise above 50000', far)).toBeNull();
  });

  it('a marker far from the quote is out of reach even inside the SAME clause', () => {
    // The window is bounded as well as clause-cut, and both bounds are load
    // bearing. Added after a mutation run: widening PRECEDING_WINDOW_CHARS to
    // 100,000 left every other test green, because the clause cut was doing all
    // the work — a bound nothing discriminates is a bound that can be deleted
    // in a tidy-up with no red anywhere (CLAUDE.md trap 13b).
    const brief =
      'Although we reviewed the risk register in detail last quarter with the board and with the auditors, costs rise above 50000 by then';
    expect(deriveRiskPolarity('costs rise above 50000', brief)).toBeNull();
  });

  it('a movement verb with no possibility marker anywhere is inconclusive', () => {
    expect(deriveRiskPolarity('Revenue rises above 500000')).toBeNull();
  });

  it('a phrase pointing BOTH ways is inconclusive — ambiguity never deletes a constraint', () => {
    expect(deriveRiskPolarity('churn could rise or fall above 3%')).toBeNull();
  });

  it('an obligation modal is not a possibility marker', () => {
    // "must rise above" is a requirement whose `>=` is correct.
    expect(deriveRiskPolarity('revenue must rise above 500000')).toBeNull();
  });

  it('a requirement inside a risk list declines Route B', () => {
    const brief = 'Key risks: churn above 3%, and costs must not exceed 50000.';
    expect(deriveRiskPolarity('and costs must not exceed 50000', brief)).toBeNull();
    expect(deriveRiskPolarity('churn above 3%', brief)).toBe('fears_high');
  });

  it('a risk header cannot reach across a sentence boundary', () => {
    const brief = 'Key risks: the sales team is stretched thin. Churn above 3% is our target floor.';
    expect(deriveRiskPolarity('Churn above 3%', brief)).toBeNull();
  });

  it('Route B needs the brief — a quote alone carries no header', () => {
    expect(deriveRiskPolarity('churn above 3%')).toBeNull();
  });
});

describe('2.653 — the two exported halves cannot drift apart', () => {
  /**
   * DERIVATION GUARD (trap 12d, first face). `contradictedRiskPolarity` is what
   * the screen calls; `deriveRiskPolarity` + `polaritySafeOperator` are what the
   * rule is written as. Three exports, one meaning — so assert the identity
   * rather than re-testing the composite by hand, which is how the two would
   * silently come to disagree.
   *
   * This proves AGREEMENT and can never prove COMPLETENESS; the corpus above is
   * the instrument for that. Both ship, neither supersedes the other.
   */
  const PHRASES = [
    ...FEARS_HIGH_BRIEFS.map(([, b]) => b),
    ...FEARS_LOW_BRIEFS.map(([, b]) => b),
    ...REQUIREMENT_BRIEFS.map(([, b]) => b),
    'churn could rise above 3%',
    'retention could drop below 90%',
    'revenue must rise above 500000',
    '',
  ];

  it.each(['<=', '>='] as const)('holds for operator %s across every corpus phrase', (op) => {
    for (const phrase of PHRASES) {
      const polarity = deriveRiskPolarity(phrase, phrase);
      const expected =
        polarity === null || polaritySafeOperator(polarity) === op ? null : polarity;
      expect(contradictedRiskPolarity(phrase, op, phrase)).toBe(expected);
    }
  });

  it('an operator outside the ASCII pair is never contradicted', () => {
    // `GoalConstraintSchema` admits only `>=` and `<=`, but the screen reads
    // untyped merged rows. A stray value must fall through, not throw.
    expect(contradictedRiskPolarity('churn could rise above 3%', '>', null)).toBeNull();
    expect(contradictedRiskPolarity('churn could rise above 3%', undefined, null)).toBeNull();
  });
});

describe('2.653 — partitionRiskFramedInversions, directly', () => {
  it('splits on operator-vs-polarity, reports which fear was contradicted, and preserves order', () => {
    const good = { operator: '<=', source_quote: 'keep churn under 3%' };
    const bad = { operator: '>=', source_quote: 'churn could rise above 3%' };
    const alsoGood = { operator: '>=', source_quote: 'retention must be at least 90%' };
    const { binding, inverted } = partitionRiskFramedInversions([good, bad, alsoGood]);
    expect(binding).toEqual([good, alsoGood]);
    expect(inverted).toEqual([{ constraint: bad, polarity: 'fears_high' }]);
  });

  it('falls back to `label` when `source_quote` is absent', () => {
    const row = { operator: '>=', label: 'churn could rise above 3%' };
    const { binding, inverted } = partitionRiskFramedInversions([row]);
    expect(binding).toEqual([]);
    expect(inverted.map((e) => e.polarity)).toEqual(['fears_high']);
  });

  it('is a no-op on a list with nothing risk-framed', () => {
    const list = [
      { operator: '<=', source_quote: 'keep churn under 3%' },
      { operator: '>=', source_quote: 'NPS must be at least 40' },
    ];
    const { binding, inverted } = partitionRiskFramedInversions(list);
    expect(binding).toEqual(list);
    expect(inverted).toEqual([]);
  });
});
