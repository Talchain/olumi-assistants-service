/** FIX-1 / Science goals (r): fixture drafts, current-graph derivation, real Run boundary. No LLM or database. */
import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, chancesWithheldByAGuess, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { riskMatchesLimit } from '../unitless-risk-exclusion.js';
import { usersRisk } from '../product-goal-extra-parent.js';
import { holdStatedEventRisks } from '../stated-event-risk-draft.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; [key: string]: unknown };
const SCENARIO = '77000000-0000-4000-8000-000000000001';
const BRIEF = 'Should we increase Marketing budget from £1,000 to £2,000 a month or keep it? '
  + 'Monthly revenue is £10,000 today and we want at least £20,000 within twelve months. '
  + 'Each extra £1 per month of Marketing budget raises Monthly revenue by £2 per month.';
const RISK = 'Price sensitivity';
const DISCLOSURE = "Olumi added ‘Price sensitivity’ as a risk but can't size it in your goal's units yet, "
  + "so it's shown as a risk to weigh and kept out of the chance.";
const strictCandidate = new Ajv({ strict: false }).compile(buildCandidateSchema());

const link = (from: string, to: string, direction: 'positive' | 'negative' = 'positive', extra: Json = {}) => ({
  from, to, direction, provenance: 'ai_proposed', effect_amount: null,
  effect_per_source_change: null, effect_provenance: null, definitional: null, ...extra,
});

/**
 * Risk identity/quantity and incident placeholders are the B1-d1 lab's Price sensitivity slice
 * (p44-lab-two-risks-20261008, last provider_calls[].output_text). A single sized revenue core
 * isolates this rule from the lab's independent product/churn sizing blockers.
 */
function candidate(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = {
    goal: { metric: 'Monthly revenue', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month',
      horizon_months: 12, provenance: 'explicit', frame: 'level', baseline_known: true,
      baseline_value: 10000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Increase marketing', provenance: 'explicit', is_status_quo: false, changes: [],
        interventions: [{ factor_label: 'Marketing budget', value: 2000, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' }] },
      { label: 'Keep marketing', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [{ label: 'Marketing budget', role: 'controllable', baseline_known: true, baseline_value: 1000,
      unit: 'GBP/month', plausible_max: 10000, provenance: 'explicit' }],
    risks: [{ label: RISK, provenance: 'ai_proposed', unit: null, plausible_max: null }],
    outcomes: [], identities: [], unknowns: [], decision_question: null,
    links: [
      link('Marketing budget', 'Monthly revenue', 'positive', { provenance: 'explicit', effect_amount: 2,
        effect_per_source_change: 1, effect_provenance: 'explicit' }),
      link('Marketing budget', RISK),
      link(RISK, 'Monthly revenue', 'negative'),
    ],
  };
  edit(c);
  return c as CandidateModel;
}

function graphOf(c: CandidateModel, brief = BRIEF): Graph {
  const admitted = admitCandidateModel(c, {}, brief);
  return { nodes: admitted.nodes as Json[], edges: admitted.edges as Json[], goal_constraints: admitted.goal_constraints };
}
const riskOf = (graph: Graph, label = RISK): Json => {
  const risk = graph.nodes.find(n => n.kind === 'risk' && n.label === label);
  expect(risk, `risk ${label} must survive admission`).toBeDefined();
  return risk!;
};
const optionsOf = (graph: Graph) => graph.nodes.filter(n => n.kind === 'option').map(n => n.id as string);
const goalOf = (graph: Graph) => graph.nodes.find(n => n.kind === 'goal')!;
const protectedTargetsOf = (graph: Graph) => graph.nodes.filter(n => n.kind === 'option')
  .flatMap(n => Object.keys(n.interventions ?? {}));
const guarded = (graph: Graph, brief = BRIEF) => guardAnalysisParticipation(graph, {
  goalNodeId: goalOf(graph).id, submittedOptionIds: optionsOf(graph), optionInterventionTargetIds: protectedTargetsOf(graph),
  brief,
});

async function build(c: CandidateModel, brief = BRIEF): Promise<{ graph: Graph; out: Json }> {
  expect(strictCandidate(c), JSON.stringify(strictCandidate.errors)).toBe(true);
  let registered: Graph | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: Graph }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(c) });
  const out = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Json;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  expect(registered, 'the REAL builder must register its admitted graph').toBeDefined();
  return { graph: registered!, out };
}

/** Real handler; only PLoT transport and scenario reading are fixture dependencies. */
async function runPayload(graph: Graph, brief = BRIEF): Promise<{ payload: Json; result: Json }> {
  const optionIds = optionsOf(graph);
  const run = vi.fn(async () => ({
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'unitless-risk-pr1' },
    response_hash: 'unitless-risk-pr1', analysis_status: 'computed',
    option_comparison: optionIds.map((id, i) => ({ option_id: id, option_label: graph.nodes.find(n => n.id === id)!.label,
      win_probability: i === 0 ? 0.6 : 0.4, probability_of_goal: i === 0 ? 0.7 : 0.5, status: 'computed' })),
    factor_sensitivity: [],
  }) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => ({ graph, options: graph.nodes.filter(n => n.kind === 'option'),
      goal_node_id: goalOf(graph).id, rawPersistedGraph: graph, briefText: brief } as unknown as RunAnalysisScenarioSnapshot),
  });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-unitless-risk', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: brief, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'unitless-risk', scenario_id: SCENARIO, message: 'Run the analysis.',
      turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-unitless-risk', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
  expect(fact).toBeDefined();
  return { payload: (run.mock.calls as unknown as [Json][])[0]![0], result: (fact as Json).result };
}

describe('FIX-1: unitless risks Olumi added are retained, disclosed, and absent from the chance', () => {
  it('admission does not stamp the added unitless risk; current graph derivation keeps it out and its stored incident links survive', () => {
    const c = candidate();
    const before = structuredClone(c);
    const graph = graphOf(c);
    const risk = riskOf(graph);
    expect(risk.provenance).toBe('ai_inferred');
    expect(risk.analysis_participation).toBeUndefined();
    expect(guarded(graph).excludedNodeIds).toContain(risk.id);
    expect(graph.edges.filter(e => e.from === risk.id || e.to === risk.id)).toHaveLength(2);
    expect(c, 'the admission step must be pure').toEqual(before);
  });

  it('RED: the real registered draft returns the omission disclosure through not_represented', async () => {
    const { graph, out } = await build(candidate());
    expect(riskOf(graph).analysis_participation).toBeUndefined();
    expect(out.not_represented).toContain(DISCLOSURE);
    expect((out.not_represented as string[]).filter(s => s === DISCLOSURE)).toHaveLength(1);
  });

  it('deliberately including the risk restores withholding; the current-graph Run guard otherwise removes both incident links', async () => {
    // The chance mirror also checks the stored target. Admission alone precedes the builder's
    // holdStatedGoalAttributes step, so exercise the registered graph the real Run receives.
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    const direct = graph.edges.find(e => e.to === goalOf(graph).id && e.from !== risk.id);
    expect(direct?.provenance?.magnitude, 'premise: real scoped admission credits the separately stated core size').toBe('user_stated');
    const before = structuredClone(graph);
    riskOf(before).analysis_participation = 'included';
    expect(chancesWithheldByAGuess(before, BRIEF), 'premise: the risk path alone blocks the sized core').toBe(true);
    expect(unsizedLeaderGoalPaths(before, optionsOf(before)).some(p => p.links.some(l => l.from === risk.id || l.to === risk.id))).toBe(true);
    const run = guarded(graph);
    expect(run.refusals).toEqual([]);
    expect(run.excludedNodeIds).toEqual([risk.id]);
    expect(run.prunedEdgeCount).toBe(2);
    expect(run.graph.nodes.some(n => n.id === risk.id)).toBe(false);
    expect(run.graph.edges.some(e => e.from === risk.id || e.to === risk.id)).toBe(false);
    expect(unsizedLeaderGoalPaths(run.graph, optionsOf(run.graph))).toEqual([]);
    expect(chancesWithheldByAGuess(graph, BRIEF)).toBe(false);
    expect(riskOf(graph).analysis_participation).toBeUndefined();
  });

  it('RED: the actual PLoT payload has neither the excluded risk nor its edges, and no risk-link chance warning survives', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    const { payload, result } = await runPayload(graph);
    expect(payload.graph.nodes.some((n: Json) => n.id === risk.id)).toBe(false);
    expect(payload.graph.edges.some((e: Json) => e.from === risk.id || e.to === risk.id)).toBe(false);
    expect(payload.graph.nodes.some((n: Json) => n.id === goalOf(graph).id)).toBe(true);
    expect(payload.options).toHaveLength(2);
    const warnings = (result.enrichment?.inference_warnings ?? []) as Json[];
    expect(warnings.flatMap(w => w.links ?? []).some((l: Json) => l.from === risk.id || l.to === risk.id)).toBe(false);
  });

  it.each(['explicit', 'from_brief'])('NEVER (a): a %s risk stays in the calculation', provenance => {
    const graph = graphOf(candidate(c => { c.risks[0].provenance = provenance; }));
    // `from_brief` is the persisted display carrier, not an admitted candidate authorship literal.
    if (provenance === 'from_brief') riskOf(graph).provenance = 'from_brief';
    expect(riskOf(graph).provenance).toBe('from_brief');
    expect(riskOf(graph).analysis_participation).not.toBe('retained_excluded');
    expect(guarded(graph).excludedNodeIds).toEqual([]);
  });

  it('NEVER (a): all risk words in the brief keep an otherwise inferred risk; mutant user-named exclusion fails here', async () => {
    const { graph, out } = await build(candidate(), `${BRIEF} We are worried about price sensitivity.`);
    expect(riskOf(graph).analysis_participation).not.toBe('retained_excluded');
    expect(out.not_represented).not.toContain(DISCLOSURE);
    expect(chancesWithheldByAGuess(graph, `${BRIEF} We are worried about price sensitivity.`)).toBe(true);
  });

  it('NEVER (b): an explicit size on ANY incident link protects a unitless risk', () => {
    const graph = graphOf(candidate(c => Object.assign(c.links[1], {
      effect_amount: 0.1, effect_per_source_change: 1, effect_provenance: 'explicit',
    })));
    expect(riskOf(graph).analysis_participation).not.toBe('retained_excluded');
  });

  it("NEVER (b'): a held user likelihood protects a singular/plural risk name that usersRisk alone does not recognise", async () => {
    const c = candidate(c => {
      c.risks[0].label = 'Subscribers leave';
      c.links = c.links.filter((l: Json) => l.to !== RISK).map((l: Json) => l.from === RISK ? { ...l, from: 'Subscribers leave' } : l);
    });
    const { graph } = await build(c, `${BRIEF} Our subscriber leaves, maybe 10–30% in the next 6 months.`);
    const risk = riskOf(graph, 'Subscribers leave');
    expect(risk.provenance).toBe('ai_inferred');
    expect(risk.event_risk?.occurrence).toEqual({ p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' });
    expect(risk.analysis_participation).not.toBe('retained_excluded');
    expect(guarded(graph).excludedNodeIds).toEqual([]);
    // The stem veto also protects the same user-named risk when no likelihood was given.
    const withoutLikelihood = await build(c, `${BRIEF} Our subscriber leaves in the next 6 months.`);
    const ordinaryRisk = riskOf(withoutLikelihood.graph, 'Subscribers leave');
    expect(ordinaryRisk.event_risk).toBeUndefined();
    expect(ordinaryRisk.analysis_participation).toBeUndefined();
    expect(guarded(withoutLikelihood.graph, `${BRIEF} Our subscriber leaves in the next 6 months.`).excludedNodeIds).toEqual([]);
  });

  it("NEVER (b'): a stated likelihood remains protected while an incoming cause prevents the event-risk hold", () => {
    const label = 'Subscribers leave';
    const brief = `${BRIEF} Our subscriber leaves, maybe 10–30% in the next 6 months.`;
    const c = candidate(c => {
      c.risks[0].label = label;
      c.links = c.links.map((l: Json) => ({ ...l, from: l.from === RISK ? label : l.from, to: l.to === RISK ? label : l.to }));
    });
    expect(usersRisk(c.risks[0]!, brief), 'premise: authorship/brief-word veto alone does not protect this plural name').toBe(false);
    const held = holdStatedEventRisks(
      [{ id: 'risk_subscriber', kind: 'risk', label }],
      [{ from: 'factor_budget', to: 'risk_subscriber' }], brief,
    );
    expect(held.held).toEqual([]);
    expect(held.refused).toEqual([{ risk_id: 'risk_subscriber', reason: 'has_cause_link' }]);
    expect(riskOf(graphOf(c, brief), label).analysis_participation).not.toBe('retained_excluded');
  });

  it('NEVER (c): a definitional incident link vetoes exclusion even without a candidate unit', () => {
    const graph = graphOf(candidate(c => { c.links[2].definitional = true; }));
    expect(riskOf(graph).analysis_participation).not.toBe('retained_excluded');
  });

  it('NEVER (d): an inferred threshold-breach risk matching a stated constraint metric stays; dropping predicate (d) fails', () => {
    const label = 'Monthly churn threshold breach';
    const c = candidate(c => {
      c.constraints = [{ metric: 'Monthly churn', operator: '<=', value: 5, unit: '%', frame: 'level', provenance: 'explicit' }];
      c.risks[0].label = label;
      c.links = c.links.map((l: Json) => ({ ...l, from: l.from === RISK ? label : l.from, to: l.to === RISK ? label : l.to }));
    });
    const graph = graphOf(c, `${BRIEF} Monthly churn must stay below 5%.`);
    expect(riskOf(graph, label).provenance).toBe('ai_inferred');
    expect(riskOf(graph, label).analysis_participation).not.toBe('retained_excluded');
    expect(guarded(graph).excludedNodeIds).toEqual([]);
  });

  it('NEVER (d), pure metric carrier: the metric protects a differently labelled risk without extending the drafter schema', () => {
    const constraints = [{ metric: 'Monthly churn' }];
    expect(riskMatchesLimit({ label: 'Unanticipated outage' }, constraints)).toBe(false);
    expect(riskMatchesLimit({ label: 'Unanticipated outage', metric: 'Monthly churn' }, constraints)).toBe(true);
    expect(riskMatchesLimit({ label: 'Unanticipated outage', metric: 'Monthly churn' }, [])).toBe(false);
  });

  it('NEVER: an option intervention target remains included, so the real guard does not refuse the Run', () => {
    const graph = graphOf(candidate(c => c.options[0].interventions.push({
      factor_label: RISK, value: 0.2, provenance: 'ai_proposed',
    })));
    const risk = riskOf(graph);
    expect(protectedTargetsOf(graph), 'premise: admission preserved the option target').toContain(risk.id);
    expect(risk.analysis_participation).not.toBe('retained_excluded');
    expect(guarded(graph).refusals).toEqual([]);
  });

  it('CONTROL: a drafted natural-unit quantity never produces a durable unitless-risk participation stamp', () => {
    const graph = graphOf(candidate(c => Object.assign(c.risks[0], { unit: 'subscribers', plausible_max: 1000 })));
    expect(riskOf(graph).analysis_participation).not.toBe('retained_excluded');
  });
});
