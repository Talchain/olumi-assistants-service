/** Unit-proof precondition only: the brief stops this half when no typed outcome scale/unit proof exists. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';

type Rec = Record<string, unknown>;
const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/waveB-pilot-t1b-86ccaf3-turn003.json', import.meta.url), 'utf8')) as {
  draft_graph: Rec;
  blocks: { type: string; enrichment: { option_comparison: Rec[] } }[];
};
const envelope = served.blocks.find((b) => b.type === 'analysis_result')!.enrichment;
const goalId = 'monthly_recurring_revenue';
const raise = 'raise_prices_by_10';
const launch = 'launch_starter_tier';

describe('spread note unit-proof precondition — STOP, not a implemented disclosure', () => {
  it('served T1b: Launch has the closer mean and higher raw chance; no typed proof, no note', () => {
    const a = envelope.option_comparison.find((r) => r.option_id === launch)!;
    const b = envelope.option_comparison.find((r) => r.option_id === raise)!;
    expect(Math.abs((a.outcome as Rec).mean as number - 126000)).toBeLessThan(Math.abs((b.outcome as Rec).mean as number - 126000));
    expect(a.probability_of_goal).toBeGreaterThan(b.probability_of_goal as number);
    const licence = goalChanceLicenceOf(envelope, served.draft_graph, goalId)!;
    expect(licence).not.toBeNull();
    expect(licence.pct_by_option).toHaveProperty(raise);
    expect(licence.pct_by_option).toHaveProperty(launch);
    expect(licence).not.toHaveProperty('spread_note_by_option');
  });
  it('T1b-shaped apparent reversal still emits nothing: finite means and a goal cap/unit are not typed outcome proof', () => {
    const variant = structuredClone(envelope);
    const a = variant.option_comparison.find((r) => r.option_id === launch)!;
    const b = variant.option_comparison.find((r) => r.option_id === raise)!;
    a.probability_of_goal = 0.30;
    b.probability_of_goal = 0.60;
    delete a.probability_of_goal_precision;
    delete b.probability_of_goal_precision;
    const licence = goalChanceLicenceOf(variant, served.draft_graph, goalId)!;
    expect(licence).not.toBeNull();
    expect(licence.pct_by_option[launch]).toBe(30);
    expect(licence.pct_by_option[raise]).toBe(60);
    expect(licence).not.toHaveProperty('spread_note_by_option');
  });
});
