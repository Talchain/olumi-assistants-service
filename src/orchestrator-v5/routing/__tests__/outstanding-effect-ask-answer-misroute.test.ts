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
  messageAnswersMissingValueAsk,
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

  it('⭐⭐ all four are REFUSED, bound by identity to the asked pair', () => {
    for (const message of ECHOED) {
      expect(
        collide(message)?.pairs.map((p) => `${p.optionId}::${p.factorId}`),
        message,
      ).toEqual([ASKED_PAIR]);
    }
  });

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

  it('⭐⭐ `baseline` VOCABULARY DOES NOT LICENSE A NUMBER THE BINDER REFUSED TO READ', () => {
    // REVIEW BLOCKER, #1292 r2. With the binder-refusal arm BELOW the
    // `BASELINE_FRAMING` suppressor, every qualitative reading carrying baseline
    // vocabulary escaped — which is exactly what that arm's header claimed
    // could not happen. The arm is now hoisted above the suppressor.
    for (const message of [
      'Change its baseline to a third.',
      'Set the baseline to half.',
      'Set its baseline to high.',
      `Change the ${FACTOR_LABEL} baseline to a third.`,
    ]) {
      expect(readMissingValueAnswer(message)?.kind, message).toBe('qualitative');
      expect(
        collide(message)?.pairs.map((p) => `${p.optionId}::${p.factorId}`),
        message,
      ).toEqual([ASKED_PAIR]);
    }
  });

  it('⚠ THE HOIST\'S ASYMMETRY, DECLARED RATHER THAN DENIED — word-zero baselines ARE refused', () => {
    // ⚠⚠ REVIEW FINDING, #1292 r4. The claim next door reads *"THE HOIST CANNOT
    // COST A LEGITIMATE TWIN"*, and it is true only as scoped to BINDABLE
    // requests — ones carrying a digit. A baseline request whose value is a
    // WORD ZERO carries no digit, so it reads `qualitative` and the hoisted arm
    // claims it. Measured, not reasoned:
    //
    //     "Change its baseline to zero."     → qualitative ⇒ REFUSED
    //     "Change its baseline to nothing."  → qualitative ⇒ REFUSED
    //     "Change its baseline to none."     → qualitative ⇒ REFUSED
    //     "Change its baseline to 0."        → null        ⇒ WRITES
    //
    // The direction is fail-safe (a refusal costs one clarify turn on a graph
    // that is already blocked, which is this module's declared and unchanged
    // asymmetry) and the words are genuinely ambiguous against a factor whose
    // scale nobody has stated. But an unstated asymmetry is how "cannot" gets
    // inherited as a guarantee, so it is pinned here rather than argued away.
    for (const message of [
      'Change its baseline to zero.',
      'Change its baseline to nothing.',
      'Change its baseline to none.',
      'Set the baseline to zero.',
    ]) {
      expect(readMissingValueAnswer(message)?.kind, message).toBe('qualitative');
      expect(
        collide(message)?.pairs.map((p) => `${p.optionId}::${p.factorId}`),
        message,
      ).toEqual([ASKED_PAIR]);
    }
    // CONTRAST CONTROL in the same run: the DIGIT form of the same sentence
    // still writes, so this block is not merely observing a blanket refusal.
    expect(collide('Change its baseline to 0.')).toBeNull();
  });

  it('⭐⭐ THE HOIST CANNOT COST A **BINDABLE** TWIN — no digit-carrying baseline reads `qualitative`', () => {
    // This is the derivation the hoist rests on, asserted rather than assumed:
    // `qualitative` is returned when there is NO DIGIT in the value slot, so a
    // baseline request carrying the number it wants written can never read it.
    // ⚠ SCOPE, because the unscoped version of this sentence was a review
    // finding: it is a claim about BINDABLE requests only — see the word-zero
    // asymmetry pinned directly above.
    // If this ever REDs, the hoist has become unsafe and must be re-derived.
    for (const message of [
      'Change its baseline to 0.4.',
      `Change the ${FACTOR_LABEL} baseline to 0.4.`,
      'Set the baseline to 40%.',
      `Set the ${FACTOR_LABEL} baseline to 0.25`,
      'Set its baseline to 0.7',
      'baselines: set it to 0.5',
    ]) {
      expect(readMissingValueAnswer(message)?.kind, message).not.toBe('qualitative');
      expect(collide(message), message).toBeNull();
    }
  });

  it('⚠ ONE MEASURED CONSEQUENCE BEYOND THE FOUR, pinned rather than discovered later', () => {
    // Genuinely ambiguous: it asserts the factor's current level AND asks for an
    // assignment, and the binder itself declined to extract a figure. Refusing
    // costs one clarify turn on an already-blocked graph — this module's
    // declared and unchanged asymmetry.
    const message = `Actually, ${FACTOR_LABEL} is currently about 40%, set it to that.`;
    expect(readMissingValueAnswer(message)?.kind).toBe('qualitative');
    expect(collide(message)?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
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

  it('⭐⭐ an UNANCHORED `baseline` request still writes — found by a surviving mutant', () => {
    // COVERAGE GAP FOUND BY EXECUTION, not by reading (trap 13c: a survivor is a
    // claim either way and must be settled with a discriminating fixture).
    // Removing the `BASELINE_FRAMING` early return left the whole battery GREEN,
    // because every baseline case here NAMED the factor and the new
    // `!namesTheFactor` conjunct declines those on its own. The one input where
    // `BASELINE_FRAMING` is genuinely load-bearing is a baseline request that
    // does NOT name the factor: `messageAnswersMissingValueAsk` reads it as an
    // answer, nothing anchors it, and without the suppressor the guard would
    // refuse a request whose own wording says the user means the factor's value.
    expect(collide('Change its baseline to 0.4.')).toBeNull();
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
// CASE 2b — THE FACTOR-NAME CHECK IS BOUND TO THE **ASKED** PAIR, NOT TO EVERY
// OUTSTANDING PAIR. Two blockers on two different factors; the write targets
// the asked one while the sentence names the OTHER. Reading "did the user name
// a factor?" across all outstanding pairs would let this through.
// ═══════════════════════════════════════════════════════════════════════════
describe('CASE 2b — naming a DIFFERENT outstanding factor does not license the asked one', () => {
  const OTHER_FACTOR = 'aa11bb22';
  const OTHER_LABEL = 'Driver Retention Rate';
  const twoBlockers = {
    blockers: [
      ...(readiness.blockers as unknown[]),
      {
        option_id: ASKED_OPTION,
        option_label: OPTION_LABELS[2],
        factor_id: OTHER_FACTOR,
        factor_label: OTHER_LABEL,
        blocker_type: 'missing_value',
        code: 'MISSING_OPTION_VALUE',
      },
    ],
  };

  it('⭐ the write targets the ASKED factor while the sentence names ANOTHER — refused', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: ASKED_FACTOR,
      message: `Set ${OTHER_LABEL} to 40%.`,
      optionLabels: OPTION_LABELS,
      readiness: twoBlockers,
      chipOriginated: false,
    });
    // Bound by IDENTITY: only the pair whose factor IS the write target.
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
  });

  it('⭐ OPPOSITE DIRECTION — naming the factor the write actually targets still writes', () => {
    expect(
      findOutstandingEffectAskCollision({
        handlerId: 'set_factor_value',
        entityId: OTHER_FACTOR,
        message: `Set ${OTHER_LABEL} to 40%.`,
        optionLabels: OPTION_LABELS,
        readiness: twoBlockers,
        chipOriginated: false,
      }),
    ).toBeNull();
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
  /**
   * ⭐⭐ THE PIN ITSELF — A LITERAL, WRITTEN HERE INDEPENDENTLY OF THE SET.
   *
   * ⚠⚠ THIS ASSERTION REPLACES A VACUOUS ONE, AND THE MEASUREMENT IS RECORDED
   * BECAUSE THE DOCBLOCK'S CLAIM SURVIVED A ROUND OF REVIEW WHILE BEING FALSE.
   * The previous version was a per-member loop asserting each member is still
   * unclaimed, under a title reading *"the set is exact in both directions"* and
   * a module docblock reading *"REDs if the set GROWS **or** SHRINKS"*. A loop
   * OVER the set can only ever see members the set still contains, so it is
   * structurally incapable of observing a removal. Measured at `36d2213b`, in an
   * isolated worktree:
   *
   *     remove 1 member  ('Make it a third.')                 → GREEN (survived)
   *     remove 4 members ('two thirds' … 'half')              → GREEN (survived)
   *     add a claimed member ('Set it to a third.')           → RED   (bitten)
   *
   * One direction only. The sentence promising both was copied verbatim from
   * `CONTENTFUL_SUBJECT_KNOWN_DROPPED`, **whose own comment documents this exact
   * shape as vacuous and states that only a literal `toEqual([...])` makes the
   * sentence true** — so the remedy was already in the repo, one module over,
   * with its reasoning written out, and the copy took the claim without the fix.
   *
   * ⭐ WHY THE LITERAL AND NOT A DERIVATION. A filter OF the set compared AGAINST
   * the set is a projection of the set onto itself: both sides move together
   * (trap 12d — a derived guard proves agreement and can never prove
   * completeness). The literals below are the only thing that makes the docblock
   * true, and they are what a reader must consciously edit when the gap changes.
   */
  it('⭐⭐ THE PINNED SET IS EXACTLY THESE SIXTEEN — REDs if it GROWS **or** SHRINKS', () => {
    expect(
      [...OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED],
      'the pinned set grew or shrank — a known gap changed and needs re-review',
    ).toStrictEqual([
      'a third',
      'About a third.',
      'Make it a quarter.',
      'quite high',
      'two thirds',
      'three quarters',
      'a fifth',
      'half',
      'roughly a third',
      'About half.',
      'somewhere around a third',
      'a bit less than half',
      'Make it high.',
      'fairly low',
      'very low',
      'Make it a third.',
    ]);
  });

  it('⭐ every pinned member is STILL NOT CLAIMED — which member, not merely that one moved', () => {
    // This direction alone is NOT the pin (see the literal above) — it is kept
    // because it NAMES the member that started being claimed, which an equality
    // check on the whole array cannot.
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

  /**
   * ⭐⭐ THE CONTRAST CONTROL FOR THE WHOLE PINNED SET — WITHOUT IT, THE TWO
   * ASSERTIONS ABOVE ARE SATISFIED BY A GUARD THAT CLAIMS NOTHING AT ALL.
   *
   * Both tests above assert an ABSENCE (`collide(...)` is null, the reading is
   * null). An absence suite with no positive control cannot tell "these
   * specific answers escape" from "this guard is inert" — trap 13, and it is
   * the shape a pinned-gap set is most exposed to, because every one of its
   * assertions points the same way.
   *
   * So: the ASSIGNMENT-FRAMED form of the very same value-word must be
   * REFUSED. That is also the discriminator itself, made visible — what
   * separates a pinned member from the witnessed defect is the assignment
   * frame, not the value-word.
   */
  it('⭐⭐ CONTRAST CONTROL: the assignment-framed twin of a pinned value-word IS claimed', () => {
    // ⚠ THESE THREE VERBS ARE MEASURED, NOT ASSUMED. My first cut of this
    // control used `"Make it a third."` and the control ITSELF went red —
    // `Make it X` is NOT recognised as an assignment by the shared reader,
    // which is why its sibling `"Make it a quarter."` was already a pinned
    // member. A contrast control written from the author's head is the same
    // defect as a corpus written from it.
    // Bound by identity to the asked pair, not merely "some collision".
    for (const framed of ['Set it to a third.', 'Change it to a third.', 'Update it to a third.']) {
      const collision = collide(framed);
      expect(collision, `contrast control did not fire: ${framed}`).not.toBeNull();
      expect(collision?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([ASKED_PAIR]);
    }
    // And the bare value-word it is built from is pinned as dropped, so the two
    // readings genuinely differ in the SAME run (a blind probe cannot fake a
    // discrimination it is not making).
    expect(OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED).toContain('a third');
    expect(collide('a third')).toBeNull();
  });

  /**
   * ⚠ THE LABEL-BEARING POSITIONAL FORMS, pinned HERE rather than in the module
   * constant because they only exist relative to a factor label, and the label
   * belongs to the captured fixture rather than to the module.
   *
   * These matter more than the bare forms: the product's own blocker copy puts
   * the factor label in front of the user, so echoing it back is invited
   * phrasing — and these three still escape, because the shared reader does not
   * recognise a colon/positional frame as an assignment.
   */
  it('⭐ label-bearing positional answers are ALSO dropped, and pinned rather than invisible', () => {
    const POSITIONAL_KNOWN_DROPPED = [
      `${FACTOR_LABEL}: a third`,
      `For ${FACTOR_LABEL}, a third.`,
      `put ${FACTOR_LABEL} at a third`,
    ];
    for (const message of POSITIONAL_KNOWN_DROPPED) {
      expect(readMissingValueAnswer(message), message).toBeNull();
      expect(collide(message), `pinned as dropped, but now claimed: ${message}`).toBeNull();
    }
    // CONTRAST CONTROL in the same run: the assignment-framed form of the same
    // sentence, with the same label, IS claimed.
    expect(collide(`Set ${FACTOR_LABEL} to a third.`)).not.toBeNull();
  });

  /**
   * ⚠⚠ THE RELATIVE / COMPARATIVE REPLIES — PINNED HERE BECAUSE "REPORTED
   * ELSEWHERE" TURNED OUT NOT TO BE A PLACE.
   *
   * The module constant's docblock excluded `lower it` / `halve it` /
   * `double it` on the ground that *"They are reported on #1292, not silently
   * absorbed."* **That sentence was false when it was written.** Measured at
   * `36d2213b` over a COMPLETE, NAMED manifest — the PR body, 12 issue comments,
   * 0 review comments, 3 reviews, all fetched from the API: `lower it` 0,
   * `halve it` 0, `double it` 0. CONTRAST CONTROLS in the SAME sweep, so the
   * probe is not blind: `a third` 26 matches / 22 lines, `quite high` 1,
   * `baseline` 70. The gap class was therefore INVISIBLE — the exact condition
   * this module's own doctrine bans, produced by a pointer at a document nobody
   * had written.
   *
   * ⭐ WHY HERE AND NOT IN THE MODULE CONSTANT. The constant's stated contract is
   * *"every member is a VALUE-WORD answer"*, and these are not: they name a
   * DIRECTION with no quantity, and resolving them belongs to relative-delta
   * resolution, a different seam. Folding them into the constant would make its
   * own contract false. This is the same reason `POSITIONAL_KNOWN_DROPPED` above
   * is pinned in the spec rather than in the module.
   *
   * ⭐ THIS IS A SAMPLE, NOT A SURVEY, AND SAYING SO IS THE POINT. The module
   * docblock's own warning applies with full force here: *"a short honest-gap set
   * is worse than an obviously absent one — it reads as a surveyed boundary when
   * it is a sample."* Six escaping forms were MEASURED in one run (below).
   * Nobody has derived the reachability of the class, and nothing here claims to
   * have. What is pinned is exactly: these six specific messages escape today,
   * and the suite REDs the moment any of them starts being claimed — which is
   * the direction that matters, because a gap closing silently turns this
   * record into a lie.
   */
  it('⚠ RELATIVE/COMPARATIVE replies escape — pinned, with a contrast control in the same run', () => {
    const RELATIVE_COMPARATIVE_KNOWN_DROPPED = [
      'lower it',
      'halve it',
      'double it',
      'raise it',
      'increase it',
      'reduce it',
    ];
    for (const message of RELATIVE_COMPARATIVE_KNOWN_DROPPED) {
      // WHY each escapes, pinned alongside the fact: the shared answer-reader
      // does not recognise a direction-without-a-quantity as an answer at all,
      // so `isUnanchoredAnswerToOutstandingAsk` never sees it.
      expect(messageAnswersMissingValueAsk(message), message).toBe(false);
      expect(readMissingValueAnswer(message), message).toBeNull();
      expect(collide(message), `pinned as dropped, but now claimed: ${message}`).toBeNull();
    }
    // ⭐⭐ CONTRAST CONTROL, SAME RUN — without it this block is satisfied by a
    // guard that claims nothing at all (trap 13: every assertion above points
    // the same way). A blind probe cannot fake a discrimination it is not
    // making, so the assignment-framed forms must come back REFUSED.
    for (const framed of ['Set it to a third.', 'Set it to half.']) {
      expect(
        collide(framed)?.pairs.map((p) => `${p.optionId}::${p.factorId}`),
        `contrast control did not fire: ${framed}`,
      ).toEqual([ASKED_PAIR]);
    }
  });
});
