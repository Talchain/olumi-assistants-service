/** SC-24 goal-unit capture: preserve sent bytes; omit absent/out-of-bounds text. */
export function normalizeRunGoalUnit(value: unknown): string | undefined {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64 ? value : undefined;
}
