/**
 * FIXTURE — a tree that contains TypeScript but no rate-limiting code at all.
 *
 * Blinding control for the derived guard: pointed here, the scanner finds files
 * but no plugin reference, no registration and no builder. It must HARD-FAIL
 * with SCANNER BLINDED rather than pass by finding nothing (CLAUDE.md trap 13 —
 * an absence assertion that cannot see a presence is vacuous).
 */

export function unrelated(value: number): number {
  return value + 1;
}
