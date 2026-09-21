/**
 * DERIVE THE PRODUCER'S REFUSAL SENTENCE — NEVER RE-TYPE IT.
 *
 * ⚠ WHY THIS EXISTS. Three composer fixtures carried the
 * `bare_number_outside_cap` sentence as a hand-typed `issue:` string:
 *
 *   "Value 250000 is outside the factor's expected range [0, 200000] and no
 *    unit was given."
 *
 * `feat/1560-merged-tree-and-binding-pins` collapsed the producer's two range
 * arms onto one shared helper and changed that copy (and began formatting the
 * number, so `250000` now renders `250,000`). **Not one of the three fixtures
 * went red**, because each one constructs the producer's output itself and then
 * asserts COMPOSER behaviour over it. They are decoupled from the producer by
 * construction — which is exactly the property that let them go on asserting
 * composer behaviour over an input the producer can no longer emit.
 *
 * A fixture that builds its own producer input cannot notice the producer
 * changing. Hand-copying the NEW sentence into the three call sites would just
 * restart the same drift with a fresher string (CLAUDE.md trap 12: derive, do
 * not mirror). So the sentence is DERIVED here, by running the real producer.
 *
 * ⚠ THIS HELPER PINS ITS OWN PRECONDITION (trap 13b). A derivation that
 * silently returned some OTHER refusal's sentence would be worse than the
 * hardcoded string: the fixtures would still be green, still exercising the
 * composer, and now over a sentence nobody chose. So the reason code is
 * asserted, and anything else throws by name rather than returning.
 *
 * It deliberately does NOT export the producer's private
 * `bareNumberOutsideCapSentence`. Exporting the formatter would let a caller
 * obtain the sentence for inputs the predicate can never actually reject,
 * re-opening the "fixture the producer cannot emit" hole one level down. Going
 * through `evaluateFactorValueProposal` means a fixture exists only if the
 * product can really produce it. This is the same discipline as
 * `tools/handlers/__tests__/precise-refusal-survives-the-boundary.test.ts`,
 * which drives the real predicate for this reason code rather than re-typing
 * copy.
 */

import {
  evaluateFactorValueProposal,
  type EvaluateFactorValueProposalInput,
} from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

/**
 * The REAL `bare_number_outside_cap` sentence for a bare `value` against `cap`.
 *
 * `inputHasUnit: false` is what selects this reason over `value_exceeds_cap`:
 * a bare number asserts no scale, so the cap is the only scale evidence there
 * is. The pair is driven through the actual predicate, so the returned string
 * is by construction one the product can emit.
 */
export function bareNumberOutsideCapIssue(value: number, cap: number): string {
  const input: EvaluateFactorValueProposalInput = {
    rawInput: value,
    operator: 'set',
    factorCap: cap,
    inputHasUnit: false,
  };

  const result = evaluateFactorValueProposal(input);

  if (result.ok) {
    throw new Error(
      `bareNumberOutsideCapIssue(${value}, ${cap}): the producer ACCEPTED this ` +
        `pair, so no refusal sentence exists for it. The fixture this feeds ` +
        `would have been asserting composer behaviour over an input the ` +
        `product cannot emit.`,
    );
  }

  if (result.reason !== 'bare_number_outside_cap') {
    throw new Error(
      `bareNumberOutsideCapIssue(${value}, ${cap}): the producer refused with ` +
        `'${result.reason}', not 'bare_number_outside_cap'. Refusing to hand ` +
        `back another branch's sentence — pick a value/cap pair that reaches ` +
        `the range guard, or fix the caller's intent.`,
    );
  }

  return result.specific_issue;
}
