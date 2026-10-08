/** P05b automatic draft validation: selective bounded repair, inert risks and exact fallback. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as admission from '../admit-model.js';
import type { AdmittedModel, CandidateModel } from '../admit-model.js';
import * as widening from '../runtime/widen-draft.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { risksTurnFromSignals, widenGate, widenTurnFromSignals } from '../method-turn/widen-turn.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { inertRiskBranch, preconditionRiskIds, withoutPreconditionRisks } from '../../../graph/inert-risk.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { constructionDeadline } from '../../../routes/agent-v1-turn.js';
import { log } from '../../../utils/telemetry.js';
import { recordingDrafter, type DrafterCallRecord } from '../../drafter-raw/record.js';
import * as drafterRaw from '../../drafter-raw/index.js';

type Rec = Record<string, any>;
const BRIEF = 'We want to deliver 20 features in six months. I propose Hire a Tech Lead. Today we have 0 Developer hires, 0 Tech lead hires, and 0 Contractor hours. Developer hires can range up to 10 people; Tech lead hires up to 10 people; Contractor hours up to 100 hours. Background demand is 10 enquiries, up to 100 enquiries.';
const SCENARIO = '99999999-9999-4999-8999-999999999999';
const RATIONALE = 'RATIONALE MUST NEVER REACH ANY USER VISIBLE GRAPH FIELD';
const OPTIONS_PREAMBLE = 'Where the text asks why an option might do better, write instead how it would move the goal through a different mechanism; never use better, best, recommend, winner, or improve.';
const PREAMBLE = "This is Olumi's own check of a first draft; the user has not asked for it. Anything you add is shown as Olumi's suggestion for the user to keep or remove. Where the text below says the user asked or will approve, read it as: Olumi is suggesting, and the user decides.";
const WIDEN_TURN_SHA256 = '378292bd12aec3a4392ace8ede96e672a8170e0255472a2e8e2eb96ee30e4a67';
const B1_GRAPH = (JSON.parse(readFileSync(new URL('./fixtures/b1-two-state/turn-004-WIDEN-1791343253849.json', import.meta.url), 'utf8')) as { draft_graph: Rec }).draft_graph;
const ADMIT = admission.admitCandidateModel;
const factor = (label: string, unit = 'people', baseline = 0, max = 10): CandidateModel['factors'][number] => ({
  label, role: 'observable', baseline_known: true, baseline_value: baseline, unit, provenance: 'explicit', plausible_max: max,
});
const opt = (label: string, factorLabel: string, value: number, unit = 'people', provenance = 'explicit'): CandidateModel['options'][number] => ({
  label, provenance, changes: [], is_status_quo: false,
  interventions: [{ factor_label: factorLabel, value, unit, provenance: 'ai_proposed' }],
});
function candidate({ risks = 2, sameLever = false, nonSq = 3, counterCase = false }: { risks?: number; sameLever?: boolean; nonSq?: number; counterCase?: boolean } = {}): CandidateModel {
  const options = sameLever
    ? [opt('Hire a Tech Lead', 'Developer hires', 2), opt('Grow engineering team', 'Developer hires', 3, 'people', 'inferred'), opt('Recruit more developers', 'Developer hires', 4, 'people', 'inferred')]
    : [opt('Hire a Tech Lead', 'Tech lead hires', 1), opt('Hire Two Developers', 'Developer hires', 2, 'people', 'inferred'), opt('Use contractors', 'Contractor hours', 20, 'hours', 'inferred')];
  return {
    goal: { metric: 'Features delivered', operator: '>=', value: 20, unit: 'features', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [{ label: 'Carry on as now', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true }, ...options.slice(0, nonSq)],
    factors: [factor('Developer hires'), factor('Tech lead hires'), factor('Contractor hours', 'hours', 0, 100), { ...factor('Background demand', 'enquiries', 10, 100), role: 'external' }],
    risks: Array.from({ length: risks }, (_, i) => ({ label: i === 0 ? 'Supplier interruption' : 'Customer delay', provenance: 'explicit', ...(counterCase ? { unit: 'features', plausible_max: 100 } : {}) })),
    outcomes: [{ label: 'Feature delivery capacity', provenance: 'inferred', unit: 'features', plausible_max: 100 }],
    links: ['Developer hires', 'Tech lead hires', 'Contractor hours'].map((from) => ({ from, to: 'Feature delivery capacity', direction: 'positive', provenance: 'inferred' })).concat([
      { from: 'Feature delivery capacity', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
      ...(counterCase && risks > 0 ? [
        { from: 'Developer hires', to: 'Supplier interruption', direction: 'positive', provenance: 'inferred' },
        { from: 'Supplier interruption', to: 'Feature delivery capacity', direction: 'negative', provenance: 'inferred' },
      ] : []),
    ]),
  };
}
const fixture = (args: Parameters<typeof candidate>[0] = {}) => {
  const c = candidate(args);
  return { candidate: c, admitted: ADMIT(c, {}, BRIEF), brief: BRIEF, deadlineAt: Date.now() + 60_000 };
};
const riskSuggestions = (sameLever = false) => [
  { label: 'Recruitment delay', category: 'timing', hits_id: sameLever ? 'grow_engineering_team' : 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'filling both developer roles quickly', watch_for: 'offers remain unaccepted' },
  { label: 'Coordination drag', category: 'people', mechanism: 'drives', hits_id: sameLever ? 'grow_engineering_team' : 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
  { label: 'Supplier disruption', category: 'external', mechanism: 'drives', hits_id: sameLever ? 'grow_engineering_team' : 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'tools remaining available during onboarding', watch_for: 'tool outages during delivery' },
  { label: 'Wrong bottleneck', category: 'dependency', hits_id: 'hire_a_tech_lead', through_id: sameLever ? 'developer_hires' : 'tech_lead_hires', through_direction: 'positive', affects_id: 'features_delivered', direction: 'negative', relies_on: 'a Tech Lead removing the main delivery blocker', watch_for: 'delays persist after the lead starts' },
];
const level = (value: number, unit = 'people', basis = 'A bounded pilot for the team to test') => ({ value, unit, estimate: true, basis });
const optionsArgs = () => ({ options: [
  { label: 'Combine lead and developer hires', acts_on: [{ factor_label: 'Developer hires', direction: 'positive', level: level(1) }, { factor_label: 'Tech lead hires', direction: 'positive', level: level(1) }], rationale: RATIONALE },
  { label: 'Try a contractor pilot', acts_on: [{ factor_label: 'Developer hires', direction: 'positive', level: level(1) }, { factor_label: 'Contractor hours', direction: 'positive', level: level(10, 'hours') }], rationale: RATIONALE },
] });
const isRisks = (req: Parameters<CallStructuredModel>[0]) => req.instructions.includes('suggest risks they have not considered');
const isOptions = (req: Parameters<CallStructuredModel>[0]) => req.instructions.includes('METHOD TURN:') && req.instructions.includes('propose_new_option');
function generator(risks?: unknown, options: unknown = optionsArgs()) {
  return vi.fn<CallStructuredModel>(async (req) => {
    const sameLever = (JSON.parse(req.input).graph.nodes as Rec[]).some(n => n.id === 'grow_engineering_team');
    return { text: JSON.stringify(isRisks(req) ? { risk_suggestions: risks ?? riskSuggestions(sameLever) } : options) };
  });
}
const addedNodes = (before: AdmittedModel, after: AdmittedModel, kind: string): Rec[] => {
  const ids = new Set(before.nodes.map((n) => n.id));
  return (after.nodes as unknown as Rec[]).filter((n) => n.kind === kind && !ids.has(n.id));
};
const graphOf = (a: AdmittedModel): Rec => ({ nodes: a.nodes, edges: a.edges, ...(a.goal_constraints.length ? { goal_constraints: a.goal_constraints } : {}) });
function expectOriginalIdentity(before: AdmittedModel, after: AdmittedModel) {
  for (const n of before.nodes) expect(after.nodes.find((x) => x.id === n.id), n.id).toEqual(n);
  for (const e of before.edges) expect(after.edges.find((x) => x.from === e.from && x.to === e.to), `${e.from}->${e.to}`).toEqual(e);
}
function builder(c: CandidateModel, pass: CallStructuredModel, brief = BRIEF, deadlineAt = Date.now() + 60_000) {
  let graph: Rec | undefined;
  const recording: DrafterCallRecord[] = [];
  const callStructured = vi.fn<CallStructuredModel>(async (req, callDeadlineAt) => isRisks(req) || isOptions(req) ? pass(req, callDeadlineAt) : { text: JSON.stringify(c) });
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, versions: [] } };
  };
  const promise = buildModelFromBrief(SCENARIO, brief, dispatch, recordingDrafter(callStructured, recording), undefined, deadlineAt, callStructured).then((out) => ({ out: out as Rec, graph, callStructured, recording }));
  return { promise, callStructured, recording };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); drafterRaw.resetDrafterRawStoreForTests(); });

const validationGraph = (): Rec => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Success' },
    { id: 'lever_a', kind: 'factor', label: 'First lever', observed_state: { value: 0 } },
    { id: 'lever_b', kind: 'factor', label: 'Second lever', observed_state: { value: 0 } },
    { id: 'baseline_lever', kind: 'factor', label: 'Baseline factor', observed_state: { value: 0 } },
    { id: 'bridge', kind: 'outcome', label: 'Intermediate exposure' },
    { id: 'option_a', kind: 'option', label: 'First option', interventions: { lever_a: { value: 1 } } },
    { id: 'option_b', kind: 'option', label: 'Second option', interventions: { lever_b: { value: 1 } } },
    { id: 'baseline', kind: 'option', label: 'An arbitrary baseline label', is_baseline: true, interventions: { baseline_lever: { value: 1 } } },
    { id: 'risk_a', kind: 'risk', label: 'First concern' },
    { id: 'risk_b', kind: 'risk', label: 'Second concern' },
  ],
  edges: [{ from: 'lever_a', to: 'bridge' }, { from: 'bridge', to: 'risk_a' }],
});

describe('P05b pure typed draft diagnosis', () => {
  it('dv-typed: renaming every label preserves sufficient, risk-deficient and option-deficient diagnoses', () => {
    const rich = validationGraph();
    const noCounter = { ...rich, edges: [] };
    const sameLever = { ...rich, nodes: rich.nodes.map((n: Rec) => n.id === 'option_b' ? { ...n, interventions: { lever_a: { value: 2 } } } : n) };
    const tooFew = { ...rich, nodes: rich.nodes.filter((n: Rec) => n.id !== 'risk_b') };
    for (const graph of [rich, noCounter, sameLever, tooFew]) {
      const bytes = JSON.stringify(graph);
      const before = widening.diagnoseDraft(graph);
      const renamed = { ...graph, nodes: graph.nodes.map((n: Rec) => ({ ...n, label: 'Carry on as now', description: 'No action and no risks' })) };
      expect(widening.diagnoseDraft(renamed)).toEqual(before);
      expect(JSON.stringify(graph)).toBe(bytes);
    }
    expect(widening.diagnoseDraft(rich)).toEqual({ risks: null, options: null });
    expect(widening.diagnoseDraft(noCounter)).toEqual({ risks: 'no_counter_case', options: null });
    expect(widening.diagnoseDraft(sameLever)).toEqual({ risks: null, options: 'no_distinct_lever' });
    expect(widening.diagnoseDraft(tooFew)).toEqual({ risks: 'too_few', options: null });
  });

  it('dv-directed-counter: intervention targets reach risks through directed paths, including cycles, but reversed paths do not', () => {
    const graph = validationGraph();
    expect(widening.diagnoseDraft(graph).risks).toBeNull();
    expect(widening.diagnoseDraft({ ...graph, edges: [...graph.edges, { from: 'bridge', to: 'lever_a' }] }).risks).toBeNull();
    expect(widening.diagnoseDraft({ ...graph, edges: [{ from: 'risk_a', to: 'bridge' }, { from: 'bridge', to: 'lever_a' }] }).risks).toBe('no_counter_case');
    // Existing lever fallback remains typed: an option-to-factor edge supplies an unknown move.
    const edgeLever = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === 'option_a' ? { ...n, interventions: undefined } : n), edges: [...graph.edges, { from: 'option_a', to: 'lever_a' }] };
    expect(widening.diagnoseDraft(edgeLever).risks).toBeNull();
  });

  it.each(['relies_on_option_id', 'relies_on_hits', 'draft_widening'] as const)(
    'dv-attachment-%s: typed risk attachment can bear on an active option without graph edges', (shape) => {
      const graph = validationGraph();
      const attachment = shape === 'relies_on_option_id' ? { relies_on: { option_id: 'option_a' } }
        : shape === 'relies_on_hits' ? { relies_on: { hits: { id: 'option_a' } } }
        : { draft_widening: { provenance: 'ai_suggested_widen', hits: { id: 'option_a', kind: 'option' } } };
      const attached = { ...graph, edges: [], nodes: graph.nodes.map((n: Rec) => n.id === 'risk_a' ? { ...n, ...attachment } : n) };
      expect(widening.diagnoseDraft(attached)).toEqual({ risks: null, options: null });
      expect(widening.diagnoseDraft({ ...attached, nodes: attached.nodes.map((n: Rec) => n.id === 'option_a' ? { ...n, is_baseline: true } : n) }).risks).toBe('no_counter_case');
    });

  it('dv-active-only: baseline and typed status quo risks do not count as an active-option counter-case', () => {
    const graph = validationGraph();
    const baselineOnly = { ...graph, edges: [{ from: 'baseline_lever', to: 'risk_a' }] };
    expect(widening.diagnoseDraft(baselineOnly)).toEqual({ risks: 'no_counter_case', options: null });
    const nestedBaseline = { ...baselineOnly, nodes: baselineOnly.nodes.map((n: Rec) => n.id === 'baseline' ? { ...n, is_baseline: undefined, data: { is_baseline: true } } : n) };
    expect(widening.diagnoseDraft(nestedBaseline)).toEqual({ risks: 'no_counter_case', options: null });
    const statusQuo = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === 'option_a' ? { ...n, is_status_quo: true } : n) };
    expect(widening.diagnoseDraft(statusQuo)).toEqual({ risks: 'no_counter_case', options: 'no_distinct_lever' });
  });

  it('dv-distinctness: one active option is deficient; opposite directions are distinct and differing magnitudes alone are not', () => {
    const graph = validationGraph();
    const single = { ...graph, nodes: graph.nodes.filter((n: Rec) => n.id !== 'option_b') };
    expect(widening.diagnoseDraft(single).options).toBe('no_distinct_lever');
    const neither = { ...single, nodes: single.nodes.filter((n: Rec) => n.id !== 'option_a') };
    expect(widening.diagnoseDraft(neither)).toEqual({ risks: 'no_counter_case', options: 'no_distinct_lever' });
    const sameFactor = (value: number) => ({ ...graph, nodes: graph.nodes.map((n: Rec) => n.id === 'option_b' ? { ...n, interventions: { lever_a: { value } } } : n) });
    expect(widening.diagnoseDraft(sameFactor(2)).options).toBe('no_distinct_lever');
    expect(widening.diagnoseDraft(sameFactor(-1)).options).toBeNull();
  });

  it('dv-unproven-distinct: an unknown move or an empty lever never proves distinctness, in either option order', () => {
    const graph = validationGraph();
    const unknownOn = (unknownId: string, knownId: string) => ({ ...graph,
      nodes: graph.nodes.map((n: Rec) => n.id === unknownId ? { ...n, interventions: undefined } : n.id === knownId ? { ...n, interventions: { lever_a: { value: 2 } } } : n),
      edges: [...graph.edges, { from: unknownId, to: 'lever_a' }] });
    expect(widening.diagnoseDraft(unknownOn('option_a', 'option_b')).options).toBe('no_distinct_lever');
    expect(widening.diagnoseDraft(unknownOn('option_b', 'option_a')).options).toBe('no_distinct_lever');
    const empty = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === 'option_b' ? { ...n, interventions: undefined } : n) };
    expect(widening.diagnoseDraft(empty).options).toBe('no_distinct_lever');
    // CONTRAST: a known opposite move on the same factor is still distinct.
    expect(widening.diagnoseDraft({ ...graph, nodes: graph.nodes.map((n: Rec) => n.id === 'option_b' ? { ...n, interventions: { lever_a: { value: -1 } } } : n) }).options).toBeNull();
  });

  it('dv-B1-fixture: the captured B1 has one risk and two distinct active levers, so only the risks call runs', async () => {
    const bytes = JSON.stringify(B1_GRAPH);
    expect(widening.diagnoseDraft(B1_GRAPH)).toEqual({ risks: 'too_few', options: null });
    expect(JSON.stringify(B1_GRAPH)).toBe(bytes);
    const input = fixture({ risks: 1 });
    const admitted = { ...input.admitted, nodes: B1_GRAPH.nodes, edges: B1_GRAPH.edges, goal_constraints: [] };
    const callStructured = generator([], { options: [] });
    expect(await widening.widenDraft({ ...input, admitted, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(1);
    expect(isRisks(callStructured.mock.calls[0]![0])).toBe(true);
    expect(JSON.stringify(B1_GRAPH)).toBe(bytes);
  });
});

describe('P05b automatic widening, rows bound to graph identity', () => {
  it('dv-rich: a sufficient draft makes zero calls and ships byte-identical with zero widening latency', async () => {
    const input = fixture({ counterCase: true });
    const graph = graphOf(input.admitted);
    const graphBytes = JSON.stringify(graph);
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(widening.diagnoseDraft(graph)).toEqual({ risks: null, options: null });
    expect(await widening.widenDraft({ ...input, clock: () => 42, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(graph)).toBe(graphBytes);
    expect(JSON.stringify(input)).toBe(bytes);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ calls: 0, ms: 0, outcome: 'sufficient', diagnosis: { risks: null, options: null }, counts: { options: 0, risks: 0 } });
  });

  it('dv-final-graph: diagnosis follows the final un-widened graph after pure post-admission projection', async () => {
    const input = fixture({ counterCase: true });
    expect(widening.diagnoseDraft(graphOf(input.admitted))).toEqual({ risks: null, options: null });
    const finalGraph = vi.fn((admitted: AdmittedModel) => ({ ...graphOf(admitted),
      edges: admitted.edges.filter(e => !(e.from === 'developer_hires' && e.to === 'supplier_interruption')),
    }));
    const callStructured = generator();
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    await widening.widenDraft({ ...input, finalGraph, callStructured });
    expect(finalGraph).toHaveBeenCalled();
    expect(finalGraph.mock.calls[0]![0]).toBe(input.admitted);
    expect(callStructured).toHaveBeenCalledTimes(1);
    expect(isRisks(callStructured.mock.calls[0]![0])).toBe(true);
    expect(events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0]).toMatchObject({ diagnosis: { risks: 'no_counter_case', options: null } });
  });

  it('dv-no-counter: two unattached risks and distinct levers run only the risks pass', async () => {
    const input = fixture();
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(widening.diagnoseDraft(graphOf(input.admitted))).toEqual({ risks: 'no_counter_case', options: null });
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(1);
    expect(isRisks(callStructured.mock.calls[0]![0])).toBe(true);
    expect(out!.calls).toBe(1);
    expect(out!.counts).toEqual({ options: 0, risks: 3 });
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0]).toMatchObject({ diagnosis: { risks: 'no_counter_case', options: null } });
  });

  it('dv-too-few-risks: one risk and distinct levers run only risks and retain zero-edge attachments', async () => {
    const input = fixture({ risks: 1 });
    const callStructured = generator(riskSuggestions(), { options: [] });
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(1);
    expect(isRisks(callStructured.mock.calls[0]![0])).toBe(true);
    expect(widening.diagnoseDraft(graphOf(input.admitted))).toEqual({ risks: 'too_few', options: null });
    expect(out!.calls).toBe(1);
    expect(out).not.toHaveProperty('triggered');
    const added = addedNodes(input.admitted, out!.admitted, 'risk');
    expect(added).toHaveLength(3);
    expect(out!.counts).toEqual({ options: 0, risks: 3 });
    expect(events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0]).not.toHaveProperty('partial');
    expect(added.some((n) => n.draft_widening.hits.id === 'hire_a_tech_lead')).toBe(true);
    for (const risk of added) {
      expect(['from_brief', 'ai_inferred', 'user_set']).toContain(risk.provenance);
      expect(risk.proposed_by).toBe('olumi');
      expect(risk.analysis_participation).toBe('retained_excluded');
      expect(risk.draft_widening).toMatchObject({ provenance: 'ai_suggested_widen', hits: { kind: 'option' }, through: { id: expect.any(String) }, affects: { id: expect.any(String) }, mechanism: expect.any(String), relies_on: expect.any(String), watch_for: expect.any(String) });
      expect(out!.admitted.edges.filter((e) => e.from === risk.id || e.to === risk.id)).toEqual([]);
    }
    const g = graphOf(out!.admitted);
    const exempt = preconditionRiskIds(g.nodes, g.edges, []);
    const branch = inertRiskBranch(g.nodes, g.edges, []);
    for (const risk of added) { expect(exempt.has(risk.id)).toBe(true); expect(branch.has(risk.id)).toBe(true); }
    const compute = withoutPreconditionRisks(g) as Rec;
    expect(compute.nodes.filter((n: Rec) => added.some((r) => r.id === n.id))).toEqual([]);
    const beforeIssues = validateGraphStructure(graphOf(input.admitted) as never, { leaveOutInertRisks: true }).violations;
    const afterIssues = validateGraphStructure(g as never, { leaveOutInertRisks: true }).violations;
    expect(afterIssues).toEqual(beforeIssues);
    expect(out!.admitted.withheld).toEqual(input.admitted.withheld);
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(GraphV3.safeParse(g).success).toBe(true);
  });

  it('aw-shared-risk: an explicitly attached shared driver also stays out of the calculation', async () => {
    const input = fixture({ risks: 1 });
    const shared = { label: 'Demand disruption', category: 'external', mechanism: 'drives', hits_id: 'background_demand', through_id: 'background_demand', through_direction: 'positive', affects_id: 'features_delivered', direction: 'negative', relies_on: 'customer demand staying steady', watch_for: 'fewer enquiries arriving' };
    const out = await widening.widenDraft({ ...input, callStructured: generator([shared], { options: [] }) });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'risk');
    expect(added).toHaveLength(1);
    expect(added[0]!.draft_widening.hits).toMatchObject({ id: 'background_demand', kind: 'factor' });
    const g = graphOf(out!.admitted);
    expect(preconditionRiskIds(g.nodes, g.edges, []).has(added[0]!.id)).toBe(true);
    expect((withoutPreconditionRisks(g) as Rec).nodes.some((n: Rec) => n.id === added[0]!.id)).toBe(false);
    expect(out!.admitted.edges.filter((e) => e.from === added[0]!.id || e.to === added[0]!.id)).toEqual([]);
  });

  it('aw-risk-exemption: malformed stamps, incident edges, limits, duplicates and unmarked orphans get no exemption', async () => {
    const input = fixture({ risks: 1 });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'risk')[0]!;
    const g = graphOf(out!.admitted);
    const check = (risk: Rec, nodes = g.nodes, edges = g.edges, limits: string[] = []) => preconditionRiskIds(nodes.map((n: Rec) => n.id === added.id ? risk : n), edges, limits).has(added.id);
    expect(check(added)).toBe(true);
    expect(check(added, g.nodes, [...g.edges, { from: added.id, to: 'features_delivered' }])).toBe(false);
    expect(check(added, g.nodes, g.edges, [added.id])).toBe(false);
    expect(check(added, [...g.nodes, added])).toBe(false);
    // Display provenance can be recomputed by the graph projection; the retained nested stamp is authoritative.
    expect(check({ ...added, provenance: 'ai_inferred' })).toBe(true);
    expect(check({ ...added, proposed_by: undefined })).toBe(false);
    expect(check({ ...added, analysis_participation: undefined })).toBe(false);
    expect(check({ ...added, draft_widening: undefined })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, hits: { id: 'missing_option', label: 'Missing option', kind: 'option' } } })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, through: { id: 'features_delivered', label: 'Features delivered', direction: 'positive' } } })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, affects: { id: 'developer_hires', label: 'Developer hires', direction: 'negative' } } })).toBe(false);
  });

  it('dv-same-lever: a counter-case and same-lever options run only options with grounded estimates', async () => {
    const input = fixture({ sameLever: true, counterCase: true });
    const callStructured = generator([]);
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(1);
    expect(isOptions(callStructured.mock.calls[0]![0])).toBe(true);
    expect(widening.diagnoseDraft(graphOf(input.admitted))).toEqual({ risks: null, options: 'no_distinct_lever' });
    expect(out!.calls).toBe(1);
    expect(out).not.toHaveProperty('triggered');
    const added = addedNodes(input.admitted, out!.admitted, 'option');
    expect(added).toHaveLength(2);
    expect(out!.counts).toEqual({ options: 2, risks: 0 });
    const goalPath = new Set(['developer_hires', 'tech_lead_hires', 'contractor_hours']);
    for (const n of added) {
      expect(n.proposed_by).toBe('olumi');
      expect(['from_brief', 'ai_inferred', 'user_set']).toContain(n.provenance);
      expect(n.draft_widening.provenance).toBe('ai_suggested_widen');
      expect(Object.keys(n.interventions).some((id) => goalPath.has(id))).toBe(true);
      for (const setting of Object.values(n.interventions) as Rec[]) expect(setting).toMatchObject({ estimate: true, basis: expect.any(String), source: 'cee_hypothesis' });
    }
    expect(JSON.stringify(out!.admitted)).not.toContain(RATIONALE);
    expect(JSON.stringify(out!.admitted)).not.toContain('rationale');
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(GraphV3.safeParse(graphOf(out!.admitted)).success).toBe(true);
  });

  it('dv-both: a one-risk, same-lever two-option draft starts both repairs before either resolves', async () => {
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    const releases: (() => void)[] = [];
    const callStructured = vi.fn<CallStructuredModel>((req) => new Promise((resolve) => {
      releases.push(() => resolve({ text: JSON.stringify(isRisks(req) ? { risk_suggestions: riskSuggestions(true) } : optionsArgs()) }));
    }));
    const promise = widening.widenDraft({ ...input, callStructured });
    await Promise.resolve();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(2);
    for (const release of releases) release();
    const out = await promise;
    expect(out!.calls).toBe(2);
    expect(out).not.toHaveProperty('triggered');
    expect(out!.counts.options).toBeGreaterThan(0);
    expect(out!.counts.risks).toBeGreaterThan(0);
    expect(out!.counts.options).toBeLessThanOrEqual(3);
    expect(out!.counts.risks).toBeLessThanOrEqual(3);
  });

  it.each(['risks', 'options'] as const)('aw-partial-%s-empty-or-invalid: the other pass ships after an empty, invalid or failed pass', async (dropped) => {
    for (const failure of ['empty', 'invalid', 'throw', 'incomplete'] as const) {
      const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
      const bytes = JSON.stringify(input);
      const events = vi.spyOn(log, 'info').mockImplementation(() => {});
      const callStructured = vi.fn<CallStructuredModel>(async (req) => {
        const failed = dropped === 'risks' ? isRisks(req) : isOptions(req);
        if (failed && failure === 'throw') throw new Error('only this pass failed');
        if (failed && failure === 'invalid') return { text: 'not valid JSON' };
        if (failed && failure === 'incomplete') return { text: '', status: 'incomplete' };
        return { text: JSON.stringify(isRisks(req)
          ? { risk_suggestions: failed ? [] : riskSuggestions(true) }
          : failed ? { options: [] } : optionsArgs()) };
      });
      const out = await widening.widenDraft({ ...input, callStructured });
      expect(out, `${dropped} ${failure} must preserve the successful pass`).not.toBeNull();
      expect(callStructured).toHaveBeenCalledTimes(2);
      expect(out!.counts).toEqual(dropped === 'risks' ? { options: 2, risks: 0 } : { options: 0, risks: 3 });
      expectOriginalIdentity(input.admitted, out!.admitted);
      expect(JSON.stringify(input)).toBe(bytes);
      const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
      expect(event).toMatchObject({ outcome: 'widened', calls: 2, partial: true, enrichment_incomplete: false, counts: out!.counts });
      expect(event).not.toHaveProperty('triggered');
      events.mockRestore();
    }
  });

  it.each(['risks', 'options'] as const)('aw-partial-readmit-%s-refused: retry admission with only the surviving pass', async (dropped) => {
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const spy = vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      if (dropped === 'risks' ? c.risks.length > input.candidate.risks.length : c.options.length > input.candidate.options.length) {
        throw new Error(`${dropped} re-admission refused`);
      }
      return ADMIT(c, ...rest);
    });
    const callStructured = generator();
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(out!.counts).toEqual(dropped === 'risks' ? { options: 2, risks: 0 } : { options: 0, risks: 3 });
    const accepted = spy.mock.calls.find(([c]) => dropped === 'risks'
      ? c.risks.length === input.candidate.risks.length && c.options.length > input.candidate.options.length
      : c.options.length === input.candidate.options.length && c.risks.length > input.candidate.risks.length);
    expect(accepted, 'the surviving items must be re-admitted alone').toBeDefined();
    expectOriginalIdentity(input.admitted, out!.admitted);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ outcome: 'widened', partial: true, enrichment_incomplete: false });
  });

  it('aw-all-empty: both diagnosed repairs run, no additions return null and incomplete telemetry is explicit', async () => {
    const input = fixture({ risks: 1, sameLever: true });
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator([], { options: [] });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(input)).toBe(bytes);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ calls: 2, outcome: 'empty_gate', enrichment_incomplete: true, counts: { options: 0, risks: 0 } });
    expect(event).not.toHaveProperty('triggered');
  });

  it('aw-no-budget: less than five seconds before the construction deadline skips both calls byte-identically', async () => {
    const input = fixture({ risks: 1, sameLever: true });
    const now = 1_800_000_000_000;
    input.deadlineAt = now + 4_999;
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(await widening.widenDraft({ ...input, clock: () => now, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(input)).toBe(bytes);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ calls: 0, outcome: 'no_budget', enrichment_incomplete: true, counts: { options: 0, risks: 0 } });
    expect(event).not.toHaveProperty('triggered');
  });

  it('aw-deadline-cap: deadlineAt minus now caps both passes below twenty seconds under fake timers', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    input.deadlineAt = now + 6_000;
    let settled = false;
    let result: unknown;
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = vi.fn<CallStructuredModel>(() => new Promise(() => {}));
    const promise = widening.widenDraft({ ...input, callStructured }).then((out) => { settled = true; result = out; });
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(callStructured.mock.calls.map(([, deadlineAt]) => deadlineAt)).toEqual([now + 6_000, now + 6_000]);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'the 6 s deadline budget must cap the default 20 s timeout').toBe(true);
    expect(result).toBeNull();
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ outcome: 'timeout', calls: 2, ms: 6_000, enrichment_incomplete: true });
    if (settled) await promise;
  });

  it('aw-at-deadline: the construction deadline itself leaves no widening budget or calls', async () => {
    const input = fixture({ risks: 1, sameLever: true });
    const now = 1_800_000_000_000;
    input.deadlineAt = now;
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(await widening.widenDraft({ ...input, clock: () => now, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(input)).toBe(bytes);
    expect(events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0]).toMatchObject({ outcome: 'no_budget', calls: 0 });
  });

  it('aw-worked-deadline: a 125 second proxy and construction ending at 99.9 seconds skips widening', async () => {
    const input = fixture({ risks: 1, sameLever: true });
    const started = 1_800_000_000_000;
    const now = started + 99_900;
    input.deadlineAt = constructionDeadline(started, 125_000);
    expect(input.deadlineAt).toBe(started + 100_000);
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(await widening.widenDraft({ ...input, clock: () => now, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(input)).toBe(bytes);
    expect(events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0]).toMatchObject({ outcome: 'no_budget', calls: 0 });
  });

  it('aw-timeout: a never-resolving call closes at exactly the default 20 second cap', async () => {
    vi.useFakeTimers();
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    let settled = false;
    let result: unknown;
    const promise = widening.widenDraft({ ...input, callStructured: vi.fn<CallStructuredModel>(() => new Promise(() => {})) }).then((out) => { settled = true; result = out; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'deadline must settle even when the provider never does').toBe(true);
    expect(result).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
    if (settled) await promise;
  });

  it('aw-injected-timeout: a shorter injected cap and clock close a pending pass', async () => {
    vi.useFakeTimers();
    let settled = false;
    const input = fixture({ risks: 1 });
    const clock = vi.fn(() => 42);
    const promise = widening.widenDraft({ ...input, timeoutMs: 7, clock, callStructured: vi.fn<CallStructuredModel>(() => new Promise(() => {})) }).then((out) => { settled = true; expect(out).toBeNull(); });
    await vi.advanceTimersByTimeAsync(7);
    expect(settled).toBe(true);
    expect(clock).toHaveBeenCalled();
    if (settled) await promise;
  });

  it('aw-late-timeout: separate late risk and option responses leave admission, recording and persisted graph unchanged', async () => {
    vi.useFakeTimers();
    const c = candidate({ risks: 1, nonSq: 2, sameLever: true });
    const bytes = JSON.stringify(c);
    const spy = vi.spyOn(admission, 'admitCandidateModel');
    const releases: Partial<Record<'risks' | 'options', () => void>> = {};
    const pass = vi.fn<CallStructuredModel>((req) => new Promise((resolve) => {
      const kind = isRisks(req) ? 'risks' : 'options';
      releases[kind] = () => resolve({ text: JSON.stringify(kind === 'risks' ? { risk_suggestions: riskSuggestions(true) } : optionsArgs()) });
    }));
    const run = builder(c, pass);
    await vi.advanceTimersByTimeAsync(20_000);
    const actual = await run.promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(actual.out).not.toHaveProperty('widened');
    expect(pass).toHaveBeenCalledTimes(2);
    expect(releases.risks).toBeDefined();
    expect(releases.options).toBeDefined();
    expect(releases.risks).not.toBe(releases.options);
    const admittedBefore = spy.mock.calls.length;
    const recordingBefore = JSON.stringify(actual.recording);
    const recordingLength = actual.recording.length;
    const graphBefore = JSON.stringify(actual.graph);
    const resultBefore = JSON.stringify(actual.out);
    expect(recordingLength).toBeGreaterThan(0);
    releases.risks!();
    releases.options!();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy, 'late generation must stop before re-admission').toHaveBeenCalledTimes(admittedBefore);
    expect(actual.recording).toHaveLength(recordingLength);
    expect(JSON.stringify(actual.recording)).toBe(recordingBefore);
    expect(JSON.stringify(actual.recording)).not.toContain(RATIONALE);
    expect(JSON.stringify(actual.graph)).toBe(graphBefore);
    expect(JSON.stringify(actual.out)).toBe(resultBefore);
    expect(JSON.stringify(c)).toBe(bytes);
  });

  it('aw-same-admission: widening forwards the brief and every original admission callback', async () => {
    const input = fixture({ risks: 1 });
    const goalLevelStated = () => false;
    const writtenAgain = () => false;
    const goalFromBrief = () => null;
    const sizeWritten = () => false;
    const sizeRangeEnd = () => null;
    const spy = vi.spyOn(admission, 'admitCandidateModel');
    const admissionArgs = [goalLevelStated, writtenAgain, goalFromBrief, sizeWritten, sizeRangeEnd] as const;
    const out = await widening.widenDraft({ ...input, admissionArgs: [...admissionArgs], callStructured: generator() });
    expect(out).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]!.slice(1)).toEqual([{}, BRIEF, ...admissionArgs]);
  });

  it.each(['throw', 'empty-gate', 'readmit-refusal', 'graph-invalid'] as const)('aw-%s: fail closed without mutating the original graph', async (failure) => {
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    const callStructured = failure === 'throw' ? vi.fn<CallStructuredModel>(async () => { throw new Error('provider failed'); }) : generator(failure === 'empty-gate' ? [] : riskSuggestions(), failure === 'empty-gate' ? { options: [] } : optionsArgs());
    if (failure === 'readmit-refusal') vi.spyOn(admission, 'admitCandidateModel').mockImplementation(() => { throw new Error('readmission refused'); });
    if (failure === 'graph-invalid') vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const admitted = ADMIT(c, ...rest);
      return { ...admitted, nodes: [...admitted.nodes, { id: 'invalid', kind: 'invalid', label: 'Invalid added entity' } as never] };
    });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-existing-unchanged: refuse any readmission that changes one pre-existing node or edge', async () => {
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const a = ADMIT(c, ...rest);
      return { ...a, nodes: a.nodes.map((n, i) => i === 0 ? { ...n, label: 'Silently changed original label' } : n) };
    });
    expect(await widening.widenDraft({ ...input, callStructured: generator() })).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-existing-edge-unchanged: refuse a pre-existing edge whose mean changes', async () => {
    const input = fixture({ risks: 1 });
    vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const a = ADMIT(c, ...rest);
      return { ...a, edges: a.edges.map((e, i) => i === 0 ? { ...e, strength: { ...e.strength, mean: 0.123 } } : e) };
    });
    expect(await widening.widenDraft({ ...input, callStructured: generator() })).toBeNull();
  });

  it('aw-existing-demotion: refuse a new option that would change an original context factor category', async () => {
    const c = candidate({ sameLever: true });
    const original: CandidateModel = { ...c, factors: c.factors.map((f) => f.label === 'Tech lead hires' || f.label === 'Contractor hours' ? { ...f, role: 'controllable' as const } : f) };
    const admitted = ADMIT(original, {}, BRIEF);
    expect(admitted.nodes.find((n) => n.id === 'contractor_hours')!.category).toBe('external');
    expect(await widening.widenDraft({ candidate: original, admitted, brief: BRIEF, deadlineAt: Date.now() + 60_000, callStructured: generator([]) })).toBeNull();
  });

  it('aw-convention: never set or overwrite an Olumi-convention factor cap', async () => {
    const input = fixture({ sameLever: true });
    input.admitted = { ...input.admitted, nodes: input.admitted.nodes.map((n) => n.id === 'developer_hires' ? { ...n, observed_state: { ...n.observed_state!, frame_source: 'olumi_convention' as const, value: 0, cap: 37 } } : n) };
    const cap = input.admitted.nodes.find((n) => n.id === 'developer_hires');
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    // A readmission that cannot reproduce the original cap must discard the widening.
    if (out !== null) expect(out.admitted.nodes.find((n) => n.id === 'developer_hires')).toEqual(cap);
    expect(input.admitted.nodes.find((n) => n.id === 'developer_hires')).toEqual(cap);
  });

  it('aw-nonpath-option: background-only intervention is dropped', async () => {
    const input = fixture({ sameLever: true });
    const callStructured = generator([], { options: [{ label: 'Watch background demand', acts_on: [{ factor_label: 'Background demand', direction: 'positive', level: level(20, 'enquiries') }], rationale: RATIONALE }] });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
  });

  it.each(['label', 'basis'] as const)('aw-option-ranking-%s: generated suggestions never claim superiority', async (field) => {
    const input = fixture({ sameLever: true });
    const args = optionsArgs();
    if (field === 'label') {
      args.options[0]!.label = 'Better contractor pilot';
      args.options[1]!.label = 'Better hiring pilot';
    } else {
      for (const option of args.options) for (const act of option.acts_on) act.level.basis = 'This is the best choice';
    }
    expect(await widening.widenDraft({ ...input, callStructured: generator([], args) })).toBeNull();
  });

  it('aw-complete-option-label: Complete hiring pilot is dropped', async () => {
    const input = fixture({ sameLever: true });
    const option = { ...optionsArgs().options[0]!, label: 'Complete hiring pilot' };
    expect(await widening.widenDraft({ ...input, callStructured: generator([], { options: [option] }) })).toBeNull();
  });

  it('aw-improved-risk-label: Improved onboarding delays is dropped', async () => {
    const input = fixture({ risks: 1 });
    const risk = { ...riskSuggestions()[0]!, label: 'Improved onboarding delays' };
    expect(await widening.widenDraft({ ...input, callStructured: generator([risk], { options: [] }) })).toBeNull();
  });

  it.each(['better', 'best', 'improving', 'completed', 'you missed', 'winner', 'recommended'])(
    'aw-full-ranking-words-%s: widened labels and retained copy reject the complete word rule', async (word) => {
      for (const field of ['option_label', 'basis', 'risk_label', 'relies_on', 'watch_for'] as const) {
        const input = fixture({ risks: 1, sameLever: true });
        const option = structuredClone(optionsArgs().options[0]!);
        const risk = { ...riskSuggestions(true)[0]! };
        if (field === 'option_label') option.label = `${word} hiring pilot`;
        else if (field === 'basis') for (const act of option.acts_on) act.level.basis = `${word} working pattern`;
        else if (field === 'risk_label') risk.label = `${word} recruitment delay`;
        else risk[field] = `${word} working pattern`;
        const optionField = field === 'option_label' || field === 'basis';
        const out = await widening.widenDraft({ ...input, callStructured: generator(optionField ? [] : [risk], { options: optionField ? [option] : [] }) });
        expect(out, `${field} must reject ${word}`).toBeNull();
      }
    });

  it.each(['label', 'basis', 'relies_on', 'watch_for'] as const)(
    'aw-no-label-exemption-%s: quoting an existing user label does not exempt widened copy from the word rule', async (field) => {
      const c = candidate({ risks: 1, sameLever: true });
      c.options[1]!.label = 'Better hiring pilot';
      const brief = BRIEF.replace('Hire a Tech Lead', 'Better hiring pilot');
      const input = { candidate: c, admitted: ADMIT(c, {}, brief), brief, deadlineAt: Date.now() + 60_000 };
      const option = structuredClone(optionsArgs().options[0]!);
      const risk = { ...riskSuggestions(true)[0]! };
      if (field === 'label') option.label = 'Better hiring pilot with developers';
      else if (field === 'basis') for (const act of option.acts_on) act.level.basis = 'A trial beside Better hiring pilot';
      else risk[field] = 'Better hiring pilot taking effect';
      const optionField = field === 'label' || field === 'basis';
      expect(await widening.widenDraft({ ...input, callStructured: generator(optionField ? [] : [risk], { options: optionField ? [option] : [] }) })).toBeNull();
    });

  it('aw-option-text-words: a kept option whose rationale says better persists no ranking word in any widened option text', async () => {
    const input = fixture({ sameLever: true, counterCase: true });
    const args = optionsArgs();
    for (const o of args.options) (o as Rec).rationale = 'This could do better and is the best, recommended winner, improving results';
    const out = await widening.widenDraft({ ...input, callStructured: generator([], args) });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'option');
    expect(added).toHaveLength(2);
    const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
      : v !== null && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
    const persisted = added.flatMap(strings);
    expect(persisted.length).toBeGreaterThan(2);
    for (const text of persisted) expect(text).not.toMatch(/\b(better|best|improv\w*|recommend\w*|winner)\b/i);
  });

  it.each([undefined, '', '   '])('aw-basis: drop levels with missing or empty basis %s', async (basis) => {
    const input = fixture({ sameLever: true });
    const args = optionsArgs();
    for (const o of args.options) for (const a of o.acts_on) (a.level as Rec).basis = basis;
    expect(await widening.widenDraft({ ...input, callStructured: generator([], args) })).toBeNull();
  });

  it('dv-preamble: both passes start with the exact preamble and preserve every route directive byte', async () => {
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    const s = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph: graphOf(input.admitted), analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
    const risksTurn = risksTurnFromSignals(s, graphOf(input.admitted), BRIEF);
    const optionsTurn = widenTurnFromSignals(s, graphOf(input.admitted));
    expect(risksTurn.kind).toBe('run_risks');
    expect(optionsTurn.kind).toBe('run');
    const callStructured = generator();
    await widening.widenDraft({ ...input, callStructured });
    const requests = callStructured.mock.calls.map(([req]) => req);
    expect(widening.DRAFT_WIDENING_PREAMBLE).toBe(PREAMBLE);
    expect(requests).toHaveLength(2);
    for (const req of requests) expect(req.instructions.split('\n')[0]).toBe(PREAMBLE);
    expect(requests.find(isRisks)!.instructions).toBe(`${PREAMBLE}\n${(risksTurn as Rec).directive}`);
    expect(widening.DRAFT_WIDENING_OPTIONS_PREAMBLE).toBe(OPTIONS_PREAMBLE);
    expect(requests.find(isOptions)!.instructions).toBe(`${PREAMBLE}\n${OPTIONS_PREAMBLE}\n${(optionsTurn as Rec).directive}`);
    expect(createHash('sha256').update(readFileSync(new URL('../method-turn/widen-turn.ts', import.meta.url))).digest('hex')).toBe(WIDEN_TURN_SHA256);
    for (const req of requests) { expect(req.schema.type).toBe('object'); expect(req.max_output_tokens).toBeLessThanOrEqual(3000); }
  });

  it('aw-option-lever-classification: only a goal-path factor moved by no other option is a new lever', async () => {
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'option');
    const mix = added.find((n) => n.id === 'combine_lead_and_developer_hires')!;
    const pilot = added.find((n) => n.id === 'try_a_contractor_pilot')!;
    expect(mix).toBeDefined();
    expect(pilot).toBeDefined();
    const admittedGraph = graphOf(out!.admitted);
    const graph = { ...admittedGraph, nodes: [...admittedGraph.nodes, { id: 'existing_lead_option', kind: 'option', label: 'Existing lead option', interventions: { tech_lead_hires: { value: 0.1 } } }] };
    const bytes = JSON.stringify(graph);
    expect(widening.classifyWidenedOptions(graph)).toEqual({ [mix.id]: 'SAME_LEVER', [pilot.id]: 'NEW_LEVER' });
    expect(JSON.stringify(graph)).toBe(bytes);
    // Another option moving that same factor removes its uniqueness, regardless of display wording.
    const shared = { ...graph, nodes: [...graph.nodes, { ...pilot, id: 'another_contractor_pilot', draft_widening: undefined }] };
    expect(widening.classifyWidenedOptions(shared)[pilot.id]).toBe('SAME_LEVER');
    const nonpath = { ...graph, nodes: [...graph.nodes, { ...pilot, id: 'background_only', interventions: { background_demand: { value: 0.2 } } }] };
    expect(widening.classifyWidenedOptions(nonpath).background_only).toBe('SAME_LEVER');
    expect(widening.classifyWidenedOptions(graphOf(input.admitted))).toEqual({});
  });

  it('aw-schema-origin: NodeV3 keeps existing provenance values and strict optional widening metadata', async () => {
    const input = fixture({ risks: 1, nonSq: 2, sameLever: true });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    const graph = graphOf(out!.admitted);
    const addedRisk = addedNodes(input.admitted, out!.admitted, 'risk')[0]!;
    expect(GraphV3.safeParse(graph).success).toBe(true);
    const withRisk = (patch: Rec) => ({ ...graph, nodes: graph.nodes.map((n: Rec) => n.id === addedRisk.id ? { ...n, ...patch } : n) });
    expect(GraphV3.safeParse(withRisk({ provenance: 'ai_suggested_widen' })).success).toBe(false);
    expect(GraphV3.safeParse(withRisk({ draft_widening: { ...addedRisk.draft_widening, unrecognised: true } })).success).toBe(false);
    expect(GraphV3.safeParse(withRisk({ draft_widening: { ...addedRisk.draft_widening,
      affects: { ...addedRisk.draft_widening.affects, direction: 'sideways' } } })).success).toBe(false);
  });
});

describe('P05b build seam and words', () => {
  it('dv-build-rich: a sufficient draft persists byte-identically without any widening call', async () => {
    const c = candidate({ counterCase: true });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    expect(baseline.out.ok, JSON.stringify(baseline.out)).toBe(true);
    expect(widening.diagnoseDraft(baseline.graph)).toEqual({ risks: null, options: null });
    const pass = generator();
    const actual = await builder(c, pass).promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(pass).toHaveBeenCalledTimes(0);
    expect(actual.out).not.toHaveProperty('widened');
    expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it('aw-build-no-budget: zero widening calls and byte-identical persisted graph when the turn tail is exhausted', async () => {
    const c = candidate({ risks: 1, nonSq: 2, sameLever: true });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    const pass = generator();
    const deadlineAt = Date.now() + 4_000;
    const actual = await builder(c, pass, BRIEF, deadlineAt).promise;
    expect(actual.out.ok).toBe(true);
    expect(pass).toHaveBeenCalledTimes(0);
    expect(actual.out).not.toHaveProperty('widened');
    expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it('aw-build-timeout: draft ships byte-identical after provider hangs for 20 seconds', async () => {
    const c = candidate({ risks: 1 });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    vi.useFakeTimers();
    let actual: Awaited<ReturnType<typeof builder>['promise']> | undefined;
    const run = builder(c, vi.fn<CallStructuredModel>(() => new Promise(() => {})));
    run.promise.then((out) => { actual = out; });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(actual, 'build must finish when widening times out').toBeDefined();
    expect(actual!.out.ok).toBe(true);
    expect(JSON.stringify(actual!.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it.each(['throw', 'empty-gate'] as const)('aw-build-%s: fail-closed persisted graph is byte-identical', async (failure) => {
    const c = candidate({ risks: 1 });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    const pass = failure === 'throw' ? vi.fn<CallStructuredModel>(async () => { throw new Error('provider failed'); }) : generator([], { options: [] });
    const actual = await builder(c, pass).promise;
    expect(actual.out.ok).toBe(true);
    expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it('aw-build-widened: counted options and risks reach registered GraphV3 and ToolResult', async () => {
    const pass = generator();
    const actual = await builder(candidate({ risks: 1, nonSq: 2, sameLever: true }), pass).promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(pass).toHaveBeenCalledTimes(2);
    expect(actual.out.widened).toEqual({ options: expect.any(Number), risks: 3 });
    expect(actual.out.widened.options).toBeGreaterThan(0);
    const added = actual.graph!.nodes.filter((n: Rec) => n.draft_widening?.provenance === 'ai_suggested_widen');
    expect(added.filter((n: Rec) => n.kind === 'risk')).toHaveLength(actual.out.widened.risks);
    expect(added.filter((n: Rec) => n.kind === 'option')).toHaveLength(actual.out.widened.options);
    expect(GraphV3.safeParse(actual.graph).success).toBe(true);
    expect(JSON.stringify(actual.graph)).not.toContain(RATIONALE);
  });

  it('aw-served-recording: widened rationale never reaches the stored drafter recording or ToolResult', async () => {
    const rows: drafterRaw.DrafterRawRow[] = [];
    vi.stubEnv('SUPABASE_URL', 'https://drafter-recording.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-recording-key');
    drafterRaw.resetDrafterRawStoreForTests();
    vi.spyOn(drafterRaw.SupabaseDrafterRawStore.prototype, 'insert').mockImplementation(async row => {
      rows.push(structuredClone(row));
      return 'written';
    });
    let graph: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) {
        graph = structuredClone((body as { graph: Rec }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, versions: [] } };
    };
    const c = candidate({ risks: 1, nonSq: 2, sameLever: true });
    const pass = generator();
    const callStructured: CallStructuredModel = async (req, deadlineAt) => isRisks(req) || isOptions(req)
      ? pass(req, deadlineAt) : { text: JSON.stringify(c) };
    const caps = createAgentCapabilities(dispatch, new ProposalStore(), callStructured, 'full', undefined, { deadlineAt: Date.now() + 60_000 });
    const out = await caps.buildModelFromBrief({ scenario_id: SCENARIO, authenticated_user_id: 'user-aw', request_id: 'req-aw' }, { brief: BRIEF });
    await drafterRaw.settleDrafterRawWritesForTests();
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(pass).toHaveBeenCalledTimes(2);
    expect(out).toHaveProperty('widened');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.calls.length).toBeGreaterThan(0);
    expect(rows[0]!.calls.every(call => call.raw_text === JSON.stringify(c))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(RATIONALE);
    expect(JSON.stringify(rows)).not.toContain('rationale');
    expect(JSON.stringify(out)).not.toContain(RATIONALE);
    expect(JSON.stringify(graph)).not.toContain(RATIONALE);
  });

  const goldenDrafts = (JSON.parse(readFileSync(new URL('./fixtures/keep-risks-live-drafts-20260930.json', import.meta.url), 'utf8')) as { drafts: { id: string; brief: string; raw: string }[] }).drafts.filter((d) => ['mrr-12m', 'hiring', 'funding'].includes(d.id));
  it.each(goldenDrafts)('aw-golden-census $id: widening adds no withheld link or new risk readiness failure', async (d) => {
    const c = JSON.parse(d.raw) as CandidateModel;
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator(), d.brief).promise;
    vi.restoreAllMocks();
    expect(baseline.out.ok, JSON.stringify(baseline.out)).toBe(true);
    const pass = vi.fn<CallStructuredModel>(async (req) => {
      if (!isRisks(req)) {
        const graph = JSON.parse(req.input).graph as Rec;
        const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph, analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
        const turn = widenTurnFromSignals(signals, graph);
        if (turn.kind !== 'run') throw new Error('golden has no options turn');
        const pathIds = new Set(signals['model.goal_path_factor_ids']);
        const settings: Rec[] = graph.nodes.filter((n: Rec) => n.kind === 'factor' && pathIds.has(n.id)).flatMap((n: Rec) => {
          const frame = n.observed_state?.cap ?? n.scale_frame ?? 1;
          const unit = n.observed_state?.unit ?? '';
          return [0.25, 0.75].flatMap((fraction) => ['positive', 'negative'].map((direction) => ({ factor_label: n.label, direction, level: level(frame * fraction, unit, 'A bounded setting to test this pathway') })));
        });
        const combinations = [...settings.map((a) => [a]), ...settings.flatMap((a, i) => settings.slice(i + 1).filter((b) => b.factor_label !== a.factor_label).map((b) => [a, b]))];
        for (const acts_on of combinations) {
          const options = [{ label: 'Test a different working pattern', acts_on, rationale: RATIONALE }];
          if (widenGate(turn, { options }).ok) return { text: JSON.stringify({ options }) };
        }
        return { text: JSON.stringify({ options: [] }) };
      }
      const optionsLine = req.instructions.split('\n').find((l) => l.startsWith("The user's options and the factors each one changes: "))!;
      const options = JSON.parse(optionsLine.slice(optionsLine.indexOf(': ') + 2).replace(/\.$/, '')) as { id: string; changes: { id: string }[] }[];
      const option = options.find((o) => o.changes.length > 0)!;
      const goalLine = req.instructions.split('\n').find((l) => l.startsWith('The goal: '))!;
      const goal = JSON.parse(goalLine.slice('The goal: '.length).replace(/\.$/, '')) as { id: string };
      const risk = { label: 'Delivery dependency', category: 'dependency', hits_id: option.id, through_id: option.changes[0]!.id, affects_id: goal.id, direction: 'negative', relies_on: 'the planned action taking effect', watch_for: 'progress stalls after the action' };
      return { text: JSON.stringify({ risk_suggestions: [risk] }) };
    });
    const actual = await builder(c, pass, d.brief).promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(actual.out.withheld).toEqual(baseline.out.withheld);
    if (actual.out.widened !== undefined) expect(actual.out.widened.risks).toBe(widening.diagnoseDraft(baseline.graph).risks === null ? 0 : 1);
    else expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
    const newRiskIds = actual.graph!.nodes.filter((n: Rec) => n.kind === 'risk' && n.draft_widening?.provenance === 'ai_suggested_widen').map((n: Rec) => n.id);
    expect(newRiskIds).toHaveLength(actual.out.widened?.risks ?? 0);
    for (const id of newRiskIds) expect(actual.graph!.edges.filter((e: Rec) => e.from === id || e.to === id)).toEqual([]);
    const beforeFailures = validateGraphStructure(baseline.graph as never, { leaveOutInertRisks: true }).violations;
    const afterFailures = validateGraphStructure(actual.graph as never, { leaveOutInertRisks: true }).violations;
    expect(afterFailures).toEqual(beforeFailures);
  });

  it('aw-words: exact per-kind copy, singular forms, omitted zeros and excluded-risk caveat', () => {
    const tail = " for you to consider. They're Olumi's suggestions, not yours; remove any that don't fit.";
    const variants = [
      [{ options: 2, risks: 3 }, `Olumi added 2 options and 3 risks${tail}`],
      [{ options: 1, risks: 1 }, `Olumi added 1 option and 1 risk${tail}`],
      [{ options: 0, risks: 3 }, `Olumi added 3 risks${tail}`],
      [{ options: 2, risks: 0 }, `Olumi added 2 options${tail}`],
      [{ options: 0, risks: 0 }, null],
    ] as const;
    for (const [counts, words] of variants) expect(widening.widenedLine(counts)).toBe(words);
    expect(widening.widenedRiskNote({ options: 2, risks: 3 })).toBe("Risks Olumi added aren't in the chance yet, so it may be too high.");
    expect(widening.widenedRiskNote({ options: 2, risks: 0 })).toBeNull();
    const words = variants.flatMap(([counts]) => [widening.widenedLine(counts), widening.widenedRiskNote(counts)]).filter(Boolean).join(' ');
    expect(words).not.toMatch(/you missed|\bimproved\b|\bcomplete\b|\bbetter\b|\bbest\b/i);
  });

  it('aw-risk-marker: typed negative effects select DOWN; mixed or positive effects select MOVE; none returns null', () => {
    expect(widening.WIDENED_RISK_MARKER_DOWN).toBe("Leaves out Olumi's added risks; may be too high");
    expect(widening.WIDENED_RISK_MARKER_MOVE).toBe("Leaves out Olumi's added risks; may move");
    const risk = (id: string, direction: 'positive' | 'negative') => ({ id, kind: 'risk' as const, label: 'Same display wording',
      draft_widening: { provenance: 'ai_suggested_widen' as const, affects: { id: 'features_delivered', label: 'Features delivered', direction } } });
    expect(widening.widenedRiskMarker([])).toBeNull();
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative')])).toBe(widening.WIDENED_RISK_MARKER_DOWN);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative'), risk('added_risk_b', 'negative')])).toBe(widening.WIDENED_RISK_MARKER_DOWN);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'positive')])).toBe(widening.WIDENED_RISK_MARKER_MOVE);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative'), risk('added_risk_b', 'positive')])).toBe(widening.WIDENED_RISK_MARKER_MOVE);
    expect(`${widening.WIDENED_RISK_MARKER_DOWN} ${widening.WIDENED_RISK_MARKER_MOVE}`).not.toMatch(/you missed|\bimproved\b|\bcomplete\b|\bbetter\b|\bbest\b/i);
  });
});
