/**
 * TWO RESULTS COMPARED ON THE SAME DRAWS (SC2). Two options of one Run, or a model and a what-if of it on the same seed,
 * share every draw (common random numbers), so their difference is counted draw by draw: for each draw, whether each met the
 * goal. Its precision is the paired one, far tighter than two separate intervals: two options 34.9% and 33.4% have
 * overlapping intervals, yet on the same draws the gap is 1.47 ± 0.63 points (the science page's case). The interval is
 * Newcombe's (1998) method 10, from the two Wilson intervals and the draws' agreement (phi), which keeps its coverage where
 * the draws that differ are few or all one way, where a plain ± fails.
 *
 * SIMULATION precision only, as for a chance: how exactly the simulation measured the gap in this model, never how sure
 * anyone can be that the options differ in the world. Whether a gap is large enough to matter is the presenter's (Paul's S1).
 */
const Z95 = 1.959963984540054;

/** Wilson score interval at 95% for k successes in n draws: the SIMULATION precision of a chance. */
export function wilson95(k: number, n: number): [number, number] {
  const p = k / n, z2 = Z95 * Z95, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export type PairedDifference =
  /** Both results are fixed in every draw (no Monte Carlo interval): the gap is exact. */
  | { readonly kind: 'exact'; readonly difference: number }
  /** `difference` is a − b, the chances' gap; `precision_95` its paired 95% simulation precision; `differ`: draws where only one met. */
  | { readonly kind: 'sampled'; readonly difference: number; readonly precision_95: readonly [number, number]; readonly draws: number; readonly differ: number }
  /** A draw outside the model's domain in either result: no gap is worked out. */
  | { readonly kind: 'withheld'; readonly reason: 'invalid_domain'; readonly count: number };

/**
 * a and b: per draw, 1 met, 0 not, −1 outside the domain (`PerDrawOption.joint_within_limits`, or a condition's `met`), on the
 * SAME draws. `exact`: both results are fixed in every draw (their own precision is a point).
 */
export function pairedDifference(a: ArrayLike<number>, b: ArrayLike<number>, exact = false): PairedDifference {
  if (a.length !== b.length || a.length === 0) throw new Error(`paired results need the same draws, got ${a.length} and ${b.length}`);
  const n = a.length;
  let both = 0, onlyA = 0, onlyB = 0, neither = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    if (x < 0 || y < 0) { bad++; continue; }
    if (x === 1 && y === 1) both++; else if (x === 1) onlyA++; else if (y === 1) onlyB++; else neither++;
  }
  if (bad > 0) return { kind: 'withheld', reason: 'invalid_domain', count: bad };
  const difference = (onlyA - onlyB) / n;
  if (exact) return { kind: 'exact', difference };
  const p1 = (both + onlyA) / n, p2 = (both + onlyB) / n;
  const [l1, u1] = wilson95(both + onlyA, n), [l2, u2] = wilson95(both + onlyB, n);
  const den = (both + onlyA) * (onlyB + neither) * (both + onlyB) * (onlyA + neither);
  const phi = den === 0 ? 0 : (both * neither - onlyA * onlyB) / Math.sqrt(den);
  const lo = difference - Math.sqrt(Math.max(0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2));
  const hi = difference + Math.sqrt(Math.max(0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2));
  return { kind: 'sampled', difference, precision_95: [Math.max(-1, lo), Math.min(1, hi)], draws: n, differ: onlyA + onlyB };
}

/** Whether the draws separate the two results: an exact gap that is not zero, or a paired interval clear of zero. */
export const separated = (p: PairedDifference): boolean =>
  p.kind === 'exact' ? p.difference !== 0 : p.kind === 'sampled' && (p.precision_95[0] > 0 || p.precision_95[1] < 0);
