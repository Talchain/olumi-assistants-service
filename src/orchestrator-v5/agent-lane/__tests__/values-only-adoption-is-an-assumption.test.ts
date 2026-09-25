/**
 * ⛔ OLUMI'S FIGURES, ADOPTED WITHOUT LEVELS, ARE STORED AS ASSUMPTIONS — by the REAL writer
 * (review of #1851, B2; RC #63 5825007295; served defect `caf7d1a` pricing S2p, a values-only
 * approval, both figures stamped as the user's own).
 *
 * The fake dispatch hands each `factor_value_edit` to the PRODUCT'S OWN writer
 * (`applyFactorValueEdit` → `set_factor_value`) in-process, the way the route's `app.inject`
 * does, so the stamp under test is the one the served writer decides. The approved-adoption
 * identity is server-internal (`approved-adoption-context.ts`, AsyncLocalStorage — measured to
 * survive `app.inject`, `stage-stream-context.ts:30`); nothing on the wire can claim it.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { runWithApprovedAdoption } from '../approved-adoption-context.js';
import { censusConfidenceParameters } from '../../admission/analysis-admission.js';
import { earnsAuthorshipCredit, structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';

const SCENARIO = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-v', request_id: 'r' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number };
const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE', source: 'user_override' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
];
const EDGES = [
  { from: 'hire_two', to: 'team_size', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  { from: 'team_size', to: 'velocity', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  { from: 'coordination_load', to: 'velocity', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
];

/** The product double whose value writer IS the served writer. */
function product() {
  let nodes: Node[] = BASE.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  let writes = 0;
  const graph = () => ({ nodes, edges: EDGES });
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind !== 'factor_value_edit') return { status: 400, json: {} };
      const res = await applyFactorValueEdit({
        payload: { kind: 'system_event', turn_id: String(b.turn_id), scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
        event: ev as never,
        requestId: `w${writes}`,
        persistedGraph: graph() as never,
        priorFacts: [],
      });
      if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not changed.' } };
      writes += 1;
      nodes = ((res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes);
      rev += 1;
      // The served committed shape (`valueWriteCommittedByThisRequest`).
      return { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: String(ev.target_id) }] } };
    }
    return { status: 200, json: { graph: graph(), graph_hash: `h${rev}` } };
  };
  return { d, byId: () => Object.fromEntries(nodes.map((n) => [n.id, n])), graph, writes: () => writes };
}

const OLUMIS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];

async function adoptValuesOnly() {
  const p = product();
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store);
  const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const shown = store.get(String(proposed.proposal_id))!;
  expect(shown.provenance.authored_by, 'precondition: Olumi authored it').toBe('model_proposed');
  expect(new Set(shown.operations.map((o) => o.op)), 'precondition: values only — the single-kind path').toEqual(new Set(['set_factor_value']));
  const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { p, caps, proposalId: String(proposed.proposal_id) };
}

describe('values-only approval of Olumi’s figures, through the real writer', () => {
  it('RED: the stored source is user_assumption, and the value itself is the approved one', async () => {
    const { p } = await adoptValuesOnly();
    const os = p.byId().coordination_load.observed_state ?? {};
    expect(os.source).toBe('user_assumption');
    expect(os.raw_value).toBe(40);
  });

  it('RED: the admission census does not count it as user-stated (only the figure the user typed counts)', async () => {
    const { p } = await adoptValuesOnly();
    const g = p.graph();
    const adopted = g.nodes.find((n) => n.id === 'coordination_load');
    expect(earnsAuthorshipCredit(structureProvenance(adopted, g))).toBe(false);
    expect(censusConfidenceParameters(g as never).confidence_parameters_user_stated).toBe(1);
  });

  it('NEGATIVE: a replayed approval writes nothing more and relabels nothing', async () => {
    const { p, caps, proposalId } = await adoptValuesOnly();
    const before = { writes: p.writes(), os: p.byId().coordination_load.observed_state };
    const again = await caps.authoriseChange(ctx, { proposal_id: proposalId });
    expect(again).toMatchObject({ already_applied: true });
    expect(p.writes()).toBe(before.writes);
    expect(p.byId().coordination_load.observed_state).toEqual(before.os);
  });
});

describe('an approval that is not verified never enters the adoption context', () => {
  it('NEGATIVE: ANOTHER user approving the proposal writes nothing and stamps nothing', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
    const other = await caps.authoriseChange({ ...ctx, authenticated_user_id: 'someone-else' }, { proposal_id: String(proposed.proposal_id) });
    expect(other.ok).not.toBe(true);
    expect(p.writes()).toBe(0);
    expect(p.byId().coordination_load.observed_state).toBeUndefined();
  });

  it('NEGATIVE: a STALE approval (the model moved since it was proposed) writes nothing and stamps nothing', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
    // Another writer moves the model after the proposal was made.
    const ev = { kind: 'factor_value_edit', target_id: 'team_size', value: 0.7, raw_value: 7 };
    await p.d('/orchestrate/v2/turn', { kind: 'system_event', turn_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', scenario_id: SCENARIO, stage: 'frame', event: ev });
    // PRECONDITION, proven not assumed: the foreign write landed, so the model really moved.
    expect(p.writes()).toBe(1);
    const writesBefore = p.writes();
    const stale = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(stale.ok).not.toBe(true);
    expect(p.writes()).toBe(writesBefore);
    expect(p.byId().coordination_load.observed_state).toBeUndefined();
  });
});

describe('the user’s own figure stays theirs', () => {
  it('TWIN: a revision the USER named (revise: true) is stored as user_override', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true }],
    } as never);
    expect(store.get(String(proposed.proposal_id))!.provenance.authored_by).toBe('user_stated');
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().team_size.observed_state?.source).toBe('user_override');
  });
});

describe('nothing outside the verified approval can claim the adoption stamp', () => {
  const edit = async (graph: unknown, value: number) => {
    const ev = { kind: 'factor_value_edit' as const, target_id: 'coordination_load', value };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: '0b0f6a1e-9f7c-4d5e-8a1b-2c3d4e5f6a7b', scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
      event: ev as never, requestId: 'x', persistedGraph: graph as never, priorFacts: [],
    });
    expect(res.kind, JSON.stringify(res)).toBe('mutated');
    return ((res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes).find((n) => n.id === 'coordination_load')?.observed_state?.source;
  };
  it('NEGATIVE: a direct system event (no server context — the inspector, or any client) keeps user_override', async () => {
    expect(await edit(product().graph(), 40)).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER target keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'team_size', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER value keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'coordination_load', rawValue: 41 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER scenario keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', proposalId: 'p', targetId: 'coordination_load', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('CONTROL: the matching context DOES stamp user_assumption (the negatives are not vacuous)', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'coordination_load', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_assumption');
  });
});
