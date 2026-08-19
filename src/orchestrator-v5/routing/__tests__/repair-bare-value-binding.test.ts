/**
 * ⭐⭐ A BARE NUMBER BINDS TO THE SLOT THE PRODUCT ASKED ABOUT.
 *
 * THE WITNESSED DEFECT, deployed CEE `a7ee21e`, fresh guest, bound by identity,
 * `build_sha` in band on every turn. The product offered its repair chip; the
 * user clicked it and typed the plainest possible answer — **`0.6`** — and got
 * `exit_path: turn_executor`, `GAINED_PAIR []`, blockers **8 → 8**, graph hash
 * unchanged, and the reply *"I need to know what this value is for."*
 *
 * ⚠ THE TURN WAS NOT VACUOUS — `asv1Null: false`, and the eight blockers
 * enumerated — so this was a real refusal of a real answer, not a nulled store
 * being misread as failure.
 *
 * ⚠⚠ AND THE CHIP COULD NOT HAVE HELPED, WHICH IS WHY THE FIX IS NOT ON THE
 * CHIP. Read off the wire BEFORE any click, brace-matched:
 * `CHIP_OBJECT_KEYS: [["id","label","message"]]`. Settled at the contract bytes
 * (`@talchain/schemas` 0.48.0, `boundary/olumi-response.d.ts:2`): `ActionSchema`
 * is `"strict"` over `{id, label, message, action_type?, detail?}` — there is no
 * `target_refs` on a chip and one cannot be added without a schemas release, and
 * a strict schema would reject it if there were. `target_refs` exists in that
 * package, but on COACHING BLOCKS. So the chip carries identity in its PROSE
 * because that is the only place the wire lets it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE ANTECEDENT ACTUALLY COMES FROM — a READ, not a new record.
 *
 * The estate's own note pinned this gap with the reason *"nothing in CEE records
 * which slot the previous turn asked about (the ask turn is not even committed
 * to `v5_conversation_turns`)"* and named the enabling change as an
 * outstanding-ask RECORD, deferred as a persistence-seam change.
 *
 * **That premise conflated the ask TURN with the asked SLOT.** The turn is
 * indeed uncommitted and is also irrelevant. The SLOT is a fact about the
 * PERSISTED GRAPH — `deriveAskedEffectPair`, the head of the canonical blocker
 * list — and it is still there on the answering turn precisely BECAUSE the
 * answer has not been written yet. No persistence change was required, and the
 * one owner already existed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE TWO ARMS RESOLVE THEIR SLOT FROM DIFFERENT AUTHORITIES (trap 21 —
 * two questions, named apart, rather than one predicate serving both):
 *   · "Set it to 0.6."  has a referent whose antecedent is the CONVERSATION.
 *     With two or more pairs outstanding it is genuinely ambiguous, so the
 *     product ASKS. Unchanged by this lane, and pinned below as the twin.
 *   · "0.6"             has no referent at all. Its only possible antecedent is
 *     the question on screen, so it binds to `blockers[0]` however many other
 *     slots are outstanding.
 */

import { describe, expect, it } from 'vitest';
import { readMissingValueAnswer } from '../missing-value-answer.js';
import { matchBareRepairValue, resolveRepairValueBinding } from '../repair-value-binding.js';

const ASKED = {
  blocker_type: 'missing_value',
  option_id: 'opt-enterprise',
  option_label: 'Doubling down on enterprise sales',
  factor_id: 'fac-headcount',
  factor_label: 'Sales headcount',
};

const OTHER = {
  blocker_type: 'missing_value',
  option_id: 'opt-hybrid',
  option_label: 'Hybrid motion',
  factor_id: 'fac-burn',
  factor_label: 'Burn rate',
};

/** The witnessed shape: the asked pair at the head, more still outstanding. */
const MULTI = { blockers: [ASKED, OTHER] } as never;

describe('the bare-number answer binds to the asked pair', () => {
  it('RED-FIRST: a bare "0.6" binds — with MORE THAN ONE pair still outstanding', () => {
    // ⚠ THIS IS THE WITNESSED TURN. At pristine `a7ee21e` this resolves to
    // `{matched: false, reason: 'not_bare_value_shape'}` and the assertion fails
    // by name. The multi-blocker readiness is deliberate: the witnessed user had
    // EIGHT, and a single-pair fixture would have proved nothing about the case
    // that actually failed.
    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: MULTI });

    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'bind') {
      throw new Error(`expected a bind, got ${JSON.stringify(resolved)}`);
    }
    // ⭐ BOUND BY IDENTITY, never by a label or a value predicate another pair
    // could satisfy (trap 19).
    expect(resolved.pair.optionId).toBe('opt-enterprise');
    expect(resolved.pair.factorId).toBe('fac-headcount');
    // The user's own figure, carried verbatim into the product's advised format.
    expect(resolved.valueText).toBe('0.6');
    expect(resolved.instruction).toBe(
      "Set the Doubling down on enterprise sales option's effect on Sales headcount to 0.6.",
    );
  });

  it('⭐ THE DISCRIMINATING TWIN — it follows the HEAD blocker, not a fixed pair', () => {
    // Reorder the SAME two blockers and the bind must move with the head. Without
    // this, the case above would pass just as well against a resolver that always
    // returned the first pair it happened to construct — sensitivity to
    // *something* is not sensitivity to *the asked slot*.
    const reordered = { blockers: [OTHER, ASKED] } as never;
    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: reordered });

    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'bind') {
      throw new Error(`expected a bind, got ${JSON.stringify(resolved)}`);
    }
    expect(resolved.pair.optionId).toBe('opt-hybrid');
    expect(resolved.pair.factorId).toBe('fac-burn');
  });

  it('declines when the product is asking NO effect-value question', () => {
    // The head blocker is a mapping issue, so the recovery copy on screen is a
    // different sentence entirely and a bare number is answering something else.
    // Binding here would be answering a question nobody asked.
    const notAsking = {
      blockers: [{ blocker_type: 'missing_connection', option_id: 'o', factor_id: 'f' }],
    } as never;
    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: notAsking });

    expect(resolved).toEqual({ matched: false, reason: 'no_outstanding_ask' });
  });

  it('declines a figure outside the model 0-1 scale — and NEVER converts it', () => {
    // ⭐ P5. `80` is a user-scale number; the writer does not silently rescale.
    // Declining costs one turn, converting would write a figure never given.
    for (const message of ['80', '12', '5000']) {
      expect(resolveRepairValueBinding({ message, readiness: MULTI })).toEqual({
        matched: false,
        reason: 'bare_value_not_model_unit',
      });
    }
    // The scale's own endpoints remain bindable.
    for (const message of ['0', '1', '0.5', '.25']) {
      const resolved = resolveRepairValueBinding({ message, readiness: MULTI });
      expect(resolved.matched).toBe(true);
    }
  });

  it('the VERB-BEARING arm is untouched — it still ASKS when the referent is ambiguous', () => {
    // ⭐⭐ THE OPPOSITE-DIRECTION TWIN, and the guard against this lane quietly
    // changing a rule it did not come to change. "Set it to 0.6." carries a
    // referent, so with two pairs outstanding the estate's answer is still to
    // make the ambiguity the product (trap 22f) rather than to bind the head.
    const resolved = resolveRepairValueBinding({ message: 'Set it to 0.6.', readiness: MULTI });

    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'ask') {
      throw new Error(`expected an ask, got ${JSON.stringify(resolved)}`);
    }
    expect(resolved.pairs).toHaveLength(2);
  });

  it('the two arms are distinguishable AT THE READING, not only at the resolver', () => {
    // The distinction is recorded on the reading itself, so no call site can lose
    // it (trap 12: a second predicate in a second module is the copy that rots).
    const bare = readMissingValueAnswer('0.6');
    const verbed = readMissingValueAnswer('Set it to 0.6.');
    expect(bare).not.toBeNull();
    expect(verbed).not.toBeNull();
    expect(bare!.kind === 'numeric' && bare!.elliptical).toBe(true);
    expect(verbed!.kind === 'numeric' && verbed!.elliptical).toBe(false);
    // And the slot-from-the-sentence consumer refuses the elliptical one.
    expect(matchBareRepairValue('0.6')).toBeNull();
    expect(matchBareRepairValue('Set it to 0.6.')).not.toBeNull();
  });

  it('never throws, and claims nothing on hostile or empty input', () => {
    for (const message of ['', '   ', '.', '-', '0.6.0', 'zero point six']) {
      expect(() => resolveRepairValueBinding({ message, readiness: MULTI })).not.toThrow();
      const resolved = resolveRepairValueBinding({ message, readiness: MULTI });
      if (resolved.matched) throw new Error(`claimed ${JSON.stringify(message)}`);
    }
  });
});
