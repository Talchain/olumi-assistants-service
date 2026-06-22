/**
 * Tier 0 S1 — proof: typed narrowing of live-shaped `blocks[0].enrichment`,
 * byte-for-byte preservation of the original, and unknown passthrough.
 *
 * Fixture: `fixtures/enrichment.sanitised.json` — a hand-authored, leak-free,
 * structurally-faithful copy of a real staging `blocks[0].enrichment` (40 keys).
 * Sanitisation: all UUIDs → all-zero, all 16-hex hashes → zeroes, node ids →
 * opt_a..opt_d / fac_a..fac_f, labels → "Option A"/"Factor A", prose → neutral
 * sentences. Two intentional size reductions (documented): `_meta.payloads` is
 * truncated to `{}` and `fact_objects` reduced to 2 entries (both are
 * metadata/passthrough that the reader does not narrow). See the leak-guard in
 * `spine-isolation.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractBlock0Enrichment, narrowScientificEnrichment } from '../enrichment-scientific-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BYTES = readFileSync(join(HERE, 'fixtures/enrichment.sanitised.json'), 'utf8');
function loadFixture(): Record<string, unknown> {
  return JSON.parse(FIXTURE_BYTES) as Record<string, unknown>;
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

describe('extractBlock0Enrichment', () => {
  it('returns blocks[0].enrichment for a live-shaped turn response', () => {
    const enrichment = loadFixture();
    const turn = { response_version: 2, blocks: [{ type: 'analysis_result', enrichment }] };
    expect(extractBlock0Enrichment(turn)).toBe(enrichment);
  });

  it('returns null (never throws) for non-conforming inputs', () => {
    const bad: unknown[] = [{}, { blocks: [] }, { blocks: [{}] }, { blocks: 'x' }, { blocks: [{ enrichment: 'x' }] }, 42, null, undefined, [], 'str'];
    for (const value of bad) {
      expect(() => extractBlock0Enrichment(value)).not.toThrow();
      expect(extractBlock0Enrichment(value)).toBeNull();
    }
  });
});

describe('narrowScientificEnrichment — typed narrowing of live-shaped enrichment', () => {
  it('produces typed sub-views with the expected shapes and counts', () => {
    const view = narrowScientificEnrichment(loadFixture());
    expect(view.factorSensitivity).toHaveLength(6);
    expect(view.factorStability).toHaveLength(6);
    expect(view.optionComparison).toHaveLength(4);
    expect(view.flipThresholds).toHaveLength(3);
    expect(view.robustness?.fragileEdges).toHaveLength(9);
    expect(view.evidenceGaps).toHaveLength(3);
    expect(view.identifiability?.status).toBe('identifiable');
    expect(view.confidenceTier).toBe('needs_work');

    // empty arrays preserved as []
    expect(view.edgeSensitivity).toEqual([]);
    expect(view.edgeEValues).toEqual([]);
    expect(view.conditionalWinners).toEqual([]);
    expect(view.inferenceWarnings).toEqual([]);

    // typed field extraction
    expect(view.optionComparison?.[0]).toMatchObject({ optionId: 'opt_a', winProbability: 0.72 });
    expect(view.optionComparison?.[0].outcome).toMatchObject({ mean: 0.72, p90: 0.88 });
    expect(view.flipThresholds?.[0]).toMatchObject({ factorId: 'fac_a', flipValue: null, flipReason: 'no_effect_within_bounds' });
    expect(view.robustness?.nearTie).toMatchObject({ isTie: false });
    expect(view.factorSensitivity?.[0]).toMatchObject({ valueOfInformation: 0.12, evpiPercentagePoints: 1.5 });
    expect(view.evidenceGaps?.[0]).toMatchObject({ factorId: 'fac_c', voiScore: 0.07, evpiMethod: 'monte_carlo' });
  });

  it('is defensive: never throws on garbage and yields nulls', () => {
    const bad: unknown[] = [null, undefined, 42, 'x', []];
    for (const value of bad) {
      const view = narrowScientificEnrichment(value);
      expect(view.factorSensitivity).toBeNull();
      expect(view.robustness).toBeNull();
      expect(view.identifiability).toBeNull();
      expect(view.unknownFields).toEqual([]);
    }
  });
});

describe('byte-for-byte preservation of original enrichment', () => {
  it('does not mutate input, returns the same raw reference, preserves bytes and key order', () => {
    const input = loadFixture();
    const before = JSON.stringify(input);

    const view = narrowScientificEnrichment(input);

    expect(JSON.stringify(input)).toBe(before); // no in-place mutation
    expect(view.raw).toBe(input); // same reference (no clone-and-substitute)
    expect(view.raw).toEqual(JSON.parse(before)); // deep structural equality
    expect(Object.keys(view.raw)).toEqual(Object.keys(JSON.parse(before) as object)); // key order preserved
  });

  it('does not throw on a deeply-frozen input', () => {
    const frozen = deepFreeze(loadFixture());
    expect(() => narrowScientificEnrichment(frozen)).not.toThrow();
    const view = narrowScientificEnrichment(deepFreeze(loadFixture()));
    expect(view.optionComparison).toHaveLength(4);
  });
});

describe('unknown passthrough', () => {
  it('routes unrecognised keys to unknownFields and preserves them verbatim', () => {
    const input = { ...loadFixture(), brand_new_key: { nested: 1 }, another_unknown: 'x' };
    const view = narrowScientificEnrichment(input);
    expect(view.unknownFields).toContain('brand_new_key');
    expect(view.unknownFields).toContain('another_unknown');
    expect(view.raw.brand_new_key).toEqual({ nested: 1 });
    expect(view.raw.another_unknown).toBe('x');
  });

  it('the 40-key live-shaped fixture has zero unknown fields', () => {
    expect(narrowScientificEnrichment(loadFixture()).unknownFields).toEqual([]);
  });
});
