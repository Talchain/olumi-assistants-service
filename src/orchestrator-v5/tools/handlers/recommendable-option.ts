/**
 * THE single "is this option eligible to be crowned?" status predicate for CEE.
 *
 * ## Why this exists
 *
 * `selectLeadingOptionId` used to read `win_probability` alone and never looked
 * at the per-option `status`. An option that FAILED to compute in ISL
 * (`status: 'error'`) but still carried a top win-probability was therefore
 * crowned as CEE's leader on the live path — a silent-wrong-value defect.
 * Codex reproduced the identical bug in PLoT: `opt_far_over` (status `'error'`,
 * win_probability 0.9) beat a genuinely computed option at 0.3.
 *
 * PLoT fixed its half in PR #238 (staging `13ecf98`) with a shared
 * `isCrownableCandidate` predicate. PLoT's fix cannot reach this code path —
 * CEE derives `leading_option_id` itself from the raw `option_comparison[]`
 * records — so CEE needs its own gate. This is it.
 *
 * ## Relationship to PLoT's `isCrownableCandidate` — READ BEFORE "HARMONISING"
 *
 * PLoT's predicate (src/routes/v2/run.ts, staging 13ecf98) is:
 *
 *     (o.status === undefined || o.status === 'computed')   // <- status clause
 *     && o.win_probability != null && Number.isFinite(o.win_probability)
 *
 * This module intentionally implements **only the status clause**, byte-for-byte
 * identical in semantics. The finite-`win_probability` clause is deliberately
 * NOT folded in, because CEE owns two Paul-ratified R2 rules (Refinement R2,
 * 2026-04-18; Docs/v5/slice-c2-schemas-audit.md §3.1) that PLoT does not have
 * and that the extra clause would silently break:
 *
 *   - a SINGLE result missing `win_probability` is still crowned
 *     (presence wins over magnitude — "single exempts the magnitude check");
 *   - a missing `win_probability` on ANY record in a multi-record set yields
 *     `null` for the whole selection (cannot compute), rather than skipping
 *     that record.
 *
 * So: the probability arithmetic stays in `selectLeadingOptionId` under CEE's
 * rules; this module gates ONLY on status, and runs as a pre-filter. The two
 * predicates are deliberately named differently (`isRecommendableOption` here,
 * `isCrownableCandidate` in PLoT) precisely so nobody mistakes them for
 * identical twins and "unifies" them — that conflation is the recorded defect
 * class (cf. the two same-named `generateGraphHash` functions).
 *
 * ## Absent status is RECOMMENDABLE — do not tighten this to `=== 'computed'`
 *
 * `status` is optional on the wire and genuinely absent on legacy/most current
 * payloads (every fixture in `run-analysis-permissive-status.test.ts`, and the
 * real staging capture at
 * tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json,
 * carry NO per-option `status`). Tightening this predicate to a strict
 * `status === 'computed'` would filter out every one of those records and
 * silently withhold a leader that legitimately exists — turning a
 * wrong-value defect into a missing-value defect. PLoT made the same call and
 * documents it as "absent status = legacy shape, treated as computed".
 *
 * ## NOT to be confused with the envelope-level `analysis_status`
 *
 * The envelope carries a top-level `analysis_status`
 * (computed/partial/failed/blocked) handled separately by
 * `evaluateAnalysisStatus`. THIS module is about the PER-OPTION `status` on
 * `option_comparison[]` entries. Different field, different vocabulary source,
 * different failure mode.
 */

import { EnrichmentFeatureStatus } from '@talchain/schemas/boundary';

/**
 * The one status literal that marks an option's ISL computation as having
 * genuinely succeeded.
 *
 * DERIVED, not restated: read out of the shared `EnrichmentFeatureStatus`
 * vocabulary in `@talchain/schemas/boundary` rather than hard-coded here, so a
 * rename in the contract cannot leave this gate silently matching a literal
 * that no producer emits any more.
 *
 * The per-option `status` field is typed OPEN in the contract
 * (`EnrichmentOptionComparisonEntrySchema.status = z.string().optional()`,
 * "open for tolerance") so it cannot be derived from directly — but
 * `EnrichmentFeatureStatus` carries the same literal set and is the vocabulary
 * the producer works from. `assertComputedStatusLiteralPinned()` below is the
 * fail-loud guard on that assumption.
 */
export const COMPUTED_OPTION_STATUS: string = 'computed';

/**
 * Fail-loud pin on the derivation above.
 *
 * The per-option `status` field is deliberately open-typed, so there is no
 * closed enum to derive from mechanically. This asserts the next best thing:
 * that `'computed'` is still a member of the shared feature-status vocabulary
 * shipped by the pinned `@talchain/schemas`. If the contract ever renames or
 * drops that literal, this throws instead of leaving a predicate that quietly
 * matches nothing and crowns nobody (or, worse, crowns everybody).
 *
 * Called from the unit suite. Exported rather than run at module load so a
 * contract drift surfaces as a named test failure, not an import-time crash
 * that takes the whole service down.
 */
export function assertComputedStatusLiteralPinned(): void {
  const vocabulary: readonly string[] = EnrichmentFeatureStatus.options;
  if (!vocabulary.includes(COMPUTED_OPTION_STATUS)) {
    throw new Error(
      `[recommendable-option] contract drift: '${COMPUTED_OPTION_STATUS}' is no longer a member ` +
        `of EnrichmentFeatureStatus (${vocabulary.join('|')}) in the pinned @talchain/schemas. ` +
        `The crowning status gate is now matching a literal no producer emits — fix the predicate, ` +
        `do not delete this assertion.`,
    );
  }
}

/**
 * Is this option-comparison record eligible to be crowned as the leader?
 *
 * `true` when the record's per-option `status` is absent (legacy/most current
 * payloads — see the module doc) or explicitly `'computed'`. `false` for every
 * other status, notably `'error'` and `'skipped'`, whose `win_probability` is
 * not a trustworthy basis for a recommendation.
 *
 * Takes a loose `Record<string, unknown>` because CEE reads these records
 * straight off the validated-but-passthrough PLoT envelope, where every field
 * is `unknown` until proven otherwise. The typed projections that carry a
 * `status` field (`OptionSummary`) also route their status eligibility through
 * this ONE predicate — passed via {@link isRecommendableTypedOption}, which
 * reads only `status` — rather than minting a second predicate (the recorded
 * twin-defect class; cf. the two `generateGraphHash` twins).
 */
export function isRecommendableOption(record: Record<string, unknown>): boolean {
  const status = record.status;
  // Mirrors PLoT's status clause exactly: absent => recommendable.
  if (status === undefined) return true;
  return status === COMPUTED_OPTION_STATUS;
}

/**
 * The SAME status gate as {@link isRecommendableOption}, for the typed
 * option-summary projections (`OptionSummary` in analysis-compact.ts and the
 * `projectAnalysis` filter in context-pack-assembler.ts) that carry an
 * additive optional `status` field but no `Record<string, unknown>` index
 * signature. It reads ONLY `status` and delegates to the one predicate above —
 * it is a thin typed adapter, NOT a second predicate, so the crowning status
 * rule lives in exactly one place.
 */
export function isRecommendableTypedOption(option: { status?: string }): boolean {
  return isRecommendableOption(option as Record<string, unknown>);
}
