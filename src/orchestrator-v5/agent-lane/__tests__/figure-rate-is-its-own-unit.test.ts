/**
 * ⛔ THE FIGURE'S OWN RATE NAMES NO ENTITY (AI Conversation #70 5848429576, served CEE 5f941f2, run
 * `bf5-ui-ATOMIC-cd6a82e4-5f941f2-1740` turns[3]→[4]). The user typed "…it sets Paid AI add-on price to £10 per month",
 * the Agent sent it with `user_stated: true`, and the approved level was stored as Olumi's estimate: the new factor has
 * no declared unit, so "month" in "per month" read as "Monthly churn rate" / "Pro plan monthly price" — another
 * entity — and the user's figure was disowned. A "per X", "/X", "a X", "each X" or "every X" right after a figure is
 * its denominator (its unit), whatever unit the factor declares.
 *
 * Labels are the served graph's (turn 3 `draft_graph`, scopeIn: factors and the goal, never options or the decision).
 */
import { describe, it, expect } from 'vitest';
import { figureTheUserWroteFor } from '../stated-by-user.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import { ProposalStore } from '../proposal.js';

const SERVED_LABELS = ['MRR', 'Pro plan monthly price', 'AI feature release availability', 'Monthly churn rate', 'Paying Pro subscribers', 'Price-sensitive customer loss', 'Paid AI add-on price'];
const scopeOf = (...target: string[]) => ({ target, others: SERVED_LABELS.filter((l) => !target.includes(l)) });
const ADD_ON = scopeOf('Paid AI add-on price', 'Keep £49 and add a paid AI add-on');
const SERVED_TEXT = 'For "Test £54 versus £59 by customer cohort before rollout": use £54 per month as its Pro plan price, and it lowers Monthly churn rate to 6%. For "Keep £49 and add a paid AI add-on": it sets Paid AI add-on price to £10 per month.';

describe('a rate written right after the figure is the figure\'s unit, not another entity', () => {
  it('RED (served): "it sets Paid AI add-on price to £10 per month" is the user\'s £10 for the add-on price, with no unit on the factor', () => {
    expect(figureTheUserWroteFor(10, undefined, SERVED_TEXT, ADD_ON)).toBe(true);
  });

  it('RED: the other ways a rate is written — "/month", "a month", "each month", "per seat" — bind the same way', () => {
    for (const t of [
      'It sets Paid AI add-on price to £10/month.',
      'It sets Paid AI add-on price to £10 a month.',
      'It sets Paid AI add-on price to £10 each month.',
      'It sets Paid AI add-on price to £10 per seat.',
    ]) expect(figureTheUserWroteFor(10, undefined, t, ADD_ON), t).toBe(true);
  });

  it('CONTRAST (served, same sentence): the cohort\'s £54 on a price declared in GBP per month stays the user\'s', () => {
    expect(figureTheUserWroteFor(54, 'GBP per month', SERVED_TEXT, scopeOf('Pro plan monthly price', 'Test £54 versus £59 by customer cohort before rollout'))).toBe(true);
  });

  it('CONTROL: skipping the rate never hands the figure to the target — a figure written about another entity stays not the user\'s', () => {
    // The entity is BEFORE the figure: "Monthly churn rate rises 10 per month" is about churn, never the add-on price.
    expect(figureTheUserWroteFor(10, undefined, 'Monthly churn rate rises 10 per month.', ADD_ON)).toBe(false);
    // The entity is right AFTER the rate: "£10 per month of MRR" is about MRR.
    expect(figureTheUserWroteFor(10, undefined, 'That is £10 per month of MRR.', ADD_ON)).toBe(false);
    // Without a rate marker the next word is still read: "£10 churn" names churn.
    expect(figureTheUserWroteFor(10, undefined, 'It costs £10 churn money for the price.', ADD_ON)).toBe(false);
  });
});

describe('the consumer: the level the user wrote is proposed as THEIRS (where the served provenance was decided)', () => {
  // The served shape: the add-on price is a NEW factor with no value, no range and no unit.
  const nodes = [
    { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
    { id: 'fac_pro_plan_monthly_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month' } },
    { id: 'fac_monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', observed_state: { value: 0.05, unit: 'percent per month' } },
    { id: 'fac_paid_ai_add_on_price', kind: 'factor', label: 'Paid AI add-on price' },
    { id: 'opt_add_on', kind: 'option', label: 'Keep £49 and add a paid AI add-on', interventions: null },
  ];
  const d: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes, edges: [] }, graph_hash: 'h0' } });
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-446655440000', authenticated_user_id: 'user-a', request_id: 'r', user_text: SERVED_TEXT };

  it('RED (served turns[3]): user_stated £10 per month on the unit-less add-on price → authored_by user_stated, not disowned', async () => {
    const store = new ProposalStore();
    const caps = createAgentCapabilities(d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Keep £49 and add a paid AI add-on', factor_label: 'Paid AI add-on price', value: 10, basis: 'the user: £10 per month', user_stated: true },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((r as { not_the_users_figure?: unknown }).not_the_users_figure).toBeUndefined();
    const op = store.get(String(r.proposal_id))!.operations.find((o) => o.op === 'set_option_intervention');
    expect((op!.value as { authored_by?: string; raw?: number }).authored_by).toBe('user_stated');
    expect((op!.value as { raw?: number }).raw).toBe(10);
  });
});
