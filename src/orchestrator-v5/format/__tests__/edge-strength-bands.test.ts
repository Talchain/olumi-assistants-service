/**
 * ONE EDGE-STRENGTH VOCABULARY — the band a user names is the band the canvas draws.
 *
 * The defect (R&C #70 5846846471, found reviewing #1996): the Agent set a link the user
 * called "strong" to 0.825, a midpoint on the SENSITIVITY table (`influence-bands.ts`,
 * 0.3 / 0.7 / 0.95), and the canvas, whose table cuts at 0.2 / 0.4 / 0.7, drew it
 * "Very strong". A 0.5 link the canvas draws "Strong" was phrased to the Agent as
 * "moderate".
 *
 * ⚠ CROSS-REPO MIRROR. The canvas literals below are DecisionGuideAI
 * `src/canvas/domain/vocabulary.ts` `CANVAS_STRENGTH_BANDS` (slight 0–0.2 mid 0.10,
 * moderate 0.2–0.4 mid 0.30, strong 0.4–0.7 mid 0.55, veryStrong ≥0.7 mid 0.85), read
 * at UI staging `046f67ab`. They are pinned here because no shared package holds them.
 */
import { describe, expect, it } from 'vitest';

import {
  EDGE_STRENGTH_CEILING,
  EDGE_STRENGTH_CUTS,
  EDGE_STRENGTH_MIDPOINTS,
  edgeBandFromMagnitude,
  edgeBandStd,
} from '../edge-strength-bands.js';
import { AdjustEdgeStrengthSchema } from '../../tools/handlers/adjust-edge-strength.js';
import { bandFromMagnitude, type InfluenceBand } from '../influence-bands.js';
import { bidirectedRelationshipPhrase, relationshipPhrase } from '../format-graph-for-context.js';
import { formatEdgeStrengthMagnitude } from '../../tools/handlers/explanation-fallback.js';

/** The canvas's table (see header), CEE band word → [min, max, midpoint]. */
const CANVAS: Readonly<Record<InfluenceBand, readonly [number, number, number]>> = {
  weak: [0, 0.2, 0.1],
  moderate: [0.2, 0.4, 0.3],
  strong: [0.4, 0.7, 0.55],
  'very strong': [0.7, Infinity, 0.85],
};
const BANDS = Object.keys(CANVAS) as InfluenceBand[];

describe('the edge-strength table IS the canvas table', () => {
  it('cuts and midpoints equal the canvas literals, value for value', () => {
    expect(EDGE_STRENGTH_CUTS).toEqual({ moderate: 0.2, strong: 0.4, veryStrong: 0.7 });
    for (const band of BANDS) expect(EDGE_STRENGTH_MIDPOINTS[band], band).toBe(CANVAS[band][2]);
  });

  it('⭐ the band a user names is the band the canvas draws: every midpoint (the value a band is SET to) reads back as that band, on both tables', () => {
    for (const band of BANDS) {
      const set = EDGE_STRENGTH_MIDPOINTS[band];
      const [min, max] = CANVAS[band];
      expect(set >= min && set < max, `${band} midpoint ${set} inside the canvas's [${min}, ${max})`).toBe(true);
      expect(edgeBandFromMagnitude(set), band).toBe(band);
    }
  });

  it('every canvas boundary lands in the band above it; just below lands in the band beneath', () => {
    expect(edgeBandFromMagnitude(0.199)).toBe('weak');
    expect(edgeBandFromMagnitude(0.2)).toBe('moderate');
    expect(edgeBandFromMagnitude(0.399)).toBe('moderate');
    expect(edgeBandFromMagnitude(0.4)).toBe('strong');
    expect(edgeBandFromMagnitude(0.699)).toBe('strong');
    expect(edgeBandFromMagnitude(0.7)).toBe('very strong');
  });
});

describe('every EDGE-strength phrase reads the one table; SENSITIVITY keeps its own', () => {
  it('RED: a 0.55 link (the canvas\'s "Strong") is phrased "strong", not "moderate", in the Agent\'s context, both families', () => {
    expect(relationshipPhrase(0.55)).toBe('strong positive link');
    expect(relationshipPhrase(-0.85)).toBe('very strong negative link');
    expect(bidirectedRelationshipPhrase(0.5)).toMatch(/^strong positive co-movement/);
    // Unchanged below the near-zero threshold.
    expect(relationshipPhrase(0.02)).toBe('negligible link');
  });

  it('RED: the structural explanation names a 0.5 link "strong"', () => {
    expect(formatEdgeStrengthMagnitude(0.5)).toBe('strong');
    expect(formatEdgeStrengthMagnitude(-0.3)).toBe('moderate');
  });

  it('CONTRAST: sensitivity language is a different quantity and keeps its own cuts', () => {
    expect(bandFromMagnitude(0.5)).toBe('moderate');
    expect(bandFromMagnitude(0.85)).toBe('strong');
  });
});

/**
 * A6e — THE SPREAD A BAND STATES (AIQ #70 5855345225, 5855430153). A user who names a band states a RANGE of |β|,
 * not a point: the band's own width, read as uniform, is the uncertainty — std = (hi − lo)/√12 on the canvas's cuts.
 * Served `08bf9a1f`: the user's "very strong" price_sensitivity → monthly_churn kept Olumi's std 0.00375 (CV 0.4%),
 * a precision the user never claimed.
 */
describe('the spread a named band states is the band\u2019s own width, read as uniform', () => {
  it('⭐ RED: weak 0.0577, moderate 0.0577, strong 0.0866, very strong 0.0866 (AIQ\'s ruled values)', () => {
    expect(edgeBandStd('weak')).toBeCloseTo(0.0577, 4);
    expect(edgeBandStd('moderate')).toBeCloseTo(0.0577, 4);
    expect(edgeBandStd('strong')).toBeCloseTo(0.0866, 4);
    expect(edgeBandStd('very strong')).toBeCloseTo(0.0866, 4);
  });

  it('is DERIVED from the cuts the band words already use, never hand-listed: (hi − lo)/√12 on the same table', () => {
    const bounds: Record<InfluenceBand, readonly [number, number]> = {
      weak: [0, EDGE_STRENGTH_CUTS.moderate],
      moderate: [EDGE_STRENGTH_CUTS.moderate, EDGE_STRENGTH_CUTS.strong],
      strong: [EDGE_STRENGTH_CUTS.strong, EDGE_STRENGTH_CUTS.veryStrong],
      'very strong': [EDGE_STRENGTH_CUTS.veryStrong, EDGE_STRENGTH_CEILING],
    };
    for (const band of BANDS) {
      const [lo, hi] = bounds[band];
      expect(edgeBandStd(band), band).toBe((hi - lo) / Math.sqrt(12));
      // The band's own midpoint sits inside the range whose width is the spread.
      expect(EDGE_STRENGTH_MIDPOINTS[band] >= lo && EDGE_STRENGTH_MIDPOINTS[band] <= hi, band).toBe(true);
    }
  });

  it('the top band closes at the writer\'s own ceiling on |β| (the canvas leaves it open), so the ceiling is the handler\'s bound, not a second copy of it', () => {
    expect(EDGE_STRENGTH_CEILING).toBe(1);
    expect(AdjustEdgeStrengthSchema.safeParse(EDGE_STRENGTH_CEILING).success).toBe(true);
    expect(AdjustEdgeStrengthSchema.safeParse(EDGE_STRENGTH_CEILING + 1e-9).success).toBe(false);
    expect(AdjustEdgeStrengthSchema.safeParse(-EDGE_STRENGTH_CEILING).success).toBe(true);
    expect(CANVAS['very strong'][1], 'the canvas leaves very strong open-ended').toBe(Infinity);
  });
});
