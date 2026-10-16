/**
 * ⭐⭐ WHOSE NUMBER IS THIS? — the encoder's provenance carry.
 *
 * `buildInterventionV3` stamped `source: 'user_specified'` UNCONDITIONALLY, so
 * a value the MODEL produced became permanently indistinguishable from one the
 * USER stated. Measured through the full apply chain at pristine `staging`:
 *
 *   AssertionError: expected 'user_specified' to be 'cee_hypothesis'
 *
 * That is the difference between "the product suggested 0.4 and I agreed" and
 * "I said 0.4" — and it is the question every later review of the model rests
 * on. It is not cosmetic: `obligation-provenance.ts` turns the stamp into an
 * OBLIGATION, so a mis-stamped estimate makes the product DEMAND that the user
 * own a number it invented.
 *
 * ⚠ EVERY GUARD HERE IS WRITTEN AGAINST THE CHAIN
 * (`parseEditGraphResponse` → `applyPatchOperations` → `encodeOptionInterventionsForEdit`),
 * never against a helper of this spec's own, so none can pass by agreeing with
 * itself. The cells are DERIVED from the readiness producer at test time rather
 * than transcribed — a self-authored fixture encodes the author's model of the
 * producer rather than the producer (CLAUDE.md trap 16-inverse).
 *
 * The graph is a REAL DATED CAPTURE (`witness-2026-08-17/j4-wrong-entity-write
 * .json`, deployed CEE `8be62df`, scenario J4), varied only by CLEARING option
 * interventions in memory. The capture file itself is never edited — it is a
 * historic record (trap 14b).
 *
 * ⚠ SPLIT OUT OF PR #1337, which carried this encoder fix alongside an
 * unrelated, currently-unreferenced handler. These guards drive the ENCODER
 * directly and depend on no handler, so they land with the live fix.
 */

import { describe,expect,it } from 'vitest';

import {
PRESERVED_INTERVENTION_SOURCES
} from '../encode-option-interventions.js';

import {
classifyValueSource,
obligationFor
} from '../../../cee/graph-readiness/obligation-provenance.js';





/** The witnessed arm: every option unconfigured, so every effect value is open. */




/**
 * An option/factor cell the PRODUCER itself raises as an answerable blocker
 * whose factor it knows — derived, never transcribed. Throws rather than
 * returning a fallback, so a capture that stopped raising blockers fails loudly
 * instead of turning every guard below into a pass-by-absence.
 */


/**
 * Write one intervention through the real edit chain and read back what the
 * encoder committed. `value` is the raw op payload, so a guard can post any
 * shape a model or a user could actually produce.
 */




describe('encode-option-interventions — the stamp changes the OBLIGATION, not just the string', () => {
  /**
   * ⭐⭐ THE BEHAVIOUR THE STRING EXISTS FOR — asserted, not just the string.
   *
   * Every other guard above asserts the literal `'cee_hypothesis'`. None
   * asserts what it BUYS, so a tidy-up that collapsed the allowlist would keep
   * them all green while restoring the demand.
   *
   * The live chain is `analysis-ready-helper` → `classifyIssueObligation` →
   * `structureProvenanceOfEffect` → `classifyValueSource(entry.source)`. So this
   * change alters obligation classification on the shared edit path: before,
   * EVERY encoder-written value was `user_specified` → `user_stated` →
   * `required`; now a model-authored one is `ai_drafted` → `offered`.
   *
   * That is the entire point of the mark — the product may OFFER to fill a
   * number it invented and may never DEMAND that the user own it — and it is
   * pinned with a DISCRIMINATING CONTROL rather than alone: the same issue, the
   * same graph, the same call, differing only in who wrote the value.
   *
   * ⚠ The AI arm is driven through the ENCODER chain. PR #1337 drove it through
   * a handler that has no caller; the claim is the encoder's either way, and
   * pinning it here keeps it independent of whether that handler ever ships.
   */


  /**
   * ⭐ THE ALLOWLIST'S INVARIANT, DERIVED FROM THE AUTHORITY RATHER THAN RESTATED.
   *
   * `PRESERVED_INTERVENTION_SOURCES` may only ever hold provenances the estate
   * classes as NOT the user's. An earlier revision of this change also
   * allowlisted `brief_extraction` under a comment calling it one of "the two
   * NON-user provenances" — but `obligation-provenance.ts` maps it to
   * `user_stated`, the SAME class as `user_specified`, and
   * `obligationFor('user_stated')` is `required`.
   *
   * This reads the mapping out of the authority at test time, so it goes RED if
   * anyone re-adds a user provenance to the carry — including by a rename.
   */
  it('⭐ every preserved source is a NON-user provenance, checked against the authority', () => {
    expect(PRESERVED_INTERVENTION_SOURCES.size).toBeGreaterThan(0);
    for (const source of PRESERVED_INTERVENTION_SOURCES) {
      expect(classifyValueSource(source), `${source} must not be a user provenance`)
        .not.toBe('user_stated');
    }
    // CONTRAST CONTROL: the authority really does discriminate, so a green
    // result above is a fact about the allowlist and not about a probe that
    // returns the same answer for every input.
    expect(classifyValueSource('user_specified')).toBe('user_stated');
    expect(classifyValueSource('brief_extraction')).toBe('user_stated');
    expect(classifyValueSource('cee_hypothesis')).toBe('ai_drafted');
    // And the consequence, stated where it bites.
    expect(obligationFor('user_stated')).toBe('required');
    expect(obligationFor('ai_drafted')).toBe('offered');
  });
});
