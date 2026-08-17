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

export type RepairValueBindingResolution =
  | {
      readonly matched: false;
      readonly reason: 'not_bare_value_shape' | 'no_missing_effect_values';
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
