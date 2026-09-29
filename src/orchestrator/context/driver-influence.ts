/**
 * SSOT for the driver-claim ranking magnitude (DGAI #341).
 *
 * Every deterministic surface that RANKS factors to name a "strongest
 * driver" / "would shift this result the most" / "most influence" claim must
 * read its magnitude through this single accessor, so all narration surfaces
 * and the UI (which displays `influence_score`) agree on WHO the top driver
 * is. The known consumers are:
 *
 *   - `deriveTopDrivers` (analysis-compact.ts, per-option shape)
 *   - `deriveTopDriversFromTopLevel` (orchestrator-v5/context/analysis-fallback.ts,
 *     the staging-live top-level shape)
 *   - `computeDriverScore` (orchestrator-v5/coaching/analysis-result-headline.ts,
 *     the run_analysis headline's raw read)
 *
 * WHY influence_score ONLY (ruled fix for DGAI #341): under
 * `intervention_override`, ISL zeroes per-factor elasticity/sensitivity for
 * every factor an option pins — on a real board this zeroed EVERY factor
 * except one, and the old `sensitivity_score → |elasticity| × confidence`
 * heuristic latched onto the only non-zero artifact, naming the LEAST
 * influential factor on the board as "the strongest driver" while every UI
 * surface (correctly) displayed the `influence_score` ranking. `influence_score`
 * is what ISL actually ranks (`influence_rank`) and what the UI displays; a
 * factor without it has NO trustworthy driver signal and must be OMITTED from
 * driver claims — never scored by the elasticity heuristic.
 */

/**
 * Read the trustworthy driver-ranking magnitude from a raw
 * `factor_sensitivity[]` entry.
 *
 * Returns the absolute `influence_score` when it is a finite number, else
 * `null` (no trustworthy signal — the entry is not a driver candidate).
 * Deliberately reads NO other field: `sensitivity_score`, `elasticity`, and
 * `confidence` are never a fallback for driver RANKING (see module doc).
 */
export function readDriverInfluenceScore(
  entry: Record<string, unknown>,
): number | null {
  const value = entry.influence_score;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.abs(value);
}
