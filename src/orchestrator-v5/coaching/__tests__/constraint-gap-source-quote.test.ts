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
  buildConstraintDisclosure,
  buildConstraintDisclosureFromState,
  CONSTRAINT_GAP_QUOTE_MAX_CHARS,
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
} from '../constraint-gap-disclosure.js';
import { composeWithheldReasonTail } from '../../compose/withheld-reason-tail.js';
import {
  readRatifiedConstraints,
  type ConstraintVerdict,
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

/**
 * The brief the B1 atom was extracted from. The quoted span appears in it
 * VERBATIM — which is the whole point of the round-2 gate: *"From your brief"*
 * is a claim about THIS text, and the product may only make it about a span it
 * can find here.
 */
const B1_BRIEF =
  'We are choosing a CRM for the sales team. Switching would cost roughly £18,000 one-off, ' +
  'plus around £6,000 of training. We need it live inside two quarters, ' +
  'without dropping gross margin below 78%.';

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
    const suffix = buildConstraintDisclosureFromState('unevaluated', constraints(), B1_BRIEF);
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
    const suffix = buildConstraintDisclosureFromState('unevaluated', constraints(), B1_BRIEF);
    expect(suffix).not.toMatch(/you (?:set|wrote|said)/i);
    expect(suffix).toContain('From your brief:');
  });

  it('the composed suffix still satisfies the published egress grammar', () => {
    // The grammar and the allowlist compile from the SAME source. A quote slot
    // the grammar does not admit would not error — it would silently revert
    // the entire summary to the locked template (the #703 failure this module
    // exists to prevent), so this is the assertion that keeps the feature from
    // costing the disclosure.
    expect(
      grammarAdmits(buildConstraintDisclosureFromState('unevaluated', constraints(), B1_BRIEF)),
    ).toBe(true);
    expect(
      grammarAdmits(
        buildConstraintDisclosureFromState('identity_unresolved', constraints(), B1_BRIEF),
      ),
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
      // ⚠ THE BRIEF CONTAINS THE SPAN IN EVERY CASE (round 2). Without this,
      // each of these would degrade because the round-2 presence gate could not
      // find the span — i.e. every assertion below would pass for a reason the
      // test does not name, which is the "guard agreeing with itself" shape
      // (CLAUDE.md trap 13b). Supplying a brief that DOES carry the span leaves
      // the named renderability defect as the only thing that can fire.
      const suffix = buildConstraintDisclosureFromState(
        'unevaluated',
        readRatifiedConstraints({
          goal_constraints: [{ ...B1_MARGIN_CONSTRAINT, source_quote: quote }],
        }),
        `${B1_BRIEF} ${quote}`,
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
    const suffix = buildConstraintDisclosureFromState('unevaluated', many, B1_BRIEF);
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
      B1_BRIEF,
    );
    expect(suffix).toBe(
      ' One limit on your model could not be checked: “A limit”.' +
        ' We could not line it up with anything this analysis measures, so no option can be put forward yet.' +
        ' Tell me the limit you meant in your own words and I will record it; this one stays on the model.' +
        ' Then run the analysis again.',
    );
  });
});

/**
 * ROUND 2 — B1: *"From your brief"* IS A CLAIM, AND IT MUST BE CHECKED.
 *
 * ⚠ THE PREMISE ROUND 1 SHIPPED ON WAS FALSE, and this repo had already
 * measured why. The quote rung's docblock defended the lead-in on the grounds
 * that it *"asserts only that the span is present in the text the user
 * submitted, which is exactly what `source_quote` records."* `source_quote`
 * records no such thing: it is MODEL-AUTHORED, and
 * `cee/compound-goal/direction-gate.ts:331-336` says so in a measured
 * docblock, in this same service —
 *
 *   *"A model row carries a `source_quote` it wrote itself, and models
 *   routinely paraphrase — and, measured on this very defect class, routinely
 *   STRIP THE NEGATION while doing so (\"Don't let gross margin drop below
 *   78%\" is quoted back as \"gross margin drop below 78%\")."*
 *
 * That is the worst available shape for this surface. The disclosure would
 * attribute to the user a sentence they never wrote, and the documented
 * paraphrase mode INVERTS the limit — so the fabricated quote can state the
 * opposite of the constraint printed beside it, on the very turn where the
 * product is refusing to answer, in `assistant_text`.
 *
 * The guard already existed: `locateEvidence(brief, quote).located`, built in
 * that module precisely because an unlocated quote must fail closed. Round 1
 * called neither it nor any `brief.includes(...)`. Round 2 consults it.
 *
 * EVERY CASE HERE CARRIES ITS OPPOSITE-DIRECTION TWIN (CLAUDE.md trap 22b): a
 * gate that suppresses everything is not a fix, it is the feature deleted. So
 * for each suppression there is a located sibling that must still speak.
 */
describe('WS-A 2(a) round 2 — the quote rung is gated on the span being IN the brief', () => {
  const constraintsWithQuote = (quote: string): readonly RatifiedConstraint[] =>
    readRatifiedConstraints({
      goal_constraints: [{ ...B1_MARGIN_CONSTRAINT, source_quote: quote }],
    });

  /**
   * The measured paraphrase mode, verbatim from `direction-gate.ts`: the model
   * quotes the limit back with the negation removed. Present in NO brief,
   * and its plain reading is the INVERSE of the constraint.
   */
  const NEGATION_STRIPPED_PARAPHRASE = 'gross margin drop below 78%';

  it('SUPPRESSES a model paraphrase that is not in the brief — and keeps the label', () => {
    const suffix = buildConstraintDisclosureFromState(
      'unevaluated',
      constraintsWithQuote(NEGATION_STRIPPED_PARAPHRASE),
      B1_BRIEF,
    );
    // PRECONDITION PINNED IN-TEST (trap 13b): the paraphrase must genuinely be
    // absent from this brief, or the suppression below is about the fixture.
    expect(B1_BRIEF).not.toContain(NEGATION_STRIPPED_PARAPHRASE);
    expect(suffix).not.toContain('From your brief:');
    expect(suffix).not.toContain(NEGATION_STRIPPED_PARAPHRASE);
    // The fall is exactly ONE rung: the labelled disclosure survives intact.
    expect(suffix).toContain('One limit on your model could not be checked: “Keep gross margin at or above 78%”.');
    expect(grammarAdmits(suffix)).toBe(true);
  });

  it('TWIN — the same atom, quoted faithfully, still reaches the reader', () => {
    // Without this, "the gate works" would be indistinguishable from "the
    // quote rung was deleted". This is the case WS-A item 2(a) exists for.
    const suffix = buildConstraintDisclosureFromState(
      'unevaluated',
      constraintsWithQuote('without dropping gross margin below 78%'),
      B1_BRIEF,
    );
    expect(suffix).toContain('From your brief: “without dropping gross margin below 78%”.');
    expect(grammarAdmits(suffix)).toBe(true);
  });

  it('locates across the differences a faithful quote legitimately carries', () => {
    // `locateEvidence` normalises curly quotes and whitespace and retries
    // case-insensitively. These are the shapes a model produces while still
    // quoting the user's words, and suppressing them would cost the feature
    // most of its reach for no honesty gain.
    const twins: Array<[string, string]> = [
      ['different case', 'Without Dropping Gross Margin Below 78%'],
      ['collapsed whitespace', 'without  dropping   gross margin below 78%'],
    ];
    for (const [why, quote] of twins) {
      const suffix = buildConstraintDisclosureFromState(
        'unevaluated',
        constraintsWithQuote(quote),
        B1_BRIEF,
      );
      expect(suffix, why).toContain('From your brief:');
      expect(grammarAdmits(suffix), why).toBe(true);
    }
  });

  it('FAILS CLOSED with no brief to check against — an unverifiable claim is not made', () => {
    // The direction that matters when a caller has nothing to pass. An absent
    // brief is not evidence that the span is present; it is the absence of any
    // evidence at all, and the honest outcome is to say less.
    for (const brief of [undefined, null, '', '   ']) {
      const suffix = buildConstraintDisclosureFromState(
        'unevaluated',
        constraintsWithQuote('without dropping gross margin below 78%'),
        brief,
      );
      expect(suffix, String(brief)).not.toContain('From your brief:');
      expect(suffix, String(brief)).toContain('“Keep gross margin at or above 78%”');
    }
  });

  it('the whole-verdict entry point is gated identically — both call paths or neither', () => {
    // `buildConstraintDisclosure` (run_analysis) and
    // `buildConstraintDisclosureFromState` (the narrating turn) are two doors
    // onto one message. A gate on one is a gate the other walks around.
    const verdict = (quote: string): ConstraintVerdict =>
      ({
        state: 'unevaluated',
        mayNameLeadingOption: false,
        codes: ['CONSTRAINT_TARGET_UNRELIABLE'],
        constraints: constraintsWithQuote(quote),
        leaderInfeasibility: null,
        outOfScopeConstraints: [],
      }) as unknown as ConstraintVerdict;

    expect(buildConstraintDisclosure(verdict(NEGATION_STRIPPED_PARAPHRASE), B1_BRIEF)).not.toContain(
      'From your brief:',
    );
    expect(
      buildConstraintDisclosure(verdict('without dropping gross margin below 78%'), B1_BRIEF),
    ).toContain('From your brief: “without dropping gross margin below 78%”.');
  });

  it('the withheld-reason tail carries the brief through to the same gate', () => {
    // The second call site's THREAD, pinned at the seam rather than assumed.
    // `composeWithheldReasonTail` is what `withheld-reason-tail.ts:422` and the
    // finalise chokepoint consume, and a brief that stops here would leave the
    // highest-trust surface ungated while this file stayed green.
    const paraphrased = composeWithheldReasonTail(
      'unevaluated',
      constraintsWithQuote(NEGATION_STRIPPED_PARAPHRASE),
      B1_BRIEF,
    );
    expect(paraphrased?.text).not.toContain('From your brief:');
    const faithful = composeWithheldReasonTail(
      'unevaluated',
      constraintsWithQuote('without dropping gross margin below 78%'),
      B1_BRIEF,
    );
    expect(faithful?.text).toContain('From your brief: “without dropping gross margin below 78%”.');
  });
});
