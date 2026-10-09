import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABSENT_CONTROL, GOAL_FIELDS, baselineDifferences, runCensus, tokenPattern,
} from '../../scripts/ci/goal-record-census.mjs';

const baseline = JSON.parse(readFileSync(new URL('../../scripts/ci/goal-record-census-baseline.json', import.meta.url), 'utf8'));

// Auto-collected by the Required config's default include, like other contract guards.
describe('S5 goal-record census ratchet', () => {
  const census = runCensus();

  it('allows no new references and requires paid-down entries to shrink in the same PR', () => {
    expect(baselineDifferences(census, baseline).join('\n')).toBe('');
  });

  it('is non-vacuous and its generated baseline counts describe the same file sets', () => {
    expect(census.total_references).toBeGreaterThan(0);
    expect(Object.keys(baseline.references)).toEqual(GOAL_FIELDS);
    expect(baseline.source_sha).toMatch(/^[a-f0-9]{40}$/);
    for (const field of GOAL_FIELDS) {
      expect(baseline.references[field]).toEqual([...new Set(baseline.references[field])].sort());
      expect(baseline.counts[field]).toBe(baseline.references[field].length);
    }
    expect(baseline.total_references).toBe(Object.values(baseline.counts as Record<string, number>).reduce((sum, count) => sum + count, 0));
  });

  it('contrast control: present token has at least five files; absent token has zero', () => {
    expect(census.counts.goal_threshold_raw).toBeGreaterThanOrEqual(5);
    expect(census.controls[ABSENT_CONTROL]).toBe(0);
    // Actual absence alone cannot detect loss of boundaries. Exercise the
    // SAME matcher with absent-token substrings and both sides of a real token.
    for (const token of ['goal_threshold_raw', ABSENT_CONTROL]) {
      expect(tokenPattern(token).test(`node.${token};`)).toBe(true);
      expect(tokenPattern(token).test(`node.${token}_extended;`), `contrast control: ${token} suffix is not the identifier`).toBe(false);
      expect(tokenPattern(token).test(`node.prefix_${token};`), `contrast control: ${token} prefix is not the identifier`).toBe(false);
    }
  });
});
