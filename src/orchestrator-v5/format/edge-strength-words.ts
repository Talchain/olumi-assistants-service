import { linkSizing, type LinkSizing } from '../../cee/magnitude/link-sizing.js';
import { CANVAS_BAND_WORD, edgeBandFromMagnitude } from './edge-strength-bands.js';
import { NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

type Form = 'band' | 'direction' | 'relationship' | 'bidirected' | 'compact-adverb';
const commonCause = 'unmeasured common cause (not a causal route)';
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const sizings: readonly LinkSizing[] = ['user', 'placeholder', 'olumi_accepted', 'olumi_estimate', 'unmarked'];

/**
 * Science 393023 LICENCE ruling 3 (P53x): the edge, rather than its default mean, owns the words.
 * Internal compact/structure projections carry the canonical sizing read at the edge boundary.
 * A placeholder's prior never names a strength; sized links keep each surface's existing vocabulary.
 */
export function edgeStrengthWords(edge: unknown, form: Form = 'band'): string {
  const e = record(edge);
  const carried = e?.sizing;
  const canonical = linkSizing(edge);
  const sizing = canonical === 'placeholder' ? canonical
    : typeof carried === 'string' && sizings.includes(carried as LinkSizing) ? carried as LinkSizing : canonical;
  if (sizing === 'placeholder') {
    return form === 'bidirected' ? `not sized yet, ${commonCause}` : 'not sized yet';
  }
  const strength = e?.strength;
  // The formatter's usable-mean order (Codex #2819 r3 P2): a finite object mean, else a finite legacy strength_mean.
  const objectMean = record(strength)?.mean;
  const rawMean = typeof strength === 'number' && Number.isFinite(strength) ? strength
    : typeof objectMean === 'number' && Number.isFinite(objectMean) ? objectMean : e?.strength_mean;
  const mean = typeof rawMean === 'number' ? rawMean : Number.NaN;
  // Compact numeric strength is already signed; only canonical/legacy object forms carry a sign override.
  const signed = (form === 'relationship' || form === 'bidirected') && typeof strength !== 'number'
    && e?.effect_direction === 'negative' && mean >= 0 ? -mean : mean;
  const abs = Math.abs(signed);
  // The compactor's established adverbs use its historical cuts, independently of canvas band nouns.
  if (form === 'compact-adverb') return abs >= 0.7 ? 'strongly' : abs >= 0.4 ? 'moderately' : 'weakly';
  const negligible = !Number.isFinite(signed) || abs < NEAR_ZERO_INFLUENCE_THRESHOLD;
  if (form === 'relationship' || form === 'bidirected') {
    const phrase = negligible ? 'negligible' : `${CANVAS_BAND_WORD[edgeBandFromMagnitude(abs)]} ${signed < 0 ? 'negative' : 'positive'}`;
    return form === 'bidirected' ? `${phrase} co-movement, ${commonCause}` : `${phrase} link`;
  }
  if (form === 'direction' && abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'no material influence';
  const band = CANVAS_BAND_WORD[edgeBandFromMagnitude(Number.isFinite(abs) ? abs : 0)];
  return form === 'direction' && signed < 0 ? `${band} (negative)` : band;
}
