/**
 * ⛔ AN ADOPTED ASSUMPTION MUST BE STORED AS AN ASSUMPTION, NOT AS THE USER'S OWN FIGURE.
 *
 * Panel #63 5811761386 item 6. Olumi proposes a starting point, the user says
 * yes, and the capability applies each value through the product's own
 * `applyFactorValueEdit` — whose writer stamps `observed_state.source =
 * USER_EDIT_SOURCE` (`user_override`) because it was built for the inspector,
 * where the user types the number. Registered as-is, one "yes" to Olumi's
 * numbers stored them as the user's own: the UI labels them "User edited", the
 * readiness authority (`obligation-provenance.ts`) classifies them
 * `user_stated`, and one of them is enough to lift the whole model to a
 * comparative-leader claim (`analysis-admission.ts`).
 *
 * The contract already names the honest literal — `user_assumption`, member of
 * `OBSERVED_STATE_SOURCE_LITERALS` (@talchain/schemas 0.55), accepted by CEE's
 * own `ObservedStateV3`, labelled "Your assumption" by the UI, classified
 * `user_ratified` (a human act, not authorship) and sampled wide. Nothing is
 * invented here.
 *
 * The fake product is the one `one-approval-starting-point.test.ts` uses, with
 * the register route's own byte rules added: the stored graph is what
 * `GraphStateIngressSchema` admits and `projectGraphForPersistence` persists,
 * so a stamp either of them would strip or rewrite cannot pass here.
 */

import { describe, it, expect } from 'vitest';
import { type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import { createProposal, ProposalStore } from '../proposal.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { ObservedStateV3 } from '../../../schemas/cee-v3.js';
import { censusConfidenceParameters } from '../../admission/analysis-admission.js';
import { earnsAuthorshipCredit, structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const USER = 'user-a';
/** What the user wrote in these rows: a figure is recorded as theirs only when it is here (`stated-by-user.ts`). */
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r', user_text: 'Team size is 6 FTE now.' };

type Node = {
  id: string; kind: string; label: string;
  category?: string;
  observed_state?: Record<string, unknown>;
  scale_frame?: number;
  interventions?: Record<string, unknown> | null;
};

/** Every option wired to Team size only — the real write records a level only on a linked factor. */
const wired = (ns: Node[]) =>
  ns.filter((o) => o.kind === 'option').flatMap((o) => ns.filter((f) => f.id === 'team_size').map((f) => ({
    from: o.id, to: f.id, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive',
  })));

const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  // The user typed this one earlier, through the inspector: it must come out byte-identical.
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE', source: 'user_override' } },
  // No value yet, and the range construction stores for it.
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
];

function fakeProduct() {
  let nodes: Node[] = BASE.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const registered: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) {
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      // The route's own gate and its own persisted form, not a pass-through.
      const parsed = GraphStateIngressSchema.safeParse(b.graph);
      if (!parsed.success) return { status: 400, json: { code: 'GRAPH_CONTRACT_INVALID' } };
      const stored = projectGraphForPersistence(parsed.data, { scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration' });
      registered.push(stored);
      nodes = (stored as { nodes: Node[] }).nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'option_intervention_edit') {
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        nodes = nodes.map((n) => (n.id === ev.option_id
          ? { ...n, interventions: { ...(n.interventions ?? {}), [String(ev.factor_id)]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      if (ev.kind === 'factor_value_edit') {
        // The inspector writer: it stamps the value as the user's own (`USER_EDIT_SOURCE`) and
        // answers with its own committed patch — the served shape `valueWriteCommittedByThisRequest` reads.
        const tid = String(ev.target_id);
        nodes = nodes.map((n) => (n.id === tid
          ? { ...n, observed_state: { ...(n.observed_state ?? {}), value: ev.value, ...(ev.raw_value !== undefined ? { raw_value: ev.raw_value } : {}), source: 'user_override' } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: tid }] } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges: wired(nodes) }, graph_hash: `h${rev}` } };
  };
  const byId = () => Object.fromEntries(nodes.map((n) => [n.id, n]));
  return { d, byId, registered, graph: () => ({ nodes, edges: wired(nodes) }) };
}

const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
const LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
];

async function adoptOlumisStartingPoint() {
  const p = fakeProduct();
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store);
  const proposed = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const kinds = new Set(store.get(String(proposed.proposal_id))!.operations.map((o) => o.op));
  expect([...kinds].sort(), 'the compound path is the one under test').toEqual(['set_factor_value', 'set_option_intervention']);
  expect(store.get(String(proposed.proposal_id))!.provenance.authored_by).toBe('model_proposed');
  const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { p, store, caps, applied };
}

describe('adopting Olumi’s starting point stores its values as the user’s ASSUMPTIONS', () => {
  it('RED-first: the adopted value is persisted with source user_assumption, not user_override', async () => {
    const { p } = await adoptOlumisStartingPoint();
    const os = p.byId().coordination_load.observed_state ?? {};
    // The value itself is unchanged: normalised by the product's own path against the stored range.
    expect(os.value).toBeCloseTo(0.4, 6);
    expect(os.raw_value).toBe(40);
    // Bound by the identity of the literal, not by "anything but user_override".
    expect(os.source).toBe('user_assumption');
    // And it is what the register route actually persisted, not only what we sent.
    const stored = (p.registered.at(-1) as { nodes: Node[] }).nodes.find((n) => n.id === 'coordination_load');
    expect(stored?.observed_state?.source).toBe('user_assumption');
  });

  it('the stamp is one CEE’s own validator accepts — the next edit on this model is not refused', async () => {
    const { p } = await adoptOlumisStartingPoint();
    expect(ObservedStateV3.safeParse(p.byId().coordination_load.observed_state).success).toBe(true);
  });

  it('CONTRAST: a factor the approval did not value keeps its source byte-identical', async () => {
    const { p } = await adoptOlumisStartingPoint();
    expect(p.byId().team_size.observed_state).toEqual(BASE.find((n) => n.id === 'team_size')!.observed_state);
  });

  it('CONTRAST: when the user then types their OWN number, the product’s writer stamps it as theirs', async () => {
    const { p } = await adoptOlumisStartingPoint();
    const event = { kind: 'factor_value_edit' as const, target_id: 'coordination_load', value: 55 };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: '0b0f6a1e-9f7c-4d5e-8a1b-2c3d4e5f6a7b', scenario_id: SCENARIO, stage: 'frame', event } as never,
      event: event as never,
      requestId: 'r2',
      persistedGraph: p.graph(),
      priorFacts: [],
    });
    expect(res.kind, JSON.stringify(res)).toBe('mutated');
    const after = ((res as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes).find((n) => n.id === 'coordination_load');
    expect(after?.observed_state?.source).toBe('user_override');
  });

  /**
   * ⛔ A MIXED STARTING POINT (Codex 5825325926 / 5825446207): the user's own revision beside Olumi's
   * figure, with levels — the compound path. Each value keeps its own author, in the stamp AND in what
   * the approval tells the Agent.
   */
  it('RED: a mixed starting point keeps the user’s revision theirs and says so', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeStartingPoint(ctx, {
      assumptions: [...ASSUMPTIONS, { factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true }],
      option_levels: LEVELS,
    } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const shown = store.get(String(proposed.proposal_id))!;
    expect([...new Set(shown.operations.map((o) => o.op))].sort(), 'the compound path').toEqual(['set_factor_value', 'set_option_intervention']);
    expect(shown.provenance.authored_by).toBe('model_proposed');
    const applied = await caps.authoriseChange(ctx, { proposal_id: shown.proposal_id });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().team_size.observed_state).toMatchObject({ raw_value: 6, source: 'user_override' });
    expect(p.byId().coordination_load.observed_state).toMatchObject({ raw_value: 40, source: 'user_assumption' });
    const said = String(applied.not_represented);
    expect(said).toContain('Team size is the user’s own figure, stored as theirs.');
    expect(said).toContain('Coordination load is Olumi’s figure that the user adopted as an assumption');
    expect(said).toContain('The option levels are the user’s adopted assumptions too');
  });

  it('CONTRAST: a proposal the USER authored is not relabelled — the writer’s own stamp stands', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const olumi = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
    const shown = store.get(String(olumi.proposal_id))!;
    // The same operations, on the same base, authored by the user.
    store.discard(shown.proposal_id);
    const theirs = createProposal({
      scenario_id: shown.scenario_id,
      user_id: shown.user_id,
      base_graph_identity_hash: shown.base_graph_identity_hash,
      operations: shown.operations,
      provenance: { authored_by: 'user_stated', basis: 'figures the user gave' },
      validation: shown.validation,
      public_label: shown.public_label,
    });
    store.put(theirs);
    const applied = await caps.authoriseChange(ctx, { proposal_id: theirs.proposal_id });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().coordination_load.observed_state?.source).toBe('user_override');
  });

  it('tells the Agent the values are now marked as assumptions and the levels still are not', async () => {
    const { applied } = await adoptOlumisStartingPoint();
    const note = String(applied.not_represented ?? '');
    // Said per value since Codex 5825446207 (a mixed approval has two authors).
    expect(note).toMatch(/Coordination load is Olumi’s figure that the user adopted as an assumption, not a measurement, stored as the user’s assumption\./);
    expect(note).toMatch(/option levels .* carry no such mark/);
    expect(note).not.toMatch(/records no mark distinguishing the two/);
  });
});

/**
 * (vii) THE CONSEQUENCE THE STAMP EXISTS FOR: the admission census — the authority
 * behind `comparative_leader` (`analysis-admission.ts` `censusConfidenceParameters`,
 * which reads `obligation-provenance.ts` and derives no authorship rule of its own) —
 * must not count an adopted Olumi value as the user's own figure. Read from the bytes
 * the register route actually persisted, not from what was sent.
 */
describe('(vii) after approval, the admission census does not count adopted values as user-stated', () => {
  it('⛔ the adopted value earns NO authorship credit; the census counts only the figure the user typed', async () => {
    const { p } = await adoptOlumisStartingPoint();
    const stored = p.registered.at(-1) as { nodes: Node[] };
    const adopted = stored.nodes.find((n) => n.id === 'coordination_load');
    // Bound by identity: THIS node, through the ONE authorship authority.
    expect(structureProvenance(adopted, stored)).toBe('user_ratified');
    expect(earnsAuthorshipCredit(structureProvenance(adopted, stored))).toBe(false);
    const census = censusConfidenceParameters({ ...stored, edges: p.graph().edges });
    // Exactly one user-stated parameter: `team_size`, which the user typed earlier.
    expect(census.confidence_parameters_user_stated).toBe(1);
    expect(structureProvenance(stored.nodes.find((n) => n.id === 'team_size'), stored)).toBe('user_stated');
  });

  it('⭐ CONTRAST: the same bytes stamped as the writer stamps them WOULD have counted — the probe can see it', async () => {
    const { p } = await adoptOlumisStartingPoint();
    const stored = p.registered.at(-1) as { nodes: Node[] };
    const asOverride = {
      ...stored,
      edges: p.graph().edges,
      nodes: stored.nodes.map((n) => (n.id === 'coordination_load'
        ? { ...n, observed_state: { ...n.observed_state, source: 'user_override' } } : n)),
    };
    expect(censusConfidenceParameters(asOverride).confidence_parameters_user_stated).toBe(2);
  });
});

/**
 * ⛔ REVIEW OF #1851 (B2, 5824285143): the stamp covered only the COMPOUND path. Olumi's values
 * approved WITHOUT levels — a standalone `propose_assumptions`, or a starting point whose level
 * half was not made — took the single-kind `factor_value_edit` path, and the inspector writer
 * stamped them `user_override`: counted as the user's own figure, able to license a leader.
 * ⛔ OPEN for Olumi-authored values-only proposals (the fix belongs at the writer; see the
 * OPEN GAP note in `agent-capabilities.ts`). Pinned here: a revision the USER named keeps the
 * writer's path and its user's-own-figure stamp, so the future writer-side adoption stamp
 * cannot relabel the user's own figure.
 */
describe('values-only: a revision the USER named keeps the writer’s path and stamp', () => {
  it('CONTRAST: a revision the USER named (revise: true, their number) keeps the writer’s user_override', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true }],
    } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(store.get(String(proposed.proposal_id))!.provenance.authored_by).toBe('user_stated');
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().team_size.observed_state?.source).toBe('user_override');
    expect(p.registered, 'the writer path, not a register').toHaveLength(0);
  });
});
