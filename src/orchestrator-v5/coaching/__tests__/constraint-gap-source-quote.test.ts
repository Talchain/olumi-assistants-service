/**
 * WS-A ITEM 2(a) — THE BLOCKED CONSTRAINT MUST BE NAMED IN THE USER'S OWN
 * WORDS, NOT ONLY UNDER A LABEL THE DRAFTER MINTED.
 *
 * MEASURED (L2A-FIDELITY-TRACE.md §4, deployed staging, 11 August 2026).
 * B1's *"without dropping gross margin below 78%"* is the single best-handled
 * atom in the whole three-brief corpus and the ONLY `provenance: "explicit"`
 * object among 76 atoms — unit, magnitude, operator, provenance AND source
 * quote all intact:
 *
 *   { unit: "fraction", label: "Keep gross margin at or above 78%", value: 0.78,
 *     node_id: "risk_margin_pressure", operator: ">=", confidence: 0.85,
 *     provenance: "explicit", value_frame: "level",
 *     source_quote: "without dropping gross margin below 78%",
 *     constraint_id: "constraint_risk_margin_pressure_min" }
 *
 * And it is the atom that STOPPED the product answering, while B2 and B3 —
 * whose hard constraints were never extracted at all — analysed fine and
 * returned leading options. *"Fidelity is currently punished."*
 *
 * ⚠ A PREMISE FROM THE COMMISSIONING BRIEF, REFUTED AT THE BYTES, recorded
 * here because it changes what this test is for. The brief describes the
 * blocking path as producing *"a bare 'no option can be put forward'"*. It is
 * not bare: `buildConstraintDisclosure` already names the limit and already
 * offers a one-step repair, and the witnessed sentence carried both. The gap
 * that survives derivation is narrower and sharper — `readRatifiedConstraints`
 * read `constraint_id` and `label` ONLY, so the persisted `source_quote` (on
 * the shared contract since `GoalConstraintSchema`, and populated on exactly
 * this atom) never reached any surface. The user was shown a limit under a
 * name they had never seen, on the run where the product refused to answer.
 * That is what this file closes.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE constraint id
 * and THE captured quote, so no other row satisfying the same shape can keep
 * it green.
 */

import { describe, it, expect } from 'vitest';

import {
  buildConstraintDisclosureFromState,
  CONSTRAINT_GAP_QUOTE_MAX_CHARS,
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
} from '../constraint-gap-disclosure.js';
import {
  readRatifiedConstraints,
  type RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';

/** The B1 atom, verbatim from the 2026-08-11 fidelity trace. */
const B1_MARGIN_CONSTRAINT = {
  constraint_id: 'constraint_risk_margin_pressure_min',
  node_id: 'risk_margin_pressure',
  operator: '>=',
  value: 0.78,
  unit: 'fraction',
  label: 'Keep gross margin at or above 78%',
  source_quote: 'without dropping gross margin below 78%',
  confidence: 0.85,
  provenance: 'explicit',
} as const;

/** The exact regex the registry-side egress allowlist compiles. */
function grammarAdmits(suffix: string): boolean {
  return new RegExp(`^(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})$`).test(suffix);
}

describe('WS-A 2(a) — the persisted source quote reaches the reader', () => {
  it('readRatifiedConstraints carries source_quote off the SAME persisted row as the label', () => {
    const [constraint] = readRatifiedConstraints({
      goal_constraints: [B1_MARGIN_CONSTRAINT],
    });
    expect(constraint?.constraint_id).toBe('constraint_risk_margin_pressure_min');
    expect(constraint?.label).toBe('Keep gross margin at or above 78%');
    expect(constraint?.source_quote).toBe('without dropping gross margin below 78%');
  });

  it('never fabricates a quote: a row without one reads null', () => {
    const [constraint] = readRatifiedConstraints({
      goal_constraints: [{ constraint_id: 'c1', label: 'A limit' }],
    });
    expect(constraint?.source_quote).toBeNull();
  });
});

describe('WS-A 2(a) — the unevaluated disclosure quotes the user back to themselves', () => {
  const constraints = (): readonly RatifiedConstraint[] =>
    readRatifiedConstraints({ goal_constraints: [B1_MARGIN_CONSTRAINT] });

  it('names the limit AND quotes the brief span, on the exact atom that blocked B1', () => {
    const suffix = buildConstraintDisclosureFromState('unevaluated', constraints());
    expect(suffix).toContain('One limit on your model could not be checked');
    expect(suffix).toContain('“Keep gross margin at or above 78%”');
    expect(suffix).toContain('From your brief: “without dropping gross margin below 78%”.');
    // The repair step still closes the message — the quote is additive, not a
    // replacement for the one-step resolution path.
    expect(suffix).toContain('Tell me the limit you meant in your own words');
  });

  it('asserts presence in the submitted text, never authorship of the row', () => {
    // ROADMAP 2.653/2.675 withdrew "the conditions you set" from this voice
    // because `goal_constraints[]` rows are minted by the drafter too. The
    // quote lead-in must not smuggle that claim back in.
    const suffix = buildConstraintDisclosureFromState('unevaluated', constraints());
    expect(suffix).not.toMatch(/you (?:set|wrote|said)/i);
    expect(suffix).toContain('From your brief:');
  });

  it('the composed suffix still satisfies the published egress grammar', () => {
    // The grammar and the allowlist compile from the SAME source. A quote slot
    // the grammar does not admit would not error — it would silently revert
    // the entire summary to the locked template (the #703 failure this module
    // exists to prevent), so this is the assertion that keeps the feature from
    // costing the disclosure.
    expect(grammarAdmits(buildConstraintDisclosureFromState('unevaluated', constraints()))).toBe(true);
    expect(
      grammarAdmits(buildConstraintDisclosureFromState('identity_unresolved', constraints())),
    ).toBe(true);
  });

  it('degrades to the labelled form — never to silence — when the quote cannot be rendered', () => {
    // The middle rung of the ladder. Each case gives up the QUOTE and keeps
    // everything else; a fall to count-only or to '' would be over-suppression.
    const cases: Array<[string, string]> = [
      ['too long', 'x'.repeat(CONSTRAINT_GAP_QUOTE_MAX_CHARS + 1)],
      ['carries the grammar’s own quote marks', 'margin “must” stay above 78%'],
      ['carries a line break', 'without dropping\ngross margin below 78%'],
      ['empty after sanitisation', '   '],
    ];
    for (const [why, quote] of cases) {
      const suffix = buildConstraintDisclosureFromState(
        'unevaluated',
        readRatifiedConstraints({
          goal_constraints: [{ ...B1_MARGIN_CONSTRAINT, source_quote: quote }],
        }),
      );
      expect(suffix, why).toContain('“Keep gross margin at or above 78%”');
      expect(suffix, why).not.toContain('From your brief:');
      expect(grammarAdmits(suffix), why).toBe(true);
    }
  });

  it('stays silent about quotes when SEVERAL limits are disclosed — one quote cannot name three limits', () => {
    // Deliberate narrowing. Binding a single quote to a list of labels would
    // invite the reader to attach the user's own sentence to the wrong limit,
    // which is a false statement about their words rather than a smaller one.
    const many = readRatifiedConstraints({
      goal_constraints: [
        B1_MARGIN_CONSTRAINT,
        { constraint_id: 'c2', label: 'Hiring cap', source_quote: 'we cannot hire more than 8 people' },
      ],
    });
    const suffix = buildConstraintDisclosureFromState('unevaluated', many);
    expect(suffix).toContain('2 limits on your model could not be checked');
    expect(suffix).not.toContain('From your brief:');
    expect(grammarAdmits(suffix)).toBe(true);
  });

  it('a quoteless row produces exactly the message it produced before this change', () => {
    // The no-regression rung: absence of a quote must be byte-identical to the
    // pre-WS-A output, so the estate's pinned disclosure copy is untouched for
    // every row that carries no `source_quote`.
    const suffix = buildConstraintDisclosureFromState(
      'unevaluated',
      readRatifiedConstraints({ goal_constraints: [{ constraint_id: 'c1', label: 'A limit' }] }),
    );
    expect(suffix).toBe(
      ' One limit on your model could not be checked: “A limit”.' +
        ' We could not line it up with anything this analysis measures, so no option can be put forward yet.' +
        ' Tell me the limit you meant in your own words and I will record it; this one stays on the model.' +
        ' Then run the analysis again.',
    );
  });
});
