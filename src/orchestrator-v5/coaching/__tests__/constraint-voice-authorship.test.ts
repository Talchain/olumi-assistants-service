/**
 * ROADMAP 2.675 — the THREE SIBLING VOICES lose the authorship claim #840
 * removed from `unevaluated`.
 *
 * #840 (ROADMAP 2.653 I-C) withdrew "the conditions you set" from the
 * `unevaluated` voice, because the walk proved it false: CEE's own brief
 * extractor minted the row from "customer churn could rise above 3%" and showed
 * it to the tester for the first time inside the message blaming them for it.
 * The tester's note, verbatim: *"the constraint was AUTHORED BY THE DRAFTER,
 * not by me."*
 *
 * THREE SIBLING VOICES KEPT SAYING IT, and a user reaches all three:
 *
 *   1. `identity_unresolved`   "the condition you set" / "the N conditions you
 *                              set"            (constraint-gap-disclosure.ts)
 *   2. `out_of_scope`          "one of the conditions you set"
 *                                              (constraint-gap-disclosure.ts)
 *   3. `evaluated_infeasible`  "The condition you set was checked on this run",
 *                              "All N conditions you set were checked"
 *                                              (withheld-reason-tail.ts)
 *   + the `identity_unresolved` UNLABELLED read-back form, the second surface
 *     for voice 1                              (withheld-reason-tail.ts)
 *
 * WHY THE CLAIM IS FALSE WHOEVER READS IT. `goal_constraints[]` rows are minted
 * by the DRAFTER (prompts/canonical/draft_graph.txt — "Extract ALL explicit
 * numeric secondary limits") as well as by the user's own `add_constraint`
 * turn. `RatifiedConstraint` (constraint-feasibility.ts) carries exactly
 * `constraint_id` + `label`, so NO surface downstream can tell the two apart.
 * A sentence that attributes authorship is therefore a guess, and on the
 * witnessed session it guessed wrong.
 *
 * ⚠ WHY THE EXISTING `provenance` FIELD CANNOT FIX THIS — measured, not assumed
 * (see the lane report; recorded here because the next reader WILL reach for
 * it). `GoalConstraintSchema.provenance` is `z.enum(["explicit","inferred",
 * "proxy"]).optional()`. `add-constraint.ts:412` hardcodes `'explicit'` for the
 * USER-authored path — and `draft_graph.txt`'s worked examples emit
 * `"provenance": "explicit"` for rows the MODEL extracted from brief prose
 * (lines 489, 755-757, each with a `source_quote` lifted from the brief). The
 * two authorship classes we would need to separate BOTH write the identical
 * token. `"explicit"` means "explicit in the source text", never "the user
 * asked for it" — so threading it through would license "the condition you set"
 * on precisely the row that proved the claim false. Distinguishing authorship
 * needs a NEW, unoverloaded field at the two write sites; it is not a plumbing
 * job on this one.
 *
 * WHAT REPLACES IT, PER VOICE. Not one sentence blanket-swapped across three
 * states — that is the conflation `constraint-gap-disclosure.ts`'s docstring
 * exists to prevent, and each state means something different:
 *
 *   identity_unresolved   we could not MATCH the engine's condition results to
 *                         the row. Says "could not be matched", never "checked".
 *   out_of_scope          the row's subject is outside the analysed graph.
 *                         Says "This analysis does not test", and no repair.
 *   evaluated_infeasible  the row WAS checked and cannot be met. This is the
 *                         ONE voice where "was checked on this run" is TRUE —
 *                         only the authorship half was false, so the truth half
 *                         MUST survive this change (pinned below).
 *
 * The replacement is #840's: "on your model" — true whoever authored the row,
 * and asserting nothing about who.
 */
import { describe, it, expect } from 'vitest';

import {
  buildConstraintDisclosure,
  buildConstraintDisclosureFromState,
} from '../constraint-gap-disclosure.js';
import { composeWithheldReasonTail } from '../../compose/withheld-reason-tail.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import {
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdict,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../../../orchestrator/context/constraint-feasibility.js';

const BUDGET: RatifiedConstraint = {
  constraint_id: 'constraint_out_total_cost_max',
  label: 'Total three-year cost',
};
const DEADLINE: RatifiedConstraint = {
  constraint_id: 'constraint_goal_arr_max',
  label: 'Delivery deadline',
};
const UNLABELLED: RatifiedConstraint = { constraint_id: 'c_x', label: null };

const ONE = [BUDGET] as const;
const TWO = [BUDGET, DEADLINE] as const;

function verdictOf(
  state: ConstraintVerdictState,
  constraints: readonly RatifiedConstraint[],
  outOfScopeConstraints: readonly RatifiedConstraint[] = [],
): ConstraintVerdict {
  return {
    state,
    mayNameLeadingOption: MAY_NAME_LEADING_OPTION[state],
    codes: [],
    constraints,
    leaderInfeasibility: null,
    outOfScopeConstraints,
  };
}

/** The forwarder `renderConfirmation` actually invokes, called the same way. */
function throughForwarder(assistantText: string): string {
  const tmpl = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  if (typeof tmpl !== 'function') throw new Error('expected a function template');
  return tmpl({ assistant_text: assistantText });
}

/* ───────────────────────── the per-voice surfaces ─────────────────────────
 * Each helper returns EVERY user-facing string ITS voice can put on a screen,
 * across both surfaces that speak it. They are separate helpers, not one pooled
 * list, because the assertions below are per-voice by design: a pooled list
 * would let a blanket swap satisfy every check at once, which is the exact
 * conflation this change must not commit.
 */

function everyIdentityUnresolvedVoice(): string[] {
  return [
    buildConstraintDisclosureFromState('identity_unresolved', ONE),
    buildConstraintDisclosureFromState('identity_unresolved', TWO),
    buildConstraintDisclosureFromState('identity_unresolved', [UNLABELLED]),
    composeWithheldReasonTail('identity_unresolved', ONE)?.text ?? '',
    composeWithheldReasonTail('identity_unresolved', TWO)?.text ?? '',
    // The UNLABELLED read-back form — reachable when the row is deleted after
    // the run, and the second place voice 1 carried the claim.
    composeWithheldReasonTail('identity_unresolved', [])?.text ?? '',
  ].filter((s) => s.length > 0);
}

function everyOutOfScopeVoice(): string[] {
  return [
    buildConstraintDisclosure(verdictOf('not_applicable', [], [DEADLINE])),
    buildConstraintDisclosure(verdictOf('not_applicable', [], [BUDGET, DEADLINE])),
    buildConstraintDisclosure(verdictOf('not_applicable', [], [UNLABELLED])),
    // Riding alongside a state voice — the additive shape 2.349 introduced.
    buildConstraintDisclosure(verdictOf('identity_unresolved', ONE, [DEADLINE])),
  ].filter((s) => s.length > 0);
}

/** Only the shapes that NAME a ratified row; the zero-row branch is separate. */
function everyInfeasibleVoiceNamingRows(): string[] {
  return [
    composeWithheldReasonTail('evaluated_infeasible', ONE)?.text ?? '',
    composeWithheldReasonTail('evaluated_infeasible', TWO)?.text ?? '',
    composeWithheldReasonTail('evaluated_infeasible', [UNLABELLED])?.text ?? '',
  ].filter((s) => s.length > 0);
}

/**
 * PRECONDITION PINS (CLAUDE.md trap 13b, third face). Every assertion below is
 * a `for` loop over one of these lists. If a fixture silently stopped producing
 * its voice — a builder returning '' for a shape, a helper drifting off the
 * API — the loop would iterate over nothing and every check would pass by
 * testing nothing. These assert the lists are the size and shape they must be
 * BEFORE anything is asserted about their contents, so a hollowed fixture REDs
 * here instead of turning the whole file green.
 */
describe('2.675 — the fixtures actually reach the voices they name', () => {
  it('each voice produces its full complement of surfaces, and each is its own voice', () => {
    const identity = everyIdentityUnresolvedVoice();
    const outOfScope = everyOutOfScopeVoice();
    const infeasible = everyInfeasibleVoiceNamingRows();

    expect(identity).toHaveLength(6);
    expect(outOfScope).toHaveLength(4);
    expect(infeasible).toHaveLength(3);

    // Identity by the state's OWN distinguishing marker, never a value
    // predicate another voice could satisfy (CLAUDE.md trap 19).
    for (const t of identity) expect(t).toContain('could not be matched');
    for (const t of outOfScope) expect(t).toContain('This analysis does not test');
    for (const t of infeasible) expect(t).toContain('does not stand up against');
  });
});

describe('2.675 — no sibling voice claims the user authored the row', () => {
  const ALL_THREE: ReadonlyArray<readonly [string, () => string[]]> = [
    ['identity_unresolved', everyIdentityUnresolvedVoice],
    ['out_of_scope', everyOutOfScopeVoice],
    ['evaluated_infeasible', everyInfeasibleVoiceNamingRows],
  ];

  it.each(ALL_THREE)('%s makes no authorship claim on any surface', (_name, surfaces) => {
    for (const text of surfaces()) {
      // The exact claim #840 withdrew from `unevaluated`.
      expect(text).not.toMatch(/conditions? you set/i);
      expect(text).not.toMatch(/\byou (?:set|wrote|chose|specified)\b/i);
      // ⭐ AND THE PRESUPPOSITION, which is the same falsehood one grammatical
      // step back: "Re-state X" can only be addressed to someone who stated X.
      // On a drafter-authored row the user never did, so the instruction is
      // addressed to a thing that did not happen — the reading the walk's
      // tester gave the whole message.
      expect(text).not.toMatch(/\bre-?state\b/i);
    }
  });

  it.each(ALL_THREE)('%s still says WHOSE model the row sits on', (_name, surfaces) => {
    // Not a retreat into anonymity: withdrawing a false attribution by saying
    // nothing at all would leave the user unable to tell which model is meant.
    // #840's replacement, applied to the siblings.
    for (const text of surfaces()) expect(text).toContain('on your model');
  });
});

describe('2.675 — each voice keeps ITS truth conditions, and none borrows another\'s', () => {
  // ⭐ THE ANTI-BLANKET-SWAP PINS. A single honest-looking sentence applied to
  // all three states would pass every authorship check above while telling two
  // of the three users something false. These bind each voice to the statement
  // that is true ONLY in its own state, and forbid the other two's.

  it('identity_unresolved: could not be MATCHED — never "checked", never "does not test"', () => {
    for (const text of everyIdentityUnresolvedVoice()) {
      expect(text).toContain('could not be matched');
      expect(text).toContain('cannot be confirmed whether');
      // It must NOT assert the condition went unchecked (#703's false
      // statement) and must NOT borrow the scope voice.
      expect(text).not.toContain('could not be checked');
      expect(text).not.toContain('was checked on this run');
      expect(text).not.toContain('This analysis does not test');
    }
  });

  it('out_of_scope: the MODEL does not test it — and it withholds nothing', () => {
    for (const text of everyOutOfScopeVoice()) {
      expect(text).toContain('This analysis does not test');
      expect(text).toContain('not part of the comparison');
      expect(text).toContain('recorded on your scenario');
      // The scope voice must never carry the unevaluated voice's repair step:
      // there is no repair, and gap 5 shipped exactly that.
      expect(text).not.toContain('Tell me the limit you meant');
      expect(text).not.toContain('same units');
    }
  });

  it('⭐ evaluated_infeasible KEEPS "was checked on this run" — the one true half', () => {
    // The load-bearing asymmetry of this change, and the reason a blanket swap
    // is wrong. In THIS state the row genuinely WAS evaluated; only the
    // authorship half of the sentence was false. A fix that deleted the whole
    // clause would trade a false attribution for a false denial, and tell the
    // user their limit went unchecked on the one run where it did not.
    const one = composeWithheldReasonTail('evaluated_infeasible', ONE)!.text;
    const unlabelled = composeWithheldReasonTail('evaluated_infeasible', [UNLABELLED])!.text;
    const two = composeWithheldReasonTail('evaluated_infeasible', TWO)!.text;

    expect(one).toContain('The condition on your model was checked on this run');
    expect(unlabelled).toContain('The condition on your model was checked on this run');
    expect(two).toContain('All 2 conditions on your model were checked on this run');

    for (const text of everyInfeasibleVoiceNamingRows()) {
      expect(text).toContain('does not stand up against');
      // …and never the two voices that mean the opposite.
      expect(text).not.toContain('could not be checked');
      expect(text).not.toContain('could not be matched');
    }
  });

  it('the #840 unevaluated voice is untouched and still distinct from all three', () => {
    // Trap 13b: rewriting three siblings must not quietly collapse any of them
    // into the voice that was already fixed, nor disturb it.
    const unevaluated = buildConstraintDisclosureFromState('unevaluated', ONE);
    expect(unevaluated).toContain('One limit on your model could not be checked');
    expect(unevaluated).toContain('We could not line it up with anything this analysis measures');
    expect(unevaluated).not.toContain('could not be matched');
    expect(unevaluated).not.toContain('This analysis does not test');
    expect(unevaluated).not.toContain('was checked on this run');
  });
});

describe('2.675 — the singular unlabelled infeasible form is grammatical and does not ask "which one"', () => {
  it('one unnamed condition is not described as "one of them"', () => {
    // PRE-EXISTING DEFECT, fixed with the rewrite because it lives in the same
    // sentence. With exactly one ratified row whose label is unusable, the
    // count branch emitted "The condition you set WERE checked ... does not
    // stand up against ONE OF THEM ... Which one that is has not been
    // recorded" — a subject/verb disagreement wrapped around a question that
    // cannot arise when there is only one candidate. It is emitted at module
    // load by this file's own sibling probe (`one-unlabelled`), so it was live.
    const text = composeWithheldReasonTail('evaluated_infeasible', [UNLABELLED])!.text;
    expect(text).not.toMatch(/\bcondition[^.]*\bwere checked\b/);
    expect(text).toContain('was checked on this run');
    expect(text).not.toContain('one of them');
    expect(text).not.toContain('Which one that is has not been recorded');
    // The plural form KEEPS it — that is where the question is real.
    const two = composeWithheldReasonTail('evaluated_infeasible', TWO)!.text;
    expect(two).toContain('one of them');
    expect(two).toContain('Which one that is has not been recorded');
  });
});

describe('2.675 — the rewritten copy still reaches the wire', () => {
  // The whole point of `CONSTRAINT_GAP_DISCLOSURE_RE_SRC` is that a copy edit
  // propagates to the egress allowlist automatically. That is a claim about the
  // grammar's derivation, and it is worth exactly nothing unless measured at
  // the forwarder — #703 shipped a correct disclosure that no user ever saw.
  const shapes: ReadonlyArray<readonly [string, ConstraintVerdict]> = [
    ['identity_unresolved · one', verdictOf('identity_unresolved', ONE)],
    ['identity_unresolved · two', verdictOf('identity_unresolved', TWO)],
    ['identity_unresolved · unlabelled', verdictOf('identity_unresolved', [UNLABELLED])],
    ['out_of_scope · one', verdictOf('not_applicable', [], [DEADLINE])],
    ['out_of_scope · two', verdictOf('not_applicable', [], [BUDGET, DEADLINE])],
    ['combined · state + scope', verdictOf('identity_unresolved', ONE, [DEADLINE])],
  ];

  it.each(shapes)('%s survives the allowlist and the forwarder', (_name, verdict) => {
    const suffix = buildConstraintDisclosure(verdict);
    expect(suffix.length).toBeGreaterThan(0);
    const composed = `Ran analysis on your current scenario.${suffix}`;
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
    // Byte-identical through the forwarder = it was not knocked back to the
    // locked template.
    expect(throughForwarder(composed)).toBe(composed);
  });

  it('the COMBINED shape really carries both voices, not just the one that fit', () => {
    // `buildConstraintDisclosure` falls back to the state voice alone when the
    // pair fails the grammar. Without this the test above would pass on a
    // silently halved message.
    const combined = buildConstraintDisclosure(verdictOf('identity_unresolved', ONE, [DEADLINE]));
    expect(combined).toContain('could not be matched');
    expect(combined).toContain('This analysis does not test');
  });
});
