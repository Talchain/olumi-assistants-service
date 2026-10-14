/**
 * ⭐ G1b: OLUMI'S OWN HYPOTHESIS NEVER SILENTLY CHANGES THE USER'S RESULT (Science d5 #87 6011168471; DL rulings 6 Oct;
 * Desk 6b lease check; MC 21 ceiling #87 6011155077). e7's #2644 witness failed 3 of 6 T1b drafts on a mechanism the brief
 * neither sizes nor says. Each served draft is read back into the candidate it registered from
 * (fixtures/g1-2644-invented-mechanisms.json), built through the real register door, and the Run's own gates are read on the
 * registered graph (placeholder paths, P5), with each product the Run evaluates. Bound by node and edge identity.
 *
 * ⛔ AND THROUGH THE REAL RUN DOOR (stand-in for MC 21, 6 Oct): on #2662 d6470c9a these gate rows were green while
 * `resolveRunAdmission` refused the served d2 draft outright (`NO_PATH_TO_GOAL` on the support cost the cut stranded) and
 * `run_analysis` never reached PLoT. The outcome rows below read readiness and the Run handler itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { collapsedChains, costOffRevenueLine, withoutUnsupportedMechanisms } from '../unsupported-mechanism.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { SessionStore } from '../../session/store.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { textAssertsLeadingOption, textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

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
/** `run_analysis` through the production snapshot loader, PLoT faked: whether the Run reaches PLoT at all. */
async function runReachesPlot(graph: Rec): Promise<{ plotCalls: number; error: unknown }> {
  let plotCalls = 0;
  const store = { readMostRecentPendingActions: async () => [], loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }) } as unknown as SessionStore;
  const plotClient = { run: async (payload: { options: { option_id?: string; id?: string }[] }) => {
    plotCalls += 1;
    return { analysis_status: 'computed', response_hash: 'h', meta: { seed_used: 1 },
      results: payload.options.map((o, i) => ({ option_id: o.option_id ?? o.id, option_label: String(o.option_id ?? o.id), win_probability: i === 0 ? 0.5 : 0.25 })) };
  } } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: async (id: string) => loadScenarioSnapshotForRunAnalysis(id, 'req-g1b', store) });
  let error: unknown = null;
  try { await handler({ payload: { scenario_id: '77777777-7777-4777-8777-777777777777' }, requestId: 'req-g1b', signal: undefined } as unknown as HandlerInvocation); } catch (e) { error = e; }
  return { plotCalls, error };
}
const KEEP_RISKS = JSON.parse(readFileSync(new URL('./fixtures/keep-risks-live-drafts-20260930.json', import.meta.url), 'utf8')) as { drafts: { id: string; brief: string; raw: string }[] };
const liveDraft = (id: string): { brief: string; candidate: Rec } => { const d = KEEP_RISKS.drafts.find((x) => x.id === id)!; return { brief: d.brief, candidate: JSON.parse(d.raw) as Rec }; };
const L = (from: string, to: string, direction: string, amount: number | null = null, per: number | null = null, prov: string | null = null) =>
  ({ from, to, direction, provenance: prov === 'explicit' ? 'explicit' : 'inferred', effect_amount: amount, effect_per_source_change: per, effect_provenance: prov });
const challenge = (m: string): string => `Olumi hasn’t modelled ‘${m}’; it could lower ‘${GOAL}’. Add it and say roughly how much if you think it matters.`;

describe('rule 1: a mechanism the brief neither sizes nor says is not drafted, and is challenged where the user sees it', () => {
  it('RED (served d1): ‘Starter-tier service degradation’ is not drafted; the first Run\'s gates now give per-option chances', async () => {
    const { r, g } = await build(FX['draft-1']);
    expect(ids(g)).not.toContain('starter_tier_service_degradation');
    expect(r.open_questions).toContain(challenge('Starter-tier service degradation'));
    expect(r.not_represented).toContain(challenge('Starter-tier service degradation'));
    // The support cost reached the revenue only through the mechanism taken out: it goes with it (a node with no way to the
    // goal refuses the Run), and both of the user's cost quantities are said in ONE sentence (rule 3; d5's words).
    expect(ids(g)).not.toContain('starter_support_cost');
    expect(ids(g)).not.toContain('support_cost_per_starter_subscriber');
    expect(r.not_represented).toContain('‘Support cost per starter subscriber’ and ‘Starter support cost’ are costs, so they don’t change ‘monthly recurring revenue’; they would matter for profit.');
    // What the option needs stays: the starter count still reaches the revenue through the starter tier's MRR.
    expect(ids(g)).toContain('starter_subscribers');
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('RED (served d2): ‘MRR lost to starter cannibalisation’ is not drafted; with the cost off revenue, chances show', async () => {
    const { r, g } = await build(FX['draft-2']);
    expect(ids(g)).not.toContain('mrr_lost_to_starter_cannibalisation');
    expect(r.open_questions).toContain(challenge('MRR lost to starter cannibalisation'));
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it.each(['draft-1', 'draft-2'])('⛔ OUTCOME (served %s, the real Run door): readiness lets it Run and run_analysis reaches PLoT once', async (d) => {
    const { g } = await build(FX[d]);
    const admission = resolveRunAdmission(g as never);
    expect(admission.assessment.blockingIssues.map((i: Rec) => i.code)).toEqual([]);
    expect(admission.willProceed).toBe(true);
    expect(await runReachesPlot(g)).toEqual({ plotCalls: 1, error: null });
  });
  it('⛔ NEVER CUT WHERE IT UNLOCKS NOTHING (DL #75 5916217417, Paul\'s live £100k draft): the rule proposes Olumi\'s risk, but the model is Olumi\'s estimates throughout, so the risk stays and nothing is said', async () => {
    const { brief, candidate } = liveDraft('mrr-12m');
    expect(withoutUnsupportedMechanisms(candidate as never, brief).mechanisms.map((m) => m.label), 'PRECONDITION: proposed').toEqual(['Price sensitivity risk']);
    const { r, g } = await build(candidate, { brief });
    expect(g.nodes.filter((n: Rec) => n.kind === 'risk').map((n: Rec) => n.label)).toContain('Price sensitivity risk');
    expect([...(r.open_questions ?? []), ...(r.not_represented ?? [])].filter((x: string) => x.includes('hasn’t modelled'))).toEqual([]);
  });
  it('⛔ the gate reads the graph the Run reads: a risk ALREADY kept out of the calculation (the £85k draft) is not a guess the cut could unlock', async () => {
    const { brief, candidate } = liveDraft('mrr-85k');
    const { r, g } = await build(candidate, { brief });
    const risk = g.nodes.find((n: Rec) => n.kind === 'risk' && n.label === 'Price sensitivity risk');
    expect(risk?.analysis_participation).toBe('retained_excluded');
    expect([...(r.open_questions ?? []), ...(r.not_represented ?? [])].filter((x: string) => x.includes('hasn’t modelled'))).toEqual([]);
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
      // (Drawn from the starter count: the first draft's support cost went with the cut, so the retry has no such node.)
      links: [...x.links, L('Starter subscribers', 'Starter-tier service degradation', 'positive'), L('Starter-tier service degradation', GOAL, 'negative')] }) });
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
    // Reached from an option (competitors answer the starter tier), so rule 3 reads its link: only the spend words keep it.
    c.links.push(L('Starter tier subscribers', 'Competitor ad spend', 'positive'), L('Competitor ad spend', GOAL, 'negative'));
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

describe('G1b honesty: a user-stated figure the build takes out is SAID, in the user\u2019s words, where the user sees it', () => {
  const SAID = 'Olumi hasn’t put your ‘Each starter subscriber costs about £6 a month in support’ into the model, because it doesn’t feed ‘monthly recurring revenue’ directly. If it should, say how.';
  const hasPut = (xs: readonly string[] | undefined): string[] => (xs ?? []).filter((x) => x.includes('hasn’t put your'));
  const replyOf = (r: Rec): string => narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as { ok: boolean; mutated: boolean }]).status ?? '';
  it('RED (T1b, real brief): the £6 support cost is named in the brief\u2019s words in open_questions AND the reply text', async () => {
    const { r } = await build(FX['draft-2']);
    expect(BRIEF).toContain('Each starter subscriber costs about £6 a month in support.');
    expect(hasPut(r.open_questions)).toEqual([SAID]);
    expect(replyOf(r)).toContain(SAID);
    // The leader egress guards read it as no leader claim, and it carries no verdict word.
    expect(textNamesLeadingOption(SAID)).toBe(false);
    expect(textAssertsLeadingOption(SAID)).toBe(false);
    expect(SAID).not.toMatch(/\b(best|winner|recommend\w*|leader|leads?)\b/iu);
  });
  it('CONTROL: an invented mechanism gets only the existing challenge line, not this one', async () => {
    // (Without the support sentence: the served draft-1 also carries the brief's £6 cost, which is rightly said once, below.)
    const { r } = await build(FX['draft-1'], { brief: BRIEF.replace('Each starter subscriber costs about £6 a month in support. ', '') });
    expect(r.open_questions).toContain(challenge('Starter-tier service degradation'));
    expect(hasPut(r.open_questions)).toEqual([]);
    expect(hasPut((await build(FX['draft-1'])).r.open_questions)).toEqual([SAID]);
  });
  it('CONTROL: a brief with nothing dropped (profit goal keeps the cost) gets no line', async () => {
    const c = structuredClone(FX['draft-2']);
    c.goal = { ...c.goal, metric: 'monthly profit' };
    c.links = c.links.map((l: Rec) => ({ ...l, to: l.to === GOAL ? 'monthly profit' : l.to, from: l.from === GOAL ? 'monthly profit' : l.from }));
    const { r } = await build(c);
    expect(hasPut(r.open_questions)).toEqual([]);
  });
  it('CONTROL: a cost the drafter invented (no brief sentence states it) is not said as the user\u2019s', async () => {
    const { r } = await build(FX['draft-2'], { brief: BRIEF.replace('Each starter subscriber costs about £6 a month in support. ', '') });
    expect(hasPut(r.open_questions)).toEqual([]);
  });
});

/** The retry the issue asks for: ‘Customers lost to price rise’ counted, one link per user statement, no product. */
const usersChain = (x: Rec): Rec => ({
  ...x,
  risks: x.risks.filter((r: Rec) => r.label !== 'MRR lost to price-driven churn'),
  outcomes: [...x.outcomes, { label: 'Customers lost to price rise', provenance: 'explicit', unit: 'customers', plausible_max: 400 }],
  links: [...x.links.filter((l: Rec) => l.from !== 'MRR lost to price-driven churn' && l.to !== 'MRR lost to price-driven churn'),
    L('Price rise', 'Customers lost to price rise', 'positive', 2, 1, 'explicit'),
    L('Customers lost to price rise', GOAL, 'negative', -300, 1, 'explicit')],
});

describe('rule 2 (served d4): the user\'s chain collapsed into Olumi\'s £600 is asked of the retry, drawn as the user wrote it', () => {
  it('PRECONDITION (served): the first draft is never cut (dropping it overstates Raise) and is withheld on its £600', async () => {
    const { g, trace } = await build(FX['draft-4']);
    expect(ids(g)).toContain('mrr_lost_to_price_driven_churn');
    expect(trace.reasons?.chain).toBe(1);
    // Science §(i) amendment (A): "case (c) stops blocking on a link whose size is an Olumi ESTIMATE with a natural
    // effect that converts into goal units." The £600 churn estimate stays uncertain, but no longer blocks the chance.
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
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

describe('P5 is unchanged: a guess on a goal path still withholds', () => {
  it('CONTROL: a guess ON a goal path still withholds (served d4 first draft)', async () => {
    // Science §(i) amendment (A): "case (c) stops blocking on a link whose size is an Olumi ESTIMATE with a natural
    // effect that converts into goal units." The held £600 natural effect converts, so the chance is now testable.
    expect(gates((await build(FX['draft-4'])).g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it.each(['placeholder', 'non-converting estimate'])('amendment (A) CONTRAST: the same retained churn %s still blocks', async kind => {
    const { g } = await build(FX['draft-4']);
    const e = g.edges.find((x: Rec) => x.from === 'price_rise' && x.to === 'mrr_lost_to_price_driven_churn');
    expect(e).toBeDefined();
    if (kind === 'placeholder') { e.provenance.magnitude = 'olumi_placeholder'; e.strength.defaulted = true; }
    else delete e.provenance.natural_effect;
    expect(gates(g).target).toBe('not_testable');
    expect(gates(g).failures).toContain(kind === 'placeholder' ? 'goal_path_placeholder' : 'goal_path_unsized');
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

/**
 * ⛔ THE MEASURED CLASS ONLY (stand-in for MC 21, 6 Oct). CI on #2662 d6470c9a: 49 Required files red, every one a quantity
 * this rule took that was structure or part of a chain (‘Pro subscribers’, ‘Other MRR’, ‘Price sensitivity’ → the user's
 * ‘Monthly churn’ limit). Corpus: all 29 true drops in 60 stored drafts are risks whose only links out go into the goal.
 */
describe('only a risk that is a side consequence is taken, and never one whose removal strands what the user can see', () => {
  const asOutcome = (): Rec => {
    const c = structuredClone(FX['draft-1']);
    c.risks = c.risks.filter((x: Rec) => x.label !== 'Starter-tier service degradation');
    c.outcomes.push({ label: 'Starter-tier service degradation', provenance: 'inferred' });
    return c;
  };
  it('CONTROL: the same unsupported mechanism drafted as an OUTCOME (structure, not a risk) is never taken', () => {
    const c = asOutcome();
    const w = withoutUnsupportedMechanisms(c as never, BRIEF);
    expect(w.mechanisms).toEqual([]);
    expect(w.model.outcomes.map((o) => o.label)).toContain('Starter-tier service degradation');
    expect(w.model.links.filter((l) => l.from === 'Starter-tier service degradation' || l.to === 'Starter-tier service degradation')).toHaveLength(2);
  });
  it('CONTROL: an irregular past form reads as its verb ("Accounts lost" is named by "we could lose accounts") → kept', () => {
    const c = structuredClone(FX['draft-2']);
    const at = (x: string) => (x === 'MRR lost to starter cannibalisation' ? 'Accounts lost' : x);
    c.risks = c.risks.map((x: Rec) => ({ ...x, label: at(x.label) }));
    c.links = c.links.map((l: Rec) => ({ ...l, from: at(l.from), to: at(l.to) }));
    expect(withoutUnsupportedMechanisms(c as never, BRIEF).mechanisms.map((m) => m.label), 'PRECONDITION: unnamed, it is taken').toEqual(['Accounts lost']);
    expect(withoutUnsupportedMechanisms(c as never, `${BRIEF} We could lose accounts.`).mechanisms).toEqual([]);
  });
  it('CONTROL: a risk with a link into anything but the goal is part of a chain the model reads → kept', () => {
    const c = structuredClone(FX['draft-1']);
    c.factors.push({ label: 'Account manager workload', role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred' });
    c.links.push(L('Starter-tier service degradation', 'Account manager workload', 'positive'), L('Account manager workload', GOAL, 'negative'));
    expect(withoutUnsupportedMechanisms(c as never, BRIEF).mechanisms).toEqual([]);
  });
  it('⛔ CONTROL: a mechanism whose removal strands a quantity that is NOT the cost side (here an onboarding load) → kept, as drafted', () => {
    const c = structuredClone(FX['draft-1']);
    for (const l of c.links) { if (l.from === 'Starter support cost' && l.to === 'Starter-tier service degradation') l.from = 'Starter onboarding load'; }
    c.outcomes.push({ label: 'Starter onboarding load', provenance: 'inferred' });
    c.links.push(L('Starter subscribers', 'Starter onboarding load', 'positive'));
    expect(withoutUnsupportedMechanisms(c as never, BRIEF).mechanisms).toEqual([]);
  });
  it('⛔ CONTROL: an unsupported risk NO option reaches moves no option\'s chance → kept as drafted, even beside one that is taken', async () => {
    const c = structuredClone(FX['draft-1']);
    c.risks.push({ label: 'Market downturn', provenance: 'inferred' });
    c.links.push(L('Market downturn', GOAL, 'negative'));
    expect(withoutUnsupportedMechanisms(c as never, BRIEF).mechanisms.map((m) => m.label)).toEqual(['Starter-tier service degradation']);
    const { r, g } = await build(c);
    expect(g.nodes.filter((n: Rec) => n.kind === 'risk').map((n: Rec) => n.label)).toEqual(['Market downturn']);
    // No challenge for it (it is drafted); the existing ask for its size stays as before.
    expect([...(r.open_questions ?? []), ...(r.not_represented ?? [])].filter((x: string) => x.includes('hasn’t modelled ‘Market downturn’'))).toEqual([]);
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('⛔ CONTROL: an option\'s lever whose only way to the goal is the mechanism is never stranded → kept', () => {
    const c = structuredClone(FX['draft-2']);
    c.factors.push({ label: 'Starter launch campaign', role: 'controllable', baseline_known: true, baseline_value: 0, unit: null, provenance: 'inferred' });
    c.options[1].interventions.push({ factor_label: 'Starter launch campaign', value: 1, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' });
    c.links.push(L('Starter launch campaign', 'MRR lost to starter cannibalisation', 'positive'));
    expect(withoutUnsupportedMechanisms(c as never, BRIEF).mechanisms).toEqual([]);
  });
});

/** Codex buddy #2662 round 1 (gpt-6.1-sol, high): each finding's own input, RED on 13f37d70. */
describe('Codex r1: the buddy\'s inputs', () => {
  it('P1-1: a non-cost feedback loop that reaches the goal only through the mechanism is never taken as the cost side → the mechanism stays', () => {
    const c = structuredClone(FX['draft-1']);
    c.factors.push({ label: 'Support backlog', role: 'observable', baseline_known: true, baseline_value: 20, unit: 'tickets', provenance: 'explicit', plausible_max: 200 },
      { label: 'Delivery delay', role: 'observable', baseline_known: true, baseline_value: 10, unit: 'days', provenance: 'explicit', plausible_max: 100 });
    c.links.push(L('Support backlog', 'Delivery delay', 'positive'), L('Delivery delay', 'Support backlog', 'positive'), L('Delivery delay', 'Starter-tier service degradation', 'positive'));
    const brief = `${BRIEF} Our support backlog is 20 tickets and the delivery delay is 10 days.`;
    const w = withoutUnsupportedMechanisms(c as never, brief);
    expect(w.mechanisms).toEqual([]);
    expect(w.model.factors.map((f) => f.label)).toEqual(expect.arrayContaining(['Support backlog', 'Delivery delay']));
  });
  it('⚠ KNOWN LIMIT (r1 P1-2, d5\'s predicate): a paraphrase the drafter marks \'inferred\' is cut, and CHALLENGED BY NAME (never silent); cited, it is kept (the d5 contrast CONTROL above)', async () => {
    const { r, g } = await build(FX['draft-2'], { brief: `${BRIEF} Some existing customers may downgrade to the starter tier.` });
    expect(ids(g)).not.toContain('mrr_lost_to_starter_cannibalisation');
    expect(r.open_questions).toContain(challenge('MRR lost to starter cannibalisation'));
  });
  it('P1-3: a retry that draws the user\'s chain but KEEPS the collapsed quantity (now £599) is never adopted', async () => {
    const { g, trace } = await build(FX['draft-4'], { retry: (x) => {
      const y = usersChain(x);
      return { ...y, risks: x.risks, links: [...y.links, ...x.links.filter((l: Rec) => l.to === 'MRR lost to price-driven churn' || l.from === 'MRR lost to price-driven churn')
        .map((l: Rec) => (l.to === 'MRR lost to price-driven churn' ? { ...l, effect_amount: 599 } : l))] };
    } });
    expect(trace.outcome).not.toBe('adopted');
    expect(ids(g)).not.toContain('customers_lost_to_price_rise');
  });
  it('P1-3: a retry that RENAMES the collapsed quantity (Olumi-sized £599 out of the same source) is never adopted', async () => {
    const { trace } = await build(FX['draft-4'], { retry: (x) => {
      const y = usersChain(x);
      return { ...y, risks: [...y.risks, { label: 'MRR lost to churn', provenance: 'inferred' }],
        links: [...y.links, L('Price rise', 'MRR lost to churn', 'positive', 599, 1, 'ai_proposed'), L('MRR lost to churn', GOAL, 'negative', -1, 1, 'ai_proposed')] };
    } });
    expect(trace.outcome).not.toBe('adopted');
  });
  it('P2-4: an adopted retry that draws the mechanism again as the brief\'s is never said as not modelled', async () => {
    const c = structuredClone(FX['draft-1']);
    const raise = c.options.find((o: Rec) => o.label === 'Raise prices 10%');
    const kept = raise.interventions; raise.interventions = []; raise.changes = ['Price rise'];
    const { r, g, trace } = await build(c, { retry: (x) => ({ ...x,
      options: x.options.map((o: Rec) => (o.label === 'Raise prices 10%' ? { ...o, interventions: kept } : o)),
      risks: [...x.risks, { label: 'Starter-tier service degradation', provenance: 'explicit' }],
      links: [...x.links, L('Starter subscribers', 'Starter-tier service degradation', 'positive'), L('Starter-tier service degradation', GOAL, 'negative')] }) });
    expect(trace.outcome, 'PRECONDITION: adopted').toBe('adopted');
    expect(ids(g)).toContain('starter_tier_service_degradation');
    expect([...(r.open_questions ?? []), ...(r.not_represented ?? [])].filter((x: string) => x.includes('hasn’t modelled ‘Starter-tier service degradation’'))).toEqual([]);
  });
  it('P2-5: a cost whose accounting link goes while its causal route stays is SAID, as not taken off pound for pound', () => {
    const c = structuredClone(FX['draft-2']);
    c.factors.push({ label: 'Support quality', role: 'observable', baseline_known: true, baseline_value: 10, unit: 'points', provenance: 'explicit', plausible_max: 100 });
    c.links.push(L('Starter-tier support cost', 'Support quality', 'negative', -0.01, 1, 'explicit'), L('Support quality', GOAL, 'positive', 100, 1, 'explicit'));
    const w = withoutUnsupportedMechanisms(c as never, BRIEF);
    expect(w.model.links.some((l) => l.from === 'Starter-tier support cost' && l.to === GOAL)).toBe(false);
    expect(w.costs).toEqual([{ cost: 'Starter-tier support cost', goal: GOAL, stillReaches: true }]);
    expect(costOffRevenueLine(w.costs)).toBe('‘Starter-tier support cost’ is a cost, so it isn’t taken off ‘monthly recurring revenue’ pound for pound; it would matter for profit.');
  });
});

/** Codex buddy #2662 round 2 (gpt-6.1-sol, high, cap reached): each finding's own input, RED on 2d4165cb. */
describe('Codex r2: the buddy\'s inputs', () => {
  it('P1-1: a brief sentence about a DIFFERENT mechanism ("may downgrade to the starter tier") never keeps ‘Starter-tier service degradation’', async () => {
    const { r, g } = await build(FX['draft-1'], { brief: `${BRIEF} Some existing customers may downgrade to the starter tier.` });
    expect(ids(g)).not.toContain('starter_tier_service_degradation');
    expect(r.open_questions).toContain(challenge('Starter-tier service degradation'));
    expect(gates(g)).toEqual({ placeholder: [], target: 'testable', failures: [] });
  });
  it('P1-2: a renamed £599 route tagged \'explicit\' by the drafter registers as Olumi\'s estimate → never adopted', async () => {
    const { trace } = await build(FX['draft-4'], { retry: (x) => {
      const y = usersChain(x);
      return { ...y, risks: [...y.risks, { label: 'MRR lost to churn', provenance: 'inferred' }],
        links: [...y.links, L('Price rise', 'MRR lost to churn', 'positive', 599, 1, 'explicit'), L('MRR lost to churn', GOAL, 'negative', -1, 1, 'ai_proposed')] };
    } });
    expect(trace.outcome).not.toBe('adopted');
  });
  it('P2-3: the user\'s chain whose re-targeted link keeps the drafter\'s \'ai_proposed\' tag but REGISTERS as the user\'s is adopted', async () => {
    const { g, trace } = await build(FX['draft-4'], { retry: (x) => {
      const y = usersChain(x);
      return { ...y, links: y.links.map((l: Rec) => (l.from === 'Price rise' && l.to === 'Customers lost to price rise' ? { ...l, provenance: 'inferred', effect_provenance: 'ai_proposed' } : l)) };
    } });
    expect(trace.outcome).toBe('adopted');
    expect(g.edges.find((e: Rec) => e.from === 'price_rise' && e.to === 'customers_lost_to_price_rise')?.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: S1 });
    expect(ids(g)).not.toContain('mrr_lost_to_price_driven_churn');
  });
  it('P2-4: an adopted retry that restores the user\'s causal route from the cost is said against THAT model (not taken off pound for pound), never "doesn\'t change"', async () => {
    const c = structuredClone(FX['draft-2']);
    const raise = c.options.find((o: Rec) => o.label === 'Raise prices 10%');
    const kept = raise.interventions; raise.interventions = []; raise.changes = ['Price rise'];
    const brief = `${BRIEF} Support quality is currently 10 points. Each extra £100 of Starter-tier support cost lowers Support quality by 1 point. `
      + 'Each extra Support quality point adds £100 a month to monthly recurring revenue.';
    const { r, trace } = await build(c, { brief, retry: (x) => ({ ...x,
      options: x.options.map((o: Rec) => (o.label === 'Raise prices 10%' ? { ...o, interventions: kept } : o)),
      factors: [...x.factors, { label: 'Support quality', role: 'observable', baseline_known: true, baseline_value: 10, unit: 'points', provenance: 'explicit', plausible_max: 100 }],
      outcomes: [...x.outcomes.filter((o: Rec) => o.label !== 'Starter-tier support cost'), { label: 'Starter-tier support cost', provenance: 'explicit', unit: 'GBP per month', plausible_max: 5000 }],
      links: [...x.links, L('Starter tier subscribers', 'Starter-tier support cost', 'positive', 6, 1, 'explicit'),
        L('Starter-tier support cost', 'Support quality', 'negative', -1, 100, 'explicit'), L('Support quality', GOAL, 'positive', 100, 1, 'explicit')] }) });
    expect(trace.outcome, 'PRECONDITION: adopted').toBe('adopted');
    const said = (r.not_represented ?? []).filter((x: string) => x.includes('‘Starter-tier support cost’'));
    expect(said.filter((x: string) => x.includes('doesn’t change'))).toEqual([]);
    expect(said.filter((x: string) => x.includes('pound for pound'))).toHaveLength(1);
  });
});
