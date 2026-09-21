/**
 * Decision Records — outcome scoring (calibration R0). PURE: no I/O, no
 * clock, no env, no config.
 *
 * This module is the FIRST producer of `outcome.brier_component` anywhere in
 * the estate. The column, its RPC whitelist slot and its `>= 0` guard have
 * been live on staging since 2026-07-10 with zero writers
 * (supabase/migrations/20260710113000_v5_decision_records.sql:672,681-684).
 *
 * ⚠ NOT NAMED `calibration-*` ON PURPOSE. CEE already has
 * `src/orchestrator-v5/routing/calibration-semantics.ts`, which maps
 * probability PHRASES ("pretty likely" → 0.70) for the mutating path and has
 * nothing to do with scoring. Two same-named modules for two different
 * concepts is the two-`generateGraphHash` shape (CLAUDE.md trap 10); it costs
 * one naming decision to avoid.
 *
 * ─── Brier formula v1 ──────────────────────────────────────────────────────
 * `brier_component = (confidence − outcome_indicator)²` — ONE record's
 * squared-error term, never the calibration score itself (the contract says
 * so: `DecisionRecordOutcomeSchema.brier_component`, "this record's
 * individual contribution to a future aggregate").
 *
 * The indicator maps the closed 4-value result vocabulary onto {0, 1, null}:
 *
 *   better | as_expected → 1   the prediction stood
 *   worse                → 0   the decision stood and the outcome fell short
 *   abandoned            → null  UNSCORABLE, excluded from the population
 *
 * ⭐ ORACLE PROVENANCE (CLAUDE.md trap 13c — a mutant kit validates
 * sensitivity, never correctness). The `abandoned` exclusion is NOT this
 * lane's reading: it is the PRODUCER's declared semantics. The contract's own
 * comment on `DecisionRecordOutcomeResult` states that `abandoned` "covers
 * the decision being reversed/superseded BEFORE the review could meaningfully
 * judge it — distinct from `worse`, which means the decision stood and the
 * outcome fell short". A reversed decision has no realised event to score a
 * forecast against, so scoring it as either 0 or 1 would fabricate a datum.
 * ABSENT, never 0 and never null-in-the-payload: the RPC's `p_outcome`
 * whitelist admits `brier_component` only as `number >= 0`, and a stored 0
 * would read as "perfectly calibrated" forever.
 */

import { DecisionRecordOutcomeResult } from '@talchain/schemas/boundary';
import type { DecisionRecordOutcomeResultLiteral } from '@talchain/schemas/boundary';

/**
 * The closed outcome vocabulary, DERIVED from the contract enum rather than
 * re-typed here (CLAUDE.md trap 12). A value added to the schema and not
 * handled by {@link resultToOutcomeIndicator} shows up as a compile error at
 * the switch, not as a silent default.
 */
export const DECISION_OUTCOME_RESULTS: readonly DecisionRecordOutcomeResultLiteral[] =
  DecisionRecordOutcomeResult.options;

/** Formula identifier stamped in this module's own docs and telemetry. */
export const BRIER_FORMULA_VERSION = 'v1';

/**
 * Is this string one of the contract's four outcome results? Derived from the
 * schema, so the route's 400 refusal cannot drift from the RPC's whitelist.
 */
export function isDecisionOutcomeResult(
  value: unknown,
): value is DecisionRecordOutcomeResultLiteral {
  return (
    typeof value === 'string' &&
    (DECISION_OUTCOME_RESULTS as readonly string[]).includes(value)
  );
}

/**
 * The Brier outcome indicator `o` for a result, or `null` when the result is
 * UNSCORABLE (`abandoned`). See the module header for why `null` — not 0 —
 * is the only honest answer there.
 */
export function resultToOutcomeIndicator(
  result: DecisionRecordOutcomeResultLiteral,
): 0 | 1 | null {
  switch (result) {
    case 'better':
    case 'as_expected':
      return 1;
    case 'worse':
      return 0;
    case 'abandoned':
      return null;
  }
}

/**
 * `(confidence − o)²`, or `undefined` when the record cannot be scored:
 *
 *   - no `confidence` on the prediction (auto-captured records with no usable
 *     leader win_probability; the outcome still records, the record is
 *     reviewed-UNSCORED — never defaulted to 0.5, which would fabricate a
 *     forecast the product never made);
 *   - a `confidence` outside the contract's [0,1] range, or non-finite;
 *   - `result === 'abandoned'`.
 *
 * `undefined` means the caller OMITS the key entirely from `p_outcome` — the
 * RPC's whitelist has no null slot, and an omitted key is the shape the
 * contract's `.optional()` describes.
 */
export function computeBrierComponent(
  confidence: number | undefined,
  result: DecisionRecordOutcomeResultLiteral,
): number | undefined {
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return undefined;
  }
  const indicator = resultToOutcomeIndicator(result);
  if (indicator === null) return undefined;
  const error = confidence - indicator;
  return error * error;
}
