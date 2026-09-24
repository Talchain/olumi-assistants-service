/**
 * Paul's 24 September fresh hiring turn, replayed through production consumers.
 * No model, database or HTTP calls. The fixture is the captured draft, not an
 * invented successful construction. Two ordinary acceptance assertions are
 * deliberately RED on the captured malformed graph. The producer owner can
 * set HIRING_ACCEPTANCE_GRAPH to a corrected {nodes, edges} output to exercise
 * the same acceptance assertions; the captured evidence stays immutable.
 *
 * The original proposal arguments were NOT exported. The proposal controls
 * below reconstruct the visible offer and must not be cited as a replay of the
 * recorded approval payload or evidence that Paul adopted baseline five.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from './fixtures/hiring-0f174255-20260924.json';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { censusConfidenceParameters } from '../../admission/analysis-admission.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Node = Record<string, unknown> & { id: string; kind: string; label: string };
type Graph = { nodes: Node[]; edges: Array<Record<string, unknown>> };
const captured = (): Graph => structuredClone(fixture.graph);
const acceptanceGraph = (): Graph => process.env.HIRING_ACCEPTANCE_GRAPH
  ? JSON.parse(readFileSync(process.env.HIRING_ACCEPTANCE_GRAPH, 'utf8')) as Graph
  : captured();
const ctx = { scenario_id: 'd41e2c21-df8a-4386-9dff-cd92a0c2a9c7', authenticated_user_id: 'fixture-user', request_id: 'hiring-fixture' };

function hasSignedPath(graph: Graph, from: string, to: string, expectedSign: number): boolean {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const walk = (at: string, sign: number, seen: Set<string>): boolean => {
    if (at === to) return sign === expectedSign;
    for (const edge of graph.edges.filter((e) => e.from === at)) {
      const next = String(edge.to);
      if (seen.has(next) || !nodes.has(next)) continue;
      // A decision/another option is not a causal mediator for this effect.
      if (next !== to && !['factor', 'risk', 'outcome'].includes(nodes.get(next)!.kind)) continue;
      const mean = (edge.strength as { mean?: number } | undefined)?.mean;
      const direction = edge.effect_direction === 'positive' ? 1
        : edge.effect_direction === 'negative' ? -1
          : typeof mean === 'number' && mean !== 0 ? Math.sign(mean) : 0;
      if (direction !== 0 && walk(next, sign * direction, new Set([...seen, next]))) return true;
    }
    return false;
  };
  return walk(from, 1, new Set([from]));
}

function product() {
  let graph = captured();
  let revision = 0;
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const dispatch: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      writes.push({ path, body: b });
      if (b.expected_graph_hash !== `h${revision}`) return { status: 409, json: {} };
      graph = structuredClone(b.graph) as Graph;
      revision++;
      return { status: 200, json: { registered: true, graph_hash: `h${revision}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const e = b.event as Record<string, unknown>;
      if (e.kind !== 'option_intervention_edit') throw new Error(`Unexpected event: ${String(e.kind)}`);
      writes.push({ path, body: b });
      if (e.base_graph_hash !== `h${revision}`) return { status: 409, json: {} };
      graph.nodes = graph.nodes.map((n) => n.id === e.option_id ? {
        ...n, interventions: {
          ...(n.interventions as Record<string, unknown> ?? {}),
          [String(e.factor_id)]: { value: e.value, source: 'user_specified' },
        },
      } : n);
      revision++;
      return { status: 200, json: { graph_hash: `h${revision}` } };
    }
    // This seam substitutes only persistence/transport. Unexpected provider or
    // analysis dispatches fail; proposing and approving must not imply Run.
    if (!path.includes('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    return { status: 200, json: { graph: structuredClone(graph), graph_hash: `h${revision}` } };
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(dispatch, store), store, writes, read: () => structuredClone(graph) };
}

const assumptions = [
  { factor_label: 'Developer headcount', value: 5, unit: 'people', basis: 'AI placeholder, not a measured or adopted baseline' },
  { factor_label: 'Tech Lead headcount', value: 0, unit: 'people', basis: 'AI placeholder, not a measured or adopted baseline' },
];
const levels = [
  { option_label: 'Hire Two Developers', factor_label: 'Developer headcount', value: 7, basis: 'proposed five existing plus two additional hires' },
  { option_label: 'Hire One Developer', factor_label: 'Developer headcount', value: 6, basis: 'proposed five existing plus one additional hire' },
  { option_label: 'Maintain Current Team', factor_label: 'Developer headcount', value: 5, basis: 'keep proposed existing team' },
  { option_label: 'Maintain Current Team', factor_label: 'Tech Lead headcount', value: 0, basis: 'keep proposed existing team' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Tech Lead headcount', value: 1, basis: 'one additional lead above proposed zero' },
];

describe('captured hiring model through real readiness consumers', () => {
  it('reproduces all four options, direct-risk mapping blockers and total targets 2/1, without mutating the graph', () => {
    const graph = captured();
    const before = JSON.stringify(graph);
    const a = assessCanonicalAnalysisReadiness(graph);
    expect(a.issues.some((i) => i.code === 'SCHEMA_INVALID')).toBe(false);
    expect(a.analysisReady?.options?.map((o) => o.option_id).sort()).toEqual([
      'hire_a_tech_lead', 'hire_one_developer', 'hire_two_developers', 'maintain_current_team',
    ]);
    expect(a.issues.filter((i) => i.code === 'OPTION_NEEDS_MAPPING').map((i) => i.option_id).sort())
      .toEqual(['hire_a_tech_lead', 'hire_one_developer', 'hire_two_developers']);
    const options = a.analysisReady?.options ?? [];
    expect(options.find((o) => o.option_id === 'hire_two_developers')?.interventions?.developer_headcount).toBe(0.1);
    expect(options.find((o) => o.option_id === 'hire_one_developer')?.interventions?.developer_headcount).toBe(0.05);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('ACCEPTANCE: an unstated numeric goal must not become a stated target in admission', () => {
    // The brief names improvement, but never a numeric target. Current producer
    // writes from_brief/0/%/level and the real census launders that as stated.
    expect(censusConfidenceParameters(acceptanceGraph()).goal_target_stated).toBe(false);
  });

  it('CONTRAST: an absent target stays absent, while a genuinely supplied target is recognised', () => {
    const graph = captured();
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    delete goal.goal_threshold_raw;
    delete goal.goal_threshold_unit;
    delete goal.goal_threshold_frame;
    expect(censusConfidenceParameters(graph).goal_target_stated).toBe(false);
    Object.assign(goal, { goal_threshold_raw: 20, goal_threshold_unit: '%', goal_threshold_frame: 'delta', provenance: 'from_brief' });
    expect(censusConfidenceParameters(graph).goal_target_stated).toBe(true);
  });

  it('ACCEPTANCE: invented option-risk effects must not become required user-stated gaps merely because the option was stated', () => {
    const graph = acceptanceGraph();
    const a = assessCanonicalAnalysisReadiness(graph);
    expect(a.issues.some((i) => i.code === 'SCHEMA_INVALID')).toBe(false);
    // A supported mechanism/mediator may remove these mapping issues. Passing
    // by dropping the meaningful risk hypotheses is not a repair.
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([
      'onboarding_disruption', 'technical_leadership_mismatch',
      'hire_a_tech_lead', 'hire_two_developers', 'hire_one_developer', 'maintain_current_team',
    ]));
    for (const [option, risk] of [
      ['hire_a_tech_lead', 'technical_leadership_mismatch'],
      ['hire_a_tech_lead', 'onboarding_disruption'],
      ['hire_two_developers', 'onboarding_disruption'],
      ['hire_one_developer', 'onboarding_disruption'],
    ]) {
      expect(hasSignedPath(graph, option, risk, 1), `${option} must retain its proposed effect on ${risk}, directly or through a causal mediator`).toBe(true);
    }
    for (const risk of ['technical_leadership_mismatch', 'onboarding_disruption']) {
      expect(hasSignedPath(graph, risk, 'productivity_increase', -1), `${risk} must retain its adverse path to productivity`).toBe(true);
    }
    const gaps = a.issues.filter((i) => i.code === 'OPTION_NEEDS_MAPPING');
    expect(gaps.filter((i) => i.provenance === 'user_stated' || i.obligation === 'required')).toEqual([]);
  });
});

describe('reconstructed visible offer: additions become total headcounts only after explicit adoption', () => {
  it('proposes baseline five and total seven/six with the existing frame, preserving the unadopted captured model', async () => {
    const p = product();
    const before = p.read();
    const r = await p.caps.proposeStartingPoint(ctx, { assumptions, option_levels: levels });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(p.writes).toEqual([]);
    expect(p.read()).toEqual(before);
    const proposal = p.store.get(String(r.proposal_id))!;
    expect(proposal.operations).toContainEqual(expect.objectContaining({
      op: 'set_option_intervention', path: 'hire_two_developers::developer_headcount',
      value: expect.objectContaining({ raw: 7, normalised: 0.35, cap: 20 }),
    }));
    expect(proposal.operations).toContainEqual(expect.objectContaining({
      op: 'set_option_intervention', path: 'hire_one_developer::developer_headcount',
      value: expect.objectContaining({ raw: 6, normalised: 0.3, cap: 20 }),
    }));
  });

  it('explicit approval applies the compound through real capabilities; baseline-only success is insufficient and no Run is dispatched', async () => {
    const p = product();
    const proposed = await p.caps.proposeStartingPoint(ctx, { assumptions, option_levels: levels });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await p.caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const after = p.read();
    const developer = after.nodes.find((n) => n.id === 'developer_headcount')!;
    expect(developer.observed_state).toMatchObject({ raw_value: 5, value: 0.25 });
    // Existing node-level scale_frame is a valid carrier; do not demand a
    // duplicated observed_state.cap when the real writer retains that frame.
    expect(developer.scale_frame).toBe(20);
    expect(after.nodes.find((n) => n.id === 'hire_two_developers')?.interventions)
      .toMatchObject({ developer_headcount: { value: 0.35 } });
    expect(after.nodes.find((n) => n.id === 'hire_one_developer')?.interventions)
      .toMatchObject({ developer_headcount: { value: 0.3 } });
    expect(p.writes.some((w) => w.path.endsWith('/graph/register'))).toBe(true);
  });
});
