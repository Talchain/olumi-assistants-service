/**
 * ⭐⭐ WOULD THIS PROPOSAL WRITE A **DIFFERENT FIELD** OF THE PAIR THE PRODUCT
 * IS ASKING ABOUT?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WITNESSED — twice, in one fresh-guest browser session, 20 Aug 2026
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/golden-journey-runs/
 *   2026-08-20-fresh-guest-browser-witness/`; deployed CEE `65445df`).
 *
 * DEFECT A, captured verbatim in `shots/07-adjust-this-link-chip.png`. Olumi
 * had asked, on screen, for the missing EFFECT VALUE of
 * `15637f46` ("double down on mid-market…") on `0ebfde36` ("Self-serve product
 * investment"). The user answered in plain English. The product replied:
 *
 *   "Nothing has been changed. You did not ask me to edit the model, so I have
 *    not - but changing the strength of "double down on mid-market with a
 *    lower-priced self-serve tier→Self-serve product investment" to 0.6 looks
 *    like it would help. Say the word and I will make it."
 *                                                    [chip: "Adjust this link"]
 *
 * The chip's write landed (edge `strength` 1 → 0.6), the UI badged it
 * **Applied**, and `options_ready` stayed 0/4. **The change the product offered
 * against its own blocker cannot clear that blocker** — edge strength is a
 * field PLoT's preflight ignores, which is the same loop ROADMAP 2.11 was
 * opened for (`configure-option-intent.ts:5-12`).
 *
 * DEFECT B, `PLAIN-LANGUAGE-TESTS.txt` test C: *"Set its effect on Enterprise
 * sales investment to 0.7"* wrote the FACTOR'S OWN VALUE (0.5 → 0.7) and
 * reported "Applied". Measured at pristine `65445df`:
 *
 *   detectConfigureOptionIntent(msg, <the 4 real option labels>)
 *       → { matched: false, labelAnchorWouldDecide: TRUE }
 *   impliesOptionInterventionEdit(msg, …)            → false
 *
 * Adding the single word `option's` flips the first to
 * `{matched: true, trigger: 'effect_vocab'}`. **The only thing the sentence was
 * missing is an option ANCHOR**, because the user wrote a pronoun — the residual
 * gap `option-intervention-guard.ts:282-285` already declares in prose
 * ("an option referred to only by a pronoun … is still not caught").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE RULE, AND WHY IT ADDS NO NEW PREDICATE.
 *
 * Both defects are ONE shape: a mutating proposal writes a different FIELD of an
 * option × factor pair the product is CURRENTLY asking an effect value for. This
 * module answers exactly that question and nothing else. It invents no
 * vocabulary:
 *
 *   · the PAIR SET comes from `deriveMissingEffectPairs` — the estate's ONE
 *     owner of "which option × factor pairs is the product saying it has no
 *     value for" (`repair-value-binding.ts`), read off the SAME canonical
 *     readiness payload the blocker copy on screen is composed from, so this
 *     refusal cannot disagree with the sentence the user is answering;
 *   · the EDGE PARSE is `parseEdgeId`, the adjust-edge-strength handler's OWN
 *     parser, so this guard and the writer can never disagree about which edge
 *     an id names (trap 12: the second spelling is the one that rots);
 *   · the EFFECT FRAMING is the shipped classifier's own
 *     `labelAnchorWouldDecideTrigger` filtered through `EFFECT_FRAMED_TRIGGERS`,
 *     the canonical set `option-effect-write.ts` already uses. No regex here.
 *   · the `baseline` suppressor is `BASELINE_FRAMING`, imported from the writer.
 *
 * ⭐⭐ WHY `set_factor_value` NEEDS THE PROSE CONJUNCT AND `adjust_edge_strength`
 * DOES NOT. A factor whose effect value is outstanding is STILL a legitimate
 * target for an ordinary baseline edit ("Set Enterprise sales investment to
 * 0.7"), and refusing those would strand the user for as long as the model is
 * blocked. So the factor arm requires the classifier's own evidence that the
 * sentence was effect-framed and merely unanchored. The edge arm needs no such
 * conjunct: on an option → factor link there is no separate "strength" the user
 * could legitimately mean while that pair's effect value is the thing the
 * product is asking for, and the witnessed offer proves the cost of guessing.
 * Two arms, two different questions, named apart (trap 21).
 *
 * ⚠ IT REFUSES; IT NEVER WRITES AND NEVER PICKS. When more than one outstanding
 * option carries the named factor, BOTH are returned so the caller's copy can
 * ask which one is meant. Four rounds of predicate tuning oscillated on a
 * neighbouring seam (CLAUDE.md trap 22f) and the exit named there is to make the
 * ambiguity the product — never to break the tie here.
 *
 * ⚠ DIRECTION OF THE FAILURE MODE, stated: a false positive costs one clarify
 * turn on a graph that is already blocked. A false negative writes the wrong
 * field and badges it "Applied". They are not symmetric, and this module is
 * biased accordingly — but only within the two arms above, both of which are
 * bounded by an identity match against a pair the product itself put on screen.
 */

import { parseEdgeId } from '../tools/handlers/adjust-edge-strength.js';
import {
  detectConfigureOptionIntent,
} from './configure-option-intent.js';
import {
  BASELINE_FRAMING,
  EFFECT_FRAMED_TRIGGERS,
  readOptionEffectValue,
} from './option-effect-write.js';
import { deriveMissingEffectPairs, type MissingEffectPair } from './repair-value-binding.js';

/** The handlers this module can refuse. Both are D1 graph-mutating writers. */
export type OutstandingEffectAskHandlerId = 'set_factor_value' | 'adjust_edge_strength';

/** Which field the refused proposal would have written. */
export type OutstandingEffectAskRefusedField = 'factor_value' | 'edge_strength';

export interface OutstandingEffectAskCollision {
  /** The field the proposal would have written instead of the effect value. */
  readonly refusedField: OutstandingEffectAskRefusedField;
  /**
   * The outstanding pair(s) the proposal collides with, in blocker order.
   * Exactly one ⇒ the copy can name it. Two or more ⇒ the copy must ask.
   * Never empty (a collision with no pair is not a collision).
   */
  readonly pairs: readonly MissingEffectPair[];
  /**
   * ⭐ The model-unit effect value the user's OWN sentence already carried, or
   * `null`. Read with `readOptionEffectValue` — the writer's own reader, not a
   * second spelling (trap 12) — so the value a repair chip replays can never
   * differ from the value the writer would accept.
   *
   * `null` is the common and CORRECT outcome for a hedged sentence ("…about
   * 0.6"): that reader is anchored on `to <number>`, so an approximation is
   * declined rather than laundered into an exact user-stated figure. A caller
   * with no value must ask for one.
   */
  readonly userValue: number | null;
}

/**
 * ⭐ THE ONE SPELLING of the collision's `ValidationError.details` payload.
 *
 * The refusal copy is composed elsewhere (`compose/validation-failure-
 * responses.ts`) and must be able to NAME the entity and the field — that is
 * the whole point of the fix, and a copy that could not name them would be the
 * object-free "Applied" one level up. Building the keys here rather than at each
 * guard keeps the producer and the consumer reading one shape (trap 12).
 *
 * Returns `{}` for a null collision so a guard can spread it unconditionally.
 */
export function buildOutstandingEffectAskDetails(
  collision: OutstandingEffectAskCollision | null,
): Readonly<Record<string, unknown>> {
  if (collision === null) return {};
  return {
    effect_ask_refused_field: collision.refusedField,
    ...(collision.userValue !== null ? { effect_ask_user_value: collision.userValue } : {}),
    // Every pair in a collision shares the factor (both arms match on it), so
    // one label is the honest rendering rather than a list.
    effect_ask_factor_label: collision.pairs[0]!.factorLabel,
    effect_ask_option_labels: collision.pairs.map((p) => p.optionLabel),
  };
}

/**
 * Is this sentence effect-framed but merely UNANCHORED — i.e. did the shipped
 * classifier report that an option anchor, and nothing else, is what stopped it
 * routing to the option-effect writer?
 *
 * A MATCHED detection deliberately returns false: those turns already reach
 * `resolveOptionEffectWrite`, which owns them. This function claims only the
 * turns that fall THROUGH it.
 */
function isUnanchoredEffectFraming(
  message: string,
  optionLabels: readonly string[],
): boolean {
  const detection = detectConfigureOptionIntent(message, optionLabels);
  if (detection.matched) return false;
  const trigger = detection.labelAnchorWouldDecideTrigger;
  return trigger !== null && EFFECT_FRAMED_TRIGGERS.has(trigger);
}

/** Normalised exactly as the writer normalises, so the two read one string. */
function readUserValue(message: string): number | null {
  return readOptionEffectValue(message.toLowerCase().replace(/\s+/g, ' ').trim());
}

/**
 * Returns the collision, or `null` when the proposal may proceed untouched.
 *
 * `readiness` is the canonical analysis-ready payload for the graph the
 * proposal would be applied to — the caller must derive it from the SAME graph,
 * never from a request field, or the refusal could speak about a model the user
 * is not looking at.
 */
export function findOutstandingEffectAskCollision(params: {
  readonly handlerId: OutstandingEffectAskHandlerId;
  /** `proposal.entity.id`: a node id, or the `from→to` edge form. */
  readonly entityId: string;
  readonly message: string;
  readonly optionLabels: readonly string[];
  readonly readiness: { readonly blockers?: unknown } | null | undefined;
}): OutstandingEffectAskCollision | null {
  const pairs = deriveMissingEffectPairs(params.readiness);
  if (pairs.length === 0) return null;
  if (typeof params.entityId !== 'string' || params.entityId.trim().length === 0) return null;

  if (params.handlerId === 'adjust_edge_strength') {
    const parsed = parseEdgeId(params.entityId);
    if (parsed === null) return null;
    // Direction is load-bearing: an option → factor link carries the effect,
    // and the reverse edge is a different relationship entirely.
    const match = pairs.filter(
      (p) => p.optionId === parsed.from && p.factorId === parsed.to,
    );
    return match.length > 0
      ? { refusedField: 'edge_strength', pairs: match, userValue: readUserValue(params.message) }
      : null;
  }

  // set_factor_value — the prose conjunct, for the reason in the header.
  if (BASELINE_FRAMING.test(params.message.toLowerCase())) return null;
  if (!isUnanchoredEffectFraming(params.message, params.optionLabels)) return null;
  const match = pairs.filter((p) => p.factorId === params.entityId);
  return match.length > 0
    ? { refusedField: 'factor_value', pairs: match, userValue: readUserValue(params.message) }
    : null;
}
