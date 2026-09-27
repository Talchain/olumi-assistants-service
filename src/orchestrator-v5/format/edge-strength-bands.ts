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
import type { StrengthBand } from '@talchain/schemas/boundary';

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

/**
 * The WORD the canvas shows for each band. Only the lowest differs: the enum keeps `weak` (the tool value), and the
 * canvas's pill says "Slight". Anything the Agent reads as a description of a link uses this word, because the model
 * relays what it reads (Canvas, #2021 review: served "replaces … with weak (0.1 …)").
 */
export const CANVAS_BAND_WORD: Readonly<Record<InfluenceBand, string>> = {
  weak: 'slight',
  moderate: 'moderate',
  strong: 'strong',
  'very strong': 'very strong',
};

/**
 * ⭐ THE CONTRACT'S BAND WORD → CEE'S (schemas 0.60.0 `edge_strength_edit.band`; #2115, Canonical 5858386465).
 *
 * The canvas band pill sends the band the user chose in the contract's ONE band vocabulary (`StrengthBand`,
 * `very_strong | strong | moderate | slight`). CEE's edge writer, the Agent's tool enum and the table above speak
 * `InfluenceBand`. This is the ONE translation between them — a word map, not a second band table: the ranges stay
 * the cuts above (`edgeBandStd` reads them). `slight` is the canvas's label for CEE's `weak`, the same range
 * (`CANVAS_BAND_WORD`). Exhaustive: a new `StrengthBand` literal fails the typecheck at the `never` below.
 */
export function edgeBandFromStrengthBand(band: StrengthBand): InfluenceBand {
  switch (band) {
    case 'very_strong':
      return 'very strong';
    case 'strong':
      return 'strong';
    case 'moderate':
      return 'moderate';
    case 'slight':
      return 'weak';
    default: {
      const unmapped: never = band;
      throw new Error(`edge strength band has no CEE band word: ${String(unmapped)}`);
    }
  }
}

/** The band a link's |β| falls in. */
export function edgeBandFromMagnitude(absValue: number): InfluenceBand {
  if (absValue >= EDGE_STRENGTH_CUTS.veryStrong) return 'very strong';
  if (absValue >= EDGE_STRENGTH_CUTS.strong) return 'strong';
  if (absValue >= EDGE_STRENGTH_CUTS.moderate) return 'moderate';
  return 'weak';
}

/**
 * The top of |β| on CEE's side — the link writer's own bound (`AdjustEdgeStrengthSchema`, [-1, 1], and the
 * `edge_strength_edit` event's `magnitude ≤ 1`). The canvas leaves its top band open (`max: Infinity`, its weight
 * domain runs to 2); a stored link cannot exceed this, so it closes "very strong" for the spread below. Pinned to the
 * handler's schema by `edge-strength-bands.test.ts`, so it cannot drift into a second copy of that bound.
 */
export const EDGE_STRENGTH_CEILING = 1;

/** The |β| range a band names, on the cuts above: [lo, hi). */
function edgeBandBounds(band: InfluenceBand): readonly [number, number] {
  switch (band) {
    case 'weak':
      return [0, EDGE_STRENGTH_CUTS.moderate];
    case 'moderate':
      return [EDGE_STRENGTH_CUTS.moderate, EDGE_STRENGTH_CUTS.strong];
    case 'strong':
      return [EDGE_STRENGTH_CUTS.strong, EDGE_STRENGTH_CUTS.veryStrong];
    case 'very strong':
      return [EDGE_STRENGTH_CUTS.veryStrong, EDGE_STRENGTH_CEILING];
  }
}

/**
 * ⭐ THE SPREAD A NAMED BAND STATES (A6e; AIQ #70 5855345225, 5855430153). A user who says a link is "very strong"
 * states a RANGE of |β|, not a point, so the uncertainty their statement carries is that range read as uniform:
 * std = (hi − lo)/√12 — weak and moderate 0.0577, strong and very strong 0.0866. Derived from the same cuts the
 * band words use, never hand-listed.
 *
 * Only for a BAND the user named — to the Agent (`stated-link-band-context.ts`) or on the canvas pill (0.60.0
 * `edge_strength_edit.band`, `edgeBandFromStrengthBand`). An exact figure states no range: the spread stays Olumi's,
 * carried to the new mean (`adjust-edge-strength.ts` `olumiSpreadForMean`) and flagged `std_defaulted` (A6f, AIQ N1
 * on #2096).
 */
export function edgeBandStd(band: InfluenceBand): number {
  const [lo, hi] = edgeBandBounds(band);
  return (hi - lo) / Math.sqrt(12);
}
