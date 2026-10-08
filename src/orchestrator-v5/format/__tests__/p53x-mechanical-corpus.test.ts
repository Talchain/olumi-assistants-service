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
