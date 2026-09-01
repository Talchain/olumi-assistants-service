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
import {
  readMissingValueAnswer,
  toModelUnitText,
  BARE_REFERENTS as BARE_REFERENT_PHRASES,
} from './missing-value-answer.js';

/**
 * The individual WORDS the estate's bare-referent phrases are built from,
 * derived from {@link BARE_REFERENT_PHRASES} rather than re-typed. "the effect
 * value" contributes `the`, `effect`, `value`; a phrase the owner gains is
 * readable here the instant it lands (trap 12).
 */
const BARE_REFERENT_WORDS: readonly string[] = [
  ...new Set(BARE_REFERENT_PHRASES.flatMap(phrase => phrase.toLowerCase().split(/\s+/u))),
];
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  filterLivePendingActions,
  parsePendingAction,
  PENDING_KIND_CLAIMS_BARE_NUMBER,
  type PendingAction,
} from '../session/pending-action.js';

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
  /** The user's value, as typed ("8%", "40,000") — the form to QUOTE, not write. */
  readonly valueText: string;
  /**
   * ⭐ The canonical 0–1 spelling to WRITE, or `null` when the text denotes no
   * plain decimal. See `missing-value-answer.ts::toModelUnitText`.
   */
  readonly modelUnitText: string | null;
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
  return {
    valueText: answer.valueText,
    modelUnitText: answer.modelUnitText,
    referent: answer.referent,
  };
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
function isModelUnitEffectValueText(
  reading: {
    readonly valueText: string;
    readonly modelUnitText: string | null;
  },
  opts: {
    /**
     * ⭐⭐ IS AN ORDINAL READING EVEN POSSIBLE ON THIS TURN? — narrowed from
     * "always" to the one state that can produce the collision.
     *
     * The blanket refusal below cost a real, reachable answer: driven on
     * deployed `f18d941` against a model with ONE outstanding blocker, `"1"` was
     * refused, and the product never told the user that `1.0` would work. `1` is
     * INSIDE the producer's own scale; refusing it is refusing the top of the
     * range.
     *
     * ⚠ AND THE MEASURED COLLISION IS NOT DISMISSED — it is bounded at its
     * source. The ordinal risk comes from THIS lane's own ask arm
     * (`composeRepairValueAskResponse`), which offers numbered pair chips and
     * persists no pending, so a following bare "1" may mean "the first one".
     * That arm fires ONLY when TWO OR MORE pairs are outstanding
     * (`resolveRepairValueBinding` below: `pairs.length === 1` binds, `> 1`
     * asks). So with exactly one pair outstanding no numbered offer can have
     * been made and there is nothing to collide with — which is precisely the
     * case that unlocks the run.
     */
    readonly ordinalCollisionPossible: boolean;
  },
): boolean {
  // ⭐ THE RANGE IS CHECKED ON THE CANONICAL TEXT, THE ORDINAL SHAPE ON THE
  // USER'S — and the split is the whole correctness of the percent reading.
  // "60%" IS a model-unit value (0.6); "60" is not. Checking the range on what
  // the user typed would refuse the first, and checking the ordinal shape on the
  // canonical text would refuse "100%" as an ordinal it cannot be.
  const { valueText, modelUnitText } = reading;
  if (modelUnitText === null) return false;
  const parsed = Number(modelUnitText);
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
  if (opts.ordinalCollisionPossible && bareInteger && parsed !== 0) return false;
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
      /**
       * ⭐ THE CANONICAL 0–1 SPELLING, not the user's token — because every
       * consumer of this field WRITES it (the instruction below, and the ask
       * arm's chip replay message), and the writer's own grammar
       * (`readOptionEffectValue`) declines a thousands separator. ⚠ It now
       * CONVERTS a percent rather than declining it, so the old "8% would not
       * land" reason no longer holds — the canonical spelling stays because the
       * acknowledgement must name the figure that WAS WRITTEN. "8%" is carried
       * here as "0.08", so the user sees the figure that landed.
       */
      readonly valueText: string;
      /** The edit-lane instruction carrying the binding. */
      readonly instruction: string;
    }
  | {
      readonly matched: true;
      readonly kind: 'ask';
      readonly pairs: readonly MissingEffectPair[];
      /** The canonical 0–1 spelling — see the `bind` arm's note. */
      readonly valueText: string;
    };

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐⭐ THE SLOT-AWARE CONTRACT — arithmetic against a KNOWN target, instead of
// pattern-matching an unknown one.
//
// THE DEFECT, measured at `915da5a3` over fifteen ordinary English replies to
// the product's OWN effect-value ask. Five bound; the rest were lost, and the
// mechanism was NOT that the numeric grammar is too narrow:
//
//     "make it 25%"        → binds        "make it 25% please"  → LOST
//     "please make it 25%" → binds        "0.7 please"          → LOST
//     "set it to 0.7"      → binds        "put it at 0.7"       → LOST
//     "use 0.7"            → binds        "try 0.7"             → LOST
//
// A TRAILING "please" is the whole difference in the first pair. The reason is
// `NUMERIC_ANSWER_PATTERNS` in `missing-value-answer.ts`: three `^…$`-anchored
// verb shapes over a closed lexicon (`set|change|update|adjust|put` + `make` +
// `use`), with `put` requiring `to` — so `put it AT 0.7` misses by a
// preposition and `reach`, `go with`, `try` miss by not being listed.
//
// ⚠⚠ THE FIX IS NOT A FIFTH ROUND ON THAT LEXICON. Adding `reach|go with|try`
// and a trailing-politeness tail is exactly the widening that oscillated four
// times on the neighbouring seam (CLAUDE.md trap 22f), and it would still lose
// the sixth phrasing nobody thought of. The lexicon exists ONLY because the
// reader has to infer WHICH SLOT the sentence is about from the sentence
// itself, and a bare verb-less figure gives it nothing to infer from. That
// inference is what needs deleting, not widening.
//
// ⭐ THE STRUCTURAL MOVE. When the product has ASKED — and it has, and the
// `elicit_option_effect` pending records the exact cell — the slot is already
// known. A reader given the slot does not need to parse the sentence for a
// subject at all. It needs only two decidable facts:
//
//   1. does this message name any option or factor OTHER than the asked cell?
//      (decidable against the GRAPH, not against a lexicon)
//   2. is there exactly one quantity in it?
//      (decidable by counting, not by matching a verb)
//
// Neither question is ambiguous, so neither can oscillate. There is NO verb
// list here, no politeness list, and no second numeric grammar: the single
// quantity found is interpreted by {@link isModelUnitEffectValueText}, the same
// range/ordinal owner the elliptical arm already uses.
//
// FAILURE DIRECTION, stated: every unhandled shape DECLINES, which is exactly
// today's behaviour (fall through to the LLM). The contract can therefore only
// convert a loss into a bind or into a named clarification — it cannot convert
// a bind into a wrong write, because rule 1 refuses any sentence naming another
// entity and the caller supplies the slot from the pending's own ids.
// ═══════════════════════════════════════════════════════════════════════════

/** The cell the product asked about, supplied by the caller from the pending. */
export interface KnownEffectSlot {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string;
}

export type SlotBoundAnswer =
  /** A single in-scale figure. `modelUnitText` is the canonical 0–1 spelling. */
  | {
      readonly kind: 'value';
      readonly modelUnitText: string;
      readonly quantityText: string;
      readonly slot: KnownEffectSlot;
    }
  /**
   * A quantity we can NAME but must not WRITE — offered for confirmation with
   * the user's own words preserved. This is the ratified exit for "a third":
   * never silently 0.33, and never the same demand again.
   */
  | {
      readonly kind: 'confirm';
      readonly reason: 'imprecise_quantity' | 'scale_ambiguous';
      readonly suggestedModelUnitText: string;
      readonly heardText: string;
      readonly slot: KnownEffectSlot;
    }
  /** A figure outside the 0–1 effect scale. No mutation, no success receipt. */
  | {
      readonly kind: 'out_of_scale';
      readonly quantityText: string;
      readonly slot: KnownEffectSlot;
    }
  /** Not ours. The caller keeps today's behaviour exactly. */
  | {
      readonly kind: 'declined';
      readonly reason:
        | 'names_other_entity'
        | 'no_quantity'
        | 'several_quantities'
        /**
         * A sign glyph sits beside the figure but is not attached to it, so we
         * cannot tell a minus from a dash used as a separator. DECLINES rather
         * than guessing in either direction. Named apart from
         * `names_other_entity` because they are different facts about the
         * message and a shared name is how the next reader inherits a fiction
         * (trap 21) — both still fall through to today's route unchanged.
         */
        | 'ambiguous_sign';
    };

/**
 * ⭐ THE FRACTION LEXICON — the ONLY word list in this contract, and it is
 * bounded by what it can DO rather than by how well it is written.
 *
 * A member can only ever produce a `confirm`, i.e. one clarifying question
 * offering an explicit figure. It can NEVER produce a write. So a wrong entry
 * costs a turn, not a wrong value — which is why a closed five-word list is
 * acceptable here and a verb lexicon that gates BINDING is not.
 *
 * `a third` is in the set for exactly the reason it must never bind: 1/3 is not
 * expressible as the two-decimal figure the scale wants, so choosing 0.33
 * invents precision the user did not give. Offering 0.33 and asking is honest;
 * writing it is not.
 */
const FRACTION_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:a |one )?half\b/u, '0.5'],
  [/\b(?:a |one )?third\b/u, '0.33'],
  [/\b(?:a |one )?quarter\b/u, '0.25'],
  [/\btwo[ -]thirds\b/u, '0.67'],
  [/\bthree[ -]quarters\b/u, '0.75'],
];

/**
 * ⭐⭐⭐ THE SIGN GLYPHS — read as part of the figure, NEVER erased.
 *
 * ⚠⚠ THIS SET EXISTS BECAUSE THE FIRST VERSION OF THIS CONTRACT SILENTLY WROTE
 * THE POSITIVE. `(?<![\w.])` does not exclude `-`, so `-0.9` matched as `0.9`;
 * the leftover `-` was then erased by `remainderIsAllFiller`'s `[^a-z]+`; and
 * the contract returned `value 0.9` for a message stating minus nine tenths.
 * AT BASE every negative form returned `null` — a safe LOSS. Erasing the sign
 * converted that loss into a WRONG WRITE, in a domain where negative effects
 * are ordinary ("Two Developers" on "Burn rate" is naturally negative), so the
 * product would have recorded the OPPOSITE DIRECTION of what the user said.
 *
 * `−` (U+2212), `–` (U+2013) and `—` (U+2014) are here beside plain `-`
 * because word processors and phone keyboards substitute them for a typed
 * hyphen. A glyph absent from this set is not a silent positive: it is an
 * unknown character, and {@link remainderIsAllFiller} declines on those.
 */
const NEGATIVE_SIGN_GLYPHS: ReadonlySet<string> = new Set([
  '-', '−', '–', '—',
]);

/** Every glyph that may denote a sign, negative or otherwise. */
const SIGN_GLYPH_CLASS = '-+\\u00B1\\u2212\\u2013\\u2014';

/**
 * Any sign glyph, anywhere — used to keep them out of the filler collapse.
 *
 * ⚠ TWO REGEXES, ON PURPOSE. A `g`-flagged regex carries `lastIndex` ACROSS
 * `.test()` calls, so a shared instance would return `false` on every other
 * call and the answer would depend on how many times it had been asked before.
 * The replace form needs `g`; the predicate form must not have it.
 */
const SIGN_GLYPH_REPLACE_RE = new RegExp(`[${SIGN_GLYPH_CLASS}]`, 'gu');
const SIGN_GLYPH_TEST_RE = new RegExp(`[${SIGN_GLYPH_CLASS}]`, 'u');

/**
 * ⭐ A SIGN WORD, and it is REFUSE-ONLY BY CONSTRUCTION — the same
 * bounded-by-what-it-can-DO argument {@link FRACTION_WORDS} rests on.
 *
 * `minus` and `negative` can only ever push a figure BELOW zero, i.e. outside
 * the consumer's `[0,1]` interval, so a member of this pair can never enable a
 * write — only a refusal. `plus`/`positive` are deliberately ABSENT: admitting
 * them would mean a word list that ENABLES a write, which is the polarity this
 * module refuses. They decline as unknown tokens instead, which costs a
 * fall-through to today's route and never a value.
 *
 * The capture keeps the trailing whitespace so the caller knows exactly how
 * many characters the sign word consumed.
 */
const SIGN_WORD_TAIL = /(?:^|[^a-z])((?:minus|negative)\s*)$/iu;

/**
 * Every quantity in the message, as written, WITH ITS SIGN and its percent
 * marker if any. A COUNT, not a choice: two matches mean the contract asks
 * rather than picks.
 *
 * ⚠ THE SIGN IS ONLY READ WHEN IT IS ATTACHED (no space). A DETACHED `-` is
 * genuinely ambiguous between a minus and a dash used as a separator
 * ("Development throughput - 0.9"), and this contract does not guess: an
 * unattached glyph survives into {@link remainderIsAllFiller} as an unknown
 * token and DECLINES. Both readings are safe; neither is a wrong write.
 */
const QUANTITY_SCAN = new RegExp(
  `(?<![\\w.])(?<sign>[${SIGN_GLYPH_CLASS}])?(?<digits>\\d+(?:,\\d{3})*(?:\\.\\d+)?)`
  + `\\s*(?<percent>%|percent|per cent)?`,
  'giu',
);

/**
 * ⭐⭐⭐ WHAT MAY SURROUND THE NUMBER — an ALLOWLIST, and the direction is the
 * entire safety argument.
 *
 * ⚠⚠ IT EXISTS BECAUSE THE GRAPH-LABEL GUARD ALONE SHIPPED A WRONG-ENTITY
 * WRITE, caught by an existing spec before merge:
 *
 *     "Set Some other factor to 0.9"  →  BIND (0.9 onto the asked cell)
 *
 * The user NAMED a target. `namesForeignEntity` could not see it, because
 * "Some other factor" is not a node in the graph — and a guard that only knows
 * the entities that EXIST is blind to the ones a user invents. This is the
 * `ANSWERED_ASK_RESOLVED_LIMIT` residual that `option-effect-write.ts` records
 * for its own rule 3c, reached from the other side.
 *
 * ⭐ THE RULE, and why it is not a fifth round of trap 22f. The lexicon that
 * oscillated was an ACCEPTANCE list of verbs: a phrasing missing from it was
 * silently LOST, so every round added more and the widening never converged.
 * This is the opposite polarity — a list of words that may appear ALONGSIDE the
 * figure, where anything unknown DECLINES. A word missing from this set costs a
 * fall-through to today's behaviour; it can never cost a write. The same
 * "one unknown word and the whole reading declines, no partial credit and no
 * cliff" shape `missing-value-answer.ts` already ratified for its hedges.
 *
 * So a NOUN the product does not recognise — "factor", "revenue", "headcount",
 * "Some other factor" — always declines, whether or not it names a real node.
 *
 * DERIVED, NOT RETYPED: the referent half comes from {@link BARE_REFERENTS},
 * the estate's owner of "words that point at the thing being set rather than
 * naming a new one". A second spelling of those would drift (trap 12).
 */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  // The referent vocabulary, derived from the owner rather than re-typed.
  ...BARE_REFERENT_WORDS,
  // Affirmative lead + politeness, mirroring `AFFIRMATIVE_LEAD`'s own set.
  'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'please', 'thanks', 'thank',
  'cheers', 'ta',
  // Setting verbs and their auxiliaries. Membership here only ever ADMITS a
  // message that contains nothing else, so breadth is cheap and safety is not
  // bought by keeping it short.
  'set', 'change', 'update', 'adjust', 'put', 'make', 'made', 'use', 'using',
  'try', 'go', 'goes', 'going', 'went', 'reach', 'reaches', 'keep', 'leave',
  'be', 'is', 'was', 'get', 'gets', 'give', 'gives', 'take', 'takes', 'have',
  'has', 'do', 'does', 'let', 'lets', 'call', 'say', 'says', 'think', 'thinks',
  'reckon', 'guess', 'want', 'need', 'like', 'prefer', 'stick', 'move',
  // Modals and contractions (apostrophes are stripped before lookup).
  'should', 'would', 'could', 'will', 'shall', 'can', 'may', 'might', 'must',
  'id', 'ill', 'im', 'ive', 'well', 'wed', 'youd', 'theyd', 'lets',
  // Pronouns and determiners.
  'i', 'we', 'you', 'they', 'them', 'there', 'a', 'an', 'one', 'about',
  // Prepositions and connectives.
  'to', 'at', 'on', 'of', 'for', 'with', 'by', 'in', 'into', 'as', 'and',
  'or', 'but', 'than', 'then', 'up', 'down', 'over', 'under', 'just',
  // Hedges, mirroring the hedge sets in `missing-value-answer.ts`.
  'approximately', 'approx', 'roughly', 'around', 'maybe', 'perhaps',
  'possibly', 'probably', 'ish', 'so', 'thereabouts', 'sounds', 'seems',
  'feels', 'looks', 'right', 'makes', 'sense', 'good', 'fine', 'nearer',
  'near', 'close', 'circa', 'say',
]);

/**
 * Is everything the message contains APART from the figure ordinary filler?
 *
 * FAILS TOWARD DECLINE by construction: an unknown token returns false, and a
 * false here means the contract does not claim the message at all.
 */
function remainderIsAllFiller(
  message: string,
  quantityText: string,
  slot?: KnownEffectSlot,
): boolean {
  // ⭐ THE ASKED CELL'S OWN LABELS ARE KNOWN-GOOD CONTEXT, not unknown nouns.
  // "Two Developers on Development throughput should be 0.7" names exactly the
  // pair we asked about, so it is the CLEAREST possible answer and must bind.
  // They are removed BEFORE the filler test because they are, by construction,
  // the one target this contract is entitled to write to; `namesForeignEntity`
  // has already refused any message naming a different one.
  const known = slot === undefined ? '' : message.toLowerCase()
    .replace(normaliseLabel(slot.optionLabel), ' ')
    .replace(normaliseLabel(slot.factorLabel), ' ');
  const withoutQuantity = (slot === undefined ? message.toLowerCase() : known)
    // Drop the figure the caller already read, plus any percent marker.
    .replace(quantityText.toLowerCase(), ' ')
    .replace(/\b(?:percent|per cent)\b/gu, ' ')
    // Apostrophes are part of the word ("i'd", "it's"), not separators.
    .replace(/['’]/gu, '')
    // ⭐⭐ A SIGN IS NOT PUNCTUATION, AND `[^a-z]+` BELOW CANNOT TELL THE
    // DIFFERENCE. Any sign glyph the scan did NOT attach to the figure would
    // otherwise vanish here and the message would read as ordinary filler —
    // which is precisely how `-0.9` came to bind as `0.9`. Mapped to a token
    // that is deliberately NOT in the allowlist, so an unattached sign
    // DECLINES: the module's own polarity, and the safe direction, because a
    // detached glyph is genuinely ambiguous between a minus and a separator.
    .replace(SIGN_GLYPH_REPLACE_RE, ' signglyph ')
    .replace(/[^a-z]+/gu, ' ')
    .trim();
  if (withoutQuantity.length === 0) return true;
  return withoutQuantity.split(/\s+/u).every(word => word.length === 0 || FILLER_WORDS.has(word));
}

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Does `message` name an option or factor that is NOT the asked cell?
 *
 * ⚠ THIS IS THE SAFETY GATE THAT MAKES ADMITTING CONTEXT SAFE, and it is the
 * conjunct rule 3c in `option-effect-write.ts` applies for the same purpose. It
 * is re-derived here rather than imported because that module's copy is
 * unexported AND unreachable for this case: `resolveOptionEffectWrite` declines
 * on `no_single_unit_scale_value` before rule 3c runs whenever the message
 * carries no readable figure, which is precisely the population this contract
 * exists for. Exporting it would mean editing a file outside this lane's
 * declared ownership; the duplication is named here so it can be folded when
 * both seams are owned together.
 *
 * FAILS TOWARD DECLINE: a label that matches spuriously costs a fall-through to
 * today's behaviour, never a write to the wrong cell.
 */
function namesForeignEntity(
  message: string,
  slot: KnownEffectSlot,
  graph: { readonly nodes?: unknown } | null | undefined,
): boolean {
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes)) return false;
  const padded = ` ${normaliseLabel(message)} `;
  for (const raw of nodes as readonly unknown[]) {
    if (raw === null || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    if (node.kind !== 'option' && node.kind !== 'factor') continue;
    if (node.id === slot.optionId || node.id === slot.factorId) continue;
    if (typeof node.label !== 'string') continue;
    const label = normaliseLabel(node.label);
    // Three characters is `matchLabels`' own floor: shorter labels collide with
    // ordinary words and would decline every sentence containing one.
    if (label.length < 3) continue;
    if (padded.includes(` ${label} `) || padded.includes(` ${label}'s `)) return true;
  }
  return false;
}

/**
 * ⭐⭐ INTERPRET ONE MESSAGE AGAINST ONE KNOWN SLOT.
 *
 * RECEIVES the user's message, the cell the product asked about, and the graph
 * the ask was recorded against.
 * RETURNS a written value, a figure to confirm, an out-of-scale refusal, or a
 * decline.
 * REFUSES, always: any message naming another option or factor; any message
 * carrying more than one figure; any figure outside 0–1; any bare integer whose
 * scale is ambiguous; and every fraction word, which is offered and never
 * written.
 *
 * ⭐⭐⭐ THE ONE INVARIANT THIS FUNCTION IS JUDGED BY, written against the
 * CONSUMER'S SPEC rather than against any failure mode:
 *
 *   For every message, if the verdict is `kind: 'value'`, then
 *   `Number(modelUnitText)` EQUALS the signed value the message states, and
 *   lies within the closed interval [0, 1].
 *
 * That interval is the consumer's actual gate and it is SIGN-SYMMETRIC, so the
 * invariant subsumes the sign question rather than treating it as a case: a
 * stated negative is never a write, because no negative is in [0, 1]. Pinned
 * over a corpus in `__tests__/slot-bound-effect-answer.test.ts`, whose
 * expectations are computed from the message rather than listed beside it.
 *
 * PURE. No graph mutation, no I/O, no clock.
 */
export function resolveAnswerForKnownSlot(params: {
  readonly message: string;
  readonly slot: KnownEffectSlot;
  readonly graph: { readonly nodes?: unknown } | null | undefined;
}): SlotBoundAnswer {
  const { message, slot } = params;
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { kind: 'declined', reason: 'no_quantity' };
  }
  // RULE 1 — a foreign subject is refused before anything is read from it.
  if (namesForeignEntity(message, slot, params.graph)) {
    return { kind: 'declined', reason: 'names_other_entity' };
  }

  // RULE 2 — exactly one quantity, counted rather than matched.
  QUANTITY_SCAN.lastIndex = 0;
  const quantities = [...message.matchAll(QUANTITY_SCAN)];
  if (quantities.length > 1) return { kind: 'declined', reason: 'several_quantities' };

  if (quantities.length === 0) {
    // No digits. A fraction word is a quantity we can NAME but never WRITE.
    const lower = ` ${normaliseLabel(message)} `;
    for (const [pattern, suggested] of FRACTION_WORDS) {
      const hit = pattern.exec(lower);
      if (hit !== null) {
        // Same rule on this branch: "raise the burn rate by a third" names a
        // target and must not be offered against the asked cell.
        if (!remainderIsAllFiller(message, hit[0]!, slot)) {
          return { kind: 'declined', reason: 'names_other_entity' };
        }
        return {
          kind: 'confirm',
          reason: 'imprecise_quantity',
          suggestedModelUnitText: suggested,
          heardText: hit[0].trim(),
          slot,
        };
      }
    }
    return { kind: 'declined', reason: 'no_quantity' };
  }

  const found = quantities[0]!;
  const digits = found.groups!['digits']!;
  const percentMarker = found.groups!['percent'];
  const isPercent = percentMarker !== undefined;

  // ⭐⭐⭐ THE SIGN, READ RATHER THAN ERASED — glyph first, then the refuse-only
  // word pair. `found.index` points at the sign glyph when one was attached, so
  // `before` is everything the scan did not consume to the left of the figure.
  const glyphSign = found.groups!['sign'];
  const before = message.slice(0, found.index);
  const wordSign = glyphSign === undefined ? SIGN_WORD_TAIL.exec(before) : null;
  const negative = glyphSign !== undefined
    ? NEGATIVE_SIGN_GLYPHS.has(glyphSign)
    : wordSign !== null;
  // What the figure CONSUMED, so a recognised sign word is not then met as an
  // unknown noun by the filler test.
  const consumed = wordSign === null
    ? found[0]!
    : message.slice(found.index - wordSign[1]!.length, found.index + found[0]!.length);
  // The user's own bytes, quoted back in every refusal. A refusal that quoted
  // `0.9` at someone who wrote `-0.9` would be the sign erasure one seam later.
  const signText = glyphSign ?? (wordSign === null ? '' : wordSign[1]!);
  const quantityText = `${signText}${digits}${isPercent ? percentMarker : ''}`;

  // ⭐ EVERYTHING ELSE IN THE MESSAGE MUST BE FILLER. An unrecognised noun means
  // the user may have named a target we cannot verify — "Set Some other factor
  // to 0.9" is not an answer to a question about a DIFFERENT cell, and binding
  // it would be the wrong-entity write this contract exists to make unreachable.
  if (!remainderIsAllFiller(message, consumed, slot)) {
    // A sign glyph the scan could not attach is its OWN honest verdict, not a
    // claim that the user named another entity. Same fall-through either way;
    // saying which is which is what stops the next reader inheriting a fiction.
    return {
      kind: 'declined',
      reason: SIGN_GLYPH_TEST_RE.test(message.replace(consumed, ' '))
        ? 'ambiguous_sign'
        : 'names_other_entity',
    };
  }
  // ⭐ `±` IS AN INTERVAL, NOT A FIGURE, and it is the reason this test is a
  // membership check rather than `glyph !== '-'`. Only `+` asserts a positive
  // value; every other glyph either asserts a negative (refused by the interval
  // below) or asserts nothing definite, and picking one end of "plus or minus
  // nine tenths" would be the sign erasure wearing a different glyph.
  if (glyphSign !== undefined
    && glyphSign !== '+'
    && !NEGATIVE_SIGN_GLYPHS.has(glyphSign)) {
    return { kind: 'declined', reason: 'ambiguous_sign' };
  }
  // ⭐ THE CANONICAL SPELLING COMES FROM THE ONE OWNER, never re-derived here.
  // It is the MAGNITUDE: `toModelUnitText` is the estate's shared reader and
  // takes unsigned digits, so the sign is applied here rather than smuggled
  // into a module four other consumers depend on.
  const modelUnitText = toModelUnitText(digits, isPercent);
  if (modelUnitText === null) return { kind: 'declined', reason: 'no_quantity' };

  const magnitude = Number(modelUnitText);
  if (!Number.isFinite(magnitude)) return { kind: 'declined', reason: 'no_quantity' };

  /**
   * ⭐⭐⭐ THE SPEC INVARIANT, IN ONE LINE OF CODE.
   *
   * The consumer's gate is the closed interval [0, 1], which is SIGN-SYMMETRIC.
   * So the obligation is NOT "handle a leading minus" — that would be an
   * invariant written against the failure mode in hand, and the next asymmetry
   * would reproduce the defect (CLAUDE.md trap 13d). It is:
   *
   *   IF this function returns `kind: 'value'`, THEN Number(modelUnitText)
   *   EQUALS the signed value the message states, AND lies within [0, 1].
   *
   * Every gate below reads `stated`, never `magnitude`. A negative can then
   * never be a write — not because minus is special-cased, but because no
   * negative is inside [0, 1] — and the same sentence covers `-0.9`, `−90%`,
   * `minus 0.9` and any sign spelling added later.
   */
  const stated = negative ? -magnitude : magnitude;

  // ⭐ THE RATIFIED SCALE CLIFF, HONOURED RATHER THAN RE-LITIGATED, AND IT IS
  // TESTED BEFORE THE RANGE — the order is load-bearing. A bare integer is
  // ambiguous between `25` and `25%`, a hundredfold difference with nothing in
  // the message to decide it (`missing-value-answer.ts`'s human/internal
  // boundary ruling). Range-checking first would refuse `25` as "out of scale"
  // and tell the user their perfectly ordinary answer was off the scale, when
  // the truth is that we cannot tell WHICH scale they used. It is OFFERED,
  // never chosen. `0` is excluded: it means the same on either scale.
  const bareInteger = !isPercent && /^\d+$/u.test(digits.replace(/,/gu, ''));
  if (bareInteger && stated !== 0) {
    const asPercent = toModelUnitText(digits, true);
    const asPercentMagnitude = asPercent === null ? Number.NaN : Number(asPercent);
    // ⭐ THE SIGN TRAVELS WITH BOTH READINGS. `-25` is not "25 or 25%": both
    // readings are negative, so neither is inside the interval and there is
    // nothing to disambiguate. Offering `0.25` here would be the sign erasure
    // returning through the confirm door.
    const asPercentValue = negative ? -asPercentMagnitude : asPercentMagnitude;
    // Only ambiguous if the percentage reading is itself usable — a bare `150`
    // is not "25 or 25%", it is off the scale on both readings.
    if (Number.isFinite(asPercentValue) && asPercentValue >= 0 && asPercentValue <= 1) {
      return {
        kind: 'confirm',
        reason: 'scale_ambiguous',
        suggestedModelUnitText: asPercent!,
        heardText: quantityText,
        slot,
      };
    }
    return { kind: 'out_of_scale', quantityText, slot };
  }

  if (stated < 0 || stated > 1) {
    return { kind: 'out_of_scale', quantityText, slot };
  }

  return { kind: 'value', modelUnitText, quantityText, slot };
}

/** Server-only binding to a recorded question, never an ingress instruction. */
export interface RecordedEffectAnswer {
  readonly pending: PendingAction;
  readonly priorPendingActions: readonly PendingAction[];
  readonly pair: MissingEffectPair;
  readonly valueText: string;
  readonly instruction: string;
}

export type RecordedEffectAnswerResolution =
  | { readonly kind: 'unrelated' | 'unrecorded' | 'other_question' | 'unavailable' | 'stale' | 'ambiguous' }
  | { readonly kind: 'ask'; readonly pair: MissingEffectPair }
  | {
      /**
       * ⭐ THE HONEST EXIT — we read a quantity we are not entitled to WRITE, so
       * we name it and ask ONE discriminating question. Distinct from `ask`
       * because it carries a figure to confirm: `ask` says "that value will not
       * do", this says "did you mean 0.25?". The difference is the whole
       * distance between re-issuing a demand and advancing the exchange.
       */
      readonly kind: 'confirm';
      readonly pair: MissingEffectPair;
      readonly suggestedModelUnitText: string;
      readonly heardText: string;
      readonly reason: 'imprecise_quantity' | 'scale_ambiguous';
      /**
       * ⭐⭐ THE ATTEMPT NUMBER OF THE ASK WE ARE ABOUT TO EMIT — i.e. the
       * recorded ask's own count PLUS ONE, because emitting this re-ask IS the
       * next attempt.
       *
       * ⚠⚠ IT USED TO BE THE PRIOR ROW'S COUNT, AND THAT MADE THE WHOLE
       * COUNTER DARK. The route's confirm exit commits with `pending_actions:
       * []` and carries the prior row forward VERBATIM, so the stored `attempt`
       * never moved: every re-ask composed at 1, the attempt-2 copy was
       * unreachable in production, and two identical unreadable replies
       * produced BYTE-IDENTICAL re-asks — the exact defect this lane exists to
       * close, surviving inside its own fix. The route now writes {@link
       * pending} back with this number, so the count advances turn over turn.
       */
      readonly attempt: number;
      /**
       * The recorded ask being answered, so the caller can carry it forward
       * with the advanced count WITHOUT re-stamping its lifetime.
       *
       * ⚠ IT IS HANDED BACK RATHER THAN RE-EMITTED FOR A REASON:
       * `applyRecordedAskLifetimes` re-stamps THIS TURN'S OWN pendings, and
       * `computeSurvivingPriorPendingsDetailed`'s own note says re-stamping a
       * SURVIVOR "would reset that decrement every turn and make the ask
       * immortal". So the route must mutate the row IN THE CARRY-FORWARD LIST,
       * never move it into `pending_actions`.
       */
      readonly pending: PendingAction;
    }
  | { readonly kind: 'bind'; readonly answer: RecordedEffectAnswer };

/**
 * ⭐⭐ THE ADMISSION GATE — "should we CONSULT the record?", never "what does
 * this message mean?".
 *
 * ⚠⚠ IT EXISTS BECAUSE THE OLD GATE CONFLATED THOSE TWO QUESTIONS, AND THAT
 * CONFLATION IS THE DEFECT THIS LANE CLOSES. At `915da5a3` the pending set was
 * loaded ONLY when `readMissingValueAnswer(message) !== null` — a context-free
 * text predicate. So the record that names the asked cell was fetched only for
 * the replies that did not need it, and withheld from exactly the replies whose
 * only antecedent it was. `make it 0.8 please` read null, the pending was never
 * loaded, and the turn fell through to the LLM, which asked again.
 *
 * ⭐ WHY THIS PREDICATE IS SAFE WHERE THAT ONE WAS NOT — it is about POWER, not
 * about being better written. This predicate cannot bind, cannot choose a slot
 * and cannot write: its entire authority is whether to read a row. Failing OPEN
 * costs one read and then a decline; failing CLOSED costs exactly today's
 * behaviour. A binding predicate's failures cost a wrong value on a real graph.
 * That is why widening THIS is not a fifth round of trap 22f, and why widening
 * the verb lexicon would have been.
 *
 * Deliberately crude: a digit, or one of the fraction words the contract can
 * offer. Anything else keeps today's route byte-identical.
 */
export function messagePlausiblyCarriesQuantity(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (/\d/u.test(message)) return true;
  const padded = ` ${message.toLowerCase().replace(/\s+/gu, ' ').trim()} `;
  return FRACTION_WORDS.some(([pattern]) => pattern.test(padded));
}

/** Which recorded cell does this answer belong to? This is not a number parser. */
export function resolveRecordedOptionEffectAnswer(params: {
  readonly message: string;
  readonly pendings: readonly PendingAction[] | null;
  readonly graph: GraphStateIngress | null;
  readonly readiness: AnalysisReadyPayload | null | undefined;
  readonly scenarioId: string;
  readonly nowMs: number;
}): RecordedEffectAnswerResolution {
  const reading = readMissingValueAnswer(params.message);
  // ⭐ THE CONTEXT-FREE READING IS NO LONGER THE ADMISSION TEST — it is now just
  // ARM 1. A message it cannot read may still be an answer to a question we
  // ASKED, and the pending knows which. What gates entry is
  // {@link messagePlausiblyCarriesQuantity}, which can only decide whether to
  // consult the record, never what the record means.
  const contextFreeNumeric = reading?.kind === 'numeric' && reading.leadingContext === '';
  if (!contextFreeNumeric && !messagePlausiblyCarriesQuantity(params.message)) {
    return { kind: 'unrelated' };
  }
  // ⭐⭐ THE WIDENING IS ADDITIVE BY CONSTRUCTION — it may add a BIND or a
  // CONFIRM, and it may NEVER add a refusal.
  //
  // ⚠ THIS GUARD EXISTS BECAUSE THE WIDENED GATE WOULD OTHERWISE HAVE
  // REGRESSED THE ROUTE, and the regression is not obvious from the diff.
  // `stale` / `ambiguous` / `unavailable` are TERMINAL exits at `route-v2.ts`:
  // they emit "I cannot safely match that answer to the previous question" and
  // return. Before this lane they could only fire for a message the
  // context-free grammar had already read as a number. Admitting every message
  // containing a DIGIT would have let them fire on "add factor Q3 revenue" or
  // "run analysis 2" whenever an expired effect ask happened to be lying
  // around — hijacking an unrelated turn with a refusal about a question the
  // user was not answering.
  //
  // So a message admitted ONLY by the new gate is held to a stricter rule: it
  // may reach the slot-aware arm, but every non-answer outcome collapses to
  // `unrelated`, which is byte-identical to today's route. The blast radius of
  // the widening is therefore exactly "more answers bind", by construction
  // rather than by inspection.
  const additiveOnly = !contextFreeNumeric;
  const conservative = (
    verdict: RecordedEffectAnswerResolution,
  ): RecordedEffectAnswerResolution => (
    additiveOnly && verdict.kind !== 'bind' && verdict.kind !== 'confirm'
      ? { kind: 'unrelated' }
      : verdict
  );

  if (params.pendings === null || params.pendings.some(
    (pa) => parsePendingAction(pa) === null || pa.scenario_id !== params.scenarioId,
  )) return conservative({ kind: 'unavailable' });

  const claimants = filterLivePendingActions(params.pendings, params.nowMs).filter(
    (pa) => PENDING_KIND_CLAIMS_BARE_NUMBER[pa.action.kind],
  );
  if (claimants.length > 1) return conservative({ kind: 'ambiguous' });
  const pending = claimants[0];
  if (pending === undefined) {
    // A known expired question cannot be reconstructed from today's blocker order.
    return conservative({ kind: params.pendings.some(pa => pa.action.kind === 'elicit_option_effect')
      ? 'stale' : 'unrecorded' });
  }
  if (pending.action.kind !== 'elicit_option_effect') return conservative({ kind: 'other_question' });
  const asked = pending.action;
  const graph = params.graph;
  if (graph === null) return conservative({ kind: 'unavailable' });
  try {
    if (!pending.preconditions.graph_hash
      || pending.preconditions.graph_hash !== computeAnalysisAffectingGraphHash(graph)) {
      return conservative({ kind: 'stale' });
    }
  } catch { return conservative({ kind: 'unavailable' }); }
  const options = graph.nodes.filter(node => node.id === asked.option_id);
  const factors = graph.nodes.filter(node => node.id === asked.factor_id);
  if (options.length !== 1 || factors.length !== 1
    || options[0]!.kind !== 'option' || factors[0]!.kind !== 'factor') return conservative({ kind: 'stale' });
  const pair = deriveMissingEffectPairs(params.readiness).find(
    p => p.optionId === asked.option_id && p.factorId === asked.factor_id,
  );
  if (pair === undefined) return conservative({ kind: 'stale' });

  // ── ARM 1 — the context-free reading, UNCHANGED. Anything that bound at
  // `915da5a3` binds identically here, by the same predicate, to the same cell.
  if (contextFreeNumeric) {
    // The sole recorded question disambiguates 0/1; it never turns bare 20 into 20%.
    if (!isModelUnitEffectValueText(reading, { ordinalCollisionPossible: false })) {
      return { kind: 'ask', pair };
    }
    const valueText = reading.modelUnitText!;
    return { kind: 'bind', answer: {
      pending, priorPendingActions: params.pendings, pair, valueText,
      instruction: buildRepairBindingInstruction(pair, valueText),
    } };
  }

  // ── ARM 2 — THE SLOT IS THE ANTECEDENT. Reached only when the sentence
  // cannot be its own antecedent, which is precisely when the question we asked
  // is the only thing that can supply one.
  //
  // ⚠ THE SLOT COMES FROM `asked` (the PENDING's own ids), never from the
  // sentence, and `pair` is the readiness-derived record for those same ids —
  // so a wrong-entity write is not merely unlikely here, it is unreachable:
  // there is no code path on which a label parsed out of the user's prose
  // becomes a write target.
  const slotted = resolveAnswerForKnownSlot({
    message: params.message,
    slot: {
      optionId: asked.option_id,
      optionLabel: asked.option_label,
      factorId: asked.factor_id,
      factorLabel: asked.factor_label,
    },
    graph,
  });
  switch (slotted.kind) {
    case 'value': {
      const valueText = slotted.modelUnitText;
      return { kind: 'bind', answer: {
        pending, priorPendingActions: params.pendings, pair, valueText,
        instruction: buildRepairBindingInstruction(pair, valueText),
      } };
    }
    case 'confirm':
      return {
        kind: 'confirm', pair,
        suggestedModelUnitText: slotted.suggestedModelUnitText,
        heardText: slotted.heardText,
        reason: slotted.reason,
        // ⭐ PLUS ONE — emitting this re-ask IS the next attempt. A row written
        // before this field existed reads as attempt 1, so its re-ask is 2.
        attempt: (typeof asked.attempt === 'number' && Number.isFinite(asked.attempt)
          ? Math.floor(asked.attempt)
          : 1) + 1,
        pending,
      };
    case 'out_of_scale':
      // Same exit as arm 1's refused value: named, never converted, never
      // written, and no success receipt. Under `additiveOnly` this collapses to
      // `unrelated` rather than emitting a refusal the old gate would not have
      // emitted — a figure outside 0-1 in a context-bearing sentence is as
      // likely to be "add 5000 customers" as an answer to this ask.
      return conservative({ kind: 'ask', pair });
    case 'declined':
    default:
      // Names another entity, several figures, or no figure at all. Not ours —
      // today's route, unchanged.
      return { kind: 'unrelated' };
  }
}

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
    if (
      !isModelUnitEffectValueText(ellipticalReading, {
        // The ask arm below offers numbered chips only with two or more pairs
        // outstanding, so that is exactly when a bare integer is ambiguous.
        ordinalCollisionPossible: deriveMissingEffectPairs(params.readiness).length > 1,
      })
    ) {
      return { matched: false, reason: 'bare_value_not_model_unit' };
    }
    const modelUnitText = ellipticalReading.modelUnitText!;
    return {
      matched: true,
      kind: 'bind',
      pair: asked,
      valueText: modelUnitText,
      instruction: buildRepairBindingInstruction(asked, modelUnitText),
    };
  }

  const match = matchBareRepairValue(params.message);
  if (match === null) return { matched: false, reason: 'not_bare_value_shape' };
  // ⭐ THE CANONICAL SPELLING, OR NOTHING. `null` means the text denotes no
  // plain decimal, and a writer fed such a text would decline it two seams
  // later with nothing on screen to explain why.
  const written = match.modelUnitText;
  if (written === null) return { matched: false, reason: 'not_bare_value_shape' };
  // ⭐⭐ THE RANGE GUARD, ON THIS ARM TOO — AND ITS ABSENCE WAS A LIVE
  // FABRICATION HOLE, measured at this tip before the fix:
  //
  //     resolveRepairValueBinding({ message: 'Set it to 40000.' })
  //       → { matched: true, kind: 'bind', valueText: '40000' }
  //     'Set it to 40,000.' → bind  ·  'Make it 500.' → bind  ·  'Use 1200.' → bind
  //
  // i.e. a USER-SCALE figure bound as a 0–1 effect value, on the verb-bearing
  // path, while the elliptical path one branch up refused the identical number.
  // ⚠ ONE PREDICATE ANSWERING ONE QUESTION APPLIED TO BOTH ARMS, never a second
  // spelling (trap 21 — and here the two arms were not two questions, they were
  // one question asked in one place and not the other).
  //
  // ⚠ THE ORDINAL CONJUNCT IS OFF HERE, and that is a real distinction rather
  // than a convenience: this arm requires a VERB and a closed referent ("set it
  // to 1"), which no ordinal selection carries. The ambiguity the guard exists
  // for is a NAKED integer, which is the elliptical arm's shape.
  if (!isModelUnitEffectValueText(
    { valueText: match.valueText, modelUnitText: written },
    { ordinalCollisionPossible: false },
  )) {
    return { matched: false, reason: 'bare_value_not_model_unit' };
  }
  const pairs = deriveMissingEffectPairs(params.readiness);
  if (pairs.length === 0) return { matched: false, reason: 'no_missing_effect_values' };
  if (pairs.length === 1) {
    const pair = pairs[0]!;
    return {
      matched: true,
      kind: 'bind',
      pair,
      valueText: written,
      instruction: buildRepairBindingInstruction(pair, written),
    };
  }
  return { matched: true, kind: 'ask', pairs, valueText: written };
}
