/**
 * Dependency-free readers for the analysis engine's OWN warning channel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — THREE QUESTIONS THAT HAVE BEEN WEARING ONE NAME
 *
 * "Defaulted" is used in this estate for three different facts, and the live
 * capture of 2026-09-03 (`__tests__/fixtures/live-decision-review-2026-09-03
 * .json`) shows them disagreeing on one payload:
 *
 *   1. `decision_brief.defaulted_assumptions[]`  — "which factors did the
 *      producer put on its OWN disclosure list?"          → ONE entry.
 *   2. `inference_warnings[ROOT_NODE_DEFAULT_VALUE]`      — "which root nodes
 *      did the engine actually compute on a placeholder?" → THREE nodes.
 *   3. `inference_warnings[GOAL_ANCESTOR_DATA_GAP]`       — "do the GOAL-level
 *      probabilities rest on placeholder zeros?"          → YES.
 *
 * The conversational disclosure is built from (1) alone, so on that run the
 * product said *"The analysis used a default value for one of the factors"*
 * while the engine had defaulted three roots and had separately said the
 * goal's probabilities partially rest on placeholder zeros. Understating the
 * provisional-ness of a number is how a provisional number becomes a
 * recommendation.
 *
 * ⚠ THE FIX IS NOT TO ALIGN THE THREE (CLAUDE.md trap 21). They answer
 * different questions and all three answers are correct. This module NAMES
 * THEM APART and exposes each one, so a consumer picks the question it means.
 * `pick-defaulted-assumptions.ts` then takes (1) ∪ (2) as its COUNT FLOOR —
 * a union assertion, not a second mirror of the producer's list, because a
 * guard derived from a list can only prove the copies agree, never that the
 * list is complete (CLAUDE.md trap 12d).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE OF WHAT THIS READS, STATED SO IT CANNOT BE OVER-READ
 *
 * TWO warning arrays exist on a persisted enrichment and they are NOT copies
 * of each other — measured on the live capture:
 *   - `enrichment.inference_warnings[]`  carries EDGE_E_VALUE_NON_FINITE_
 *     DROPPED, ROOT_NODE_DEFAULT_VALUE ×3, GOAL_ANCESTOR_DATA_GAP.
 *   - `enrichment.decision_brief.warnings[]` carries ANCHORING_RISK,
 *     GOAL_ANCESTOR_DATA_GAP, INFLUENTIAL_EXTERNALS, M2_UNAVAILABLE,
 *     MARGINAL_SWITCH_TRUNCATED — and NO ROOT_NODE_DEFAULT_VALUE at all.
 * So reading either one alone under-reports. Both are read and unioned, and
 * the fixture-bound test asserts the counts each source contributes, so a
 * producer that stops populating one of them REDs instead of going quiet.
 *
 * This module makes NO claim about any warning code it does not name.
 */

/** The engine warning codes this module is able to answer questions about. */
export const ROOT_NODE_DEFAULT_VALUE_CODE = 'ROOT_NODE_DEFAULT_VALUE';
export const GOAL_ANCESTOR_DATA_GAP_CODE = 'GOAL_ANCESTOR_DATA_GAP';

/**
 * A structured `field` path on a ROOT_NODE_DEFAULT_VALUE warning, e.g.
 * `nodes[16ec3d64].observed_state.value`. The id is taken from the STRUCTURED
 * field only — never parsed out of the human-readable `message`, which is
 * prose the producer may reword at will.
 */
const NODE_FIELD_PATTERN = /^nodes\[([^\]]+)\]/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readWarningArrays(enrichment: unknown): ReadonlyArray<Record<string, unknown>> {
  const envelope = asRecord(enrichment);
  if (envelope === null) return [];
  const out: Record<string, unknown>[] = [];
  const push = (raw: unknown): void => {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      const rec = asRecord(entry);
      if (rec !== null) out.push(rec);
    }
  };
  push(envelope.inference_warnings);
  push(asRecord(envelope.decision_brief)?.warnings);
  return out;
}

/**
 * What the engine's warning channel says about placeholder values.
 *
 * `rootNodeIds` is the set of DISTINCT root-node ids the engine reported as
 * defaulted, taken from the structured `field` path. `unattributedCount` is
 * the number of ROOT_NODE_DEFAULT_VALUE warnings whose id could not be read
 * — counted rather than dropped, for the same reason
 * `readDefaultedAssumptions` counts an unlabelled entry: it is still evidence
 * that a value was defaulted, and dropping it would let an unreadable field
 * silently restore an over-confident claim.
 */
export interface DefaultedRootEvidence {
  /** Distinct root-node ids the engine reported as defaulted. */
  readonly rootNodeIds: ReadonlySet<string>;
  /** ROOT_NODE_DEFAULT_VALUE warnings carrying no readable node id. */
  readonly unattributedCount: number;
  /**
   * Lower bound on how many factors were computed on a placeholder:
   * `rootNodeIds.size + unattributedCount`. A FLOOR, never a total — the
   * channel reports what the engine chose to warn about.
   */
  readonly defaultedRootFloor: number;
  /**
   * True when the engine said the GOAL-level probabilities partially rest on
   * placeholder zeros. This is a DIFFERENT and stronger claim than "some root
   * was defaulted": it is the engine telling us the headline number itself is
   * provisional.
   */
  readonly goalAncestorDataGap: boolean;
}

/**
 * Read the placeholder-value evidence off a persisted enrichment envelope.
 *
 * Total and defensive: the enrichment seam is an untyped `z.record`
 * passthrough (parent CLAUDE.md hazard 2), so every read is shape-guarded and
 * an unrecognisable envelope yields the empty verdict — which every caller
 * treats as "no evidence", i.e. exactly today's behaviour.
 */
export function readDefaultedRootEvidence(enrichment: unknown): DefaultedRootEvidence {
  const rootNodeIds = new Set<string>();
  let unattributedCount = 0;
  let goalAncestorDataGap = false;

  for (const warning of readWarningArrays(enrichment)) {
    const code = typeof warning.code === 'string' ? warning.code : null;
    if (code === GOAL_ANCESTOR_DATA_GAP_CODE) {
      goalAncestorDataGap = true;
      continue;
    }
    if (code !== ROOT_NODE_DEFAULT_VALUE_CODE) continue;
    const field = typeof warning.field === 'string' ? warning.field : '';
    const match = NODE_FIELD_PATTERN.exec(field);
    const id = match?.[1];
    if (typeof id === 'string' && id.length > 0) {
      rootNodeIds.add(id);
    } else {
      unattributedCount += 1;
    }
  }

  return {
    rootNodeIds,
    unattributedCount,
    defaultedRootFloor: rootNodeIds.size + unattributedCount,
    goalAncestorDataGap,
  };
}
