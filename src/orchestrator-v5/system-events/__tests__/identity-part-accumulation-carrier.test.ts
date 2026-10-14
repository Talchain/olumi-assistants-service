/**
 * ⭐ SCIENCE (Paul's pricing brief, served CEE 2a35ff31, 14 Oct): "MRR = ‘Pro plan price’ × ‘Pro subscribers at month 12’",
 * where ‘Pro subscribers at month 12’ accumulates today's subscribers, new ones each month and churn over the goal's 12
 * months. The Run asked "What is ‘Pro subscribers at month 12’ today?": a month-12 figure has no level today. Its missing
 * figures are its accumulation's own inputs (the saved graph is the served one, `_source`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identityPartLevelAsk, identityPartsWithoutLevel } from '../identity-confirm-edit.js';

type Rec = Record<string, any>;
const served = (): Rec => structuredClone(JSON.parse(readFileSync('tests/fixtures/pricing-month12-stock/graph.json', 'utf8')).graph);
const parts = (g: Rec): string[] => g.nodes.find((n: Rec) => n.id === 'mrr').nonlinear_identity.factor_ids;
const askOf = (g: Rec): string => identityPartLevelAsk('MRR', ['Pro plan price', 'Pro subscribers at month 12'], identityPartsWithoutLevel(g, parts(g)));

describe('an identity part that is the stock AT the goal\'s month is asked through its own inputs, never "today"', () => {
  it('PRECONDITION: the served model, MRR = price × the month-12 stock, accumulating over the goal\'s 12 months', () => {
    const g = served();
    expect(parts(g)).toEqual(['pro_plan_price', 'pro_subscribers_at_month_12']);
    expect(g.nodes.find((n: Rec) => n.id === 'pro_subscribers_at_month_12').nonlinear_identity).toMatchObject({ operation: 'accumulation',
      factor_ids: ['pro_subscribers_today', 'monthly_pro_churn', 'new_pro_subscribers_per_month'], horizon_months: 12 });
  });

  it('RED: the missing figures are price, today\'s subscribers, new per month and churn; no month-12 figure is asked as today\'s', () => {
    const g = served();
    expect(identityPartsWithoutLevel(g, parts(g)).map((p) => p.id))
      .toEqual(['pro_plan_price', 'pro_subscribers_today', 'new_pro_subscribers_per_month', 'monthly_pro_churn']);
    const ask = askOf(g);
    expect(ask).not.toContain('‘Pro subscribers at month 12’ today');
    expect(ask).toContain('What is ‘Pro subscribers today’ today?');
    // #3113's held £49 is still confirmed, not asked blank (unchanged).
    expect(ask).toContain('Is your £49 per subscriber per month today\'s ‘Pro plan price’?');
  });

  it('CONTRAST: a stock accumulating over a different horizon than the goal\'s is not unwrapped (asked as before)', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'pro_subscribers_at_month_12').nonlinear_identity.horizon_months = 6;
    expect(identityPartsWithoutLevel(g, parts(g)).map((p) => p.id)).toEqual(['pro_plan_price', 'pro_subscribers_at_month_12']);
  });
});
