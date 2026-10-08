/** FIX-1 / Codex r1: real admission, writers, persisted reload and Run payload; no LLM or database. */
import { describe, expect, it, vi } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, chancesWithheldByAGuess, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unitlessRiskChanceCaveatForAgent } from '../goal-chance-screen-lines.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import { applyStructuralRename } from '../../system-events/structural-rename.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { asAnalysed } from '../../../orchestrator/context/placeholder-parts.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
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
const RISK = 'Client backlash';
const link = (from: string, to: string, direction: 'positive' | 'negative' = 'positive', extra: Json = {}) => ({
  from, to, direction, provenance: 'ai_proposed', effect_amount: null,
  effect_per_source_change: null, effect_provenance: null, definitional: null, ...extra,
});

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
      link('Marketing budget', RISK), link(RISK, 'Monthly revenue', 'negative'),
    ],
  };
  edit(c);
  return c as CandidateModel;
}

function relabel(c: Json, label: string): void {
  c.risks[0].label = label;
  c.links = c.links.map((l: Json) => ({ ...l, from: l.from === RISK ? label : l.from, to: l.to === RISK ? label : l.to }));
}
function graphOf(c: CandidateModel, brief: string | undefined = BRIEF): Graph {
  const admitted = admitCandidateModel(c, {}, brief);
  return { nodes: admitted.nodes as Json[], edges: admitted.edges as Json[], goal_constraints: admitted.goal_constraints };
}
const riskOf = (graph: Graph, label = RISK): Json => {
  const risk = graph.nodes.find(n => n.kind === 'risk' && n.label === label);
  expect(risk, `risk ${label} must survive admission`).toBeDefined();
  return risk!;
};
const goalOf = (graph: Graph): Json => graph.nodes.find(n => n.kind === 'goal')!;
const optionsOf = (graph: Graph): string[] => graph.nodes.filter(n => n.kind === 'option').map(n => n.id);
const riskEdge = (graph: Graph, riskId: string): Json => graph.edges.find(e => e.from === riskId && e.to === goalOf(graph).id)!;
const reload = (graph: Graph): Graph => JSON.parse(JSON.stringify(graph)) as Graph;
const guard = (graph: Graph, brief?: string) => guardAnalysisParticipation(graph, {
  goalNodeId: goalOf(graph).id, submittedOptionIds: optionsOf(graph),
  optionInterventionTargetIds: graph.nodes.filter(n => n.kind === 'option').flatMap(n => Object.keys(n.interventions ?? {})),
  brief,
} as Parameters<typeof guardAnalysisParticipation>[1]);
// These are existing interfaces. At be800b33 extra brief arguments are ignored; failures are behavior assertions.
const caveat = unitlessRiskChanceCaveatForAgent as (graph: unknown, brief?: string) => string | undefined;
const withheld = chancesWithheldByAGuess as (graph: Graph, brief?: string) => boolean;
const analysed = asAnalysed as (graph: Graph, keep?: unknown, brief?: string) => Graph;

async function build(c: CandidateModel, brief = BRIEF): Promise<{ graph: Graph; out: Json }> {
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
  expect(registered, 'the real builder must register its admitted graph').toBeDefined();
  return { graph: registered!, out };
}

/** The REAL Run handler; only scenario read and PLoT transport are fixture dependencies. */
async function runPayload(graph: Graph, brief: string | null = BRIEF): Promise<Json> {
  const ids = optionsOf(graph);
  const run = vi.fn(async () => ({
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'unitless-risk-fix1' },
    response_hash: 'unitless-risk-fix1', analysis_status: 'computed',
    option_comparison: ids.map((id, i) => ({ option_id: id, option_label: graph.nodes.find(n => n.id === id)!.label,
      win_probability: i === 0 ? 0.6 : 0.4, probability_of_goal: i === 0 ? 0.7 : 0.5, status: 'computed' })),
    factor_sensitivity: [],
  }) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => ({ graph, options: graph.nodes.filter(n => n.kind === 'option'),
      goal_node_id: goalOf(graph).id, rawPersistedGraph: graph, briefText: brief } as unknown as RunAnalysisScenarioSnapshot),
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-unitless-risk', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: brief, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'unitless-risk', scenario_id: SCENARIO, message: 'Run the analysis.',
      turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-unitless-risk', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  return (run.mock.calls as unknown as [Json][])[0]![0];
}

async function size(graph: Graph, riskId: string): Promise<Graph> {
  const to = goalOf(graph).id;
  const outcome = await createAdjustEdgeStrengthHandler()({
    context: { session_id: SCENARIO, stage: 'frame', request_id: 'req-size-risk', prior_turns: [], prior_facts: [],
      scenarioBriefText: BRIEF, persistedGraph: null },
    payload: { kind: 'message', scenario_id: SCENARIO, turn_id: 'unitless-risk-size', stage: 'frame', message: 'Make that negative link stronger.' },
    requestId: 'req-size-risk', signal: new AbortController().signal, orientationText: '', graphForTurn: graph,
    proposal: { handler_id: 'adjust_edge_strength',
      entity: { id: `${riskId}→${to}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'strength', value: -0.7, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] },
  } as unknown as HandlerInvocation);
  expect(outcome.mutated_graph).toBeDefined();
  return outcome.mutated_graph as Graph;
}

function expectIncluded(graph: Graph, risk: Json, brief: string): void {
  const view = guard(graph, brief);
  expect(view.refusals).toEqual([]);
  expect(view.excludedNodeIds).not.toContain(risk.id);
  expect(view.graph.nodes.some(n => n.id === risk.id)).toBe(true);
  expect(view.graph.edges.filter(e => e.from === risk.id || e.to === risk.id)).toEqual(graph.edges.filter(e => e.from === risk.id || e.to === risk.id));
  expect(caveat(graph, brief)).toBeUndefined();
}

describe('FIX-1: CURRENT graph derivation, every Codex r1 row', () => {
  it.each([
    ['P1-1 subscriber stem', 'Our subscriber leaves in the next 6 months.', 'Subscribers leave'],
    ['P1-1 customer stem', 'We are worried that customers leave.', 'Customer churn'],
  ])('%s: a risk the user named counts in despite singular/plural rewording', (_row, wording, label) => {
    const brief = `${BRIEF} ${wording}`;
    const graph = graphOf(candidate(c => relabel(c, label)), brief);
    expectIncluded(graph, riskOf(graph, label), brief);
  });

  it('P1-2: admission with a convertible AI-sized natural effect counts the inferred risk in', () => {
    const graph = graphOf(candidate(c => {
      c.risks[0].plausible_max = 100;
      Object.assign(c.links[2], { effect_amount: -100, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    }));
    const risk = riskOf(graph);
    const edge = riskEdge(graph, risk.id);
    expect(linkSizing(edge), 'premise: FINAL admission sized the link').toBe('olumi_estimate');
    expect(edge.provenance?.natural_effect).toMatchObject({ amount: -100 });
    expectIncluded(graph, risk, BRIEF);
  });

  it('P1-2: a user-sized link discovered after candidate exclusion is adopted and counts in', async () => {
    const label = 'Appointments cancelled in advance';
    const brief = `${BRIEF} Each appointment cancelled in advance reduces Monthly revenue by £300 a month.`;
    const { graph } = await build(candidate(c => {
      relabel(c, label);
      c.risks[0].plausible_max = 100;
      Object.assign(c.links[2], { effect_amount: -300, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    }), brief);
    const risk = riskOf(graph, label);
    expect(linkSizing(riskEdge(graph, risk.id)), 'premise: FINAL admission found the user size').toBe('user');
    expectIncluded(graph, risk, brief);
  });

  it('P1-3: kept out → REAL adjust-edge-strength writer → JSON reload → next REAL Run includes risk and incident edges by id', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    expect(guard(graph, BRIEF).excludedNodeIds, 'premise: the unsized inferred risk is initially kept out').toContain(risk.id);
    const reloaded = reload(await size(graph, risk.id));
    expect(linkSizing(riskEdge(reloaded, risk.id)), 'premise: the real writer gave the user sizing credit').toBe('user');
    const payload = await runPayload(reloaded);
    expect(payload.graph.nodes.some((n: Json) => n.id === risk.id)).toBe(true);
    const before = reloaded.edges.filter(e => e.from === risk.id || e.to === risk.id).map(e => [e.from, e.to]).sort();
    expect(payload.graph.edges.filter((e: Json) => e.from === risk.id || e.to === risk.id).map((e: Json) => [e.from, e.to]).sort()).toEqual(before);
    expect(caveat(reloaded, BRIEF)).toBeUndefined();
  });

  it('P1-4: kept out → REAL structural rename user_set → reload → next Run includes it, with no omission caveat', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    expect(guard(graph, BRIEF).excludedNodeIds, 'premise: risk initially kept out').toContain(risk.id);
    const event = { kind: 'structural_rename' as const, node_id: risk.id, label: 'Customer loss', expected_label: risk.label,
      base_graph_hash: computeAnalysisAffectingGraphHash(graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0])! };
    const renamed = applyStructuralRename({ persistedGraph: graph, event: event as never, requestId: 'req-rename-risk',
      payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: 'unitless-risk-rename', stage: 'frame', event } as never });
    expect(renamed.kind).toBe('mutated');
    if (renamed.kind !== 'mutated') throw new Error(`rename refused: ${renamed.reason}`);
    const reloaded = reload(renamed.mutatedGraph as Graph);
    expect(reloaded.nodes.find(n => n.id === risk.id)).toMatchObject({ label: 'Customer loss', provenance: 'user_set' });
    const payload = await runPayload(reloaded);
    expect(payload.graph.nodes.some((n: Json) => n.id === risk.id)).toBe(true);
    expect(payload.graph.edges.some((e: Json) => e.from === risk.id && e.to === goalOf(reloaded).id)).toBe(true);
    expect(caveat(reloaded, BRIEF)).toBeUndefined();
  });

  it('P1-5: operating cost ≤ £100k and an omitted negative cost effect means the chance may be TOO LOW', async () => {
    const brief = 'Should we increase Marketing budget from £1,000 to £2,000 a month or keep it? '
      + 'Monthly operating cost is £120,000 today and must stay at most £100,000 within twelve months. '
      + 'Each extra £1 per month of Marketing budget raises Monthly operating cost by £2 per month.';
    const c = candidate(c => {
      relabel(c, 'Service withdrawal');
      Object.assign(c.goal, { metric: 'Monthly operating cost', operator: '<=', value: 100000, baseline_value: 120000 });
      c.links = c.links.map((l: Json) => l.to === 'Monthly revenue' ? { ...l, to: 'Monthly operating cost' } : l);
    });
    const { graph } = await build(c, brief);
    expect(goalOf(graph).goal_direction, 'premise: real builder held the at-most direction').toBe('<=');
    expect(guard(graph, brief).excludedNodeIds).toContain(riskOf(graph, 'Service withdrawal').id);
    expect(caveat(graph, brief)).toBe("It doesn't yet include ‘Service withdrawal’, so it may be too low.");
  });

  it('P2: an older extra-parent retained exclusion is not an omitted unitless risk and does not inflate its count', () => {
    const graph = graphOf(candidate());
    // The literal belongs to the older extra-parent keep-out family. The fresh unitless class has no literal.
    const older = riskOf(graph);
    older.label = 'Customer backlash';
    older.analysis_participation = 'retained_excluded';
    const added = { ...older, id: 'risk_fresh_unitless', label: 'Unexpected regulation' };
    delete added.analysis_participation;
    graph.nodes.push(added);
    graph.edges.push({ ...riskEdge(graph, older.id), from: added.id });
    expect(guard(graph, BRIEF).excludedNodeIds).toContain(older.id);
    expect(caveat(graph, BRIEF)).toBe("It doesn't yet include ‘Unexpected regulation’, so it may be too high.");
    const onlyOlder = { ...graph, nodes: graph.nodes.filter(n => n.id !== added.id), edges: graph.edges.filter(e => e.from !== added.id) };
    expect(caveat(onlyOlder, BRIEF)).toBeUndefined();
  });

  it("explicit 'included' set directly in the graph fixture always wins", () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    risk.analysis_participation = 'included';
    expectIncluded(graph, risk, BRIEF);
  });

  it('class fix: real admission and registered draft never stamp retained_excluded for the unitless class', async () => {
    const c = candidate();
    const before = structuredClone(c);
    expect(riskOf(graphOf(c)).analysis_participation).toBeUndefined();
    expect(c, 'admission remains pure').toEqual(before);
    const { graph, out } = await build(c);
    expect(riskOf(graph).analysis_participation).toBeUndefined();
    expect((out.not_represented as string[]).filter(s => s.includes('shown as a risk to weigh and kept out of the chance')))
      .toEqual(["Olumi added ‘Client backlash’ as a risk but can't size it in your goal's units yet, so it's shown as a risk to weigh and kept out of the chance."]);
  });

  it('CURRENT no-stamp graph: Run guard, asAnalysed and draft withholding mirror use the SAME derivation', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    delete risk.analysis_participation;
    const before = structuredClone(graph);
    expect(guard(graph, BRIEF).excludedNodeIds).toEqual([risk.id]);
    expect(analysed(graph, undefined, BRIEF).nodes.some(n => n.id === risk.id)).toBe(false);
    expect(withheld(graph, BRIEF), 'the unitless omission alone no longer withholds the sized core').toBe(false);
    const payload = await runPayload(graph);
    expect(payload.graph.nodes.some((n: Json) => n.id === risk.id)).toBe(false);
    expect(payload.graph.edges.some((e: Json) => e.from === risk.id || e.to === risk.id)).toBe(false);
    expect(graph, 'readers must not stamp/mutate the persisted model').toEqual(before);
  });

  it('missing brief fails closed in Run, asAnalysed, withholding and the caveat', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    delete risk.analysis_participation;
    expect(guard(graph).excludedNodeIds).toEqual([]);
    expect(analysed(graph).nodes.some(n => n.id === risk.id)).toBe(true);
    expect(withheld(graph)).toBe(true);
    expect(caveat(graph)).toBeUndefined();
    const payload = await runPayload(graph, null);
    expect(payload.graph.nodes.some((n: Json) => n.id === risk.id)).toBe(true);
  });

  it.each([
    ['kind factor', (graph: Graph, risk: Json) => { risk.kind = 'factor'; }],
    ['provenance from_brief', (_graph: Graph, risk: Json) => { risk.provenance = 'from_brief'; }],
    ['provenance user_set', (_graph: Graph, risk: Json) => { risk.provenance = 'user_set'; }],
    ['unknown provenance', (_graph: Graph, risk: Json) => { delete risk.provenance; }],
    ['user occurrence', (_graph: Graph, risk: Json) => { risk.event_risk = { occurrence: {
      p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon',
    } }; }],
    ['relies_on precondition', (graph: Graph, risk: Json) => { risk.relies_on = { option_id: optionsOf(graph)[0] }; }],
    ['constraint metric match', (graph: Graph, risk: Json) => {
      risk.metric = 'Monthly churn';
      graph.goal_constraints = [{ constraint_id: 'limit_churn', label: 'Monthly churn', operator_as_stated: '<=', value: 5, unit: '%' }];
    }],
    ['constraint target', (graph: Graph, risk: Json) => { graph.goal_constraints = [{ node_id: risk.id, constraint_id: 'limit_client' }]; }],
    ['option intervention target', (graph: Graph, risk: Json) => {
      graph.nodes.find(n => n.kind === 'option')!.interventions[risk.id] = { value: 0.3 };
    }],
    ['definitional link', (graph: Graph, risk: Json) => { riskEdge(graph, risk.id).definitional = true; }],
    ['provenance definitional link', (graph: Graph, risk: Json) => { riskEdge(graph, risk.id).provenance.definitional = true; }],
    ['FINAL user-sized link', (graph: Graph, risk: Json) => {
      riskEdge(graph, risk.id).provenance = { source: 'user_specified' };
    }],
    ['FINAL Olumi-estimated link', (graph: Graph, risk: Json) => {
      riskEdge(graph, risk.id).provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    }],
    ['FINAL accepted Olumi-estimated link', (graph: Graph, risk: Json) => {
      riskEdge(graph, risk.id).provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } };
    }],
    ['FINAL unmarked link', (graph: Graph, risk: Json) => {
      const edge = riskEdge(graph, risk.id);
      delete edge.provenance;
      delete edge.defaulted;
    }],
    ['no goal path', (graph: Graph, risk: Json) => { graph.edges = graph.edges.filter(e => e.from !== risk.id); }],
  ] as const)('never derive exclusion for %s; Run view and caveat agree', (_row, change) => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    delete risk.analysis_participation;
    expect(guard(graph, BRIEF).excludedNodeIds, 'premise: unchanged inferred placeholder risk qualifies').toContain(risk.id);
    change(graph, risk);
    expectIncluded(graph, risk, BRIEF);
    expect(analysed(graph, undefined, BRIEF).nodes.some(n => n.id === risk.id)).toBe(true);
  });

  it('FINAL projected mean stays a placeholder even when its source says the user drew it', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    delete risk.analysis_participation;
    const edge = riskEdge(graph, risk.id);
    edge.provenance = { source: 'user_specified', magnitude: 'olumi_estimate', mean_projected: true };
    expect(linkSizing(edge)).toBe('placeholder');
    expect(guard(graph, BRIEF).excludedNodeIds).toContain(risk.id);
    expect(caveat(graph, BRIEF)).toContain('Client backlash');
  });

  it('a FINAL sized incident incoming cause link also keeps the risk in', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    delete risk.analysis_participation;
    const incoming = graph.edges.find(e => e.to === risk.id)!;
    incoming.provenance = { source: 'user_specified' };
    expect(linkSizing(incoming)).toBe('user');
    expectIncluded(graph, risk, BRIEF);
  });

  it('function words shared with the brief do not turn an added risk into a user-named concern', () => {
    const brief = `${BRIEF} There are other things we should consider.`;
    const graph = graphOf(candidate(c => relabel(c, 'Other Client backlash')), brief);
    const risk = riskOf(graph, 'Other Client backlash');
    delete risk.analysis_participation;
    expect(guard(graph, brief).excludedNodeIds).toContain(risk.id);
  });

  it('a bidirected-only connection to the goal supplies no causal omission path', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    riskEdge(graph, risk.id).edge_type = 'bidirected';
    expectIncluded(graph, risk, BRIEF);
    expect(analysed(graph, undefined, BRIEF).nodes.some(n => n.id === risk.id)).toBe(true);
  });

  it('a sized bidirected incident edge does not veto omission of the real directed-placeholder path', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    graph.nodes.push({ id: 'factor_confounder', kind: 'factor', label: 'Unmeasured common cause' });
    graph.edges.push({ from: 'factor_confounder', to: risk.id, edge_type: 'bidirected',
      strength: { mean: 0.6, std: 0.1 }, provenance: { source: 'user_specified' }, effect_direction: 'positive' });
    expect(guard(graph, BRIEF).excludedNodeIds).toContain(risk.id);
    expect(caveat(graph, BRIEF)).toBe("It doesn't yet include ‘Client backlash’, so it may be too high.");
  });

  it('targetTestabilityOf follows the derived asAnalysed view and explicit includes reverse that view', async () => {
    const { graph } = await build(candidate());
    const risk = riskOf(graph);
    const p5Links = (verdict: ReturnType<typeof targetTestabilityOf>) => verdict.kind === 'not_testable'
      ? verdict.failures.filter(f => f.precondition === 'P5').flatMap(f => f.links ?? []) : [];
    const touchesRisk = (links: readonly { from: string; to: string }[]) => links.some(l => l.from === risk.id || l.to === risk.id);
    expect(touchesRisk(p5Links(targetTestabilityOf(graph))), 'premise: no brief keeps the risk path in the target test').toBe(true);
    expect(touchesRisk(p5Links(targetTestabilityOf(graph, undefined, BRIEF)))).toBe(false);
    risk.analysis_participation = 'included';
    expect(touchesRisk(p5Links(targetTestabilityOf(graph, undefined, BRIEF)))).toBe(true);
  });

  it('a limit held only in the Run snapshot opts protects the risk before derivation', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    delete graph.goal_constraints;
    expect(guard(graph, BRIEF).excludedNodeIds, 'premise: no graph-carried limit').toContain(risk.id);
    const goalConstraints = [{ constraint_id: 'snapshot_limit', node_id: risk.id }];
    const view = guardAnalysisParticipation(graph, { goalNodeId: goalOf(graph).id, brief: BRIEF, goalConstraints });
    expect(view.excludedNodeIds).not.toContain(risk.id);
    expect(view.graph.nodes.some(n => n.id === risk.id)).toBe(true);
    expect(caveat({ ...graph, goal_constraints: goalConstraints }, BRIEF)).toBeUndefined();
  });

  it('a sole risk path through an older retained-excluded mediator creates no new omission', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    const oldMediator = { id: 'factor_old_kept_out', kind: 'factor', label: 'Duplicate route', analysis_participation: 'retained_excluded' };
    graph.nodes.push(oldMediator);
    const through = riskEdge(graph, risk.id);
    through.to = oldMediator.id;
    graph.edges.push({ ...through, from: oldMediator.id, to: goalOf(graph).id });
    const view = guard(graph, BRIEF);
    expect(view.excludedNodeIds).toEqual([oldMediator.id]);
    expect(view.graph.nodes.some(n => n.id === risk.id)).toBe(true);
    expect(view.graph.nodes.some(n => n.id === oldMediator.id)).toBe(false);
    expect(caveat(graph, BRIEF)).toBeUndefined();
    expect(analysed(graph, undefined, BRIEF).nodes.some(n => n.id === risk.id)).toBe(true);
  });

  it('the active positive path determines too-low words when a negative path passes through an older excluded mediator', () => {
    const graph = graphOf(candidate());
    const risk = riskOf(graph);
    const active = riskEdge(graph, risk.id);
    active.effect_direction = 'positive';
    const oldMediator = { id: 'factor_old_kept_out', kind: 'factor', label: 'Duplicate route', analysis_participation: 'retained_excluded' };
    graph.nodes.push(oldMediator);
    graph.edges.push({ ...active, from: risk.id, to: oldMediator.id, effect_direction: 'negative' });
    graph.edges.push({ ...active, from: oldMediator.id, to: goalOf(graph).id, effect_direction: 'positive' });
    expect(guard(graph, BRIEF).excludedNodeIds).toEqual([risk.id, oldMediator.id]);
    expect(caveat(graph, BRIEF)).toBe("It doesn't yet include ‘Client backlash’, so it may be too low.");
  });
});
