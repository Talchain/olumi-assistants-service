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
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED,
  findOutstandingEffectAskCollision,
} from '../outstanding-effect-ask-misroute.js';
import {
  MISSING_VALUE_ANSWER_KNOWN_DROPPED,
  readMissingValueAnswer,
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
const ASKED_OPTION = WIRE.asked_option_id;
const ASKED_FACTOR = WIRE.asked_factor_id;
const FACTOR_LABEL = 'Operational Control Level';
const OPTION_LABELS = WIRE.option_labels;
const readiness = WIRE.readiness_before;

const ASKED_PAIR = `${ASKED_OPTION}::${ASKED_FACTOR}`;

function collide(message: string, entityId: string = ASKED_FACTOR, chipOriginated = false) {
  return findOutstandingEffectAskCollision({
    handlerId: 'set_factor_value',
    entityId,
    message,
    optionLabels: OPTION_LABELS,
    readiness,
    chipOriginated,
  });
}

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
describe('CASE 1 — an unanchored answer to the outstanding ask', () => {
  it('⭐ THE WITNESSED DEFECT: "Set it to a third." on the asked factor is REFUSED', () => {
    const hit = collide(WITNESSED_MESSAGE);
    expect(hit).not.toBeNull();
    expect(hit?.refusedField).toBe('factor_value');
    // Bound by IDENTITY to the pair the blocker named — never to "a pair".
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
  });

  it('⭐ NO VALUE IS PUT IN THE USER\'S MOUTH — the 33% the product invented is not carried', () => {
    // `readOptionEffectValue` is anchored on `to <number>`; "a third" is not a
    // number, so the correction chip cannot replay an invented figure. This is
    // the assertion that stops the fix re-committing the original harm.
    expect(collide(WITNESSED_MESSAGE)?.userValue).toBeNull();
  });

  it('the other pinned known-dropped answers are the SAME class and are refused', () => {
    for (const message of ['Set it to 0.12 for the subcontracting option.', 'It went up a lot,set it to 0.12.']) {
      expect(collide(message)?.pairs.map((p) => `${p.optionId}::${p.factorId}`), message).toEqual([ASKED_PAIR]);
    }
  });

  it('a qualitative answer the binder refuses to interpret is refused here too', () => {
    for (const message of ['Set it to half.', 'Set it to high.']) {
      expect(collide(message)?.refusedField, message).toBe('factor_value');
    }
  });

  it('⭐ "no change" is refused — a consumer must never substitute a number for it', () => {
    // The `no_change` reading's own contract: substituting ANY number, "and that
    // includes the factor's own baseline", destroys the variance. Writing 0 to
    // the factor here would be exactly that harm.
    expect(readMissingValueAnswer('no change')?.kind).toBe('no_change');
    expect(collide('no change')?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CASE 2 — THE OPPOSITE-DIRECTION TWIN. Must still WRITE.
// Fails on a DIFFERENT assertion from CASE 1 (`toBeNull` vs identity equality).
// ═══════════════════════════════════════════════════════════════════════════
describe('CASE 2 — the legitimate factor-baseline edit still writes', () => {
  it('⭐⭐ NAMING THE FACTOR is a deliberate baseline request and is NOT claimed', () => {
    expect(collide(`Set ${FACTOR_LABEL} to 40%.`)).toBeNull();
  });

  it('naming the factor with an explicit model-unit value is not claimed', () => {
    expect(collide(`Set ${FACTOR_LABEL} to 0.4`)).toBeNull();
  });

  it('`baseline` framing is never claimed, named factor or not', () => {
    expect(collide(`Change the ${FACTOR_LABEL} baseline to 0.4.`)).toBeNull();
  });

  it('⭐ a set_factor_value on a factor with NO outstanding ask still writes', () => {
    // Identity binding: the collision is keyed on the ASKED factor id. A write
    // to any other node is untouched however the sentence is phrased.
    expect(collide(WITNESSED_MESSAGE, 'not-the-asked-factor')).toBeNull();
  });

  it('a question or a command is not an answer and is never claimed', () => {
    expect(collide('What should I put here?')).toBeNull();
    expect(collide('Run the analysis.')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CASE 3 — REGRESSION GUARDS. The arms that already worked must be unchanged.
// ═══════════════════════════════════════════════════════════════════════════
describe('CASE 3 — the arms that already worked are unchanged', () => {
  it('the effect-framed unanchored arm still refuses', () => {
    const hit = collide(`Set its effect on ${FACTOR_LABEL} to 0.33`);
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
    expect(hit?.userValue).toBe(0.33);
  });

  it('the chip-originated identity arm still refuses on content-free copy', () => {
    const hit = collide('Set that value in my model.', ASKED_FACTOR, true);
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
  });

  it('the edge arm is untouched by this change', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${ASKED_OPTION}→${ASKED_FACTOR}`,
      message: WITNESSED_MESSAGE,
      optionLabels: OPTION_LABELS,
      readiness,
      chipOriginated: false,
    });
    expect(hit?.refusedField).toBe('edge_strength');
  });

  it('an empty readiness yields no collision however the message reads', () => {
    expect(
      findOutstandingEffectAskCollision({
        handlerId: 'set_factor_value',
        entityId: ASKED_FACTOR,
        message: WITNESSED_MESSAGE,
        optionLabels: OPTION_LABELS,
        readiness: { blockers: [] },
        chipOriginated: false,
      }),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE HONEST GAP — pinned as data so the suite REDs if the set GROWS or SHRINKS
// (trap 22f's protocol, already used by this estate's sibling sets).
// ═══════════════════════════════════════════════════════════════════════════
describe('the residual gap is pinned, not invisible', () => {
  it('⭐ every pinned member is STILL NOT CLAIMED — the set is exact in both directions', () => {
    for (const message of OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED) {
      expect(collide(message), `pinned as dropped, but now claimed: ${message}`).toBeNull();
    }
  });

  it('⭐ the set is NOT EMPTY and each member is genuinely answer-shaped', () => {
    // A pinned-gap set that silently emptied would make the assertion above
    // vacuous — the trap-13 shape one level up.
    expect(OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED.length).toBeGreaterThan(0);
    for (const message of OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED) {
      // Each is a value-word answer the shared answer-reader does not recognise.
      // That is WHY it is dropped, and pinning the reason keeps the gap honest.
      expect(readMissingValueAnswer(message), message).toBeNull();
    }
  });
});
