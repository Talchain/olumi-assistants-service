/**
 * THE EDGE-STRENGTH BAND VOCABULARY — one table for a LINK's strength, the one the
 * user reads and sets on the canvas.
 *
 * ── WHY IT IS NOT `influence-bands.ts` ──────────────────────────────────────
 * `INFLUENCE_BAND_THRESHOLDS` (0.3 / 0.7 / 0.95) were written for SENSITIVITY — how
 * much an analysis result moves — and were reused for a link's strength (β). The
 * canvas, where a user reads a link ("Strong boost") and SETS one (the band pills),
 * cuts β at 0.2 / 0.4 / 0.7 (DecisionGuideAI `src/canvas/domain/vocabulary.ts`
 * `CANVAS_STRENGTH_BANDS`, the table its inspector, chips and pills all read). The two
 * disagreed on the same words (R&C #70 5846846471, on #1996): a user who told the Agent
 * a link is "strong" had it stored at 0.825, and the canvas drew it "Very strong"; a
 * 0.5 link the canvas draws "Strong" was narrated to the Agent as "moderate".
 *
 * So every EDGE-strength path in CEE — the Agent's band midpoints, its current-band
 * check, the link phrases in the Agent's context, the edge-adjust confirmation and
 * the structural explanation — reads THIS table. Sensitivity language keeps
 * `influence-bands.ts`: a different quantity.
 *
 * ── THE TABLE (the canvas's, value for value) ───────────────────────────────
 *   |β| < 0.2         → "weak"         (the canvas labels it "Slight"), midpoint 0.10
 *   |β| in [0.2, 0.4) → "moderate",    midpoint 0.30
 *   |β| in [0.4, 0.7) → "strong",      midpoint 0.55
 *   |β| ≥ 0.7         → "very strong", midpoint 0.85
 * The midpoints are the canvas pills' own (`CANVAS_STRENGTH_BANDS[].midpoint`), so a
 * band set by talking to the Agent and a band set by clicking the pill store the same
 * number. The words are CEE's existing ones (`InfluenceBand`, which the Agent's tool
 * enum and `bandTheUserWrote` already speak); only "weak" differs from the canvas's
 * "Slight" label, and it names the same range.
 *
 * ⚠ A MIRROR ACROSS A REPO BOUNDARY. There is no shared package holding this table
 * (`@talchain/schemas` carries only the `StrengthBand` names), so the values are
 * pinned by `edge-strength-bands.test.ts` against the canvas's literals. Change both
 * sides together, or neither.
 *
 * Near-zero links (|β| < `NEAR_ZERO_INFLUENCE_THRESHOLD`) are still "negligible" in
 * the link phrases; that threshold is unchanged.
 */
import type { InfluenceBand } from './influence-bands.js';

/** Lower bound of each band above the lowest, on |β|. */
export const EDGE_STRENGTH_CUTS = {
  moderate: 0.2,
  strong: 0.4,
  veryStrong: 0.7,
} as const;

/** The value a band is SET to — the canvas pills' midpoints. */
export const EDGE_STRENGTH_MIDPOINTS: Readonly<Record<InfluenceBand, number>> = {
  weak: 0.1,
  moderate: 0.3,
  strong: 0.55,
  'very strong': 0.85,
};

/** The band a link's |β| falls in. */
export function edgeBandFromMagnitude(absValue: number): InfluenceBand {
  if (absValue >= EDGE_STRENGTH_CUTS.veryStrong) return 'very strong';
  if (absValue >= EDGE_STRENGTH_CUTS.strong) return 'strong';
  if (absValue >= EDGE_STRENGTH_CUTS.moderate) return 'moderate';
  return 'weak';
}
