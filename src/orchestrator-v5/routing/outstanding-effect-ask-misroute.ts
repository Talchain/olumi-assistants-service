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
 *     parser, so this guard cannot acquire a SECOND SPELLING of "which edge does
 *     this id name" (trap 12: the second spelling is the one that rots).
 *     ⚠ STATED NARROWLY, BECAUSE THE STRONGER CLAIM IS FALSE. The handler
 *     resolves `invocation.edgeStrengthEndpointAuthority ?? parseEdgeId(...)`
 *     (`tools/handlers/adjust-edge-strength.ts:146-147`) and this guard
 *     implements ONLY the second limb. The first limb is set in exactly one
 *     place — `system-events/edge-strength-edit.ts:499`, the system-event path —
 *     which does not reach this chokepoint, so guard and writer cannot disagree
 *     TODAY. They are not structurally prevented from disagreeing. If the
 *     authority ever becomes reachable here, this guard must read it too.
 *     An invariant stated more strongly than the code supports is how the next
 *     reader stops checking;
 *   · the EFFECT FRAMING is the shipped classifier's own
 *     `labelAnchorWouldDecideTrigger` filtered through `EFFECT_FRAMED_TRIGGERS`,
 *     the canonical set `option-effect-write.ts` already uses. No regex here.
 *   · the `baseline` suppressor is `BASELINE_FRAMING`, imported from the writer.
 *
 * ⭐⭐ WHY `set_factor_value` NEEDS THE PROSE CONJUNCT ON A TYPED TURN AND
 * `adjust_edge_strength` DOES NOT. A factor whose effect value is outstanding is
 * STILL a legitimate target for an ordinary baseline edit ("Set Enterprise sales
 * investment to 0.7"), and refusing those would strand the user for as long as
 * the model is blocked. So on a turn carrying the USER'S OWN PROSE the factor arm
 * requires the classifier's own evidence that the sentence was effect-framed and
 * merely unanchored. The edge arm needs no such conjunct: on an option → factor
 * link there is no separate "strength" the user could legitimately mean while
 * that pair's effect value is the thing the product is asking for.
 *
 * ⚠⚠ AND ON A CHIP-ORIGINATED TURN THE PROSE CONJUNCT IS NOT A NARROWING, IT IS
 * A HOLE — REVIEW FINDING, MEASURED AT `1b4e2c1a`, AND IT IS THE WITNESS'S OWN
 * TWIN. The demotion chips are minted from ONE path with copy that is
 * CONTENT-FREE BY DESIGN (`compose/warrant-demotion.ts:50-52`):
 *
 *     set_factor_value:     'Set that value in my model.'
 *     adjust_edge_strength: 'Adjust that link in my model.'
 *
 * Neither carries `effect`, `intervention` or `configure`. So the factor arm
 * COULD NOT FIRE ON ANY CHIP CLICK, while its edge twin — matching on identity —
 * refused. Measured, both contrast controls discriminating in the same run:
 * "Set that value in my model." → WRITE PROCEEDS; "Adjust that link in my
 * model." → REFUSED. Sharper still, the VERBATIM witnessed defect-A sentence
 * ("…drives self-serve product investment fairly strongly, about 0.6.") is
 * REFUSED as an edge write and PASSES as a factor write — same sentence, same
 * pair, two handlers, opposite verdicts.
 *
 * **That asymmetry was trap 21 inside one change: identity for edges, prose for
 * factors.** The correction is symmetry, not widening: when the turn's message is
 * THE PRODUCT'S OWN COPY rather than the user's prose, there is no prose to
 * classify, and classifying it anyway is not a safeguard — it is a guard reading
 * a string it wrote itself. On such a turn the factor arm refuses on IDENTITY
 * ALONE, exactly as the edge arm always has. Free-typed prose is untouched,
 * which is what keeps the legitimate baseline edit working.
 *
 * ⚠ THE RESIDUAL, STATED: a product-authored chip that DELIBERATELY offers a
 * factor-baseline edit on a pair whose effect value is outstanding would now be
 * refused. No such chip exists (`what_would_flip`'s `set_factor_value` proposal
 * needs a completed analysis, which needs readiness, so the pair cannot be
 * outstanding), and such an offer would itself be the wrong-field defect one
 * level up. This is the same fail-safe direction as the edge arm.
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

import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import { parseEdgeId } from '../tools/handlers/adjust-edge-strength.js';
import {
  detectConfigureOptionIntent,
} from './configure-option-intent.js';
import {
  BASELINE_FRAMING,
  EFFECT_FRAMED_TRIGGERS,
  normaliseOptionLabel,
  readOptionEffectValue,
  resolveOptionEffectWrite,
} from './option-effect-write.js';
import { deriveMissingEffectPairs, type MissingEffectPair } from './repair-value-binding.js';
// ⭐ ONE OWNER EACH, imported rather than re-spelled (trap 12):
//   · "is this an answer to the missing-value ask?" — shared with
//     `configure-option-clarify-response.ts`, its other consumer;
//   · "does this message name this label?" — the same word-bounded reader
//     `configure-option-intent` / `-advice` / `-clarify` already use.
import { messageAnswersMissingValueAsk, readMissingValueAnswer } from './missing-value-answer.js';
import { containsPhrase, optionCueMatches } from './option-intervention-guard.js';

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
  /**
   * The VERIFIED replay from {@link buildVerifiedCorrectionReplay}, or null when
   * no correction can be offered. Required rather than optional so a caller
   * cannot silently fall back to an unverified chip (trap 12).
   */
  verifiedReplay: string | null,
): Readonly<Record<string, unknown>> {
  if (collision === null) return {};
  return {
    ...(verifiedReplay !== null ? { effect_ask_replay_message: verifiedReplay } : {}),
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

/**
 * ⭐⭐⭐ THE ANSWERS THIS MODULE RECOGNISES AS ANSWERS AND DELIBERATELY DOES NOT
 * CLAIM, pinned as data so the suite REDs if the set GROWS **or** SHRINKS
 * (trap 22f's honest-gap protocol, as used by `MISSING_VALUE_ANSWER_KNOWN_DROPPED`
 * and `CONTENTFUL_SUBJECT_KNOWN_DROPPED`).
 *
 * ⚠⚠ THAT SENTENCE WAS FALSE UNTIL #1292 r4, AND THE CORRECTION IS RECORDED
 * RATHER THAN THE SENTENCE QUIETLY FIXED (trap 14 — an honest label overwritten
 * by a comfortable one is how this estate loses evidence). The spec's guard was
 * a loop OVER this array, which can only see members the array still contains.
 * Measured at `36d2213b`: removing ONE member left the suite GREEN, removing
 * FOUR left it GREEN, and only ADDING a claimed member RED. One direction.
 * **The sentence was copied verbatim from `CONTENTFUL_SUBJECT_KNOWN_DROPPED`,
 * whose own comment documents this exact shape as vacuous and names the remedy
 * — a literal `toEqual([...])`.** The claim travelled; the fix did not.
 * What makes it true now is the literal in
 * `__tests__/outstanding-effect-ask-answer-misroute.test.ts`
 * (*"THE PINNED SET IS EXACTLY THESE SIXTEEN"*). If that literal is ever
 * replaced by anything derived FROM this array, this sentence is false again.
 *
 * Every member is a value-word answer that `messageAnswersMissingValueAsk`
 * returns FALSE for, so {@link isUnanchoredAnswerToOutstandingAsk} cannot see it.
 * Each is genuinely answer-shaped, and on each the wrong-entity factor write
 * still proceeds today.
 *
 * ⚠ WHY THEY ARE NOT CLOSED HERE. The gap is in the SHARED answer-reader, not in
 * this guard. Widening `messageAnswersMissingValueAsk` changes what the
 * loop-breaking clarify claims as well (`configure-option-clarify-response.ts`
 * is its other consumer), which is a different seam with a different blast
 * radius. Adding a SECOND spelling of "is this an answer?" here to cover them is
 * exactly the two-same-named-predicates defect (trap 12/21) — the reason this
 * guard reuses the one owner is that a second one is what rots.
 *
 * A gap recorded in the suite is honest; a gap invisible to it is how the
 * witnessed defect shipped.
 *
 * ⚠⚠ THIS SET WAS FOUR MEMBERS LONG AND THE CLASS IS EIGHTEEN — WIDENED FROM AN
 * INDEPENDENT SWEEP, #1292 r3. The four originals were the ones the review that
 * created this set happened to type. They are not the class.
 *
 * ⭐ WHY A SHORT PIN IS THE DANGEROUS KIND, and why no derivation could have
 * caught it (trap 12d). The spec's guard iterates THIS ARRAY and asserts every
 * member is still unclaimed — so it proves the set does not DRIFT and is
 * structurally incapable of proving the set is COMPLETE. A short honest-gap set
 * is worse than an obviously absent one: it reads as a surveyed boundary when it
 * is a sample, and the next reader inherits "we know where the edge is". The
 * only instrument that can find a short list is a corpus written from OUTSIDE
 * the author's head, which is what produced the fourteen below.
 *
 * ⭐ THE SWEEP, so the number is reproducible rather than asserted. A corpus of
 * plausible replies to the product's OWN on-screen ask was run through
 * `findOutstandingEffectAskCollision` against the witnessed fixture readiness.
 * Every member below measured, in one run:
 *   `messageAnswersMissingValueAsk` → FALSE · `readMissingValueAnswer` → null ·
 *   `collide(...)` → null  (i.e. the wrong-entity write still proceeds)
 * CONTRAST CONTROL in the SAME run, so the sweep is not blind: the assignment
 * forms of the very same value-words — `"Set it to a third."`,
 * `"Set <factor> to a third."`, `"Change its baseline to a third."` — all read
 * `qualitative` and are all REFUSED. The discriminator is the ASSIGNMENT FRAME,
 * not the value-word: this reader recognises `"Set it to X"` and does not
 * recognise a bare `"X"`.
 *
 * ⚠ WHAT IS NOT IN **THIS** ARRAY, AND WHERE IT IS INSTEAD — stated so the
 * boundary is not over-read again. Relative/comparative replies that name no
 * quantity at all (`"lower it"`, `"halve it"`, `"double it"`, and measured
 * alongside them `"raise it"`, `"increase it"`, `"reduce it"`) also escape.
 * They stay OUT of this array because its stated contract is *"every member is
 * a VALUE-WORD answer"* and these name a DIRECTION with no quantity — resolving
 * them belongs to relative-delta resolution, a different seam whose reachability
 * this lane has not derived.
 *
 * ⚠⚠ BUT THE PREVIOUS VERSION OF THIS PARAGRAPH DISCHARGED THEM WITH *"They are
 * reported on #1292, not silently absorbed."* — **AND THAT WAS FALSE WHEN IT WAS
 * WRITTEN.** Measured at `36d2213b` over a COMPLETE, NAMED manifest — the PR
 * body, 12 issue comments, 0 review comments and 3 reviews, all fetched from the
 * API rather than read off a page: `lower it` 0, `halve it` 0, `double it` 0.
 * CONTRAST CONTROLS in the SAME sweep, so the probe is not blind: `a third` 26
 * matches over 22 lines, `quite high` 1, `baseline` 70. (The lone `halve*` hit
 * is the word *"halves"* in an unrelated sentence — checked, not assumed.)
 * The class was INVISIBLE, which is the exact condition the paragraph below
 * bans. **A pointer at a document nobody has written is not a record** — and it
 * reads as one, which is why it survived a review.
 *
 * They are now pinned in the spec, beside `POSITIONAL_KNOWN_DROPPED` and for the
 * same reason (they exist relative to a seam rather than to this constant), with
 * a contrast control in the same run. That pin is a SAMPLE, not a survey, and it
 * says so.
 *
 * ⚠ AND THE LIMIT THAT APPLIES TO EVERY MEMBER, unchanged from this set's first
 * version: whether the router would in fact PROPOSE `set_factor_value` for a
 * given member is INFERRED from the witnessed run, not measured. What is
 * measured is only that this guard does not claim them.
 */
export const OUTSTANDING_EFFECT_ASK_ANSWER_KNOWN_DROPPED: readonly string[] = [
  // The four this set shipped with.
  'a third',
  'About a third.',
  'Make it a quarter.',
  'quite high',
  // Bare fractional answers — the witnessed value-word with no assignment frame.
  'two thirds',
  'three quarters',
  'a fifth',
  'half',
  // Hedged fractional answers. The hedge is exactly what a user types when they
  // are estimating, which is the situation this ask creates.
  'roughly a third',
  'About half.',
  'somewhere around a third',
  'a bit less than half',
  // Bare qualitative magnitudes, the same family as the original 'quite high'.
  'Make it high.',
  'fairly low',
  'very low',
  // ⭐ `Make it X` IS AN ASSIGNMENT TO A HUMAN AND NOT TO THE READER, which is
  // why 'Make it a quarter.' was already here and why this belongs beside it.
  // Measured against its own contrast in one run: `Set it to a third.`,
  // `Change it to a third.` and `Update it to a third.` are all recognised
  // (`qualitative`, refused); `Make it a third.` is not (`null`, written).
  //
  // ⚠ THE DISCRIMINATOR IS THE REQUIRED `to`, NOT THE VERB LIST — CORRECTED
  // #1292 r4, at the bytes. This comment previously read *"The verb list is the
  // discriminator, and it is one verb short."* **`make` IS in the alternation**
  // (`missing-value-answer.ts:743`:
  // `(?:set|change|update|adjust|make|put|use)`), so nothing is missing from it.
  // What the pattern also requires is `\bto\s+`, and `Make it a third.` has no
  // `to`. Measured, both directions in one run:
  //     "Make it to a third."  → qualitative ⇒ REFUSED
  //     "Set it a third."      → null        ⇒ WRITTEN
  // i.e. adding `to` to the `make` form claims it, and removing `to` from the
  // `set` form releases it. A reader who acted on the old sentence would have
  // added a verb that was already there and left the gap open.
  'Make it a third.',
];

/**
 * ⭐⭐ IS THIS THE USER ANSWERING THE PRODUCT'S OWN QUESTION, WITHOUT NAMING THE
 * FACTOR THEY ARE BEING ASKED ABOUT?
 *
 * ⚠ THIS EXISTS BECAUSE THE EFFECT FRAMING IS IN THE **ASK**, NOT IN THE
 * **ANSWER**, and {@link isUnanchoredEffectFraming} can only ever see the answer.
 * Wire-witnessed on deployed `d0544243`: the product asked for option
 * `9cb78c6e`'s effect on factor `06fd579a`; the user replied *"Set it to a
 * third."*; the identity match was PRESENT (`entityId === 06fd579a`) and was
 * discarded, because a bare answer carries no `effect`/`intervention`/`configure`
 * vocabulary. The write then moved the factor's own level to 33%, the product
 * replied *"Updated Operational Control Level to 33%."*, committed a new graph
 * hash, and the option's `interventions` never changed.
 *
 * ⭐ IT INVENTS NO VOCABULARY. Both halves are imported from their existing
 * owners, so this guard cannot acquire a second spelling of either question
 * (trap 12 — the second spelling is the one that rots):
 *
 *   · "is this an answer to the missing-value ask?" is
 *     `messageAnswersMissingValueAsk` — the estate's ONE owner, already consumed
 *     by `configure-option-clarify-response.ts` to decide the same thing;
 *   · "does the message name this label?" is `containsPhrase` — the same
 *     word-bounded, regex-free reader `configure-option-intent`,
 *     `configure-option-advice` and `configure-option-clarify` all use.
 *
 * ⭐⭐ WHY `!namesTheFactor` IS THE LOAD-BEARING CONJUNCT, AND IT IS THE TWIN'S
 * PROTECTION RATHER THAN A NARROWING. A factor whose effect value is outstanding
 * is STILL a legitimate target for an ordinary baseline edit — this module's
 * header has said so since it was written, and refusing those would strand the
 * user for as long as the model is blocked. The discriminator is that a user who
 * NAMES the factor has made an anchored choice about that entity, whereas a user
 * who does not name it has given the system nothing but an answer — so the ONLY
 * reason the proposal resolved this factor at all is the outstanding ask, i.e.
 * the system is already treating the message as that answer. Measured, both
 * directions in one run:
 *
 *   "Set it to a third."                   → REFUSED (the witnessed defect)
 *   "Set Operational Control Level to 40%." → WRITES  (the legitimate twin)
 *
 * ⚠ DIRECTION OF THE FAILURE MODE, stated, and unchanged from this module's
 * existing arms: a false positive costs ONE clarify turn on a graph that is
 * ALREADY BLOCKED — and the copy it produces re-asks the outstanding question,
 * which is the turn the user needed anyway. A false negative writes the wrong
 * field, badges it "Applied", and feeds the user's own number back to them as
 * the factor's established level. They are not symmetric.
 *
 * ⚠ IT NEVER PICKS AND NEVER WRITES — the ambiguity is made the product
 * (trap 22f's exit), exactly as the sibling arms do.
 */
function isUnanchoredAnswerToOutstandingAsk(
  message: string,
  askedPairs: readonly MissingEffectPair[],
): boolean {
  if (!messageAnswersMissingValueAsk(message)) return false;
  // `containsPhrase` requires a lower-cased, space-padded haystack.
  const padded = ` ${message.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  return !askedPairs.some((p) => containsPhrase(padded, p.factorLabel.toLowerCase()));
}

/**
 * ⭐⭐⭐ THE AUTHORITY ON "HOW DO WE READ THIS ANSWER?" ALREADY REFUSED TO TURN
 * IT INTO A NUMBER, SO NO NUMBER THIS BLOCK LETS THROUGH CAN BE THAT ANSWER.
 *
 * ⚠⚠⚠ THE SCOPE OF THAT SENTENCE, BEFORE ANYTHING ELSE — BECAUSE THE FIRST
 * VERSION OF IT WAS A FALSE GUARANTEE AND WAS CAUGHT IN REVIEW.
 *
 * It read *"NO NUMBER WRITTEN HERE CAN BE THAT ANSWER."* That was false: this
 * arm sat BELOW the `BASELINE_FRAMING` suppressor, so every `qualitative`
 * reading carrying baseline vocabulary escaped it — measured, four of them
 * (`"Change its baseline to a third."`, `"Set the baseline to half."`, …).
 * The arm is now hoisted ABOVE that suppressor and the sentence is true of THIS
 * BLOCK, which is the only thing it may ever claim.
 *
 * ⛔ WHAT IT STILL DOES **NOT** COVER, and none of this is closed by this
 * module:
 *   · a CHIP-ORIGINATED turn skips every prose arm here by design (identity
 *     alone decides), so this sentence says nothing about that path;
 *   · FOUR PRODUCTION WRITERS of a factor's own baseline are never EXAMINED by
 *     the caller — the route-level `edit_graph` lane, the `factor_value_edit`
 *     system event and the GM held-consent apply never reach it at all, while
 *     ⚠ a compound chain's parts 2..N DO reach it and execute inside the same
 *     block, downstream of the guard, carrying entity ids it never reads
 *     (corrected #1292 r4 — this said all four "never reach the caller", and
 *     "out of scope" and "downstream" are different claims about a guard).
 *     `add_constraint` passes that block while writing `{value, baseline}`.
 *     See `turn-executor.ts`'s own corrected note.
 *
 * ⭐ THE LESSON, RECORDED BECAUSE IT IS THE SHARPEST ONE AVAILABLE: the false
 * version of this sentence was written in the SAME COMMIT that removed a false
 * *"one guard here covers every dispatch path"* from `turn-executor.ts`. **The
 * comment most likely to be false is the one written to correct a false
 * comment.** Any guarantee here must name the block it is true of and the paths
 * it is silent about, or it will be inherited as the larger claim.
 *
 * ⚠ THIS ARM EXISTS BECAUSE `!namesTheFactor` FAILS IN THE DANGEROUS DIRECTION,
 * AND THE PRODUCT ITSELF PROMPTS THE PHRASING THAT DEFEATS IT. Review finding on
 * #1292, measured at this tip. The witnessed harm with the factor name simply
 * added back was NOT claimed by the unanchored arm:
 *
 *     "Set Operational Control Level to a third."   · "… to half."
 *     "… to high."                                  · "no change to Operational Control Level"
 *
 * And the factor name is exactly what the product's own blocker copy puts in
 * front of the user — *`Factor "Operational Control Level" needs a numeric value
 * for option "…"`* — so **a user who echoes back the words on their screen
 * defeated the guard.** Nothing upstream catches them either:
 * `detectConfigureOptionIntent` returns `matched: false, trigger: null` on all
 * four (positive control in the same run: the fully-anchored sentence returns
 * `matched: true`).
 *
 * ⭐ THE DISCRIMINATOR IS THE READER'S OWN VERDICT, NOT A NEW READING OF THE
 * TEXT. `readMissingValueAnswer` returns `qualitative` for all four and `null`
 * for EVERY legitimate baseline twin — measured, not reasoned:
 *
 *     "Set Operational Control Level to a third."   → qualitative   ⇒ refuse
 *     "Set Operational Control Level to 40%."       → null          ⇒ write
 *     "Set Operational Control Level to 0.4"        → null          ⇒ write
 *     "Change its baseline to 0.4."                 → null          ⇒ write
 *     "Set Driver Retention Rate to 40%."           → null          ⇒ write
 *
 * A `qualitative` reading's own contract says the term is *"The user's own
 * words, quoted back. NEVER mapped to a number."* Writing a number to the factor
 * on such a turn is a handler overruling an authority that already answered —
 * which is precisely the witnessed defect (`"Set it to a third."` → 33%).
 *
 * ⚠⚠ THE SPELLING IS POSITIVE (`=== 'qualitative'`) AND MUST STAY THAT WAY.
 * The obvious `!== 'numeric'` would ALSO claim every `null` reading — i.e. every
 * legitimate twin in the table above — and silently convert this guard into the
 * blanket ban on `set_factor_value` that this module has refused since it was
 * written.
 *
 * ⚠ `no_change` IS DELIBERATELY NOT IN THIS ARM, AND IT IS NOT A GAP — DERIVED,
 * NOT ASSUMED. `readNoChange` is WHOLE-MESSAGE-ONLY: an exact match against
 * `MISSING_VALUE_NO_CHANGE_PHRASES` after stripping one of four fixed openers
 * (`this option ` / `the option ` / `that option ` / `it `). None of those can
 * contain a factor label, so a `no_change` reading can never name the factor and
 * the unanchored arm above already covers every reachable one. (Measured
 * consequence: `"no change to Operational Control Level"` is not read as
 * `no_change` at all — it reads `qualitative`, and this arm claims it.) If that
 * reader ever gains a contextual form, this comment is the thing that must be
 * re-derived.
 *
 * ⚠ ONE MEASURED CONSEQUENCE BEYOND THE FOUR, pinned in the spec rather than
 * discovered later: *"Actually, Operational Control Level is currently about
 * 40%, set it to that."* also reads `qualitative` and is now refused. The
 * sentence is genuinely ambiguous — it asserts the factor's current level AND
 * asks for an assignment — and the binder itself declined to extract a figure
 * from it. Refusing costs one clarify turn on an already-blocked graph, which is
 * this module's declared and unchanged asymmetry.
 */
function isAnswerTheBinderRefusedToNumber(message: string): boolean {
  return readMissingValueAnswer(message)?.kind === 'qualitative';
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
/**
 * ⭐⭐ COLLAPSE A GENUINE AMBIGUITY TO THE PAIR THE PRODUCT ITSELF NAMED — and
 * do NOTHING ELSE.
 *
 * THE DEFECT, captured 1 Sep 2026 on deployed staging (turn 2 of four). Two
 * options were outstanding on one factor, so `pairs` carried both and
 * `composeOutstandingEffectAskMisroute` emitted *"I'm not sure which option you
 * mean"* — one turn after the product had asked about exactly one of them and
 * written down which. The estate's ruling that two candidates must be ASKED
 * about rather than guessed between (trap 22f) was correct and was being applied
 * to a question that was never ambiguous.
 *
 * ⚠⚠ DIRECTION OF THE CHANGE, STATED AND BOUNDED — every one of these is cased
 * in `recorded-effect-ask.test.ts`:
 *   · it can only NARROW, never widen: the result is always a subset;
 *   · it cannot CREATE a collision (an empty `pairs` is returned untouched, and
 *     the caller has already returned null on it);
 *   · it cannot DELETE one: a record naming a pair that is not a member leaves
 *     the set alone rather than emptying it;
 *   · it cannot alter a set that already has exactly one member.
 * So the reachable behavioural change is exactly "an ambiguous refusal becomes
 * the specific one the product owed the user", by construction rather than by
 * inspection.
 *
 * ⚠ THE FALLBACK IS THE AMBIGUOUS SET, NOT THE HEAD BLOCKER. Narrowing by list
 * position would put a confidently-named, possibly-wrong option in a sentence
 * about the user's own model — trading an honest "which one?" for a quiet lie,
 * which is the wrong direction on every axis this module was built for.
 */
function narrowToRecordedAsk(
  pairs: readonly MissingEffectPair[],
  recordedAsk: MissingEffectPair | null,
): readonly MissingEffectPair[] {
  if (recordedAsk === null || pairs.length <= 1) return pairs;
  const named = pairs.filter(
    (p) => p.optionId === recordedAsk.optionId && p.factorId === recordedAsk.factorId,
  );
  return named.length === 1 ? named : pairs;
}

/**
 * The current turn outranks an older recorded ask when it identifies an
 * option. Identity comes from `optionCueMatches`, the same reader used by the
 * option-effect writer; this guard does not classify the prose a second time.
 *
 * A current reference can only narrow to outstanding members. If it points at
 * no member, the collision is suppressed so the caller's ordinary
 * option-intervention refusal can handle the turn without minting a replay for
 * the stale record. Two current references remain two candidates: the older
 * record must never break a tie the user introduced on this turn.
 */
function narrowToCurrentOrRecordedAsk(
  pairs: readonly MissingEffectPair[],
  recordedAsk: MissingEffectPair | null,
  message: string,
  optionLabels: readonly string[],
  nonOptionLabels: readonly string[],
): readonly MissingEffectPair[] | null {
  const prior = recordedAsk ?? null;
  if (prior !== null && pairs.length > 0) {
    const currentKeys = new Set(
      optionCueMatches(message, optionLabels, nonOptionLabels)
        .map((index) => optionLabels[index])
        .filter((label): label is string => typeof label === 'string')
        .map(normaliseOptionLabel),
    );
    if (currentKeys.size > 0) {
      const current = pairs.filter((pair) =>
        currentKeys.has(normaliseOptionLabel(pair.optionLabel)),
      );
      return current.length > 0 ? current : null;
    }
  }
  return narrowToRecordedAsk(pairs, prior);
}

export function findOutstandingEffectAskCollision(params: {
  readonly handlerId: OutstandingEffectAskHandlerId;
  /** `proposal.entity.id`: a node id, or the `from→to` edge form. */
  readonly entityId: string;
  readonly message: string;
  readonly optionLabels: readonly string[];
  /** Non-option graph labels used by the shared option-identity reader. */
  readonly nonOptionLabels?: readonly string[];
  readonly readiness: { readonly blockers?: unknown } | null | undefined;
  /**
   * ⭐ Is `message` the PRODUCT'S OWN CHIP COPY rather than the user's prose?
   *
   * REQUIRED rather than optional on purpose: an omitted argument would silently
   * restore the hole this parameter closes, so the compiler is made to point at
   * every caller instead (trap 12 — fail loud on drift, never assume-good).
   */
  readonly chipOriginated: boolean;
  /**
   * ⭐⭐ THE PAIR THE PRODUCT'S OWN LIVE `elicit_option_effect` RECORD NAMES, or
   * `null` — from {@link deriveRecordedEffectAsk}, the one owner of that
   * question (`repair-value-binding.ts`). It is passed IN rather than derived
   * here because only the caller holds the turn's pending rows.
   *
   * REQUIRED rather than optional, for the same reason `chipOriginated` is: an
   * omitted argument would silently restore the hole it closes, so the compiler
   * is made to point at every caller instead (trap 12 — fail loud on drift).
   * On free-typed prose, a current option identity resolved by the existing
   * option-cue reader outranks this older record.
   */
  readonly recordedAsk: MissingEffectPair | null;
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
    const narrowed = narrowToCurrentOrRecordedAsk(
      match,
      params.recordedAsk,
      params.message,
      params.optionLabels,
      params.nonOptionLabels ?? [],
    );
    return narrowed !== null && narrowed.length > 0
      ? {
          refusedField: 'edge_strength',
          pairs: narrowed,
          userValue: readUserValue(params.message),
        }
      : null;
  }

  // set_factor_value — the prose conjuncts apply to a TYPED turn only. On a
  // chip-originated turn the message is the product's own content-free copy, so
  // the arm matches on identity alone, symmetric with the edge arm above.
  //
  // ⚠ THE IDENTITY MATCH IS TAKEN FIRST, and that is a reordering rather than a
  // widening: both were already conjuncts, so the accepted set is unchanged. It
  // is hoisted because `isUnanchoredAnswerToOutstandingAsk` must read the factor
  // label of THE PAIR THE PRODUCT IS ASKING ABOUT — not of every outstanding
  // pair in the model — or a user naming some other blocked factor would be
  // silently claimed here.
  const match = pairs.filter((p) => p.factorId === params.entityId);
  if (match.length === 0) return null;
  if (!params.chipOriginated) {
    // ⭐⭐⭐ THE BINDER'S REFUSAL TO NUMBER IS CHECKED **BEFORE** THE `baseline`
    // SUPPRESSOR, AND THE ORDER IS THE WHOLE POINT — REVIEW BLOCKER, #1292 r2.
    //
    // With this arm below `BASELINE_FRAMING`, every `qualitative` reading
    // carrying baseline vocabulary escaped it. Measured, four of them:
    //
    //     "Change its baseline to a third."   ·  "Set the baseline to half."
    //     "Set its baseline to high."         ·  "Change the <factor> baseline to a third."
    //
    // ⭐ THE HOIST CANNOT COST A **BINDABLE** TWIN, AND THAT IS DERIVABLE RATHER
    // THAN MERELY MEASURED. `qualitative` is the reading returned when there is
    // NO DIGIT in the value slot, so a BINDABLE baseline request — one that
    // carries the number it wants written — can never read `qualitative`.
    // Confirmed by execution over the bindable baseline forms
    // ("…to 0.4.", "…to 40%.", "…to 0.25", "…to 0.7", "baselines: set it to
    // 0.5"): every one reads `null`, none reads `qualitative`.
    //
    // ⚠⚠ THE SCOPE WORD `BINDABLE` IS LOAD-BEARING AND WAS ADDED IN #1292 r4.
    // This read *"THE HOIST CANNOT COST A LEGITIMATE TWIN"*, full stop, and the
    // unscoped claim is FALSE: a baseline request whose value is a WORD ZERO
    // carries no digit, so it reads `qualitative` and this arm claims it.
    // Measured:
    //     "Change its baseline to zero."    · "…to nothing." · "…to none."
    //         → qualitative ⇒ REFUSED   (they were WRITTEN before the hoist)
    //     "Change its baseline to 0."       → null ⇒ still WRITES
    // The direction is fail-safe and the words are genuinely ambiguous against a
    // factor whose scale nobody has stated, so the hoist stands — but the
    // asymmetry is DECLARED rather than denied, and pinned in the spec
    // ("THE HOIST'S ASYMMETRY, DECLARED RATHER THAN DENIED"). A "cannot" stated
    // wider than the code supports is how the next reader stops checking, which
    // is the failure this very block's header was rewritten for once already.
    //
    // So `baseline` vocabulary still suppresses everything it ever suppressed
    // EXCEPT the word-zero forms above — it no longer licenses writing a number
    // the binder refused to read.
    if (!isAnswerTheBinderRefusedToNumber(params.message)) {
      // ⭐⭐ THE OTHER TWO WAYS A TYPED TURN CAN BE THE WRONG FIELD OF THE ASKED
      // PAIR. These are genuinely different questions, not one predicate
      // widened (trap 21 — name the concepts apart):
      //
      //   · the user described an EFFECT and merely failed to anchor the option
      //     ("Set its effect on X to 0.33") — the framing is in the SENTENCE;
      //   · the user ANSWERED THE PRODUCT'S OWN QUESTION and named no factor
      //     ("Set it to a third.")          — the framing is in the ASK.
      //
      // The second is what the witnessed defect needed, and what no reading of
      // the user's own words could ever have supplied. Both are suppressible by
      // explicit `baseline` framing; the binder-refusal arm above is not.
      if (BASELINE_FRAMING.test(params.message.toLowerCase())) return null;
      if (
        !isUnanchoredEffectFraming(params.message, params.optionLabels)
        && !isUnanchoredAnswerToOutstandingAsk(params.message, match)
      ) {
        return null;
      }
    }
  }
  // `match` is non-empty by the early return above — no second, unreachable
  // emptiness guard here. A guard that cannot fail reads as protection and is
  // not, which is the shape this estate hunts.
  const narrowed = narrowToCurrentOrRecordedAsk(
    match,
    params.recordedAsk,
    params.message,
    params.optionLabels,
    params.nonOptionLabels ?? [],
  );
  if (narrowed === null || narrowed.length === 0) return null;
  return {
    refusedField: 'factor_value',
    pairs: narrowed,
    userValue: readUserValue(params.message),
  };
}

/**
 * ⭐⭐ WOULD THE CORRECTION CHIP'S REPLAY ACTUALLY WORK? ASK THE WRITER.
 *
 * Returns the replay message ONLY when running it through the real
 * `resolveOptionEffectWrite` — against the graph the chip is being offered on —
 * binds the EXACT pair and value the copy names. Otherwise `null`, and the caller
 * offers no chip and asks instead.
 *
 * ⚠ THIS EXISTS BECAUSE A GROWING LIST OF THINGS-THAT-BREAK-IT IS NOT A GUARD.
 * A review swept eleven hostile option-label classes through the offered replay:
 * full stops, decimals, apostrophes, double quotes, em-dashes, question marks,
 * colons, a label containing the factor label, even a label containing the
 * literal phrase `option's effect on` — all resolve correctly. ONE breaks:
 *
 *     "raise the enterprise seat minimum from 2 to 5"
 *       -> {matched:false, reason:"no_single_unit_scale_value"}
 *
 * A second `to <number>` span in the OPTION'S OWN LABEL defeats the value
 * reader, so the chip is minted, the user clicks it, and nothing happens. It
 * degrades to a decline rather than a false receipt — a UX defect, not a trust
 * one — but it is the DEAD-END-AFFORDANCE class this module's neighbours say the
 * estate has already paid for TWICE, and it sits on the repair path this change
 * makes central.
 *
 * Enumerating the breaking label shapes would be a corpus written from my own
 * head over an input space I do not control (trap 22): option labels are the
 * USER'S OWN brief fragments. So the gate asks the only authority that can
 * answer — the writer itself — and closes the whole class rather than this case.
 *
 * ⚠ IT DOES **NOT** SUBSUME THE EGRESS COPY CHECK, and conflating them would be
 * trap 21. This function answers *"would this replay WRITE the right thing?"*;
 * `findChipRawDecimalLeak` at the composer answers *"would this chip SURVIVE
 * RENDERING?"*. A high-precision value (`0.6667`) passes this gate and fails
 * that one. Two questions, named apart, both required.
 */
export function buildVerifiedCorrectionReplay(
  collision: OutstandingEffectAskCollision,
  graph: unknown,
): string | null {
  if (collision.pairs.length !== 1 || collision.userValue === null) return null;
  const pair = collision.pairs[0]!;
  const replay = `${buildConfigureOptionAdvisedFormat(
    pair.optionLabel,
    pair.factorLabel,
    String(collision.userValue),
  )}.`;
  const resolved = resolveOptionEffectWrite({ message: replay, graph });
  // ⚠ THESE TWO LINES ARE MUTUALLY COVERING, AND THAT WAS MEASURED RATHER THAN
  // ASSUMED. Each SURVIVES deletion on its own — remove the kind check and an
  // `ask` result is caught by the identity check (its `optionId` is undefined);
  // remove the identity check and the kind check catches the same case. Deleting
  // BOTH is BITTEN by the duplicate-option-label case in the spec. So neither is
  // dead code and neither is individually pinnable: the PAIR is the guard.
  // Recorded because a future reader looking at a lone surviving mutant would
  // otherwise conclude one of them is redundant and delete it.
  if (!resolved.matched || resolved.kind !== 'write') return null;
  // Bound by IDENTITY to the pair the copy names — never "it matched something".
  if (resolved.optionId !== pair.optionId || resolved.factorId !== pair.factorId) return null;
  if (resolved.value !== collision.userValue) return null;
  return replay;
}
