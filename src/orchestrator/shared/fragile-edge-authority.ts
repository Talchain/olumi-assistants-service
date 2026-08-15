/**
 * Canonical selector for a producer-authored fragile-edge priority.
 *
 * `robustness.fragile_edges` is not guaranteed to arrive sorted. The only
 * fragility-priority evidence CEE owns is the producer's finite conditional
 * `switch_probability`, so the selected row is the finite maximum. This is not
 * a sensitivity score. A strict `>` keeps the producer's
 * order as the tie-break. When no row carries a finite value, and only then,
 * the producer's head is retained as a compatibility fallback.
 *
 * Pure and shape-defensive: no sorting, mutation, metric substitution or
 * locally invented default.
 */

/** Read the producer metric without coercing strings or non-finite numbers. */
export function readFiniteConditionalSwitchProbability(value: unknown): number | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const probability = (value as Record<string, unknown>).switch_probability;
  return typeof probability === 'number' && Number.isFinite(probability)
    ? probability
    : null;
}

/**
 * Return the row carrying the greatest finite `switch_probability`.
 *
 * - empty input -> `undefined`;
 * - finite values -> maximum, first producer row on ties;
 * - no finite values -> producer head.
 */
export function selectFragilityPriorityRow<T>(rows: readonly T[]): T | undefined {
  let best = rows[0];
  let bestValue: number | null = null;

  for (const row of rows) {
    const value = readFiniteConditionalSwitchProbability(row);
    if (value === null) continue;
    if (bestValue === null || value > bestValue) {
      bestValue = value;
      best = row;
    }
  }

  return best;
}

/**
 * Return a new metric-descending view by repeatedly applying the canonical
 * selector. Finite ties and the no-finite tail retain producer order.
 */
export function orderFragilityPriorityRows<T>(rows: readonly T[]): T[] {
  const remaining = [...rows];
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const selected = selectFragilityPriorityRow(remaining);
    // `remaining.length > 0` makes this unreachable; keep the total-function
    // guard so a future selector signature cannot create an infinite loop.
    if (selected === undefined) break;
    const index = remaining.indexOf(selected);
    if (index < 0) break;
    ordered.push(selected);
    remaining.splice(index, 1);
  }
  return ordered;
}

/** True only when a row carries the finite conditional-switch producer metric. */
export function hasFiniteConditionalSwitchProbability(row: unknown): boolean {
  return readFiniteConditionalSwitchProbability(row) !== null;
}
