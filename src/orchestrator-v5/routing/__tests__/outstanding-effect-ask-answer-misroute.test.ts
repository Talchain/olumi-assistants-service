/**
 * ⭐⭐ AN ANSWER TO THE PRODUCT'S OWN EFFECT-VALUE ASK MUST NOT BE WRITTEN TO
 * THE FACTOR'S OWN VALUE AND ACKNOWLEDGED AS A SUCCESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, wire-witnessed on deployed CEE `d0544243` (this repo's `staging`
 * tip at the time), fresh guest, scenario `c0a3484d`. Every byte in
 * `fixtures/witness-2026-08-31/false-success-factor-write.json` is captured
 * from `POST /orchestrate/v2/turn`, never authored here (trap 16).
 *
 *   ASK      'Factor "Operational Control Level" needs a numeric value for
 *             option "Hybrid model: subcontract overflow volumes only, retain
 *             core driver team"'                       (blocker 9cb78c6e × 06fd579a)
 *   REQUEST  "Set it to a third."
 *   APPLIED  a FACTOR-baseline write: graph_patch `set_factor_value` on
 *            `06fd579a`, `{value: 0.33, raw_value: 33}` — the factor's OWN level.
 *   REPLY    "Updated Operational Control Level to 33%."   ← A SUCCESS SENTENCE
 *   COMMIT   graph_hash accaeb7c6fd9d0e0 → 18a2a97fede15253 ← A NEW HASH
 *   NOT DONE option 9cb78c6e's `interventions` were byte-identical before and
 *            after (`17d737cf,55d1a102,6ff320a0,c03e00a6`), and the asked
 *            factor `06fd579a` is ABSENT from them throughout.
 *   LOOP     the blocker survived BY IDENTITY and the re-ask then embedded the
 *            user's own answer as the factor's established level:
 *            'Factor "Operational Control Level" is currently 33%. What should
 *             option "…" set it to?'
 *
 * So: wrong-entity write + false success acknowledgement + a re-ask carrying the
 * user's own number back at them. That is the loop.
 *
 * ⭐ WHY THE EXISTING GUARD DID NOT FIRE — the identity evidence was PRESENT and
 * was DISCARDED. `findOutstandingEffectAskCollision` is on this path
 * (`turn-executor.ts:9219`), it derived the pair `9cb78c6e × 06fd579a` from the
 * canonical readiness, and the proposal's `entityId` WAS `06fd579a`. It returned
 * `null` anyway, because the factor arm's typed-turn conjunct required
 * `isUnanchoredEffectFraming` — i.e. the classifier's evidence that the USER'S
 * SENTENCE was effect-framed. An answer to the product's own question carries no
 * effect framing. The framing is in the ASK, not in the ANSWER.
 *
 * ⚠ AND THE BINDER HAD ALREADY DECLINED TO MAP THE WORD TO A NUMBER.
 * `readMissingValueAnswer("Set it to a third.")` returns `{kind: 'qualitative'}`
 * — a reading whose own contract says the term is *"NEVER mapped to a number"*
 * (`missing-value-answer.ts`), and which is a pinned member of
 * `MISSING_VALUE_ANSWER_KNOWN_DROPPED` for the stated reason that parsing it
 * means inventing precision the user did not give. The route-v2 answered-ask
 * pre-route gates on `kind === 'numeric'` (`route-v2.ts:5661`), so a qualitative
 * reading falls through to the LLM router — which mapped it to 33% anyway.
 * **The estate's ONE owner of "how do we read this answer" said do not choose a
 * number; a downstream path chose one and wrote it to the wrong entity.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OPPOSITE-DIRECTION TWIN IS MANDATORY AND IS TESTED HERE.
 * A user who NAMES the factor is making a deliberate, anchored request to move
 * that factor's own baseline, and it must still land, still commit, and still be
 * acknowledged. That is what the `namesTheFactor` conjunct protects, and it is
 * the reason this fix is a widening of ONE conjunct rather than a ban on
 * `set_factor_value` while anything is outstanding.
 */
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

import {
MISSING_VALUE_ANSWER_KNOWN_DROPPED,
readMissingValueAnswer
} from '../missing-value-answer.js';

/** The CAPTURED wire evidence — a real deployed turn, never authored here. */
const WIRE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-31/false-success-factor-write.json', import.meta.url),
    'utf8',
  ),
) as {
  user_message: string;
  asked_option_id: string;
  asked_factor_id: string;
  option_labels: string[];
  readiness_before: { blockers: unknown[] };
  observed: {
    assistant_text: string;
    graph_hash_before: string;
    graph_hash_after: string;
    graph_patch_blocks: Array<Record<string, unknown>>;
    asked_option_interventions_before: Record<string, unknown>;
    asked_option_interventions_after: Record<string, unknown>;
  };
};

const WITNESSED_MESSAGE = WIRE.user_message;

const ASKED_FACTOR = WIRE.asked_factor_id;
const FACTOR_LABEL = 'Operational Control Level';







// ═══════════════════════════════════════════════════════════════════════════
// The captured bytes, asserted here so this spec's premise cannot go stale
// silently and so a reader can see the harm without opening the fixture.
// ═══════════════════════════════════════════════════════════════════════════
describe('the witnessed wire evidence', () => {
  it('the product emitted a SUCCESS SENTENCE for the write', () => {
    expect(WIRE.observed.assistant_text).toContain('Updated Operational Control Level to 33%.');
  });

  it('the product COMMITTED A NEW GRAPH HASH', () => {
    expect(WIRE.observed.graph_hash_after).not.toBe(WIRE.observed.graph_hash_before);
    expect(WIRE.observed.graph_hash_after).toBe('18a2a97fede15253');
  });

  it('the write landed on the FACTOR, not on the option effect', () => {
    expect(WIRE.observed.graph_patch_blocks).toHaveLength(1);
    expect(WIRE.observed.graph_patch_blocks[0]).toMatchObject({
      operation: 'set_factor_value',
      status: 'applied',
      target_id: ASKED_FACTOR,
    });
  });

  it('⭐ the asked slot was NEVER WRITTEN — and this probe can SEE a written intervention', () => {
    const before = WIRE.observed.asked_option_interventions_before;
    const after = WIRE.observed.asked_option_interventions_after;
    // POSITIVE CONTROL for the absence claim (trap 13): the same probe, on the
    // same field, reads FOUR interventions that ARE present. An absence read by
    // a probe that can only ever read absence proves nothing.
    expect(Object.keys(before).sort()).toEqual(['17d737cf', '55d1a102', '6ff320a0', 'c03e00a6']);
    expect(Object.keys(after).sort()).toEqual(['17d737cf', '55d1a102', '6ff320a0', 'c03e00a6']);
    // THE ABSENCE ITSELF, bound by identity to the asked factor id.
    expect(before[ASKED_FACTOR]).toBeUndefined();
    expect(after[ASKED_FACTOR]).toBeUndefined();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('the binder had already declined to map the word to a number', () => {
    const reading = readMissingValueAnswer(WITNESSED_MESSAGE);
    expect(reading).not.toBeNull();
    expect(reading?.kind).toBe('qualitative');
    // Not a numeric reading ⇒ route-v2's answered-ask pre-route (`kind ===
    // 'numeric'`) cannot claim the turn, which is HOW it reached turn_executor.
    expect(MISSING_VALUE_ANSWER_KNOWN_DROPPED).toContain(WITNESSED_MESSAGE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CASE 1 — THE DEFECT. Must REFUSE.
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// CASE 1b — THE FACTOR-NAME ECHO. Review finding on #1292.
//
// `!namesTheFactor` failed in the DANGEROUS direction, and the product itself
// prompts the phrasing that defeats it: its blocker copy reads
//   `Factor "Operational Control Level" needs a numeric value for option "…"`
// so a user who echoes back the words ON THEIR SCREEN escaped the guard. These
// are the witnessed harm verbatim with the factor name added.
// ═══════════════════════════════════════════════════════════════════════════
describe('CASE 1b — echoing the factor name back does not license the write', () => {
  const ECHOED = [
    `Set ${FACTOR_LABEL} to a third.`,
    `Set ${FACTOR_LABEL} to half.`,
    `Set ${FACTOR_LABEL} to high.`,
    `no change to ${FACTOR_LABEL}`,
  ];



  it('⭐ the discriminator is the BINDER\'S OWN VERDICT, not a new reading of the text', () => {
    // Each of the four is read as an answer the binder refuses to turn into a
    // number. That is why writing one to the factor is a handler overruling an
    // authority that already answered.
    for (const message of ECHOED) {
      expect(readMissingValueAnswer(message)?.kind, message).toBe('qualitative');
    }
  });

  it('⭐⭐ THE POSITIVE SPELLING IS LOAD-BEARING — every legitimate twin reads `null`', () => {
    // `!== 'numeric'` would claim ALL of these and turn the guard into the
    // blanket ban on `set_factor_value` this module has always refused.
    for (const message of [
      `Set ${FACTOR_LABEL} to 40%.`,
      `Set ${FACTOR_LABEL} to 0.4`,
      'Change its baseline to 0.4.',
      'Set Driver Retention Rate to 40%.',
      'What should I put here?',
      'Run the analysis.',
    ]) {
      expect(readMissingValueAnswer(message), message).toBeNull();
    }
  });

  it('⭐ a `no_change` reading can never name the factor — derived, not assumed', () => {
    // `readNoChange` is WHOLE-MESSAGE-ONLY: an exact match against
    // MISSING_VALUE_NO_CHANGE_PHRASES after stripping one of four fixed openers,
    // none of which can contain a factor label. So the unanchored arm already
    // covers every reachable `no_change`, and the factor-name form is not read
    // as `no_change` at all.
    expect(readMissingValueAnswer('no change')?.kind).toBe('no_change');
    expect(readMissingValueAnswer(`no change to ${FACTOR_LABEL}`)?.kind).toBe('qualitative');
  });








});

// ═══════════════════════════════════════════════════════════════════════════
// CASE 2 — THE OPPOSITE-DIRECTION TWIN. Must still WRITE.
// Fails on a DIFFERENT assertion from CASE 1 (`toBeNull` vs identity equality).
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// CASE 2b — THE FACTOR-NAME CHECK IS BOUND TO THE **ASKED** PAIR, NOT TO EVERY
// OUTSTANDING PAIR. Two blockers on two different factors; the write targets
// the asked one while the sentence names the OTHER. Reading "did the user name
// a factor?" across all outstanding pairs would let this through.
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// CASE 3 — REGRESSION GUARDS. The arms that already worked must be unchanged.
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// THE HONEST GAP — pinned as data so the suite REDs if the set GROWS or SHRINKS
// (trap 22f's protocol, already used by this estate's sibling sets).
// ═══════════════════════════════════════════════════════════════════════════
