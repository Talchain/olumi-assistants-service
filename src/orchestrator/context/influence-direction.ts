/**
 * Influence-direction resolver — single source of truth.
 *
 * Resolves a driver's influence direction from the authoritative PLoT
 * `direction` enum, falling back to the sign of a sensitivity/elasticity
 * magnitude ONLY when no authoritative direction is present.
 *
 * Why this exists: the outer-envelope contract
 * (`src/orchestrator-v5/types/sensitivity-contract.md`) states that
 * `factor_sensitivity[*].elasticity` is an UNSIGNED magnitude and
 * `factor_sensitivity[*].direction` (`'positive' | 'negative' | 'neutral'`) is
 * authoritative. Deriving direction from the sign of an unsigned magnitude is
 * therefore wrong whenever the producer supplies `direction`. Every derive and
 * sign-reattachment path must apply this one rule rather than re-deriving
 * direction with slightly different local logic.
 *
 * Rules:
 *   - `'positive' | 'negative' | 'neutral'` → honoured verbatim (enum wins).
 *   - direction absent/invalid + FINITE magnitude → sign fallback.
 *   - direction absent/invalid + NON-FINITE magnitude → `'neutral'`. A
 *     `NaN`/`Infinity` magnitude carries no directional signal, so we resolve
 *     to the safe non-directional value rather than letting `NaN >= 0`
 *     (which is `false`) masquerade as a confident `'negative'`.
 */
export type InfluenceDirection = 'positive' | 'negative' | 'neutral';

export function resolveInfluenceDirection(
  rawDirection: unknown,
  fallbackMagnitude: number,
): InfluenceDirection {
  if (
    rawDirection === 'positive' ||
    rawDirection === 'negative' ||
    rawDirection === 'neutral'
  ) {
    return rawDirection;
  }
  if (!Number.isFinite(fallbackMagnitude)) return 'neutral';
  return fallbackMagnitude >= 0 ? 'positive' : 'negative';
}
