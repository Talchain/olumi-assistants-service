/**
 * P53x (DL 8 Oct ~04:4xZ): the agent-capabilities swap is MECHANICAL for every sized link — the helper returns byte-identical
 * band words to the old `linkBandWord(edgeBandFromMagnitude(|mean|))` / `CANVAS_BAND_WORD[...]` for every non-placeholder
 * sizing, over a 2,001-point grid of signed means. Placeholders are the only class whose words change.
 */
import { describe, expect, it } from 'vitest';
import { edgeStrengthWords } from '../edge-strength-words.js';
import { CANVAS_BAND_WORD, edgeBandFromMagnitude } from '../edge-strength-bands.js';

const SIZED = [
  { provenance: { source: 'user_specified' } },
  { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } },
  { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_accepted' } },
  { provenance: { source: 'cee_hypothesis' } },
];
describe('P53x mechanical corpus: sized links keep byte-identical band words', () => {
  it('2,001 means × 4 sized classes: helper === old CANVAS_BAND_WORD (agent-capabilities.ts linkBandWord is CANVAS_BAND_WORD[band], :481)', () => {
    let n = 0;
    for (let i = -1000; i <= 1000; i += 1) {
      const mean = i / 1000;
      for (const base of SIZED) {
        const edge = { ...base, strength: { mean, std: 0.1 } };
        const old = CANVAS_BAND_WORD[edgeBandFromMagnitude(Math.abs(mean))];
        expect(edgeStrengthWords(edge)).toBe(old);
        n += 1;
      }
    }
    expect(n).toBe(8004);
  });
  it('CONTROL: the placeholder class is the one that changes', () => {
    const edge = { provenance: { source: 'cee_hypothesis' }, defaulted: true, strength: { mean: 0.5, std: 0.125 } };
    expect(edgeStrengthWords(edge)).toBe('not sized yet');
  });
});


describe('P53x helper keeps the formatter usable-mean fallback (Codex #2819 r3 P2)', () => {
  it('an Olumi-sized a→b with an unusable object mean and strength_mean 0.5 reads strong, as at the diff base', () => {
    const edge = { from: 'a', to: 'b', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, strength: { mean: 'bad' }, strength_mean: 0.5 };
    expect(edgeStrengthWords(edge, 'relationship')).toBe('strong positive link');
  });
});
describe('P53x helper: a non-finite compact strength falls back like the formatter (Codex #2819 r4 P2)', () => {
  it('an Olumi-sized a→b with strength Infinity and strength_mean 0.5 reads strong', () => {
    const edge = { from: 'a', to: 'b', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, strength: Number.POSITIVE_INFINITY, strength_mean: 0.5 };
    expect(edgeStrengthWords(edge, 'relationship')).toBe('strong positive link');
  });
  it('(r5 P2) the same link marked negative keeps its sign after the fallback: strong negative', () => {
    const edge = { from: 'a', to: 'b', provenance: { magnitude: 'olumi_estimate' }, strength: Number.POSITIVE_INFINITY, strength_mean: 0.5, effect_direction: 'negative' };
    expect(edgeStrengthWords(edge, 'relationship')).toBe('strong negative link');
    expect(edgeStrengthWords(edge, 'bidirected')).toBe('strong negative co-movement, unmeasured common cause (not a causal route)');
    // CONTROL: a usable compact number is already signed; effect_direction does not flip it.
    expect(edgeStrengthWords({ ...edge, strength: 0.5 }, 'relationship')).toBe('strong positive link');
  });
});
