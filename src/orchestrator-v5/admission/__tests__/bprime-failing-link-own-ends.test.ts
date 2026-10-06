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
 *
 * The question sizes the SAME link (Science d5, #2606): an answer about the lever's whole effect on the goal, recorded
 * on an upstream link, double-counts every non-definitional link after it. Units only when both ends have their own.
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
    expect(v.failures).toEqual([{ precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'Starter monthly price', link_to: 'Starter-tier monthly recurring revenue',
      link: { from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' }, links: [
        { from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' },
        { from: 'starter_subscribers', to: 'starter_tier_monthly_recurring_revenue' },
      ] }]);
    expect(g.edges.some((e: Json) => e.from === 'starter_monthly_price' && e.to === 'monthly_recurring_revenue')).toBe(false);
  });

  it('d3: the readiness sentence and the B′ tail name "Starter monthly price → Starter-tier monthly recurring revenue", never a Starter monthly price → goal link', () => {
    const g = withPriceLinkSized();
    const v = targetTestabilityOf(g);
    // R10 composition: P0's complete reason list; #2606's SAME first-link question below.
    // ⭐ RE-PINNED (Science d5 #87 6010444174, on FA1 6010078697): "Starter-tier MRR" is a definitional part of MRR (+1 £/month
    // per £/month), so it reads £/month and the upstream question is asked in its own ends' units. The ask and the writer
    // must agree: the writer takes this answer in £/month (the old unitless question invited one it could not place).
    const link = 'a size for the links from Starter monthly price to Starter-tier monthly recurring revenue and from Starter subscribers to Starter-tier monthly recurring revenue';
    const sentence = notTargetTestableSentence(g, v);
    const tail = untestableTargetTail(g, v);
    expect(sentence).toBe(`Olumi can compare your options, but can't yet test them against your target (at least £150,000 / month), because it needs ${link}. `
      + 'Roughly how much does Starter-tier monthly recurring revenue change, in £/month, when Starter monthly price rises by £1 / subscriber / month?');
    expect(tail).toBe(`I can't yet say how likely any option is to keep monthly recurring revenue at or above £150,000 / month: I need ${link}. `
      + 'Roughly how much does Starter-tier monthly recurring revenue change, in £/month, when Starter monthly price rises by £1 / subscriber / month?');
    for (const s of [sentence, tail]) {
      expect(s).not.toContain('link from Starter monthly price to monthly recurring revenue');
      expect(s).not.toMatch(/how much monthly recurring revenue/);
    }
  });

  it('d3 with the far end in its own unit: the question asks in both ends\' units', () => {
    const g = withPriceLinkSized();
    // Its level in £/month (the reader the RT-6 sizing route uses, `linkEffectEndUnits`, reads the level's unit).
    g.nodes.find((n: Json) => n.id === 'starter_tier_monthly_recurring_revenue').observed_state = { unit: '£/month', value: 0, raw_value: 0, cap: 50000, source: 'cee_inference' };
    const v = targetTestabilityOf(g);
    expect(v.kind === 'not_testable' && v.failures[0]).toMatchObject({ link: { from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' } });
    expect(notTargetTestableSentence(g, v)).toMatch(/ Roughly how much does Starter-tier monthly recurring revenue change, in £\/month, when Starter monthly price rises by £1 \/ subscriber \/ month\?$/);
  });

  it('CONTRAST: as stored, the failing link IS into the goal, so the goal is its far end and AIQ\'s question (in the goal\'s unit) stays', () => {
    const v = targetTestabilityOf(D3);
    expect(v.kind === 'not_testable' && v.failures[0]).toMatchObject({ lever: 'Existing-price increase', link_to: 'monthly recurring revenue' });
    expect(notTargetTestableSentence(D3, v)).toBe("Olumi can compare your options, but can't yet test them against your target (at least £150,000 / month), "
      + 'because it needs a size for the links from Existing-price increase to monthly recurring revenue, from Starter monthly price to Starter-tier monthly recurring revenue and from Starter subscribers to Starter-tier monthly recurring revenue. '
      + 'Roughly how much monthly recurring revenue in £/month does a change in Existing-price increase bring?');
  });
});
