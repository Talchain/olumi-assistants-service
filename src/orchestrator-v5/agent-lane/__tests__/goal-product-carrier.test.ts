/**
 * ⛔ A GOAL WHOSE ONLY PARENT IS A PRODUCT OF THE USER'S TWO FIGURES IS THAT PRODUCT (R3 #72 5888379558 run 2; AIQ
 * 5888438944; DL 5888399097; MG 5888469185 class 1; R3 5888498516 science).
 * Row 1: R3's served run 2 on Paul's brief (CEE `ed49d44`, scenario b87e91cb-e543-4b3d-ad19-ce038983fdaf), its registered
 * graph re-expressed as the drafter candidate (labels, units, levels and links as served; checked against the strict
 * schema), through the real build. Rows 9–10 (AIQ 5888943993 class 2): two REAL live drafts of the same brief where the
 * drafter added an "Other-plan MRR" of its own. Rows 2–8, 11: every shape that must NOT fold, each returning the candidate itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import { foldProductCarrierIntoGoal, foldedCarrierLines } from '../goal-product-carrier.js';
import { readFileSync } from 'node:fs';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const PAUL = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

const opt = (label: string, provenance: string, price: number | null, sq: boolean | null = null) => ({
  label, provenance, changes: [], is_status_quo: sq,
  interventions: price === null ? [] : [{ factor_label: 'Pro plan price', value: price, value_kind: 'absolute', unit: '£/subscriber/month', provenance }],
});
const link = (from: string, to: string, direction = 'positive') => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
function run2(): Rec {
  return {
    goal: { metric: 'MRR', operator: '>', target_stated: true, value: 85000, unit: '£/month', horizon_months: 12, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 5, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [opt('Raise to £59', 'explicit', 59), opt('Keep current price', 'explicit', 49, true), opt('Raise to £54', 'ai_proposed', 54)],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£/subscriber/month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Pro paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 3000 },
    ],
    risks: [{ label: 'Price-sensitive cancellations', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro plan MRR', provenance: 'inferred' }],
    links: [
      link('Pro plan price', 'Monthly churn'), link('Price-sensitive cancellations', 'Monthly churn'),
      link('Monthly churn', 'Pro paying subscribers', 'negative'),
      link('Pro plan price', 'Pro plan MRR'), link('Pro paying subscribers', 'Pro plan MRR'),
      link('Pro plan MRR', 'MRR'),
    ],
    identities: [{ outcome: 'Pro plan MRR', operation: 'product', factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'inferred' }],
    unknowns: [],
    decision_question: 'Should we raise our Pro plan price from £49 to £59 a month?',
  };
}

function build(candidate: unknown, brief = PAUL) {
  let registered: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, fn).then((r) => ({ r: r as Rec, g: registered as unknown as Rec }));
}

describe('R3\'s served run 2 (Paul\'s brief): "Pro plan MRR" is the goal\'s only parent, so the model works MRR out as price × subscribers', () => {
  it('PRECONDITION: the re-expressed candidate is strict-schema valid, and today\'s mint alone cannot fire (the goal\'s parent is the carrier)', () => {
    expect(strict(run2()), JSON.stringify(strict.errors?.slice(0, 2))).toBe(true);
  });
  it('1 (real build) — the goal carries the product of the user\'s price and subscribers; the carrier and its plain link are gone; it is said', async () => {
    const { r, g } = await build(run2());
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    const nodes = g.nodes as Rec[];
    const goal = nodes.find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false });
    expect(nodes.some((n) => n.label === 'Pro plan MRR')).toBe(false);
    const into = (g.edges as Rec[]).filter((e) => e.to === goal.id).map((e) => e.from).sort();
    expect(into).toEqual(['pro_paying_subscribers', 'pro_plan_price']);
    // Said where the USER sees it (AIQ 5888943993 (1)(c)): the build's open questions, not only the Agent's ledger.
    expect(r.open_questions).toContain('‘Pro plan MRR’ accounts for your MRR (£49 × 1,500 = £73,500, close to your £75,000), so MRR is worked out as Pro plan price × Pro paying subscribers.');
  });
});

describe('what must NOT fold — each returns the very same candidate', () => {
  const same = (c: Rec) => expect(foldProductCarrierIntoGoal(c as CandidateModel, PAUL).model).toBe(c);
  it('2 — the subscribers are Olumi\'s estimate, not the user\'s (Baseline brief A\'s shape): no fold', () => {
    const c = run2();
    c.factors[2] = { ...c.factors[2], baseline_known: false, baseline_value: 1300, provenance: 'ai_proposed' };
    same(c);
    expect(foldProductCarrierIntoGoal(c as CandidateModel, PAUL.replace('We have 1,500 paying subscribers and', 'We have')).folded).toBeNull();
  });
  it('3 — the goal has a second parent (e.g. the user\'s other-plan MRR, an addend CEE cannot carry, R3 5888498516): no fold', () => {
    const c = run2();
    c.factors.push({ label: 'Other plan MRR', role: 'observable', baseline_known: true, baseline_value: 1500, unit: '£/month', provenance: 'explicit', plausible_max: 10000 });
    c.links.push(link('Other plan MRR', 'MRR'));
    same(c);
  });
  it('4 — the carrier feeds something else too (it is a quantity in its own right): no fold', () => {
    const c = run2();
    c.outcomes.push({ label: 'Marketing budget', provenance: 'inferred' });
    c.links.push(link('Pro plan MRR', 'Marketing budget'));
    same(c);
  });
  it('5 — the user\'s figures do not reconcile (£49 × 1,500 = £73,500 against a stated £60k, 18% off): no fold', () => {
    const c = run2();
    c.goal = { ...c.goal, baseline_value: 60000 };
    same(c);
  });
  it('6 — an option sets the carrier, or a limit sits on it: no fold', () => {
    const a = run2(); a.options[2].interventions.push({ factor_label: 'Pro plan MRR', value: 80000, value_kind: 'absolute', unit: '£/month', provenance: 'ai_proposed' }); same(a);
    const b = run2(); b.constraints.push({ metric: 'Pro plan MRR', operator: '>=', value: 70000, unit: '£/month', provenance: 'explicit', frame: 'level' }); same(b);
  });
  it('7 — the goal already carries an identity, or the carrier holds no product: no fold', () => {
    const a = run2(); a.identities.push({ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'inferred' }); same(a);
    const b = run2(); b.identities = []; same(b);
  });
  it('8 — the cloud "savings → spend" carrier (spend is not the savings): no fold', () => {
    const cloud = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
    const c = {
      goal: { metric: 'Monthly spend', operator: '<=', target_stated: true, value: -20, unit: '%', horizon_months: null, provenance: 'explicit', frame: 'change_rel', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null },
      constraints: [], options: [opt('Switch to GCP', 'explicit', null), opt('Stay on AWS', 'explicit', null, true)],
      factors: [
        { label: 'Migrated monthly spend', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '£/month', provenance: 'ai_proposed', plausible_max: 100000 },
        { label: 'GCP unit-cost saving', role: 'external', baseline_known: false, baseline_value: null, unit: 'proportion', provenance: 'ai_proposed', plausible_max: 1 },
      ],
      risks: [], outcomes: [{ label: 'Monthly cloud spend savings', provenance: 'inferred' }],
      links: [link('Migrated monthly spend', 'Monthly cloud spend savings'), link('GCP unit-cost saving', 'Monthly cloud spend savings'), link('Monthly cloud spend savings', 'Monthly spend', 'negative')],
      identities: [{ outcome: 'Monthly cloud spend savings', operation: 'product', factors: ['Migrated monthly spend', 'GCP unit-cost saving'], provenance: 'inferred' }],
      unknowns: [], decision_question: null,
    };
    expect(foldProductCarrierIntoGoal(c as unknown as CandidateModel, cloud).model).toBe(c);
  });
  it('11 — a brief that DOES state another plan (AIQ\'s row): the other plan is the user\'s, so nothing is dropped and nothing folds', () => {
    const brief = `${PAUL} Our Basic plan is £19 a month with 400 subscribers.`;
    const c = run2();
    c.factors.push({ label: 'Basic plan MRR', role: 'observable', baseline_known: true, baseline_value: 7600, unit: '£/month', provenance: 'explicit', plausible_max: 20000 });
    c.links.push(link('Basic plan MRR', 'MRR'));
    expect(foldProductCarrierIntoGoal(c as CandidateModel, brief).model).toBe(c);
  });
  it('the said lines name the user\'s own arithmetic, in AI Quality\'s words', () => {
    expect(foldedCarrierLines({ carrier: 'Pro plan MRR', goal: 'MRR', dropped: ['Other-plan MRR'], parts: [{ label: 'price', value: 49 }, { label: 'subscribers', value: 1500 }], stated: 75000, unit: '£/month' }))
      .toEqual([
        '‘Pro plan MRR’ accounts for your MRR (£49 × 1,500 = £73,500, close to your £75,000), so MRR is worked out as price × subscribers.',
        '‘Other-plan MRR’ was Olumi\'s addition, and your figures don\'t need it (£49 × 1,500 = £73,500, close to your £75,000), so it is left out.',
      ]);
  });
});

const LIVE = JSON.parse(readFileSync(new URL('./fixtures/paul-mrr-carrier-plus-invented-20260929.json', import.meta.url), 'utf8')) as { brief: string; drafts: { rep: number; candidate: Rec }[] };
describe('class 2 (AIQ 5888943993 (1)): REAL live drafts that add Olumi\'s own "Other-plan MRR" beside the carrier', () => {
  it.each(LIVE.drafts.map((d) => [d.rep, d.candidate] as const))('%s — PRECONDITION: strict-valid; the carrier and Olumi\'s other-plan MRR are the goal\'s two parents', (_rep, cand) => {
    expect(strict(cand), JSON.stringify(strict.errors?.slice(0, 2))).toBe(true);
    const into = (cand.links as Rec[]).filter((l) => l.to === cand.goal.metric).map((l) => l.from).sort();
    expect(into).toEqual(['Other-plan MRR', 'Pro plan MRR']);
    expect((cand.factors as Rec[]).find((f) => f.label === 'Other-plan MRR')!.provenance).not.toBe('explicit');
  });
  it.each(LIVE.drafts.map((d) => [d.rep, d.candidate] as const))('%s (real build) — the goal carries price × subscribers; Olumi\'s other-plan MRR is left out and said', async (_rep, cand) => {
    const { r, g } = await build(cand, LIVE.brief);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    const nodes = g.nodes as Rec[];
    const goal = nodes.find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
    expect(nodes.some((n) => n.label === 'Pro plan MRR' || n.label === 'Other-plan MRR')).toBe(false);
    expect((r.open_questions as string[]).some((q) => q.startsWith('‘Other-plan MRR’ was Olumi\'s addition, and your figures don\'t need it (£49 × 1,500 = £73,500, close to your £75,000)'))).toBe(true);
  });
  it('12 — CONTROL: an invented parent that is not money in the goal\'s currency (a score) → nothing changes', () => {
    const cand = structuredClone(LIVE.drafts[0]!.candidate);
    cand.factors = (cand.factors as Rec[]).map((f) => (f.label === 'Other-plan MRR' ? { ...f, unit: 'index points' } : f));
    expect(foldProductCarrierIntoGoal(cand as unknown as CandidateModel, LIVE.brief).model).toBe(cand);
  });
  it('13 — CONTROL: an invented parent something else feeds (a quantity in the model\'s mechanism) → nothing changes', () => {
    const cand = structuredClone(LIVE.drafts[0]!.candidate);
    (cand.links as Rec[]).push(link('Pro paying subscribers', 'Other-plan MRR'));
    expect(foldProductCarrierIntoGoal(cand as unknown as CandidateModel, LIVE.brief).model).toBe(cand);
  });
  it('CONTROL: the same draft where the other-plan level is one the brief writes → nothing changes', () => {
    const cand = structuredClone(LIVE.drafts[0]!.candidate);
    const brief = `${LIVE.brief} Other plans bring in £1,500 a month.`;
    expect(foldProductCarrierIntoGoal(cand as unknown as CandidateModel, brief).model).toBe(cand);
  });
});
