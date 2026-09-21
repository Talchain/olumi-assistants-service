/**
 * ROADMAP 2.315(a) — the raw goal-target fields for `analysis_ready`.
 *
 * THE RULE, IN ONE SENTENCE: `goal_threshold_raw` is the ANCHOR — it may ride
 * alone, and `goal_threshold_unit` / `goal_threshold_cap` ride ONLY alongside
 * it, so a cap can never reach the wire without the raw value it belongs to.
 *
 * `goal_threshold` on the wire is NORMALISED (raw / cap). These fields are the
 * raw target as the user stated it, carried so a consumer can render the
 * user's own figure instead of "reaching >= 0.8 count".
 *
 * ⚠ WHY THE ANCHOR EXISTS — a cap without a raw is an ACTIVE DEFECT, not
 * merely incomplete data. Emitted independently, a goal node carrying
 * `goal_threshold` + `goal_threshold_cap` but no `goal_threshold_raw` puts a
 * cap on the wire alone, and the UI then does this
 * (canvas/store.ts:4006-4008, tip cb957c8c):
 *
 *     if (ceeRaw != null)         -> use raw           (representation 'raw')
 *     else if (ceeNorm && hasCap) -> ceeNorm * ceeCap  (representation 'raw')
 *
 * i.e. it MULTIPLIES the normalised value by the cap and tags the product
 * `'raw'` — a consumer-side RE-DERIVATION of an attested value, presented as
 * authoritative. A second derivation is the defect class this whole change
 * exists to avoid, and the two numbers genuinely disagree whenever the
 * attested cap was not the one a fresh resolution would pick.
 *
 * The shape is reachable, not theoretical: all four goal fields are
 * independently `.optional()` on the LLM-writable draft node
 * (adapters/llm/shared-schemas.ts:64-67), and adapters/llm/normalisation.ts
 * clears an ORPHAN CAP only when it is EXACTLY 0 — a non-zero cap with no raw
 * survives to the graph.
 *
 * ⚠ WHY THE ANCHOR IS RAW-ONLY AND NOT ALL-THREE-OR-NONE. An earlier revision
 * required all three. That closed the same defect, but it also suppressed the
 * case where we hold the TRUE NUMBER and merely lack a unit label — and
 * suppressing it makes the surface fall back to rendering the normalised
 * `0.8`. A unitless "800000" is honest and useful; "0.8" is neither. The
 * anchor is therefore exactly as strict as it needs to be (cap-without-raw is
 * unrepresentable) and no stricter: we never trade away a correct number to
 * satisfy a symmetry the defect does not require.
 *
 * `goal_threshold` itself is never suppressed by any of this — it is honest
 * alone, and PLoT needs it.
 *
 * Values are CARRIED VERBATIM. Nothing here recomputes: `raw = threshold x cap`
 * and the 25%-headroom cap doctrine are each defensible but can disagree with
 * the cap the graph was actually scored against.
 */

import {
  GOAL_THRESHOLD_CAP_PROVENANCE,
  type GoalThresholdCapProvenance,
} from './goal-threshold-cap.js';

/**
 * What may reach the wire: the raw target, optionally accompanied by its unit
 * and the cap it was normalised against. Never a cap or unit on their own.
 */
export interface GoalThresholdTrio {
  goal_threshold_raw: number;
  goal_threshold_unit?: string;
  goal_threshold_cap?: number;
  /**
   * WHICH RULE produced `goal_threshold_cap` — rides ONLY alongside the cap it
   * describes, for the same reason the cap rides only alongside the raw value.
   *
   * ⚠ WITHOUT THIS THE CAP IS A NUMBER NOBODY CAN JUDGE. On
   * `target_derived_headroom` the denominator is `raw * 1.25`, so
   * `goal_threshold` is the constant 0.8 for every target and says nothing
   * about the user's goal; on `metric_scale` / `inherited` the denominator
   * comes from outside the target and the threshold is meaningful. Those are
   * different epistemic states and the payload could not previously tell them
   * apart. Carried verbatim, never re-derived (see the header).
   */
  goal_threshold_cap_provenance?: GoalThresholdCapProvenance;
}

/** A source of goal-threshold fields: a graph node, or an upstream payload. */
export interface GoalThresholdTrioSource {
  goal_threshold_raw?: unknown;
  goal_threshold_unit?: unknown;
  goal_threshold_cap?: unknown;
  goal_threshold_cap_provenance?: unknown;
}

/**
 * Return the raw target plus whichever companions are present and well-typed,
 * or an empty object when there is no usable raw value. Spread the result
 * directly into a payload literal:
 *
 *     ...pickGoalThresholdTrio(goalNode)
 *
 * Non-finite numbers (NaN / Infinity) and empty-string units are treated as
 * absent — they would serialise into a payload a consumer cannot use, and an
 * empty unit is what normalisation.ts already normalises away.
 */
export function pickGoalThresholdTrio(
  source: GoalThresholdTrioSource | null | undefined,
): GoalThresholdTrio | Record<string, never> {
  if (!source) return {};

  // THE ANCHOR. No usable raw value ⇒ nothing rides, so `goal_threshold_cap`
  // can never appear alone and arm the consumer's `norm × cap` re-derivation.
  const raw = source.goal_threshold_raw;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return {};

  const out: GoalThresholdTrio = { goal_threshold_raw: raw };

  const unit = source.goal_threshold_unit;
  if (typeof unit === 'string' && unit !== '') {
    out.goal_threshold_unit = unit;
  }

  const cap = source.goal_threshold_cap;
  if (typeof cap === 'number' && Number.isFinite(cap)) {
    out.goal_threshold_cap = cap;

    // THE CAP'S OWN ANCHOR. The provenance is a claim ABOUT the cap, so it
    // rides only when the cap does — beside it, never instead of it and never
    // without it. Validated against the resolver's own enum rather than
    // trusted: an unrecognised value is treated as absent (UNATTESTED), which
    // is the honest default, rather than forwarded as though it meant
    // something.
    const provenance = source.goal_threshold_cap_provenance;
    if (
      typeof provenance === 'string' &&
      (GOAL_THRESHOLD_CAP_PROVENANCE as readonly string[]).includes(provenance)
    ) {
      out.goal_threshold_cap_provenance = provenance as GoalThresholdCapProvenance;
    }
  }

  return out;
}
