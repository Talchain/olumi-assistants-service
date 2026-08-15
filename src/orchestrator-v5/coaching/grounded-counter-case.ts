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
 * ── PRIORITY COMES FROM THE PRODUCER METRIC, NOT ARRIVAL ORDER ────────────────
 * A committed-capture sweep disproved the old "sorted descending" premise.
 * The shared authority selects the maximum finite `switch_probability`, with
 * strict `>` so producer order breaks ties. Only an array with no finite value
 * falls back to its head. No substitute metric or local score is invented.
 *
 * ── ⭐ WHAT THE PROSE MAY CLAIM, AND THE CLAIM IT CAREFULLY DOES NOT MAKE ────
 * DSK-TR-003 fires `consider_opposite` on a DECISIVE, attested-NON-FRAGILE
 * leader, and DSK-P-003's own contraindications forbid running it "when the
 * analysis shows a close call". So on the runs where this exercise ships, the
 * selected fragile edge can still carry a modest `switch_probability`: it is a
 * priority within the producer's set, not a statement that the result is close.
 *
 * The copy uses "most sensitive" only when a finite producer metric proves the
 * maximum. On the no-finite compatibility fallback it says only that the link
 * was flagged as sensitive. It NEVER says the link is "likely to" overturn
 * anything; that would import a magnitude claim the run does not support.
 *
 * ── WHAT IS READ AS A STRUCTURED GATE AND NEVER SURFACED ────────────────────
 * `switch_probability` is read only for the shared structured priority and is
 * never surfaced. `alternative_winner_label` is likewise NOT read:
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
import {
  selectMostSensitiveRow,
  selectionHasMetricProof,
} from '../../orchestrator/shared/fragile-edge-authority.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import { findForbiddenPhraseHit, RAW_DECIMAL_RE } from '../compose/forbidden-user-facing-phrases.js';

/** Why no grounded counter-case was produced. Closed enum — the telemetry payload. */
export type GroundedCounterCaseRefusalReason =
  /** No robustness object, or it carried no fragile edges. */
  | 'no_fragile_edges'
  /** Rows exist but the metric-selected row carries no `(from_id, to_id)` identity. */
  | 'no_edge_identity'
  /** The metric-selected row carries no human-readable endpoint labels. */
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
export function composeGroundedCounterCase(
  fromLabel: string,
  toLabel: string,
  metricProvesMaximum = false,
): string {
  const sensitivityClaim = metricProvesMaximum
    ? 'is the one the robustness check found most sensitive'
    : 'is one the robustness check flagged as sensitive';
  return (
    'Take the opposite view for a moment: assume the option in front turns out to be ' +
    'the wrong choice. Of everything this run tested, the link from ' +
    `${fromLabel} to ${toLabel} ` +
    `${sensitivityClaim}. Make the strongest case ` +
    'that this link does not hold, and note what evidence would settle it either way.'
  );
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
  const selectedRaw = selectMostSensitiveRow(rows);
  const head = readRecord(selectedRaw);
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

  const counterCase = composeGroundedCounterCase(
    fromLabel,
    toLabel,
    selectionHasMetricProof(selectedRaw),
  );
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
