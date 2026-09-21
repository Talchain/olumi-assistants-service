/**
 * THE FACTOR VALUE-STATE RECORD — the model-facing answer to "which factors
 * still have no value, and whose value is on the ones that do?".
 *
 * ── WHY THIS EXISTS: THE MODEL COULD NOT ANSWER THE MOST BASIC QUESTION ────
 * Journey-witnessed 26 Aug 2026 on UI `08a30ab9` / CEE `5a2640a`, reproduced
 * three times across three phrasings with staleness eliminated as a confound:
 *
 *     user: "Which factors still have no value? Please list them by name."
 *     Olumi: "I don't have a way to see which individual factors are missing a
 *             value from here, so I can't list them by name."
 *
 * ⚠ THAT ANSWER WAS TRUE, AND THAT IS THE POINT. It is not a hallucination and
 * not an instruction defect — every fragment of it reads ZERO in `src/`
 * (contrast: two known-canned phrases read 3 each in the same sweep), so it is
 * the model's own wording describing a real limit. Meanwhile the Model tab in
 * the SAME session rendered "3 of 4 have no value yet" and named all three.
 *
 * The two surfaces genuinely knew different things: the UI computes value-state
 * client-side from the graph it holds; nothing in the model-facing ContextPack
 * carried it. Measured on the wire from that very session,
 * `sessionStorage['olumi-cee-analysis-ready']` read `status: "ready"`,
 * `may_run: true`, with `blockers` and `readiness_issues` ABSENT — so
 * `summariseReadiness` returned an empty projection (it exits immediately on a
 * `ready` payload, by design), and `factor_label` appears in the pack schema
 * ONLY inside analysis-derived slices (drivers, flip thresholds, evidence
 * gaps). Hence the exact anomaly observed: the model could name
 * "Delivery Lead Time" — the analysis's main driver, which arrives in a driver
 * slice — one sentence after saying it could not enumerate unset factors.
 *
 * ── ROOT CAUSE, AND WHY IT IS NOT A READINESS BUG (CLAUDE.md trap 21) ──────
 * "Readiness" answers CAN THE ANALYSIS RUN? On the witnessed model the answer
 * was yes — the factors carried AI estimates, so the run was legitimate. The
 * user asked WHICH FACTORS DO I STILL NEED TO SUPPLY VALUES FOR? Those are
 * different questions under one name, and only the first was in the pack.
 *
 * ⛔ DO NOT "FIX" THIS BY RELAXING `issuesFromBlockers`'s ready-payload guard.
 * That guard stops open items being minted from advisory blockers on a ready
 * verdict — turning an under-report into an OVER-report, the worse failure —
 * and the witnessed payload carried no blockers to mint from in any case.
 *
 * ── TWO AXES, TWO FIELDS, DELIBERATELY ────────────────────────────────────
 * `has_value` and `provenance` are SEPARATE because in the real data they
 * disagree: the witnessed model had factors that were BOTH "Not set" AND
 * carried an "AI estimate" badge. Collapsing them into a single
 * "has a user-supplied value" boolean would re-commit the very conflation that
 * produced this defect.
 *
 * ── NO NEW PREDICATES. BOTH AXES COME FROM EXISTING AUTHORITIES ───────────
 * The UI already answers this client-side, so a fresh derivation here would be
 * a SECOND implementation of one predicate — this estate's most expensive
 * defect class. Therefore:
 *   · value presence → `factorHasExtractedValue` (cee/provenance/
 *     factor-value-provenance.ts), whose own header calls it "the predicate the
 *     whole row turns on"; it is built on `readFactorValueView`, which owns the
 *     ONE precedence order (observed_state → node → data).
 *   · authorship → `structureProvenance` (cee/graph-readiness/
 *     obligation-provenance.ts), which delegates to `classifyValueSource`,
 *     the single authority on "who authored this?".
 * This module classifies nothing and re-derives nothing.
 *
 * ⚠ `provenance` IS AUTHORSHIP, NOT A USER-WRITE RECEIPT. `classifyValueSource`
 * maps `brief_extraction` and `explicit` to `user_stated`. The stricter
 * question — "is this stamp trustworthy evidence the USER wrote it?" — is
 * `isUserWriteReceipt` (cee/context-integrity/not-modelled-manifest.ts), a
 * deliberately different predicate with two conjuncts. Do not read this field
 * as that one, and do not swap the authority without moving the field name too.
 *
 * ── PERSISTED-FIRST, LIKE `goal-target-record.ts` ─────────────────────────
 * This is a claim about what is SAVED, so the caller must pass the persisted
 * record (`context.persistedGraph ?? …`), never the request-first
 * `graphStateForTurn`. A stale or forged client `graph_state` would otherwise
 * be reported to the model as recorded state — the same defect class this slice
 * exists to close.
 *
 * ── ABSENCE MEANS UNKNOWN, NEVER "NOTHING MISSING" ───────────────────────
 * The key is OMITTED when no graph was read. When a graph WAS read and every
 * factor carries a value, the slice is PRESENT with `without_value_count: 0` —
 * a POSITIVE claim. Encoding "none missing" as absence is exactly how the
 * witnessed defect was able to exist, and the `goal_target` union next door
 * carries the same posture for the same reason.
 */

import { factorHasExtractedValue } from '../../cee/provenance/factor-value-provenance.js';
import {
  structureProvenance,
  type StructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';

/**
 * Bound on the number of factors enumerated. Real models sit far below this;
 * the cap exists so a pathological graph cannot dominate the prompt. Truncation
 * is DISCLOSED (`factors_omitted`), never silent — a collapse the reader cannot
 * see is the failure mode this whole slice exists to end.
 */
export const FACTOR_VALUE_RECORD_CAP = 40;

export interface ContextPackFactorValueEntry {
  readonly label: string;
  /** Does this factor carry a numeric value at all? (`factorHasExtractedValue`) */
  readonly has_value: boolean;
  /** Who authored the value. (`structureProvenance` → `classifyValueSource`) */
  readonly provenance: StructureProvenance;
}

export interface ContextPackFactorValues {
  readonly factors: readonly ContextPackFactorValueEntry[];
  /**
   * How many enumerated factors carry no value. ZERO IS A POSITIVE CLAIM —
   * the graph was read and every factor has a value.
   */
  readonly without_value_count: number;
  /** Disclosed truncation — present ONLY when the cap dropped factors. */
  readonly factors_omitted?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A factor node's display label, or `null` when it carries none worth showing. */
function labelOf(node: Record<string, unknown>): string | null {
  const direct = node.label;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
  const data = asRecord(node.data);
  const nested = data?.label;
  if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim();
  return null;
}

/**
 * Is this node a factor? Accepts `kind` (the canonical field) and `type` (the
 * shape the persisted client autosave carries), so the record does not depend
 * on which of the two a given carrier happens to use.
 */
function isFactorNode(node: Record<string, unknown>): boolean {
  return node.kind === 'factor' || node.type === 'factor';
}

/**
 * Project the persisted graph's factor value-state.
 *
 * Returns `undefined` — key omitted by the caller — when no graph was read or
 * the graph carries no readable node list. That is UNKNOWN, and it is
 * deliberately NOT the same value as "a graph was read and nothing is missing".
 */
export function projectFactorValueRecord(
  persistedGraph: unknown,
): ContextPackFactorValues | undefined {
  const graph = asRecord(persistedGraph);
  if (graph === null) return undefined;
  const rawNodes = graph.nodes;
  if (!Array.isArray(rawNodes)) return undefined;

  const factors: ContextPackFactorValueEntry[] = [];
  let omitted = 0;
  for (const raw of rawNodes) {
    const node = asRecord(raw);
    if (node === null || !isFactorNode(node)) continue;
    const label = labelOf(node);
    if (label === null) continue;
    if (factors.length >= FACTOR_VALUE_RECORD_CAP) {
      omitted += 1;
      continue;
    }
    factors.push({
      label,
      has_value: factorHasExtractedValue(node),
      provenance: structureProvenance(node, persistedGraph),
    });
  }

  const withoutValue = factors.filter((f) => !f.has_value).length;
  return {
    factors,
    without_value_count: withoutValue,
    ...(omitted > 0 ? { factors_omitted: omitted } : {}),
  };
}
