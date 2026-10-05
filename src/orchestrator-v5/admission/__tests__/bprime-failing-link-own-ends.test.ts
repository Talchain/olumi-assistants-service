/**
 * RT-10 B′ (Science d5, #2606 words defect): case (c) names the FAILING link by its own two ends, never "{lever} to
 * {goal}". P5 fails on the first link into the goal not sized in its unit, else on the first Olumi-guessed link
 * anywhere on an option's path; the second is often not into the goal, and "{lever} to {goal}" then names a link the
 * canvas does not have.
 *
 * Fixture: the stored T1b draw3 graph (MC P0 replay, served-graphs.json). As stored, the failing link is
 * Existing-price increase → monthly recurring revenue (into the goal). Once the user's £1,200 sentence sizes that link
 * (MC P0's Fi promotion), the failing link is Starter monthly price → Starter-tier monthly recurring revenue, which
 * is upstream of the goal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notTargetTestableSentence, targetTestabilityOf, untestableTargetTail } from '../target-testability.js';

type Json = Record<string, any>;
const D3 = JSON.parse(readFileSync(new URL('./fixtures/bprime-d3-guessed-upstream-link.json', import.meta.url), 'utf8')) as Json;

/** The draw3 graph after the user's "each 1% price rise adds £1,200 a month" sentence sizes Existing-price increase → MRR. */
const withPriceLinkSized = (): Json => {
  const g = structuredClone(D3);
  const e = g.edges.find((x: Json) => x.from === 'existing_price_increase' && x.to === 'monthly_recurring_revenue');
  e.provenance = { ...e.provenance, magnitude: 'user_stated' };
  return g;
};

describe('B′ (c) names the failing link by its own two ends', () => {
  it('precondition: once the £1,200 link is sized, the failing link is Starter monthly price → Starter-tier monthly recurring revenue (not into the goal)', () => {
    const g = withPriceLinkSized();
    const v = targetTestabilityOf(g);
    expect(v.kind).toBe('not_testable');
    if (v.kind !== 'not_testable') return;
    expect(v.failures).toEqual([{ precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'Starter monthly price', link_to: 'Starter-tier monthly recurring revenue' }]);
    expect(g.edges.some((e: Json) => e.from === 'starter_monthly_price' && e.to === 'monthly_recurring_revenue')).toBe(false);
  });

  it('d3: the readiness sentence and the B′ tail name "Starter monthly price → Starter-tier monthly recurring revenue", never a Starter monthly price → goal link', () => {
    const g = withPriceLinkSized();
    const v = targetTestabilityOf(g);
    const link = 'a size for the link from Starter monthly price to Starter-tier monthly recurring revenue';
    const sentence = notTargetTestableSentence(g, v);
    const tail = untestableTargetTail(g, v);
    expect(sentence).toBe(`Olumi can compare your options, but can't yet test them against your target (at least £150,000 / month), because it needs ${link}. `
      + 'Roughly how much monthly recurring revenue in £/month does a change in Starter monthly price bring?');
    expect(tail).toBe(`I can't yet say how likely any option is to keep monthly recurring revenue at or above £150,000 / month: I need ${link}. `
      + 'Roughly how much monthly recurring revenue in £/month does a change in Starter monthly price bring?');
    for (const s of [sentence, tail]) expect(s).not.toContain('link from Starter monthly price to monthly recurring revenue');
  });

  it('CONTRAST: as stored, the failing link IS into the goal, so the goal is its far end', () => {
    const v = targetTestabilityOf(D3);
    expect(v.kind === 'not_testable' && v.failures[0]).toMatchObject({ lever: 'Existing-price increase', link_to: 'monthly recurring revenue' });
    expect(notTargetTestableSentence(D3, v)).toContain('because it needs a size for the link from Existing-price increase to monthly recurring revenue.');
  });
});
