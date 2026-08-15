/**
 * THE GROUNDED COUNTER-CASE — Lane C, the post-analysis scientific reasoning
 * loop (DSK-P-003 disconfirmation / "consider the opposite").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES.
 *
 * `consider_opposite` ships today as `phase3-blocks.ts`'s
 * `CONSIDER_OPPOSITE_COUNTER_CASE` — a fixed string whose own header describes
 * it as "fixed copy, no transport, no producer-content dependency". That is an
 * accurate description of A TEMPLATE: it is byte-identical on every decision
 * this product has ever analysed. The science it cites is real and the sentence
 * is well written, and neither fact makes it an intervention — a prompt that
 * cannot vary with the model it is asked about spends the user's trust and
 * returns nothing they could not have written themselves.
 *
 * This module supplies the missing half: WHICH relationship this particular run
 * says is worth arguing against. The exercise then names a mechanism the team
 * can actually dispute, and two different decisions produce two different
 * exercises.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠ THE QUESTION THIS ANSWERS IS NOT `selectFragileEdge`'s QUESTION ────────
 * `coaching/select-fragile-edge.ts` exists, is reviewed, and reads the same
 * array. It is deliberately NOT reused here, and the reason is CLAUDE.md trap
 * 21 (two authorities under similar names answering different questions):
 *
 *   `selectFragileEdge`  →  "which edge may we OFFER TO ADJUST?"
 *   this module          →  "which relationship should the team ARGUE AGAINST?"
 *
 * The first must clear an `edge_e_values` join, a non-degenerate 10-seed
 * stability band, and a `flip_mean` inside the settable strength domain —
 * because its answer ends in a graph MUTATION, and an offer with no applicable
 * target is an inert chip. None of those gates bear on a DISCONFIRMATION
 * EXERCISE, which mutates nothing and needs only a relationship a human can
 * name and dispute. Reusing the action-gated selector would silently withhold
 * the exercise on every run whose head edge is real but not mechanically
 * adjustable — a refusal imported from a question nobody asked.
 *
 * Kept apart, deliberately, rather than "unified": aligning them would be
 * exactly the reconciliation trap 21 warns against.
 *
 * ── ORDER IS THE PRODUCER'S. WE DO NOT MANUFACTURE IMPORTANCE ────────────────
 * `robustness.fragile_edges` arrives sorted by `switch_probability` DESCENDING
 * (verified on both committed live captures: 0.1900 → 0.0516 and 0.3172 →
 * 0.1836). This module CONSUMES the head of that order. It never re-sorts and
 * never compares probabilities itself: re-ranking here would be a second
 * opinion about importance computed from a subset of the producer's inputs.
 *
 * ── ⭐ WHAT THE PROSE MAY CLAIM, AND THE CLAIM IT CAREFULLY DOES NOT MAKE ────
 * DSK-TR-003 fires `consider_opposite` on a DECISIVE, attested-NON-FRAGILE
 * leader, and DSK-P-003's own contraindications forbid running it "when the
 * analysis shows a close call". So on the runs where this exercise ships, the
 * head fragile edge is the most sensitive relationship in a result that is NOT
 * considered fragile overall — its `switch_probability` can be modest.
 *
 * The copy therefore says the link is the one the robustness check found MOST
 * SENSITIVE — a true superlative over the producer's own ordering — and NEVER
 * that it is "likely to" overturn anything. That would import a probability
 * claim the run does not support, on precisely the runs this lens selects.
 * A superlative over a set is not a statement about a magnitude.
 *
 * ── WHAT IS READ AS A STRUCTURED GATE AND NEVER SURFACED ────────────────────
 * `switch_probability` is read for NOTHING here — not even ordering (the
 * producer already ordered). `alternative_winner_label` is likewise NOT read:
 * naming the option that would take the lead is a LEADING-OPTION CLAIM, and
 * that permission belongs to the canonical `readMayNameLeadingOptionVerdict`
 * derivation, which a pure module holds no access to and must not fake. Five
 * independent producers of "who is leading" have already been found in this
 * estate (`compose/leading-option-egress-guard.ts`); this module refuses to be
 * the sixth. The fixed copy's deliberately vague "the option in front" is
 * preserved verbatim for exactly that reason.
 *
 * ── ⭐ COMPOSABILITY IS ASKED EARLY, AND THAT IS THE POINT ───────────────────
 * `buildDskExerciseBlock` routes `counter_case` through
 * `validateProseAndSchemaOrDrop`, which DROPS THE WHOLE BLOCK on a prose-gate
 * hit. With fixed copy that can never fire. With PRODUCER LABELS interpolated
 * it genuinely can — a label carrying a raw decimal, an id-shaped token, or a
 * forbidden phrase would cost the user the entire exercise.
 *
 * That is the exact defect `coaching/fragile-edge-offer-text.ts` was created to
 * close ("the fix is not a better failure path; it is asking the question
 * EARLIER"), so the same lesson is applied here: this module evaluates the
 * gates ON THE COMPOSED STRING and REFUSES the grounding when they bite. The
 * caller then falls back to the existing fixed copy and the user still gets an
 * exercise. Grounding can fail; the intervention cannot vanish.
 *
 * ⚠ THE GATE OBJECTS ARE IMPORTED, NEVER RE-DECLARED — a second copy of a
 * safety rule is the hand-maintained-mirror class (trap 12) and drifts silently
 * the first time the shared list is edited.
 *
 * Pure: no I/O, no LLM, no clock, no config read. A total function of one
 * `enrichment` object, so it can be replayed over a captured enrichment and
 * give the same answer — the property `lens-history.ts` depends on.
 */

import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../orchestrator/routing/value-update-gate.js';
import { findForbiddenPhraseHit, RAW_DECIMAL_RE } from '../compose/forbidden-user-facing-phrases.js';
import { isAnalyticalQuestion } from '../routing/analytical-question-guard.js';
import { isStateQueryQuestionShape } from '../routing/state-query-guard.js';

/** Why no grounded counter-case was produced. Closed enum — the telemetry payload. */
export type GroundedCounterCaseRefusalReason =
  /** No robustness object, or it carried no fragile edges. */
  | 'no_fragile_edges'
  /** Rows exist but the head carries no `(from_id, to_id)` identity. */
  | 'no_edge_identity'
  /** The head row carries no human-readable endpoint labels — nothing to name. */
  | 'no_endpoint_labels'
  /**
   * The composed sentence trips a prose gate or the length bound. The caller
   * keeps the fixed copy; the exercise still ships.
   */
  | 'not_composable';

/** The one grounded counter-case. Identity-bearing, label-bearing, quantity-FREE. */
export interface GroundedCounterCase {
  readonly fromId: string;
  readonly toId: string;
  /**
   * `${fromId}→${toId}`. The composite the graph-edit path accepts
   * (`tools/handlers/adjust-edge-strength.ts::parseEdgeId` takes `→` or `->`
   * and REJECTS `::`), composed from the endpoint pair rather than copied from
   * either producer's `edge_id` — `fragile_edges` and `edge_e_values` use
   * DIFFERENT separators for the same edge.
   *
   * This is what binds a later turn's follow-through to the relationship this
   * exercise named, without persisting anything.
   */
  readonly edgeIdentity: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  /** The exercise prose. Producer labels only — no number, no option, no id. */
  readonly counterCase: string;
}

export interface GroundedCounterCaseDecision {
  readonly grounded: GroundedCounterCase | null;
  /** Present exactly when `grounded === null`. */
  readonly refusalReason: GroundedCounterCaseRefusalReason | null;
}

/**
 * The renderability bound on the composed sentence.
 *
 * `ExerciseBlockSchema.counter_case` is `z.string().min(1)` with NO maximum, so
 * nothing downstream would reject a 900-character sentence built from two long
 * producer labels — it would simply ship an unreadable card. The bound is
 * declared here and enforced BEFORE composition succeeds, so an over-long pair
 * costs the grounding and not the card.
 *
 * Sized against the fixed copy it replaces (`CONSIDER_OPPOSITE_COUNTER_CASE`,
 * 231 characters) with headroom for two ordinary endpoint labels.
 */
export const GROUNDED_COUNTER_CASE_MAX = 400;

// ============================================================================
// Defensive reads. A missing/ill-typed field becomes absent, never a default.
// ============================================================================

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Compose the sentence. ONE definition, so the string the gates are evaluated
 * on is byte-identical to the string that ships — a gate applied to a
 * differently-composed preview is a guard agreeing with itself (trap 13b).
 */
export function composeGroundedCounterCase(fromLabel: string, toLabel: string): string {
  return (
    'Take the opposite view for a moment: assume the option in front turns out to be ' +
    'the wrong choice. Of everything this run tested, the link from ' +
    `${fromLabel} to ${toLabel} ` +
    'is the one the robustness check found most sensitive. Make the strongest case ' +
    'that this link does not hold, and note what evidence would settle it either way.'
  );
}

/**
 * The editable sentence the exercise asks the HUMAN to write in their own
 * words when disconfirmation exposes a missing causal driver. It is prose in
 * the card, not an action field: no chip sends it and no model write follows
 * until the user supplies a driver and confirms the held proposal.
 *
 * No numeric or qualitative relationship strength is requested. The existing
 * edit lane may propose those edge semantics, but graph management holds the
 * resulting add_node + add_edge batch for explicit confirmation.
 */
export function composeGroundedCounterCaseHandoffTurn(toLabel: string): string {
  return `Add [your driver] as a factor affecting ${toLabel}.`;
}

/**
 * Compose the complete disconfirmation loop's card copy.
 *
 * The route gate is the exact five-conjunct `editVerbCandidate` predicate from
 * `route-v2`, rebuilt from the SAME imported authorities. Producer labels are
 * ordinary strategic prose and can contain any veto ("why", "compare", a
 * value-update phrase, a state query), so the check runs on the actual handoff
 * turn on every composition. A failed route or prose/length gate returns null;
 * the caller then preserves the already-shipped grounded card byte-for-byte.
 */
export function composeGroundedCounterCaseWithModelHandoff(
  fromLabel: string,
  toLabel: string,
): string | null {
  const handoffTurn = composeGroundedCounterCaseHandoffTurn(toLabel);
  const editVerbCandidate =
    EDIT_GRAPH_POSITIVE_REGEX.test(handoffTurn) &&
    !EDIT_GRAPH_NEGATIVE_REGEX.test(handoffTurn) &&
    !shouldSuppressEditDispatchForValueUpdate(handoffTurn) &&
    !isAnalyticalQuestion(handoffTurn) &&
    !isStateQueryQuestionShape(handoffTurn);
  if (!editVerbCandidate) return null;

  const counterCase =
    'Argue the opposite: assume the option in front is wrong. The run’s most sensitive link is ' +
    `${fromLabel} → ${toLabel}. ` +
    'Make the strongest case it fails and name evidence that would settle it. ' +
    'If that reveals a missing driver, reply in your own words: “' +
    `${handoffTurn}” ` +
    'I’ll ask you to confirm before changing the model.';
  return isComposable(counterCase) ? counterCase : null;
}

/**
 * The prose gates, evaluated on the ACTUAL composed string.
 *
 * Mirrors `phase3-blocks.ts::scanProse`'s three checks using the SAME imported
 * objects. It is not a copy of that function's code path so much as the same
 * question asked one step earlier, which is the whole design: `scanProse` still
 * runs downstream and remains the authority — this is the early ask that keeps
 * a gate hit from costing the block.
 */
function isComposable(sentence: string): boolean {
  if (sentence.length > GROUNDED_COUNTER_CASE_MAX) return false;
  if (findForbiddenPhraseHit(sentence) !== null) return false;
  if (RAW_DECIMAL_RE.exec(sentence) !== null) return false;

  // Walk ALL matches: the first may be an English-compound false positive that
  // the slug-shape gate filters out (the same posture `scanProse` takes).
  const idMatcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idMatcher.exec(sentence)) !== null) {
    if (isSlugShapedEntityId(idMatch[0])) return false;
  }
  return true;
}


/**
 * The row carrying the greatest `switch_probability`. Producer order breaks
 * ties (strict `>`), so a correctly-sorted array yields its head unchanged.
 * When no row carries a finite value the producer's head is returned — the
 * pre-existing behaviour, and the identity/label gates below still apply.
 */
function selectMostSensitiveRow(rows: readonly unknown[]): unknown {
  let best = rows[0];
  let bestValue: number | null = null;
  for (const raw of rows) {
    const row = readRecord(raw);
    if (row === null) continue;
    const value = typeof row.switch_probability === 'number' && Number.isFinite(row.switch_probability)
      ? row.switch_probability
      : null;
    if (value === null) continue;
    if (bestValue === null || value > bestValue) {
      bestValue = value;
      best = raw;
    }
  }
  return best;
}

/** The composite separator the graph-edit path accepts (`parseEdgeId`). */
const EDGE_IDENTITY_SEPARATOR = '→'; // →

/**
 * Select the relationship this run's disconfirmation exercise should argue
 * against, and compose the exercise prose naming it.
 *
 * Total: every input yields a decision, and every refusal names its reason.
 */
export function selectGroundedCounterCase(enrichment: unknown): GroundedCounterCaseDecision {
  const root = readRecord(enrichment);
  const robustness = root !== null ? readRecord(root.robustness) : null;
  const rows = robustness !== null && Array.isArray(robustness.fragile_edges)
    ? robustness.fragile_edges
    : [];

  if (rows.length === 0) {
    return { grounded: null, refusalReason: 'no_fragile_edges' };
  }

  // ⚠ THE MAXIMUM, NOT THE HEAD (CEE #933 review).
  //
  // This module previously consumed `rows[0]` on the stated guarantee that
  // `fragile_edges` "arrives sorted by switch_probability DESCENDING". A sweep
  // of all 28 committed fragile-edge arrays found **3 violations**, one in a
  // staging capture. Head happened to equal max in every case examined, so no
  // false sentence was ever witnessed — but the copy says "the one the
  // robustness check found MOST SENSITIVE", and an unguaranteed ordering is not
  // a basis for a superlative.
  //
  // Reading the maximum of the producer's OWN metric is not manufacturing
  // importance (the rule this module's header invokes) — it is declining to
  // infer that metric from arrival order. Ties keep producer order, so where
  // the array IS sorted the behaviour is byte-identical to before.
  const head = readRecord(selectMostSensitiveRow(rows));
  const fromId = head !== null ? nonEmptyString(head.from_id) : null;
  const toId = head !== null ? nonEmptyString(head.to_id) : null;
  if (head === null || fromId === null || toId === null) {
    return { grounded: null, refusalReason: 'no_edge_identity' };
  }

  // Labels are what a human argues about. An id is not a relationship anyone
  // can dispute, so a label-less row refuses rather than printing a slug.
  const fromLabel = nonEmptyString(head.from_label);
  const toLabel = nonEmptyString(head.to_label);
  if (fromLabel === null || toLabel === null) {
    return { grounded: null, refusalReason: 'no_endpoint_labels' };
  }

  const counterCase = composeGroundedCounterCase(fromLabel, toLabel);
  if (!isComposable(counterCase)) {
    return { grounded: null, refusalReason: 'not_composable' };
  }

  return {
    grounded: {
      fromId,
      toId,
      edgeIdentity: `${fromId}${EDGE_IDENTITY_SEPARATOR}${toId}`,
      fromLabel,
      toLabel,
      counterCase,
    },
    refusalReason: null,
  };
}
