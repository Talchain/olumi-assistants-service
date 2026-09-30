/**
 * ⛔ AN OLUMI LEVEL SOLVED FROM THE USER'S WHOLE GOAL FIGURE IS NOT EVIDENCE (DL #75 5902244799 / 5902287038; served A rep2
 * on CEE `1f9d769`, R3 `a3-1f9d769/rep2`; MG 5902271826).
 *
 * Paul's brief states total MRR ("£100k MRR … [Currently 75k]"). In rep2 the drafter modelled the Pro plan only
 * (`goal.scope.modelled`, unstated → asked), declared MRR = Pro plan price × Pro paying subscribers, and gave the
 * subscribers Olumi's level 1,530.612245 = £75,000 ÷ £49: solved FROM the user's whole figure, so the product
 * "reconciles" by construction and all of Paul's MRR becomes Pro MRR (the reply: "treats £75k … as Pro-plan-only MRR").
 * Saved wires: A 10/16 carry such a level. Real path: strict candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect, vi } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const PAUL = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const link = (from: string, to: string, direction = 'positive') => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const opt = (label: string, provenance: string, price: number, sq: boolean | null = null) => ({
  label, provenance, changes: [], is_status_quo: sq,
  interventions: [{ factor_label: 'Pro plan price', value: price, value_kind: 'absolute', unit: '£ per Pro subscriber per month', provenance }],
});

/** Rep2's shape as the drafter candidate: Pro-only scope (unstated), goal = price × subscribers, subscribers solved from £75k. */
function rep2(subscribers: number): Rec {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: '£/month', horizon_months: 12, provenance: 'explicit', frame: 'level',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit',
      scope: { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false } },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 4, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [opt('Hold price with release', 'explicit', 49, true), opt('Raise price with release', 'explicit', 59)],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£ per Pro subscriber per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro paying subscribers', role: 'observable', baseline_known: false, baseline_value: subscribers, unit: 'subscribers', provenance: 'inferred', plausible_max: 5000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3.2, unit: '%', provenance: 'inferred', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [link('Pro plan price', 'Monthly churn'), link('Monthly churn', 'Pro paying subscribers', 'negative'),
      link('Pro plan price', 'MRR'), link('Pro paying subscribers', 'MRR')],
    identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'inferred' }],
    unknowns: [],
    decision_question: 'Should we increase the Pro plan price from £49 to £59 per month?',
  };
}

function build(candidate: Rec) {
  let registered: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief('99999999-9999-4999-8999-99999999a3a3', PAUL, dispatch, fn).then((r) => ({ r: r as Rec, g: registered as unknown as Rec }));
}
const subs = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.label === 'Pro paying subscribers')!;

describe('PRECONDITION — the served rep2 shape reaches the graph as served', () => {
  it('the candidate is strict-schema valid', () => {
    expect(strict(rep2(75000 / 49)), JSON.stringify(strict.errors?.slice(0, 2))).toBe(true);
  });
  it('as at base: the goal is price × subscribers and the subscribers carry Olumi\'s 1,530.6 solved from £75k', async () => {
    const { r, g } = await build(rep2(75000 / 49));
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
    expect(subs(g).observed_state).toMatchObject({ source: 'cee_inference' });
    expect(subs(g).observed_state.raw_value).toBeCloseTo(1530.612245, 4);
  });
});
