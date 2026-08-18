/**
 * ⭐⭐ ROADMAP 2.1266 / A3 — THE FACTOR-BASELINE CLARIFY MUST NOT ANSWER AN
 * OPTION-EFFECT QUESTION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WITNESSED, AND WHY THE TWO PREVIOUS FIXES COULD NOT SEE IT.
 *
 * Composed journey witness, 18 Aug 2026, **deployed CEE `4a513781` — #1034 AND
 * #1035 both merged and live** — fresh guest, 22:19–22:21Z
 * (`olumi-docs/feedback-2026-08-16/COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`,
 * LINK 4/5). Olumi asked, on screen, for the effect value of option `4abad64d`
 * on factor `3a75cabd`. Three ordinary-prose turns later the product had
 * written `nodes[3a75cabd].observed_state.value` `0.5 → 0.8` — the FACTOR'S OWN
 * VALUE, the one thing the requirement says must stay untouched — while
 * `interventions` stayed empty and the blocker survived by identity.
 *
 * ⚠⚠ NEITHER #1034 NOR #1035 IS ON THAT PATH, AND THAT IS THE FINDING. Both
 * live inside `resolveOptionEffectWrite`, which route-v2 reaches only through
 * its answered-ask pre-route. Measured at pristine `877affe2` against the
 * witnessed identities:
 *
 *   turn R1  "That would push sales headcount up a lot, set it to 0.8."
 *     `readMissingValueAnswer`      → null        (a COMMA was not a clause break)
 *     `resolveOptionEffectWrite`    → decline     (unreachable: conjunct (b) needs
 *                                                  a non-null reading)
 *     `impliesOptionInterventionEdit` → **false**  (no "option" word, no full
 *                                                  option label — the drafter
 *                                                  minted an 85-char label the
 *                                                  product renders truncated —
 *                                                  and every distinctive token
 *                                                  is claimed by a factor label)
 *     `tryDeterministicValueUpdate` → **`{matched: true, dispatch: 'clarify'}`**
 *                                     on candidate `3a75cabd`
 *
 * So the FACTOR-BASELINE pre-route claimed the turn, emitted
 * *"I wasn't sure which factor you meant. Did you mean Enterprise sales
 * headcount and spend?"* with the chip *"Set Enterprise sales headcount and
 * spend to 0.8."*, and persisted a `set_factor_value` pending. Two turns later
 * the clarification resumer applied that pending — `llm_calls: 0`, ack
 * *"Updated Enterprise sales headcount and spend"* — and the wrong entity moved.
 *
 * ⭐ THE PENDING AND ITS OWN CHIP AGREED WITH EACH OTHER AND BOTH WERE WRONG.
 * That is the shape worth naming: this was not a mis-parse. The pre-route
 * resolved the right FACTOR, read the right VALUE, and composed a perfectly
 * coherent factor-baseline interaction — while the product's own outstanding
 * question was about an OPTION'S EFFECT on that factor. **Nothing in the
 * factor-baseline pre-route or its composer ever consults the outstanding ask.**
 * `#1034` fixed which option a WRITER binds; `#1035` fixed which sentences a
 * WRITER accepts; neither is consulted when the FACTOR pre-route decides to ask
 * a question. The wrong-entity class survived by moving from the writer to the
 * question.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE LEAD QUESTION — "could this fix be another instance of the defect class
 * it removes?" — ANSWERED BY CONSTRUCTION, NOT BY CONFIDENCE.
 *
 * The class is "the writer targets the wrong entity". This module writes
 * NOTHING. It changes only WHICH QUESTION is asked and WHAT ITS CHIP REPLAYS,
 * and the pair it names is not resolved from the user's sentence at all — it is
 * `deriveAskedEffectPair`, the head of the canonical blocker list, which is the
 * SAME element `coaching/readiness-recovery.ts:194,242` composed the on-screen
 * question from (P7: derived from the producer). The only thing read off the
 * sentence is the `baseline` suppressor, and that is imported from the writer
 * rather than re-spelled, so the two cannot disagree about one sentence
 * (trap 12/21). A redirect can therefore only ever bind a pair the product
 * itself just put on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CONJUNCTS, each load-bearing and each with a biting mutant:
 *
 *   (a) The product IS asking for an effect value — `deriveAskedEffectPair`
 *       returns the head blocker's pair, or `null` when the recovery copy is
 *       rendering some other sentence entirely. `null` ⇒ no redirect.
 *   (b) EXACTLY ONE clarify candidate, and it IS the asked factor. Two or more
 *       candidates is a genuine factor ambiguity between entities the user
 *       might have meant, and picking the asked one there is the wrong-entity
 *       class arriving on the factor axis — the shape `#1034`'s surviving
 *       mutant M8 found. Pinned as a known-dropped residual below, not silently
 *       absent.
 *   (c) The message does not carry `baseline` framing — the writer's own closed
 *       single-token suppressor, imported.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE CHIP IS OFFERED ONLY WHEN THE USER'S NUMBER IS ALREADY A MODEL-UNIT
 * EFFECT VALUE, and that restraint is the P5 half of this change. An effect
 * value is on the 0–1 scale (`src/prompts/edit-graph-v6.ts`: "effect values are
 * on the 0-1 scale" — P7, the producer's own instruction). CQE hands back
 * `80%` as `{value: 0.8, unit: 'percentage'}`; replaying that as
 * *"…to 0.8"* would silently perform a unit conversion this estate's writer
 * explicitly refuses to perform. When the number is not already model-unit, or
 * the operator is a delta rather than a set, the redirect still fires — the
 * product still stops asking the wrong question — but it asks for a 0–1 number
 * instead of putting one in the user's mouth.
 */

import { BASELINE_FRAMING } from './option-effect-write.js';
import { deriveAskedEffectPair, type MissingEffectPair } from './repair-value-binding.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';

/**
 * Shapes this redirect KNOWINGLY DOES NOT CLAIM, pinned as data so the suite
 * REDs if the claim widens or narrows (CLAUDE.md trap 22f's honest-gap
 * protocol). Each falls through to the pre-existing factor clarify unchanged.
 */
export const OUTSTANDING_ASK_CLARIFY_KNOWN_DROPPED: readonly {
  readonly shape: string;
  readonly why: string;
}[] = Object.freeze([
  Object.freeze({
    shape:
      'two or more clarify candidates, one of which is the asked factor — the factor-baseline '
      + 'chips are emitted for all of them, including the asked one',
    why:
      'the user named something that matches two factors; choosing the asked one is the product '
      + 'picking between two entities the user might have meant, which is the wrong-entity class '
      + 'this seam exists to remove, arriving on the factor axis (the shape #1034\'s surviving '
      + 'mutant M8 found). Closing it needs a way to ask WHICH FACTOR while offering the option '
      + 'effect for each — a two-axis ask this seam does not have a composer for',
  }),
  Object.freeze({
    shape: 'the sole candidate is a factor the product is NOT currently asking about',
    why:
      'the product has no outstanding question about that factor, so there is no option to bind '
      + 'to and a factor-baseline edit is the honest reading of the sentence',
  }),
  Object.freeze({
    shape: 'the message carries the word "baseline"',
    why:
      'the writer\'s own closed single-token suppressor, imported rather than re-spelled: in this '
      + 'product\'s vocabulary "baseline" names a factor\'s own observed value, a different entity '
      + 'from an option\'s effect on it',
  }),
]);

export interface OutstandingAskClarifyRedirect {
  /** The pair the PRODUCT is asking about — never read from the sentence. */
  readonly pair: MissingEffectPair;
  /**
   * The user's value rendered for the advised-format chip, or `null` when it is
   * not already a model-unit effect value (see the header). `null` means "ask
   * for a 0-1 number", never "convert one".
   */
  readonly modelUnitValueText: string | null;
}

/** The quantity fields this module reads. Structural, so the CQE type is not a dependency. */
export interface OutstandingAskQuantity {
  readonly value: number | null;
  readonly unit: string | null;
  readonly operator?: string | null;
}

/**
 * Decide whether a factor clarify is really an answer to the product's own
 * outstanding option-effect question.
 *
 * PURE — no I/O, no LLM, no telemetry. The caller owns the graph read and the
 * composition.
 */
export function resolveOutstandingAskClarifyRedirect(params: {
  readonly message: string;
  /** The pre-route's clarify candidates, in its own order. */
  readonly candidates: readonly { readonly id: string; readonly label: string }[];
  /** Canonical readiness for the PERSISTED graph. */
  readonly readiness: { readonly blockers?: unknown } | null | undefined;
  readonly quantity: OutstandingAskQuantity;
}): OutstandingAskClarifyRedirect | null {
  if (typeof params.message !== 'string') return null;
  // (c) the writer's own suppressor, imported.
  if (BASELINE_FRAMING.test(params.message.toLowerCase())) return null;
  // (a) the product IS asking for an effect value.
  const asked = deriveAskedEffectPair(params.readiness);
  if (asked === null) return null;
  // (b) exactly one candidate, and it IS the asked factor.
  if (params.candidates.length !== 1) return null;
  if (params.candidates[0]?.id !== asked.factorId) return null;

  return { pair: asked, modelUnitValueText: readModelUnitEffectValue(params.quantity) };
}

/**
 * The user's number, but only when it is ALREADY an effect value in the model's
 * own units. Returns `null` rather than converting — see the header.
 */
function readModelUnitEffectValue(quantity: OutstandingAskQuantity): string | null {
  if (quantity.value === null || !Number.isFinite(quantity.value)) return null;
  // A unit means the user gave a user-scale figure (`80%`, `£25,000`). This
  // module performs no conversion, so it may not put a number in the chip.
  if (quantity.unit !== null && quantity.unit !== undefined) return null;
  // A delta ("increase it by 0.1") is not an effect value.
  if (quantity.operator !== undefined && quantity.operator !== null && quantity.operator !== 'set') {
    return null;
  }
  if (quantity.value < 0 || quantity.value > 1) return null;
  return String(quantity.value);
}

/**
 * ⭐ THE CHIP'S REPLAY MESSAGE — the product's OWN advised format, built by the
 * SAME function `repair-value-binding.ts` and `option-effect-ask-response.ts`
 * use, so a chip this seam offers cannot fail to route into the lane that
 * offered it (trap 12: the second spelling is the one that rots).
 */
export function buildOutstandingAskChipMessage(
  pair: MissingEffectPair,
  modelUnitValueText: string,
): string {
  return `${buildConfigureOptionAdvisedFormat(pair.optionLabel, pair.factorLabel, modelUnitValueText)}.`;
}

/**
 * ⭐⭐ THE COPY — P8 AT ITS MOST LITERAL: NEVER ASK A YES/NO YOU CANNOT ACCEPT.
 *
 * The sentence this replaces was *"I wasn't sure which factor you meant. Did
 * you mean <factor>?"* — a yes/no question whose only acceptance path was a
 * numeral. The witnessed user answered it correctly, with *"Yes, that one —
 * under the enterprise sales option."*, and was told *"I couldn't use that as
 * the value. Tell me the number you want and I'll set it."* — **and the 0.8
 * they had given one turn earlier was gone from the conversation.**
 *
 * There is nothing to disambiguate here: the sole candidate IS the factor the
 * product is already asking about. So this copy does not ask a question the
 * product already knows the answer to. It states the pair by label, carries the
 * user's own number forward INTO THE CHIP (which is what stops the value being
 * lost across the turn), and asks for the one thing genuinely outstanding.
 *
 * ⚠ WHAT IT DOES NOT DO (P5): it makes no claim that anything changed, and no
 * offer that the analysis can now run — a neighbouring composer shipped exactly
 * that promise unconditionally and had to have it withdrawn. *"I have not
 * changed the model."* is the sanctioned lead used by
 * `compose/option-effect-ask-response.ts`; the negative-phrasing variants that
 * read naturally here are banned by `FORBIDDEN_USER_FACING_PHRASES`.
 */
export function buildOutstandingAskClarifyText(redirect: OutstandingAskClarifyRedirect): string {
  const { pair, modelUnitValueText } = redirect;
  const opening =
    `"${pair.optionLabel}" still needs an effect value on "${pair.factorLabel}" — `
    + `that is the number I asked for.`;
  const closing =
    modelUnitValueText === null
      ? `Effect values run from 0 to 1. Tell me the number for that pair and I will set it.`
      : `Use the button below to apply ${modelUnitValueText} to that pair, or name the option and the factor together in your reply.`;
  return `${opening} I have not changed the model. ${closing}`;
}
