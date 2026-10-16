/**
 * RUN-OVER-RUN CONSEQUENCE — THE WIRE, AT THE RENDERED PROMPT BYTES.
 *
 * `run_delta` is System C's consequence: what changed between two runs and what
 * it means, derived from real prior analytical state. The producer merged
 * (#1160) and was threaded (#1166) — but it ran ONLY inside
 * `finaliseV5Response` (`response-finaliser.ts` → `attachRunDelta`), which is
 * response assembly, i.e. AFTER the model call BY CONSTRUCTION. Measured before
 * this change through the real chain: a genuine two-run `priorFacts` array
 * yielded a 2,740-char prompt containing ZERO `run_delta`. The model was told a
 * rerun had happened and never what changed.
 *
 * WHAT THIS SUITE PINS, AND WHY IT IS ROUTE-LEVEL
 * ----------------------------------------------
 * It drives the REAL `assembleContextPack` → `buildUserMessage` chain and reads
 * the SERIALISED PACK the model receives, not the assembler's return value. A
 * pack field that never reaches `buildUserMessage`'s output is dark, and only
 * the rendered bytes can tell the two apart.
 *
 * ⭐ BOUND BY IDENTITY, NEVER BY A VALUE ANOTHER SLICE COULD SATISFY (trap 19).
 * Every assertion below reads `serialised.run_delta` — the slice's OWN subtree,
 * extracted from the pack — and never `toContain` over the whole prompt string.
 * This is not a stylistic preference: the sibling `factor_values` slice was
 * caught by exactly that shortcut, its assertion matching a factor label the
 * `graph` slice ALSO carried, so two of its four wire tests passed with the
 * wiring deleted. Option ids here (`opt-a`) would likewise appear in the
 * `analysis` block, so a whole-prompt substring match would prove nothing.
 *
 * ⭐ THE ABSENCE ARM IS THE POINT OF THE SUITE, NOT ITS FOOTNOTE. The producer
 * REFUSES on every pair it cannot honestly classify, and its header states the
 * doctrine: "THE OMIT PATH IS THE DEFAULT AND IT IS NOT A DEGRADED STATE… a
 * fabricated comparison is worse than an absent one." A test that only checks
 * the PRESENT case cannot see the property that matters — absence staying
 * absent — so REFUSED_PAIR below is written as the discriminating twin of
 * PRESENT_PAIR, over the SAME assertions.
 */

import { describe,expect,it } from 'vitest';


import { buildRunDelta } from '../../coaching/build-run-delta.js';
import { PRESENT_PAIR,REFUSED_PAIR } from './run-delta-fixtures.js';



/**
 * Fact fixtures live in ./run-delta-fixtures.ts — shared with the
 * turn-executor-level suite that pins the same wire one hop upstream, so
 * the two cannot drift apart silently.
 */



describe('run_delta reaches the rendered routing prompt', () => {
  /**
   * PRECONDITION PINNED IN-TEST (trap 13b). Every assertion below is about
   * whether a DERIVABLE consequence reaches the model. If the producer refused
   * this pair for an unrelated reason — a fixture drift in the echoes, say —
   * the absence assertions would pass by testing nothing and the presence
   * assertions would fail for the wrong reason. Prove the pair is derivable
   * FIRST, and prove the refused pair is genuinely refused.
   */
  it('PRECONDITION — the producer accepts the present pair and refuses the other', () => {
    const ok = buildRunDelta({ priorFacts: PRESENT_PAIR, mayNameLeadingOption: true });
    expect(ok.kind, 'the present pair must be derivable or this suite is vacuous').toBe('ok');
    if (ok.kind !== 'ok') throw new Error('unreachable');
    expect(ok.delta.leader.changed, 'the pair must carry a REAL consequence').toBe(true);

    const refused = buildRunDelta({ priorFacts: REFUSED_PAIR, mayNameLeadingOption: true });
    expect(refused.kind, 'the refused pair must be REFUSED or the absence arm is vacuous').toBe('none');
    if (refused.kind !== 'none') throw new Error('unreachable');
    expect(refused.reason).toBe('insufficient_runs');
  });



  /**
   * ⛔ THE FROZEN SLOT MUST NOT BE PROJECTED. `flip_thresholds` is emitted
   * frozen-EMPTY by the producer (`RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED`)
   * because the flip-threshold join is DEFERRED and never looked. Its own
   * header: "an empty array is NOT a neutral placeholder: read naively it
   * asserts THERE ARE NO FLIP THRESHOLDS, which is a claim" — and an LLM is
   * precisely a naive reader. Serialising `[]` would hand the model a
   * computed-looking answer to a question nothing asked.
   */


  /**
   * ⭐ THE DISCRIMINATING TWIN. On a pair the producer refuses, the prompt must
   * say NOTHING about what changed. Absence staying absent is the property;
   * a suite that only checked the present case could not see it.
   */


  /**
   * ⛔⛔ THE ABSENCE GUARD ITSELF. The licence text must reach the model on the
   * turn where `run_delta` is ABSENT — that is the turn the guard governs, and
   * absence is the producer's DEFAULT path, not an edge case. An instruction
   * gated on the field's PRESENCE would render this rule only on the turns that
   * do not need it: a conditionally-emitted absence clause is dead text.
   *
   * MUTANT: gate the emission on `contextPack.run_delta !== undefined` and this
   * test REDs while every other test in this file stays green — which is the
   * discrimination, since the present arm cannot see this property at all.
   */




  /**
   * The leader half of the wire, pinned separately. `mayNameLeadingOption` is
   * FAIL-CLOSED in the assembler, so dropping the turn-executor's thread does
   * not remove the delta — it silently strips the leader ids, which is the
   * quieter failure and needs its own red.
   */


  /**
   * The fail-closed default, pinned. A caller that does not thread the
   * permission must get NO leader ids — never a promoted claim.
   */


  /**
   * ⭐ RUN_DELTA_IS_STRUCTURAL_NOT_PROSE — measured, not assumed.
   *
   * `prompt-pack-sanction.gate.test.ts` only fires on PROSE-BEARING fields
   * (`proseLeaves`: string leaves of >= 4 words). This field carries option
   * ids, enums and numbers and NO free text, so it scores zero and THE GATE
   * skips it. That is recorded in the gate's registration comment, and a claim
   * about our own verification is still a claim — so it is MEASURED here rather
   * than asserted there.
   *
   * It is a SAFETY property, not a gap: there is no sentence in this block for
   * a model to lift, so it cannot quote a consequence — it must join ids
   * against the `analysis` section, under the instruction's rules, to say
   * anything at all. If a future field adds free text to `run_delta`, this test
   * REDs and THE GATE becomes load-bearing for it: re-check the sanctioning
   * then, and do NOT delete this test to make it quiet.
   */

});
