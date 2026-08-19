/**
 * ⭐ ROADMAP 2.1261 — repair-leg BARE-VALUE BINDING.
 *
 * THE DEFECT, wire-witnessed on deployed #998 (`c5e2430`, scenario
 * `a05fefcd-3956-4700-879f-6fc8b09e3905`, 2026-08-16, reqs dd5ad6ca/b90d62e0):
 * the product presented an honest `MISSING_OPTION_VALUE` blocker asking the
 * user to choose an effect value; the user's "…should be 12% of revenue…" was
 * refused on unit grounds (correctly); the user then complied EXACTLY —
 * **"Set it to 0.12."**, unit-free — and received the BYTE-IDENTICAL refusal,
 * whose canned copy mischaracterised the unit-free input as "applying a value
 * in %". A fully explicit phrasing naming the option and factor WAS accepted
 * (req c899c1f0, `edit_graph`), so the write path works; what was missing is
 * any binding between a bare compliant value and the factor under discussion.
 *
 * MECHANISM OF THE DEAD END, derived at the bytes: "Set it to 0.12." carries
 * no option/factor label, so `detectConfigureOptionIntent` cannot anchor
 * (`configure-option-intent.ts`), `tryDeterministicValueUpdate` finds no
 * label candidate (bare "it" is deliberately outside its deictic set,
 * `deterministic-value-update.ts`), and the turn falls to the LLM router —
 * which re-reads the conversation history, re-proposes `set_factor_value`
 * with the PRIOR turn's `%` unit on a unit-free message, and the
 * `unit_redeclares_scale` guard then re-serves the identical refusal
 * (`evaluate-factor-value-proposal.ts:436` → `validation-failure-responses.ts`
 * `parameter_invalid_issue`). Every component is individually defensible; the
 * loop is the product.
 *
 * THE REMEDY — deterministic, bounded, and refusing to guess:
 *   - CLAIM only a message that is, IN ITS ENTIRETY, a bare value-set
 *     instruction over a CLOSED referent set ("set it to 0.12", "change the
 *     value to 0.5", …). Anything else — a named target, a unit, a trailing
 *     clause, a question — is NOT claimed and keeps today's route untouched.
 *     Four rounds of open-ended NL predicates oscillated on a neighbouring
 *     seam (CLAUDE.md trap 22f); a FULL-MESSAGE ANCHOR over a closed set is
 *     the opposite shape: it cannot creep, only decline.
 *   - BIND when the model has EXACTLY ONE missing effect value: the blocker
 *     names one option×factor, the product itself asked for this value, and
 *     the referent is unambiguous. The write goes through the edit lane with
 *     the product's OWN advised phrasing (`buildConfigureOptionAdvisedFormat`
 *     — probe P1 verbatim, the one form proven to reach the honest writer),
 *     carrying the user's value verbatim.
 *   - ASK when more than one effect value is missing: name each candidate
 *     pair and offer one chip per pair whose replay message is the advised
 *     phrasing with the user's value — the ambiguity becomes the product
 *     (trap 22f), never a guess and never the verbatim re-refusal.
 *   - DECLINE (fall through, byte-identical route) when nothing is missing:
 *     with no repair context there is no referent to bind, and inventing one
 *     would be the misbind this module exists to avoid.
 *
 * DERIVED, NOT MIRRORED (trap 12): the missing-pair set is read off the SAME
 * canonical readiness payload that composes the blocker copy the user is
 * looking at (`buildCanonicalAnalysisReadyFromGraph`), so the binding cannot
 * disagree with the blocker about what is missing. The advised phrasing comes
 * from `configure-option-chip-text.ts`, the SAME module the router's
 * `effect_vocab` trigger is calibrated against, so an offered chip cannot
 * fail to route back into the lane that offered it.
 */

import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';

/**
 * The referent set and the whole-message value grammar MOVED to
 * `routing/missing-value-answer.ts` (a MOVE, not a copy — CLAUDE.md trap 12).
 *
 * ⭐ WHY THEY LEFT. Two modules need the same answer to "did the user answer the
 * missing-value ask?": this one, to BIND the value to a slot, and
 * `compose/configure-option-clarify-response.ts`, to refuse to repeat a demand
 * the user has already answered. While the grammar lived here, the composer had
 * no access to it and re-issued the identical demand — the witnessed NEW-1 loop.
 * One owner is what makes that structurally impossible rather than fixed at the
 * sites someone remembered.
 *
 * Re-exported so this module's existing consumers and specs are unaffected.
 */
import { readMissingValueAnswer } from './missing-value-answer.js';

export { BARE_REFERENTS } from './missing-value-answer.js';

/**
 * ⭐ Trap 22f's honest-gap protocol — phrasings that carry the SAME user intent
 * and are KNOWINGLY NOT CLAIMED, pinned as data so the suite REDs if the
 * predicate silently widens to claim one, or narrows past a claimed form.
 *
 * ⚠⚠ THIS SET SHRANK BY FOUR, AND THAT IS THE POINT OF PINNING IT.
 *
 * `Make it 0.12.` · `Use 0.12.` · `Set it to .12.` · `Yes, set it to 0.12.` were
 * recorded here as knowingly-unclaimed. Measured at this tip, all four were
 * refused by the binder AND by the configure composer's termination signal — so
 * an ordinary human answer to the product's own ask got the identical demand
 * back. They are now CLAIMED; each has a twin in the suite showing it bound to
 * the right pair, and each verb shape is separately pinned.
 *
 * The set is now the single owner's, re-exported: a second list here would drift
 * from the grammar that decides it (trap 12). See
 * `MISSING_VALUE_ANSWER_KNOWN_DROPPED` for the four that remain refused and the
 * stated reason for each — three are deliberate (hedge, word-number, named
 * target) and one, the bare number, is a genuine capability gap whose enabling
 * change is named there.
 */
export { MISSING_VALUE_ANSWER_KNOWN_DROPPED as REPAIR_BARE_VALUE_KNOWN_DROPPED } from './missing-value-answer.js';

export interface BareRepairValueMatch {
  /** The user's value, verbatim as typed (commas preserved). */
  readonly valueText: string;
  /** The referent phrase that matched, or null for the bare "set to N" form. */
  readonly referent: string | null;
}

/**
 * Does this message consist ENTIRELY of a bare value-set instruction?
 * Pure text predicate — no graph, no state. Normalisation mirrors
 * `detectConfigureOptionIntent` (lowercase, collapse whitespace, trim).
 */
export function matchBareRepairValue(message: string): BareRepairValueMatch | null {
  const answer = readMissingValueAnswer(message);
  // QUALITATIVE ANSWERS ARE NOT BINDABLE AND MUST NOT REACH THIS FUNCTION'S
  // CONSUMERS. This is the write path: "high" has no number, and choosing one
  // for the user is the fabrication class the sibling claim guard exists to
  // close. The clarify composer handles that reading instead.
  if (answer === null || answer.kind !== 'numeric') return null;
  // ⭐ AND NEITHER MAY A CONTEXT-BEARING ANSWER, which is what keeps this
  // function's own contract ("ENTIRELY a bare value-set instruction") true after
  // the clause anchor widened the reading. THIS CALLER'S SLOT RESOLUTION IS
  // "exactly one pair is missing" — it has NO reader for what the prose points
  // at, so admitting context here would bind a sentence naming one option to a
  // pair belonging to another. The context-bearing form is claimed by
  // `resolveOptionEffectWrite`'s rule 3c, which checks the prose against the
  // graph's own entities first. Trap 21: two questions, named apart.
  if (answer.leadingContext !== '') return null;
  // ⭐ AND NEITHER MAY AN ELLIPTICAL (BARE-NUMBER) ANSWER, for the SAME reason
  // stated one paragraph up, arriving from the opposite direction. This
  // function's consumers resolve the slot from "exactly one pair is missing";
  // a bare number's only antecedent is the question the product asked, which is
  // `deriveAskedEffectPair`, and this function has no reader for it. Admitting
  // one here would bind a number to whichever pair happened to be sole-missing
  // rather than to the pair on screen. Trap 21: two questions, named apart —
  // `resolveRepairValueBinding` owns the elliptical route.
  if (answer.elliptical) return null;
  return { valueText: answer.valueText, referent: answer.referent };
}

/** One option×factor pair the model is still waiting on. */
export interface MissingEffectPair {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string;
}

/**
 * The missing effect-value pairs, read off the canonical readiness payload —
 * the SAME payload the blocker copy is composed from, so this list cannot
 * disagree with what the user was told is missing. Only `missing_value`
 * blockers carrying FULL identity (option and factor, id and label) qualify:
 * a blocker this module cannot name is a blocker it must not bind to.
 * Deduplicated by (option_id, factor_id); order preserved (the first pair is
 * the one the readiness-recovery copy presents as "next").
 *
 * ⭐ THIS IS THE ESTATE'S ONE OWNER of "which option × factor pairs is the
 * product currently saying it has no value for". `compose/blocked-slot-claim-guard.ts`
 * imports it rather than re-deriving it, and that is load-bearing rather than
 * tidy: the claim guard's whole invariant is that a blocker and a possession
 * claim are mutually exclusive, and two readers of "which pairs are blocked"
 * could disagree about exactly the pair under dispute (CLAUDE.md trap 12).
 *
 * ⚠⚠ THE DISCRIMINATOR HAS TWO SPELLINGS AND THIS FUNCTION USED TO SEE ONLY
 * ONE. Measured on the J4 t2 wire capture (deployed CEE `8be62df`), a SINGLE
 * payload carries the same ten blockers twice:
 *
 *   `analysis_ready.blockers[]`           → `blocker_type: "missing_value"`
 *   `analysis_state.readiness.blockers[]` → `code: "MISSING_OPTION_VALUE"`,
 *                                           and NO `blocker_type` field at all
 *
 * The canonical Zod type (`schemas/analysis-ready.ts:152`) declares
 * `blocker_type` and has no `code`, so a reader written from the schema is
 * green in unit and blind to half the payloads it will actually be handed.
 * Both spellings are read; which one matched is deliberately not recorded,
 * because a consumer that behaved differently per spelling would be a second
 * concept (trap 21).
 *
 * ⚠ WIDENING DIRECTION, stated: this can only ADD pairs, never remove one. The
 * reachable behavioural change is a payload that carried only the `code`
 * spelling moving from `no_missing_effect_values` (no bind) to `bind`/`ask`,
 * and a single-pair payload gaining a second pair moves `bind` → `ask` — which
 * asks the user instead of choosing for them. Both directions are toward less
 * guessing.
 */
const MISSING_VALUE_BLOCKER_TYPE = 'missing_value';
const MISSING_VALUE_BLOCKER_CODE = 'MISSING_OPTION_VALUE';

export function deriveMissingEffectPairs(
  readiness: { readonly blockers?: unknown } | null | undefined,
): readonly MissingEffectPair[] {
  const blockers = readiness?.blockers;
  if (!Array.isArray(blockers)) return [];
  const seen = new Set<string>();
  const pairs: MissingEffectPair[] = [];
  for (const raw of blockers as readonly unknown[]) {
    if (raw === null || typeof raw !== 'object') continue;
    const blocker = raw as Record<string, unknown>;
    if (
      blocker.blocker_type !== MISSING_VALUE_BLOCKER_TYPE
      && blocker.code !== MISSING_VALUE_BLOCKER_CODE
    ) {
      continue;
    }
    const optionId = nonEmpty(blocker.option_id);
    const optionLabel = nonEmpty(blocker.option_label);
    const factorId = nonEmpty(blocker.factor_id);
    const factorLabel = nonEmpty(blocker.factor_label);
    if (!optionId || !optionLabel || !factorId || !factorLabel) continue;
    const key = `${optionId}::${factorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ optionId, optionLabel, factorId, factorLabel });
  }
  return pairs;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * ⭐⭐ THE PAIR THE PRODUCT IS CURRENTLY ASKING ABOUT — `blockers[0]`, and the
 * identity of that index is DERIVED FROM THE PRODUCER, not chosen here (P7).
 *
 * `coaching/readiness-recovery.ts` composes the sentence the user is answering
 * from exactly one element:
 *
 *   const firstBlocker = asBlocker(analysisReady?.blockers?.[0]);   // :194
 *   …
 *   nextStep: `Next, choose the missing effect value for "\${option}" on
 *              "\${factor}" so the comparison can be prepared.`     // :242
 *
 * So "which pair did Olumi ask about?" has ONE answer in this system and it is
 * the head of the blocker list. `deriveMissingEffectPairs` — this module's, and
 * the estate's, sole owner of "which pairs is the product saying it has no value
 * for" — is run over the head ALONE rather than re-implemented, so this reader
 * cannot drift from it about what qualifies as a missing-effect blocker
 * (CLAUDE.md trap 12: the second spelling is the one that rots).
 *
 * ⚠ RETURNS null WHEN THE HEAD IS NOT SUCH A BLOCKER, and that is the whole
 * point rather than a convenience. `pairs[0]` is NOT the same thing: if the head
 * blocker is a mapping or encoding issue, the recovery copy renders a DIFFERENT
 * sentence and the product is not asking for an effect value at all — binding an
 * answer to `pairs[0]` there would be answering a question nobody asked.
 *
 * ⚠⚠ THIS FUNCTION ANSWERS **"WHICH PAIR IS THE READINESS AUTHORITY OUTSTANDING
 * ON?"** — NOT "what is on screen". The two differ, and conflating them breaks
 * something in whichever direction you collapse them. See
 * {@link deriveOnScreenEffectAsk} directly below for the other question and for
 * the measurement that forced them apart.
 *
 * ⚠ IT IS DELIBERATELY **NOT** STATUS-GATED, and that was MEASURED rather than
 * assumed. Its consumers — `option-effect-write.ts`'s rule 3c (which WRITES) and
 * `outstanding-ask-clarify.ts` — resolve their antecedent from the USER'S OWN
 * PROSE, which names or points at entities and is checked against the graph.
 * Their claim does not rest on what the recovery projection is rendering, so a
 * structurally messy graph must not silence them.
 */
export function deriveAskedEffectPair(
  readiness: { readonly blockers?: unknown } | null | undefined,
): MissingEffectPair | null {
  const blockers = readiness?.blockers;
  if (!Array.isArray(blockers) || blockers.length === 0) return null;
  const head = deriveMissingEffectPairs({ blockers: blockers.slice(0, 1) });
  return head.length === 1 ? head[0]! : null;
}

/**
 * ⭐⭐ **WHICH PAIR IS THE PRODUCT ASKING ABOUT ON SCREEN?** — a DIFFERENT
 * QUESTION from {@link deriveAskedEffectPair}, and the difference is a
 * wrong-entity WRITE.
 *
 * THE DEFECT, measured at the real producer with a contrast control.
 * `assessCanonicalAnalysisReadiness` overwrites the status but carries the
 * blockers through UNTOUCHED (`analysis-ready-helper.ts:1113-1119`), and
 * `hardBlocked` fires on any `graph_structure` / `numeric_integrity` /
 * `internal` issue (`:1109-1112`). So a graph with an orphan node AND a missing
 * effect value yields `status: 'blocked'` with a FULL-IDENTITY `missing_value`
 * blocker still at `blockers[0]`:
 *
 *   STATUS   = blocked   blocked_reason = ORPHAN_NODE
 *   CHIP     = chip_prompt_resolve_model_issue  "Resolve model issue"
 *   NEXTSTEP = "Next, resolve the model issue shown before comparing the options."
 *
 * **The screen says resolve the model issue. The user types `0.6`.** Without
 * this reader the product wrote 0.6 onto a pair they never named — answering a
 * question nobody asked, with a write, silently.
 *
 * `projectReadinessRecovery` short-circuits on STATUS (`readiness-recovery.ts:
 * 243-247`) and `needs_user_input` is the ONLY status under which it renders an
 * effect-value question (`:294-311`), so that is the gate.
 *
 * ⚠⚠ WHY THIS IS A SECOND READER AND **NOT** A CONJUNCT ON THE OWNER, which is
 * what the review prescribed — OVERTURNED BY EXECUTION, NOT BY ARGUMENT. Gating
 * the owner reddened **16** tests across the RUN-B journey acceptance and the
 * full apply chain, because **the REAL captured 18 Aug witness graph is itself
 * `status: 'blocked'` / `ORPHAN_NODE`**. Real drafted graphs are structurally
 * messy; that is the normal case, not the exception. A gate on the owner would
 * therefore have silenced the shipped answered-ask WRITE path (#1034/#1035/#1036)
 * on almost every genuine draw — a far larger and quieter regression than the one
 * it closed, and one that would have looked like "fixtures need a status field".
 *
 * ⭐ The two questions are genuinely different and are now named apart (trap 21):
 *   · OUTSTANDING (owner)   — "does the authority still lack this value?" Used
 *     where the antecedent is the USER'S PROSE, which stands on its own.
 *   · ON SCREEN (this)      — "is this the question the product just rendered?"
 *     Used ONLY by the elliptical arm, whose entire and only antecedent IS the
 *     rendered question, because a bare number says nothing else.
 *
 * The blocker logic is NOT re-implemented here — it delegates to the owner and
 * adds one conjunct, so the two cannot drift about what a missing-effect blocker
 * is (trap 12).
 *
 * ⚠ The status is compared as a string rather than by importing
 * `projectReadinessRecovery`, which would be cleaner: `readiness-recovery.ts:25`
 * already imports FROM this module, so that would be an import cycle. The
 * coupling is stated here and pinned by a PRODUCER-DERIVED spec rather than by
 * the type system — a hand-maintained edge, named as one.
 */
export function deriveOnScreenEffectAsk(
  readiness: { readonly blockers?: unknown; readonly status?: unknown } | null | undefined,
): MissingEffectPair | null {
  if (readiness?.status !== 'needs_user_input') return null;
  return deriveAskedEffectPair(readiness);
}

/**
 * The advised-format instruction that binds the user's value to a pair. This
 * is the exact phrasing the product itself advises users to type (probe P1
 * verbatim — `configure-option-chip-text.ts`), with the user's value in the
 * slot. Used as the edit lane's instruction on the BIND path and as the chip
 * replay message on the ASK path, so both routes are the ONE wire-proven form.
 */
export function buildRepairBindingInstruction(
  pair: MissingEffectPair,
  valueText: string,
): string {
  return `${buildConfigureOptionAdvisedFormat(pair.optionLabel, pair.factorLabel, valueText)}.`;
}

/**
 * Is this bare figure ALREADY an effect value in the model's own units?
 *
 * ⭐ THE 0-1 SCALE IS THE PRODUCER'S, NOT THIS MODULE'S: `src/prompts/edit-graph-v6.ts`
 * states "effect values are on the 0-1 scale" (P7 — derive the bound from the
 * producer, never pick one here). `routing/outstanding-ask-clarify.ts` applies
 * the identical restraint to the identical question one seam over, and its
 * reason is this one's: a figure outside the scale is a USER-SCALE number, and
 * converting it is a rescale this estate's writer explicitly refuses to perform
 * silently. Declining costs the user one turn; converting would write a number
 * they never gave.
 *
 * ⚠ ONLY REACHED FOR THE ELLIPTICAL (bare) FORM, which by construction carries
 * no unit token at all — so this is a RANGE check, and it is not, and must not
 * become, a substitute for the unit handling the verb-bearing paths already own.
 */
function isModelUnitEffectValueText(valueText: string): boolean {
  const parsed = Number(valueText.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return false;
  if (parsed < 0 || parsed > 1) return false;
  // ⭐⭐ AND A BARE **INTEGER** IS REFUSED, BECAUSE IT IS AN ORDINAL IN DISGUISE.
  //
  // The estate's label/ordinal pre-route resolves a naked "1" / "2" against the
  // chips a previous turn offered. This lane's own sibling ask arm
  // (`composeRepairValueAskResponse`) offers up to three numbered pair chips and
  // exits through `sendFinalised200` — persisting NO pending — so the next turn
  // has no live record that an offer is outstanding. Measured: a bare "1" bound
  // as an effect value of 1.0 while the user meant "the first one".
  //
  // Two readings, different entities written, and nothing on the wire
  // distinguishes them — so the estate declines rather than picks (trap 22f).
  // The refusal is SHAPE-BASED and therefore cannot go stale the way a
  // state-based guard does: `2` and `3` were already out of scale, `0` is not an
  // ordinal, and the only figure this costs is exactly 1, still reachable as
  // "1.0" or "Set it to 1".
  //
  // ⭐ THIS REPLACES A BLUNTER GUARD AT THE ROUTE. Standing down on ANY live
  // pending closed the same collision but also blocked a legitimate bare answer
  // for a whole TTL window whenever any unrelated offer was outstanding —
  // over-declining a capability to fix an over-acceptance. Refusing the ambiguous
  // SHAPE removes the collision at its source, so the route keeps only the
  // narrow `set_factor_value` check it had before this lane.
  // ⚠ THE TEST IS ON THE TEXT, NOT THE PARSED VALUE, and the difference is real:
  // `Number.isInteger(Number('1.0'))` is TRUE, so a value-based check would also
  // refuse "1.0" — a figure that is unambiguously a decimal the user typed and
  // could never be an ordinal. Ambiguity with an ordinal is a property of how the
  // message is WRITTEN, so that is what is inspected.
  const bareInteger = /^\d+$/.test(valueText.replace(/,/g, ''));
  if (bareInteger && parsed !== 0) return false;
  return true;
}

export type RepairValueBindingResolution =
  | {
      readonly matched: false;
      readonly reason:
        | 'not_bare_value_shape'
        | 'no_missing_effect_values'
        /** A bare number arrived while the product was asking no effect-value question. */
        | 'no_outstanding_ask'
        /** A bare number outside the 0-1 effect scale. Declined, never converted. */
        | 'bare_value_not_model_unit';
    }
  | {
      readonly matched: true;
      readonly kind: 'bind';
      readonly pair: MissingEffectPair;
      readonly valueText: string;
      /** The edit-lane instruction carrying the binding. */
      readonly instruction: string;
    }
  | {
      readonly matched: true;
      readonly kind: 'ask';
      readonly pairs: readonly MissingEffectPair[];
      readonly valueText: string;
    };

/**
 * Resolve the binding verdict for one message against one readiness payload.
 * Pure — the caller owns the graph read, the pendings gate, telemetry and
 * dispatch. Exactly one pair binds; two or more ask; zero declines.
 */
export function resolveRepairValueBinding(params: {
  readonly message: string;
  readonly readiness: AnalysisReadyPayload | null | undefined;
}): RepairValueBindingResolution {
  // ⭐⭐ THE ELLIPTICAL ROUTE — a BARE NUMBER, bound to THE PAIR THE PRODUCT
  // ASKED ABOUT, and to nothing else.
  //
  // WHY THIS DOES NOT GO THROUGH THE SOLE-MISSING-PAIR RULE BELOW, stated as a
  // rule rather than tuned to the witness: the two arms resolve their slot from
  // DIFFERENT AUTHORITIES because they have different antecedents available.
  //   · "Set it to 0.6."  carries a referent whose antecedent is the CONVERSATION,
  //     so with two or more pairs outstanding the referent is genuinely
  //     ambiguous and the product must ASK (trap 22f).
  //   · "0.6"             carries no referent at all. Its ONLY possible
  //     antecedent is the question the product put on screen — `blockers[0]`,
  //     via `deriveAskedEffectPair`, the SAME element
  //     `coaching/readiness-recovery.ts:194,242` composed that question from and
  //     the SAME element `buildReadinessRecoveryChip`'s `provide_value` branch
  //     mints its chip from. So the number binds to the slot the user was
  //     looking at when they typed it, however many other slots are outstanding.
  //
  // ⚠ IT DECLINES RATHER THAN GUESSING IN BOTH DIRECTIONS THAT MATTER: no
  // outstanding effect-value ask ⇒ no antecedent ⇒ no bind; a figure outside the
  // model's own 0-1 effect scale ⇒ no bind and NO CONVERSION (the same refusal
  // `outstanding-ask-clarify.ts` states for `80%` — this estate's writer does not
  // silently rescale a user's number).
  const ellipticalReading = readMissingValueAnswer(params.message);
  if (
    ellipticalReading !== null
    && ellipticalReading.kind === 'numeric'
    && ellipticalReading.elliptical
  ) {
    // ⭐ THE ON-SCREEN READER, NOT THE OUTSTANDING ONE. A bare number's ONLY
    // antecedent is the question the product just rendered, so if the screen is
    // saying "resolve the model issue" there is nothing here to answer.
    const asked = deriveOnScreenEffectAsk(params.readiness);
    if (asked === null) return { matched: false, reason: 'no_outstanding_ask' };
    if (!isModelUnitEffectValueText(ellipticalReading.valueText)) {
      return { matched: false, reason: 'bare_value_not_model_unit' };
    }
    return {
      matched: true,
      kind: 'bind',
      pair: asked,
      valueText: ellipticalReading.valueText,
      instruction: buildRepairBindingInstruction(asked, ellipticalReading.valueText),
    };
  }

  const match = matchBareRepairValue(params.message);
  if (match === null) return { matched: false, reason: 'not_bare_value_shape' };
  const pairs = deriveMissingEffectPairs(params.readiness);
  if (pairs.length === 0) return { matched: false, reason: 'no_missing_effect_values' };
  if (pairs.length === 1) {
    const pair = pairs[0]!;
    return {
      matched: true,
      kind: 'bind',
      pair,
      valueText: match.valueText,
      instruction: buildRepairBindingInstruction(pair, match.valueText),
    };
  }
  return { matched: true, kind: 'ask', pairs, valueText: match.valueText };
}
