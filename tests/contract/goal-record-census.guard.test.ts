import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABSENT_CONTROL, GOAL_FIELDS, baselineDifferences, censusFiles, countOccurrences, runCensus, tokenPattern,
} from '../../scripts/ci/goal-record-census.mjs';

const baseline = JSON.parse(readFileSync(new URL('../../scripts/ci/goal-record-census-baseline.json', import.meta.url), 'utf8'));

// Auto-collected by the Required config's default include, like other contract guards.
describe('S5 goal-record census ratchet', () => {
  const census = runCensus();

  it('allows no new references and requires paid-down entries to shrink in the same PR', () => {
    expect(baselineDifferences(census, baseline).join('\n')).toBe('');
  });

  it('is non-vacuous and its generated baseline counts are the per-file occurrence sums', () => {
    expect(census.total_references).toBeGreaterThan(0);
    expect(Object.keys(baseline.references)).toEqual(GOAL_FIELDS);
    expect(baseline.source_sha).toMatch(/^[a-f0-9]{40}$/);
    for (const field of GOAL_FIELDS) {
      const files = Object.keys(baseline.references[field]);
      expect(files).toEqual([...files].sort());
      for (const n of Object.values(baseline.references[field] as Record<string, number>)) expect(Number.isInteger(n) && n > 0).toBe(true);
      expect(baseline.counts[field]).toBe(Object.values(baseline.references[field] as Record<string, number>).reduce((sum, n) => sum + n, 0));
    }
    expect(baseline.total_references).toBe(Object.values(baseline.counts as Record<string, number>).reduce((sum, count) => sum + count, 0));
  });

  it('ratchets occurrences, not presence: a second read in an already-listed file fails; one fewer is stale', () => {
    const [file, n] = Object.entries(baseline.references.goal_threshold_raw as Record<string, number>)[0];
    const bump = (d: number) => ({ ...census, references: { ...census.references, goal_threshold_raw: { ...census.references.goal_threshold_raw, [file]: n + d } } });
    expect(baselineDifferences(bump(1), baseline)).toEqual([expect.stringMatching(new RegExp(`^new goal reference: goal_threshold_raw in ${file} \\(${n} → ${n + 1}\\)`))]);
    expect(baselineDifferences(bump(-1), baseline)).toEqual([expect.stringMatching(new RegExp(`^stale entry: goal_threshold_raw in ${file}`))]);
    expect(countOccurrences('a.goal_threshold; b["goal_threshold"]; c.goal_threshold_raw', 'goal_threshold')).toBe(2);
  });

  it('walks tracked src/ only, with every *.test.* basename and test/fixture/prompt segment excluded', () => {
    const files = censusFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.every((f) => f.startsWith('src/'))).toBe(true);
    expect(files.some((f) => f.startsWith('src/generated/'))).toBe(false);
    expect(files.some((f) => /(^|\/)(__tests__|fixtures|prompts)\//.test(f) || f.split('/').pop()!.includes('.test.'))).toBe(false);
    // Contrast: a known tracked production reader IS walked.
    expect(files).toContain('src/orchestrator-v5/goal-target/goal-chance-licence.ts');
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
