/**
 * Paul's try-guide step 4 (DL 58e392, 8 Oct): ISL's GOAL_LEVEL_FROM_IDENTITY_INPUTS said "…give today: 12,250.00 in its own
 * units; …" for a £-a-month MRR. The served warning and graph are the stored Run fixture (goal-reach run 2, 53e2ddbd).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalLevelWords, withGoalLevelInGoalUnits } from '../goal-level-in-goal-units.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-served-run2-53e2ddbd.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Record<string, unknown>[] }; analysis_result: { enrichment: { inference_warnings: Record<string, unknown>[] } };
};
const SERVED = served.analysis_result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_LEVEL_FROM_IDENTITY_INPUTS')!;
const SERVED_WORDS = 'MRR has no level stated for today, so the chance of reaching the goal is measured from the level its inputs give today: 12,250.00 in its own units; Paying Pro subscribers is Olumi\'s estimate, so this is Olumi\'s estimate of today\'s MRR, not the user\'s.';

describe('the goal’s derived level in the goal’s own units', () => {
  it('CONTROL: the served warning is verbatim the try-guide’s words', () => {
    expect(SERVED.message).toBe(SERVED_WORDS);
  });

  it('RED (served): "12,250.00 in its own units" → "£12,250 a month"; every other word, and every other warning, unchanged', () => {
    const out = withGoalLevelInGoalUnits(served.analysis_result, served.graph);
    const warnings = out.enrichment.inference_warnings;
    expect(warnings.find((w) => w.code === 'GOAL_LEVEL_FROM_IDENTITY_INPUTS')!.message).toBe(SERVED_WORDS.replace('12,250.00 in its own units', '£12,250 a month'));
    expect(warnings.filter((w) => w.code !== 'GOAL_LEVEL_FROM_IDENTITY_INPUTS')).toEqual(
      served.analysis_result.enrichment.inference_warnings.filter((w) => w.code !== 'GOAL_LEVEL_FROM_IDENTITY_INPUTS'));
  });

  it('CONTROL (unreadable unit): the bare number, WITHOUT "in its own units"; no unit is invented', () => {
    const graph = { nodes: [{ id: 'mrr', kind: 'goal', label: 'Momentum', unit: 'zq#%' }] };
    const out = withGoalLevelInGoalUnits({ inference_warnings: [{ ...SERVED, node_id: 'mrr' }] }, graph);
    const said = (out.inference_warnings[0] as Record<string, unknown>).message as string;
    expect(said).toContain('give today: 12,250; ');
    expect(said).not.toMatch(/own units|£|GBP/);
  });

  it('a count unit the shared reader reads is said in it; a non-matching warning and an envelope with none are the same object', () => {
    expect(goalLevelWords(1200, { label: 'Customers', unit: 'subscribers' })).toBe('1,200 subscribers');
    const none = { inference_warnings: [{ code: 'OTHER', message: '5.00 in its own units; x' }] };
    expect(withGoalLevelInGoalUnits(none, served.graph)).toBe(none);
    const empty = { enrichment: {} };
    expect(withGoalLevelInGoalUnits(empty, served.graph)).toBe(empty);
  });

  it('bounded: 20k digits / spaces in a warning message < 50 ms', () => {
    for (const filler of ['1'.repeat(20_000), ' '.repeat(20_000)]) {
      const start = performance.now();
      withGoalLevelInGoalUnits({ inference_warnings: [{ code: 'GOAL_LEVEL_FROM_IDENTITY_INPUTS', message: `today: ${filler} in its own units; x` }] }, served.graph);
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
});
