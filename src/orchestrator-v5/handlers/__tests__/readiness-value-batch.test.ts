/**
 * ⭐⭐ THE ESTIMATE BATCH — propose, approve once, apply atomically.
 *
 * WHAT THIS SUITE PINS, and why each guard exists rather than being tidy:
 *
 *   1. MEMBERSHIP IS DERIVED FROM THE BLOCKERS, never composed in prose. The
 *      witnessed turn proposed NINE values against TEN blockers and said so;
 *      an approved set short by one still does not unblock the analysis. The
 *      membership guard REFUSES that set and names the missing cell.
 *   2. ATOMICITY — one bad cell in the set writes NOTHING.
 *   3. PROVENANCE SURVIVES THE WRITE. An approved estimate must stay
 *      distinguishable from a user-stated figure for the life of the graph.
 *   4. A GAP WE CANNOT ESTIMATE IS CARRIED, NOT GUESSED and not dropped.
 *
 * ⚠ EVERY EXPECTATION IS DERIVED FROM THE PRODUCER, NEVER TRANSCRIBED. The
 * option ids, factor ids, blocker codes and cell counts are read out of
 * `assessCanonicalAnalysisReadiness` at test time. A self-authored fixture
 * encodes the author's model of the producer rather than the producer
 * (CLAUDE.md trap 16-inverse), and this module's entire job is to carry the
 * producer's own cell set faithfully.
 *
 * The graph is a REAL DATED CAPTURE (`witness-2026-08-17/j4-wrong-entity-write
 * .json`, deployed CEE `8be62df`, scenario J4), varied only by CLEARING option
 * interventions in memory. The capture file itself is never edited — it is a
 * historic record (trap 14b).
 */

import { describe,expect,it } from 'vitest';


import {
classifyValueSource,
obligationFor
} from '../../../cee/graph-readiness/obligation-provenance.js';
import {
PRESERVED_INTERVENTION_SOURCES
} from '../../../orchestrator/tools/encode-option-interventions.js';






/** The witnessed arm: every option unconfigured, so every effect value is open. */




/** A complete, valid estimate set derived from the producer's own membership. */














describe('readiness value batch — the mark survives persistence, and it changes the obligation', () => {
  /**
   * ⭐⭐ THE RELOAD HALF, WHICH THE FIRST REVISION OF THIS SUITE DID NOT PIN.
   *
   * `executeValueBatch` calls its mark "permanent — written into the graph, not
   * merely into the turn", and the guard above reads `outcome.appliedGraph` —
   * the IN-MEMORY return value. That is not the same claim. A mark is permanent
   * when it survives the write.
   *
   * ⚠ AND THERE IS A SECOND, UNRELATED STAMPER ON THAT PATH.
   * `normalise-option-interventions.ts` `freshInterventionV3` writes
   * `source: 'user_specified'` UNCONDITIONALLY and runs inside
   * `projectGraphForPersistence`. It is a no-op for this module's output only
   * because `encodeOptionInterventionsForEdit` deletes `data.interventions`
   * before it looks — an ORDERING, and nothing enforced it.
   *
   * If that ordering ever inverts, every AI estimate persists as
   * `user_specified`, which `obligation-provenance.ts` classes `user_stated`
   * and turns into `required`: the product would DEMAND the user answer for
   * numbers it invented, and attribute them to the user. Silently.
   *
   * This runs the real projection and goes RED the day that happens.
   */


  /**
   * ⭐⭐ THE BEHAVIOUR THE STRING EXISTS FOR — asserted, not just the string.
   *
   * Every other provenance guard in this suite asserts the literal
   * `'cee_hypothesis'`. None asserts what it BUYS, so a tidy-up that collapsed
   * the allowlist would keep them all green while restoring the demand.
   *
   * The live chain is `analysis-ready-helper` → `classifyIssueObligation` →
   * `structureProvenanceOfEffect` → `classifyValueSource(entry.source)`. So this
   * PR silently changes obligation classification on the shared edit path:
   * before, every encoder-written value was `user_specified` → `user_stated` →
   * `required`; now a batch-written one is `ai_drafted` → `offered`.
   *
   * That is the entire point of the mark — the product may OFFER to fill a
   * number it invented and may never DEMAND that the user own it — and it is
   * pinned here with a DISCRIMINATING CONTROL rather than alone: the same issue,
   * the same graph, the same call, differing only in who wrote the value.
   */


  /**
   * ⭐ THE ALLOWLIST'S INVARIANT, DERIVED FROM THE AUTHORITY RATHER THAN RESTATED.
   *
   * `PRESERVED_INTERVENTION_SOURCES` may only ever hold provenances the estate
   * classes as NOT the user's. An earlier revision of this PR also allowlisted
   * `brief_extraction` under a comment calling it one of "the two NON-user
   * provenances" — but `obligation-provenance.ts` maps it to `user_stated`,
   * the SAME class as `user_specified`, and `obligationFor('user_stated')` is
   * `required`.
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
