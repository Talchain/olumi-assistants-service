/**
 * A link too weak to matter is "negligible", whatever its sign, and a strength that is not a number never reads as a size.
 *
 * Deletion 11 (22 Oct 2026, Codex r3 on #3620): these rows reached the live `edgeStrengthWords` through the deleted
 * formatter's one-line wrappers (`relationshipPhrase` = `edgeStrengthWords({ strength }, 'relationship')`, and its
 * bidirected twin). Re-pointed to `edgeStrengthWords` with the same inputs and expected words.
 */
import { describe, expect, it } from 'vitest';
import { edgeStrengthWords } from '../edge-strength-words.js';

const COMMON_CAUSE = 'unmeasured common cause (not a causal route)';
const directed = (strength: number) => edgeStrengthWords({ strength }, 'relationship');
const bidirected = (strength: number) => edgeStrengthWords({ strength }, 'bidirected');

describe('edgeStrengthWords: the negligible branch', () => {
  it('treats |strength| < 0.05 as negligible (sign suppressed)', () => {
    expect(directed(0.02)).toBe('negligible link');
    expect(directed(-0.02)).toBe('negligible link');
    expect(directed(0)).toBe('negligible link');
  });

  it('handles non-finite strengths defensively', () => {
    expect(directed(Number.NaN)).toBe('negligible link');
    expect(directed(Number.POSITIVE_INFINITY)).toBe('negligible link');
  });

  it('suppresses sign below the near-zero threshold on a bidirected link, mirroring the directed path', () => {
    expect(bidirected(0.02)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirected(-0.02)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirected(0)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
  });

  it('handles non-finite strengths defensively on a bidirected link', () => {
    expect(bidirected(Number.NaN)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirected(Number.POSITIVE_INFINITY)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
  });
});
