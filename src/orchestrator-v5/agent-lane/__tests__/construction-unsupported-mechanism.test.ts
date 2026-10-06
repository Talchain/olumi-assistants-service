/**
 * ⭐ G1b: OLUMI'S OWN HYPOTHESIS NEVER SILENTLY CHANGES THE USER'S RESULT (Science d5 #87 6011168471; DL rulings 6 Oct;
 * Desk 6b lease check; MC 21 ceiling #87 6011155077). e7's #2644 witness failed 3 of 6 T1b drafts on a mechanism the brief
 * neither sizes nor says. Each served draft is read back into the candidate it registered from
 * (fixtures/g1-2644-invented-mechanisms.json), built through the real register door, and the Run's own gates are read on the
 * registered graph (placeholder paths, P5), with each product the Run evaluates. Bound by node and edge identity.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { reachedGoalPaths, targetTestabilityOf } from '../../admission/target-testability.js';
import { OLUMI_GUESS_LIMIT_REASON, placeholderMovedOptions } from '../../../orchestrator/context/placeholder-parts.js';
import { collapsedChains, withoutUnsupportedMechanisms } from '../unsupported-mechanism.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/g1-2644-invented-mechanisms.json', import.meta.url), 'utf8')) as Rec;
const BRIEF: string = FX.brief;
const S1 = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const S2 = 'Each lost customer removes £300 a month of monthly recurring revenue.';
const GOAL = 'monthly recurring revenue';

async function build(first: Rec, opts: { brief?: string; retry?: (x: Rec) => Rec } = {}): Promise<{ r: Rec; g: Rec; trace: Rec; calls: number }> {
  let g: Rec | null = null; let calls = 0; let trace: Rec = {};
  const call = (async (req: { input: string }) => {
    calls += 1;
    if (calls === 1 || opts.retry === undefined) return { text: JSON.stringify(first) };
    const asked = JSON.parse(req.input.slice(req.input.indexOf(': {', req.input.indexOf('Candidate to repair')) + 2)) as Rec;
    return { text: JSON.stringify(opts.retry(asked)) };
  }) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { g = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const r = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', opts.brief ?? BRIEF, dispatch, call, (t) => { trace = t as unknown as Rec; }) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
  return { r, g: g!, trace, calls };
}
/** The Run's own gates on the registered graph, with each product it evaluates (as a Run would, `identity_evaluations`). */
function gates(g: Rec): { placeholder: string[]; target: string; failures: string[] } {
  const options = g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id);
  const evals = g.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({ node_id: n.id, evaluated: true,
    operation: n.nonlinear_identity.operation, factor_ids: n.nonlinear_identity.factor_ids }));
  const v = targetTestabilityOf(g, evals) as Rec;
  return { placeholder: [...new Set(unsizedLeaderGoalPaths(g, options, evals).flatMap((p) => p.links.map((l) => `${l.from}->${l.to}`)))],
    target: v.kind, failures: (v.failures ?? []).map((f: Rec) => f.code) };
}
const ids = (g: Rec): string[] => g.nodes.map((n: Rec) => n.id);
const L = (from: string, to: string, direction: string, amount: number | null = null, per: number | null = null, prov: string | null = null) =>
  ({ from, to, direction, provenance: prov === 'explicit' ? 'explicit' : 'inferred', effect_amount: amount, effect_per_source_change: per, effect_provenance: prov });
const challenge = (m: string): string => `Olumi hasn’t modelled ‘${m}’; it could lower ‘${GOAL}’. Add it and say roughly how much if you think it matters.`;

describe('rule 1: a mechanism the brief neither sizes nor says is not drafted, and is challenged where the user sees it', () => {
  it('RED (served d1): ‘Starter-tier service degradation’ is not drafted; the first Run\'s gates now give per-option chances', async () => {
    const { r, g } = await build(FX['draft-1']);
    expect(ids(g)).not.toContain('starter_tier_service_degradation');
    expect(r.open_questions).toContain(challenge('Starter-tier service degradation'));
    expect(r.not_represented).toContain(challenge('Starter-tier service degradation'));
    // The user's £6 support figure stays in the model, said as a cost that moves no revenue (rule 3).
    expect(ids(g)).toContain('starter_support_cost');
    expect(r.not_represented).toContain('‘Starter support cost’ is a cost, so it doesn’t change ‘monthly recurring revenue’; it would matter for profit.');
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('RED (served d2): ‘MRR lost to starter cannibalisation’ is not drafted; with the cost off revenue, chances show', async () => {
    const { r, g } = await build(FX['draft-2']);
    expect(ids(g)).not.toContain('mrr_lost_to_starter_cannibalisation');
    expect(r.open_questions).toContain(challenge('MRR lost to starter cannibalisation'));
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('CONTROL (d5\'s contrast): the brief mentions it in other words and the drafter marks it the brief\'s → KEPT', async () => {
    const c = structuredClone(FX['draft-2']);
    c.risks.find((x: Rec) => x.label === 'MRR lost to starter cannibalisation').provenance = 'explicit';
    const { r, g } = await build(c, { brief: `${BRIEF} Some existing customers may downgrade to the starter tier.` });
    expect(ids(g)).toContain('mrr_lost_to_starter_cannibalisation');
    expect([...(r.open_questions ?? []), ...(r.not_represented ?? [])].filter((x: string) => x.includes('cannibalisation') && x.includes('hasn’t modelled'))).toEqual([]);
  });
  it('CONTROL: a brief sentence naming every content word of the label keeps it, whatever the drafter marked', async () => {
    const c = structuredClone(FX['draft-1']);
    const { g } = await build(c, { brief: `${BRIEF} We worry about starter-tier service degradation.` });
    expect(ids(g)).toContain('starter_tier_service_degradation');
  });
  it('CONTROL: a figure the brief WRITES on a link at the mechanism keeps it, even as Olumi\'s estimate (£6)', async () => {
    const c = structuredClone(FX['draft-1']);
    Object.assign(c.links.find((l: Rec) => l.to === 'Starter-tier service degradation'), { effect_amount: 6, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    expect(withoutUnsupportedMechanisms(c, BRIEF).mechanisms.map((m) => m.label)).not.toContain('Starter-tier service degradation');
  });
  it('CONTROL: a brief figure on a link at the mechanism keeps it', async () => {
    const c = structuredClone(FX['draft-1']);
    const e = c.links.find((l: Rec) => l.from === 'Starter-tier service degradation');
    Object.assign(e, { effect_amount: -300, effect_per_source_change: 1, effect_provenance: 'explicit', provenance: 'explicit' });
    const { g } = await build(c);
    expect(ids(g)).toContain('starter_tier_service_degradation');
  });
  it('CONTROL (Desk 6b / DL 1): a level-less, inferred operand the rate × count mint WILL multiply is never dropped', async () => {
    // ‘Entry-plan adopters’: no brief sentence names it, no figure on its links, not set by an option.
    const c = {
      goal: FX['draft-1'].goal, constraints: [], unknowns: [], decision_question: null, risks: [], identities: [],
      options: [
        { label: 'Launch starter tier', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [
          { factor_label: 'Starter tier launched', value: 1, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' },
          { factor_label: 'Starter tier monthly price', value: 49, value_kind: 'absolute', unit: 'GBP per subscriber per month', provenance: 'ai_proposed' }] },
        { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      ],
      factors: [
        { label: 'Starter tier launched', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '', provenance: 'ai_proposed', plausible_max: 1 },
        { label: 'Starter tier monthly price', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP per subscriber per month', provenance: 'ai_proposed', plausible_max: 200 },
        { label: 'Entry-plan adopters', role: 'observable', baseline_known: false, baseline_value: 0, unit: 'subscribers', provenance: 'inferred', plausible_max: 1000 },
      ],
      outcomes: [{ label: 'Starter-tier MRR', provenance: 'inferred', unit: 'GBP per month', plausible_max: 50000 }],
      links: [L('Starter tier launched', 'Entry-plan adopters', 'positive'),
        L('Starter tier monthly price', 'Starter-tier MRR', 'positive'), L('Entry-plan adopters', 'Starter-tier MRR', 'positive'),
        { ...L('Starter-tier MRR', GOAL, 'positive', 1, 1, 'ai_proposed'), definitional: true },
        // A second way for the option to reach the goal, so only the mint keeps the count (never the option-path keep).
        L('Starter tier monthly price', 'Price-sensitive churn', 'positive'), L('Price-sensitive churn', GOAL, 'negative')],
    };
    (c.risks as Rec[]).push({ label: 'Price-sensitive churn', provenance: 'inferred' });
    const { g } = await build(c);
    expect(ids(g)).toContain('entry_plan_adopters');
    expect(g.nodes.find((n: Rec) => n.id === 'starter_tier_mrr')?.nonlinear_identity?.factor_ids).toContain('entry_plan_adopters');
  });
});

describe('the repair retry is held to rule 1', () => {
  it('a coverage retry that re-draws ‘Starter-tier service degradation’ has it taken out again, and it stays said', async () => {
    const c = structuredClone(FX['draft-1']);
    const raise = c.options.find((o: Rec) => o.label === 'Raise prices 10%');
    const kept = raise.interventions; raise.interventions = []; raise.changes = ['Price rise'];
    const { r, g, trace } = await build(c, { retry: (x) => ({ ...x,
      options: x.options.map((o: Rec) => (o.label === 'Raise prices 10%' ? { ...o, interventions: kept } : o)),
      risks: [...x.risks, { label: 'Starter-tier service degradation', provenance: 'inferred' }],
      links: [...x.links, L('Starter support cost', 'Starter-tier service degradation', 'positive'), L('Starter-tier service degradation', GOAL, 'negative')] }) });
    expect(trace.retried).toBe(true);
    expect(ids(g)).not.toContain('starter_tier_service_degradation');
    expect(r.open_questions).toContain(challenge('Starter-tier service degradation'));
  });
});

describe('rule 3: a cost quantity never enters a revenue goal as accounting; a causal spend lever always stays', () => {
  it('RED (served d2): ‘Starter-tier support cost’ → MRR (drawn negative, unsized) is taken off and said', async () => {
    const { r, g } = await build(FX['draft-2']);
    expect(g.edges.filter((e: Rec) => e.from === 'starter_tier_support_cost' && e.to === 'monthly_recurring_revenue')).toEqual([]);
    expect(r.not_represented).toContain('‘Starter-tier support cost’ is a cost, so it doesn’t change ‘monthly recurring revenue’; it would matter for profit.');
    // A statement, never one of the two visible question slots (DL).
    expect((r.open_questions ?? []).filter((x: string) => x.includes('is a cost'))).toEqual([]);
  });
  it('CONTROL (d5): on a PROFIT goal the same cost link is kept', async () => {
    const c = structuredClone(FX['draft-2']);
    const profit = 'monthly profit';
    c.goal = { ...c.goal, metric: profit };
    c.links = c.links.map((l: Rec) => ({ ...l, to: l.to === GOAL ? profit : l.to, from: l.from === GOAL ? profit : l.from }));
    const { r, g } = await build(c);
    expect(g.edges.some((e: Rec) => e.from === 'starter_tier_support_cost' && e.to === 'monthly_profit')).toBe(true);
    expect((r.not_represented ?? []).filter((x: string) => x.includes('is a cost'))).toEqual([]);
  });
  it('CONTROL (Desk 6b / DL 3, d5 mutant): a causal spend lever into revenue ("Ad spend" → MRR) is never barred', async () => {
    const c = structuredClone(FX['draft-2']);
    c.factors.push({ label: 'Ad spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP per month', provenance: 'inferred', plausible_max: 10000 });
    c.options[0].interventions.push({ factor_label: 'Ad spend', value: 2000, value_kind: 'absolute', unit: 'GBP per month', provenance: 'ai_proposed' });
    c.links.push(L('Ad spend', GOAL, 'positive'));
    const { r, g } = await build(c);
    expect(g.edges.some((e: Rec) => e.from === 'ad_spend' && e.to === 'monthly_recurring_revenue')).toBe(true);
    expect((r.not_represented ?? []).filter((x: string) => x.includes('‘Ad spend’'))).toEqual([]);
  });
  it('CONTROL (d5 mutant): an outside SPEND that moves revenue ("Competitor ad spend", drawn negative, unsized) is causal: kept', async () => {
    const c = structuredClone(FX['draft-2']);
    c.factors.push({ label: 'Competitor ad spend', role: 'external', baseline_known: false, baseline_value: 0, unit: 'GBP per month', provenance: 'inferred', plausible_max: 100000 });
    c.links.push(L('Competitor ad spend', GOAL, 'negative'));
    // The brief names it (so rule 1 keeps it): only rule 3 could bar it.
    const { r, g } = await build(c, { brief: `${BRIEF} Competitors spend heavily on ads.` });
    expect(g.edges.some((e: Rec) => e.from === 'competitor_ad_spend' && e.to === 'monthly_recurring_revenue')).toBe(true);
    expect((r.not_represented ?? []).filter((x: string) => x.includes('‘Competitor ad spend’ is a cost'))).toEqual([]);
  });
  it('CONTROL: a cost link with a causal size (−0.5 per £1) is a claim, never accounting: kept', async () => {
    const c = structuredClone(FX['draft-2']);
    Object.assign(c.links.find((l: Rec) => l.from === 'Starter-tier support cost' && l.to === GOAL), { effect_amount: -0.5, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    const { g } = await build(c);
    expect(g.edges.some((e: Rec) => e.from === 'starter_tier_support_cost' && e.to === 'monthly_recurring_revenue')).toBe(true);
  });
});

describe('rule 2 (served d4): the user\'s chain collapsed into Olumi\'s £600 is asked of the retry, drawn as the user wrote it', () => {
  /** The retry the issue asks for: ‘Customers lost to price rise’ counted, one link per user statement, no product. */
  const usersChain = (x: Rec): Rec => ({
    ...x,
    risks: x.risks.filter((r: Rec) => r.label !== 'MRR lost to price-driven churn'),
    outcomes: [...x.outcomes, { label: 'Customers lost to price rise', provenance: 'explicit', unit: 'customers', plausible_max: 400 }],
    links: [...x.links.filter((l: Rec) => l.from !== 'MRR lost to price-driven churn' && l.to !== 'MRR lost to price-driven churn'),
      L('Price rise', 'Customers lost to price rise', 'positive', 2, 1, 'explicit'),
      L('Customers lost to price rise', GOAL, 'negative', -300, 1, 'explicit')],
  });
  it('PRECONDITION (served): the first draft is never cut (dropping it overstates Raise) and is withheld on its £600', async () => {
    const { g, trace } = await build(FX['draft-4']);
    expect(ids(g)).toContain('mrr_lost_to_price_driven_churn');
    expect(trace.reasons?.chain).toBe(1);
    expect(gates(g).failures).toContain('goal_path_unsized');
  });
  it('RED → GREEN: the retry draws both user links, bound with their quotes and range; the product is gone; chances show', async () => {
    const { g, trace } = await build(FX['draft-4'], { retry: usersChain });
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(ids(g)).not.toContain('mrr_lost_to_price_driven_churn');
    const into = g.edges.find((e: Rec) => e.from === 'price_rise' && e.to === 'customers_lost_to_price_rise');
    const out = g.edges.find((e: Rec) => e.from === 'customers_lost_to_price_rise' && e.to === 'monthly_recurring_revenue');
    expect(into.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: S1 });
    expect(into.provenance.natural_effect.stated_range).toMatchObject({ low: 1, high: 4, end: 'centre' });
    expect(out.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: S2 });
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('⛔ DOUBLE COUNT (d5 mutant row): a retry that draws the chain AND keeps the £600 is never adopted', async () => {
    const { g, trace } = await build(FX['draft-4'], { retry: (x) => { const y = usersChain(x); return { ...y, risks: x.risks, links: [...y.links, ...x.links.filter((l: Rec) => l.to === 'MRR lost to price-driven churn' || l.from === 'MRR lost to price-driven churn')] }; } });
    expect(trace.outcome).not.toBe('adopted');
    expect(ids(g)).toContain('mrr_lost_to_price_driven_churn');
    expect(ids(g)).not.toContain('customers_lost_to_price_rise');
  });
  it('DL: a failed retry (the same draft back) → the first draft, unchanged', async () => {
    const first = await build(FX['draft-4']);
    const failed = await build(FX['draft-4'], { retry: (x) => x });
    expect(failed.trace.outcome).not.toBe('adopted');
    expect(failed.g.edges.map((e: Rec) => `${e.from}->${e.to}`).sort()).toEqual(first.g.edges.map((e: Rec) => `${e.from}->${e.to}`).sort());
  });
});

describe('P5 reads only links on a goal path (Science d5, 6 Oct); a limit keeps its own check', () => {
  it('a guess into a dead end withholds nothing (served d1, once the mechanism is not drafted)', async () => {
    const { g } = await build(FX['draft-1']);
    const { toGoal } = reachedGoalPaths(g, [], new Map());
    expect(toGoal.has('starter_support_cost')).toBe(false);
    expect(g.edges.some((e: Rec) => e.to === 'starter_support_cost' && e.provenance?.mean_projected === true)).toBe(true);
    expect(gates(g).target).toBe('testable');
  });
  it('CONTROL: a guess ON a goal path still withholds (served d4 first draft)', async () => {
    expect(gates((await build(FX['draft-4'])).g).failures).toEqual(['goal_path_unsized']);
  });
  it('⛔ d5 mutant row: a dead-end LIMIT keeps its per-limit withhold on a guessed link (never through P5)', () => {
    const fx = JSON.parse(readFileSync(new URL('../../../orchestrator/context/__tests__/fixtures/b6-cloud-r1-20260930.json', import.meta.url), 'utf8')) as Rec;
    // The served cloud graph with the limited quantity cut off from the goal: a LIMIT on a dead end.
    // The served cloud graph with the limited quantity a dead end, and the ONLY guess the link into it (upstream links the
    // user's): so the per-limit withhold rests on exactly the dead-end link P5 now leaves alone.
    const served = fx.served.graph as Rec;
    const g = { ...served, edges: (served.edges as Rec[]).filter((e) => e.from !== 'migration_downtime')
      .map((e) => (e.to === 'migration_duration' ? { ...e, provenance: { source: 'user_specified' } } : e)) } as Rec;
    expect(reachedGoalPaths(g, [], new Map()).toGoal.has('migration_downtime'), 'PRECONDITION: the limit sits on a dead end').toBe(false);
    const opts = g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ option_id: n.id,
      interventions: Object.fromEntries(Object.entries(n.interventions ?? {}).map(([k, v]) => [k, (v as Rec).value])) }));
    expect([...placeholderMovedOptions('migration_downtime', g.nodes, g.edges, opts).values()]).toContain(OLUMI_GUESS_LIMIT_REASON);
  });
});

/**
 * The corpus measure's guards (DL: 0 false drops on a corpus MC did not write; Desk 6b (2)). Each row is a served draft the
 * first W1 cut dropped a node from that the brief names in other words, or a figure it writes.
 */
describe('never a false drop: served drafts whose mechanism the brief names in other words', () => {
  const run = (key: string) => {
    const x = FX.corpus[key];
    return withoutUnsupportedMechanisms(x.candidate, x.brief);
  };
  const dropped = (key: string): string[] => run(key).mechanisms.map((m) => m.label);
  it('dental (red-team nde3): ‘Appointment awareness’ is how the reminders option works (its only way to no-shows) → kept', () => {
    expect(dropped('dental-awareness')).not.toContain('Appointment awareness');
  });
  it('investor (cut5 stg4, cut6 s5t stg3): ‘Enterprise deals won’ is the brief\'s "lift our enterprise win rate" → kept', () => {
    expect(dropped('investor-deals-won')).not.toContain('Enterprise deals won');
    expect(dropped('investor-deals-won-2')).not.toContain('Enterprise deals won');
  });
  it('T1b (g1-2633t d3): ‘Higher-than-expected price-rise churn’ is the brief\'s price-rise churn → kept', () => {
    expect(dropped('t1b-higher-churn')).not.toContain('Higher-than-expected price-rise churn');
  });
  it('T1b (g1-fa9f d7): ‘Starter-tier MRR’ sized by the brief\'s £49 (as Olumi\'s estimate) → kept', () => {
    expect(dropped('t1b-starter-mrr-49')).not.toContain('Starter-tier MRR');
  });
  it('T1b (cut5 prod wire, ‘Incremental price-rise MRR’): Olumi\'s £1,200 per 1% IS the brief\'s "adds £1,200", never 4 × £300', () => {
    expect(collapsedChains(FX.corpus['t1b-1200-written'].candidate, FX.corpus['t1b-1200-written'].brief)).toEqual([]);
  });
  it('CONTROL (same corpus): the T1b support-strain mechanisms the brief never names are still dropped', () => {
    expect(withoutUnsupportedMechanisms(FX['draft-1'], BRIEF).mechanisms.map((m) => m.label)).toEqual(['Starter-tier service degradation']);
  });
});
