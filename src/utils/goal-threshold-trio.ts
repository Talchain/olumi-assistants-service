/**
 * ROADMAP 2.315(a) — the ATOMIC raw goal-target trio for `analysis_ready`.
 *
 * `goal_threshold` on the wire is NORMALISED (raw / cap). The trio below is
 * the raw target as the user stated it, carried so a consumer can render the
 * user's own figure instead of "reaching >= 0.8 count".
 *
 * ⚠ WHY THIS IS ONE FUNCTION AND NOT THREE INLINE SPREADS.
 *
 * The three fields must reach the wire TOGETHER OR NOT AT ALL. Emitted
 * independently, a goal node carrying `goal_threshold` + `goal_threshold_cap`
 * but no `goal_threshold_raw` puts a CAP ON THE WIRE WITHOUT A RAW VALUE, and
 * the UI then does this (canvas/store.ts:4006-4008, tip cb957c8c):
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
 * Suppressing an incomplete trio is strictly no worse than the pre-2.315(a)
 * baseline, which emitted none of these fields ever; emitting a partial trio
 * is worse than both. `goal_threshold` itself is never suppressed — it is
 * honest on its own and PLoT needs it.
 *
 * Values are CARRIED VERBATIM. Nothing here recomputes: `raw = threshold x cap`
 * and the 25%-headroom cap doctrine are each defensible but can disagree with
 * the cap the graph was actually scored against.
 */

/** The trio, complete — the only shape allowed onto the wire. */
export interface GoalThresholdTrio {
  goal_threshold_raw: number;
  goal_threshold_unit: string;
  goal_threshold_cap: number;
}

/** A source of goal-threshold fields: a graph node, or an upstream payload. */
export interface GoalThresholdTrioSource {
  goal_threshold_raw?: unknown;
  goal_threshold_unit?: unknown;
  goal_threshold_cap?: unknown;
}

/**
 * Return the complete trio, or an empty object when ANY member is missing or
 * mistyped. Spread the result directly into a payload literal:
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

  const raw = source.goal_threshold_raw;
  const unit = source.goal_threshold_unit;
  const cap = source.goal_threshold_cap;

  if (typeof raw !== 'number' || !Number.isFinite(raw)) return {};
  if (typeof unit !== 'string' || unit === '') return {};
  if (typeof cap !== 'number' || !Number.isFinite(cap)) return {};

  return {
    goal_threshold_raw: raw,
    goal_threshold_unit: unit,
    goal_threshold_cap: cap,
  };
}
